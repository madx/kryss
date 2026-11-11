// Client state: document, ETag, sync status, filter text, pinned rows and undo history.
// Everything that changes the document goes through `commit`, everything that comes from the server through `replace`.
// Dependencies (api, timers, storage) are injected so that the state machine can be tested without DOM or network.
import type { ChangeEvent, ParseError, SavedFilter, TodoDocument } from "../shared/types";
import type { Api } from "./api";
import { canRedo, canUndo, clear, createHistory, push, redo as redoHistory, undo as undoHistory } from "./logic";
import { pinTask } from "./logic/filter";
import type { TaskPath } from "./logic/paths";
import { DEBOUNCE_MS, retryDelay, type SyncStatus } from "./sync";

export type StoreState = {
  /** Null until the first successful load, and when the file is invalid and nothing local is held. */
  doc: TodoDocument | null;
  etag: string | null;
  status: SyncStatus;
  /** Set when the file on disk is invalid. The UI shows it in place of the lists. */
  invalid: ParseError | null;
  /** The text of the filter bar (PRD 5.14). Empty shows everything. */
  filter: string;
  /** Tasks that stay visible until the filter text changes, even when they do not match. */
  pins: TaskPath[];
  canUndo: boolean;
  canRedo: boolean;
};

/** "content": everything may have changed (full render). "status": only the sync status changed. */
/** `external` is a content change coming from the disk (load, SSE, take the disk version), as opposed to a local edit. */
export type ChangeKind = "content" | "external" | "status";

export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export const FILTER_KEY = "todoapp.filter";
/** The key of the list selector, which no longer exists. It is removed on start. */
export const OLD_SELECTION_KEY = "todoapp.selectedList";

/** What a local change says about the rows it touches, so that they stay visible under a filter. */
export type CommitOptions = {
  /** The task to keep visible until the filter text changes. */
  pin?: TaskPath;
  /** `pin` was just added or pasted: the pins at or after it shift. */
  inserted?: boolean;
  /** A delete: the pins are dropped. */
  clearPins?: boolean;
};

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export function createStore(deps: { api: Api; timers?: Timers; storage?: Storage }) {
  const { api } = deps;
  const timers = deps.timers ?? realTimers;
  const storage = deps.storage;

  let doc: TodoDocument | null = null;
  let etag: string | null = null;
  let status: SyncStatus = "saving";
  let invalid: ParseError | null = null;
  let history = createHistory();
  let filter = readFilter();
  let pins: TaskPath[] = [];
  let dirty = false; // local changes not on disk yet
  let inFlight = false;
  let attempts = 0;
  let saveTimer: unknown;
  let retryTimer: unknown;
  let conflictEtag: string | null = null; // ETag of the disk version when in conflict
  let externalEvent: ChangeEvent | null = null; // external change announced while a PUT was in flight
  const listeners = new Set<(state: StoreState, kind: ChangeKind) => void>();

  function readFilter(): string {
    try {
      storage?.removeItem(OLD_SELECTION_KEY);
      return storage?.getItem(FILTER_KEY) ?? "";
    } catch {
      return "";
    }
  }

  function storeFilter() {
    try {
      storage?.setItem(FILTER_KEY, filter);
    } catch {}
  }

  function getState(): StoreState {
    return {
      doc,
      etag,
      status,
      invalid,
      filter,
      pins,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
    };
  }

  function emit(kind: ChangeKind) {
    const state = getState();
    for (const fn of listeners) fn(state, kind);
  }

  function setStatus(next: SyncStatus) {
    if (status === next) return;
    status = next;
    emit("status");
  }

  function stopTimers() {
    timers.clear(saveTimer);
    timers.clear(retryTimer);
    saveTimer = retryTimer = undefined;
  }

  function scheduleSave(ms: number) {
    timers.clear(saveTimer);
    saveTimer = timers.set(() => {
      saveTimer = undefined;
      void save();
    }, ms);
  }

  function scheduleRetry(fn: () => void) {
    timers.clear(retryTimer);
    retryTimer = timers.set(() => {
      retryTimer = undefined;
      fn();
    }, retryDelay(attempts++));
  }

  /** Registers a local change and schedules the autosave (unless the state forbids saving). */
  function markDirty() {
    dirty = true;
    if (status === "conflict" || status === "invalid" || status === "offline") return;
    if (!inFlight) setStatus("unsaved");
    scheduleSave(DEBOUNCE_MS);
  }

  /** Applies a document produced by the UI. The single entry point for local changes. */
  function commit(next: TodoDocument, options: CommitOptions = {}) {
    if (!doc || next === doc) return;
    history = push(history, doc, filter);
    if (options.clearPins) pins = [];
    if (options.pin) pins = pinTask(pins, options.pin, options.inserted);
    doc = next;
    markDirty();
    emit("content");
  }

  /** Applies a document received from the server and clears the history. */
  function replace(next: TodoDocument, nextEtag: string) {
    stopTimers();
    doc = next;
    etag = nextEtag;
    history = clear();
    pins = [];
    dirty = false;
    invalid = null;
    conflictEtag = externalEvent = null;
    attempts = 0;
    status = "saved";
    emit("external");
  }

  /** The file on disk is invalid and nothing local is kept. */
  function replaceInvalid(error: ParseError) {
    stopTimers();
    doc = null;
    etag = null;
    history = clear();
    pins = [];
    dirty = false;
    conflictEtag = externalEvent = null;
    invalid = error;
    status = "invalid";
    emit("external");
  }

  /** Loads the document from the server. Silent when nothing changed. */
  async function reload(force = false): Promise<void> {
    const result = await api.load();
    // Edits made while the GET was in flight win: the next PUT answers 409 if the disk changed.
    if (!force && dirty) return;
    if (result.kind === "ok") {
      if (!force && doc && result.etag === etag) return;
      replace(result.doc, result.etag);
    } else if (result.kind === "invalid") {
      replaceInvalid(result.error);
    } else if (!doc) {
      status = "offline";
      emit("content");
      scheduleRetry(() => void reload());
    }
  }

  async function save(): Promise<void> {
    if (inFlight || !dirty || !doc || etag === null || status === "conflict" || status === "invalid") return;
    inFlight = true;
    timers.clear(retryTimer);
    retryTimer = undefined;
    const snapshot = doc;
    setStatus("saving");
    const result = await api.save(snapshot, etag);
    inFlight = false;

    if (result.kind === "ok") {
      etag = result.etag;
      attempts = 0;
      if (doc === snapshot) {
        dirty = false;
        status = "saved";
        // The server returns the canonical document; adopt it when it differs (e.g. trimmed text), without touching the history.
        const canonical = JSON.stringify(result.doc) !== JSON.stringify(snapshot);
        if (canonical) doc = result.doc;
        emit(canonical ? "content" : "status"); // no full render when nothing changed: it would drop what the user is typing
      } else {
        status = "unsaved"; // more changes were made while saving: they go out in the next PUT
        emit("status");
        if (saveTimer === undefined) scheduleSave(0);
      }
      const announced = externalEvent;
      externalEvent = null;
      if (announced !== null) onExternalChange(announced);
    } else if (result.kind === "conflict") {
      stopTimers();
      conflictEtag = result.etag;
      setStatus("conflict");
    } else if (result.kind === "invalid") {
      stopTimers();
      invalid = result.error;
      status = "invalid";
      emit("content");
    } else if (result.kind === "rejected") {
      // The request itself is wrong (400, 428): retrying cannot help. The next edit tries again.
      stopTimers();
      status = "error";
      emit("status");
    } else {
      status = "offline";
      emit("status");
      scheduleRetry(() => void save());
    }
  }

  /** SSE `change` event: the file was modified by someone else. It carries the new state of the file. */
  function onExternalChange(event: ChangeEvent) {
    if (event.etag === etag) return;
    if (inFlight) {
      externalEvent = event;
    } else if (!dirty) {
      if ("doc" in event) replace(event.doc, event.etag);
      else replaceInvalid(event.error);
    } else {
      stopTimers();
      conflictEtag = event.etag;
      invalid = null;
      status = "conflict";
      emit("content");
    }
  }

  return {
    getState,
    subscribe(fn: (state: StoreState, kind: ChangeKind) => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    load: () => reload(),
    commit,
    replace,
    onExternalChange,
    /** The SSE stream came back after a loss: reload unless local changes are pending (the next PUT will answer 409 if needed). */
    onReconnect() {
      if (!dirty && !inFlight) void reload();
    },
    hasPendingChanges: () => dirty,
    undo(): boolean {
      const result = doc && undoHistory(history, doc);
      if (!result) return false;
      history = result.history;
      doc = result.doc;
      filter = result.filter; // back to the filter text of the change
      pins = [];
      storeFilter();
      markDirty();
      emit("content");
      return true;
    },
    redo(): boolean {
      const result = doc && redoHistory(history, doc);
      if (!result) return false;
      history = result.history;
      doc = result.doc;
      filter = result.filter; // back to the filter text of the change
      pins = [];
      storeFilter();
      markDirty();
      emit("content");
      return true;
    },
    /** Conflict: re-sends the local version with the up-to-date ETag. */
    keepMine() {
      if (status !== "conflict" || conflictEtag === null) return;
      etag = conflictEtag;
      conflictEtag = null;
      status = "unsaved";
      emit("status");
      void save();
    },
    /** Conflict: discards the local changes and loads the file. */
    takeDisk() {
      if (status !== "conflict") return;
      void reload(true);
    },
    /** Sets the filter text. It is not a change of the document: no history, no save. Pins are dropped when the text changes. */
    setFilter(text: string) {
      if (text === filter) return;
      filter = text;
      pins = [];
      storeFilter();
      emit("content");
    },
    /** Replaces the saved filters. Saved like any change of the document, but kept out of the history (PRD 5.14). */
    commitFilters(filters: SavedFilter[]) {
      if (!doc) return;
      doc = { ...doc, filters };
      markDirty();
      emit("content");
    },
  };
}

export type Store = ReturnType<typeof createStore>;
