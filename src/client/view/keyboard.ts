// The single global keydown listener: resolves the key with the pure `resolveKey`, then applies the action to the focused stop.
import type { TodoDocument } from "../../shared/types";
import { deleteTask, indent, moveDown, moveUp, outdent, toggleDone, type OpResult, type TaskPath } from "../logic";
import { firstChanged, moveCursor, stops as stopsOf, type Stop } from "../logic/cursor";
import type { AddAt, Anchor } from "../logic/insert";
import { cycleView, visibleRange } from "../logic/views";
import { isTextField, resolveKey, type Action, type Overlay, type Pending, type TargetKind } from "../shortcuts";
import type { Store } from "../store";
import type { Cursor } from "./cursor";
import { stopOf } from "./cursor";
import { isEditing } from "./edit-text";
import { BEGIN_EDIT } from "./task-row";

/** What the keyboard layer needs from the app: operations that touch its render state. */
export type KeyboardEnv = {
  store: Store;
  cursor: Cursor;
  cheatsheet: { open(): void; close(): void; isOpen(): boolean };
  /** Applies a pure operation and focuses the task at its new path. */
  apply(result: OpResult | null): void;
  /** Commits a document and focuses the given path. */
  commitFocus(doc: TodoDocument, path: TaskPath): void;
  renameList(list: number): void;
  /** `dd` on a header: deletes an empty list at once, asks for confirmation otherwise. */
  deleteList(list: number): void;
  /** The list whose deletion awaits an answer, if any. */
  confirming(): number | null;
  confirmDelete(list: number): void;
  cancelDelete(): void;
  beginAdd(at: AddAt, anchor: Anchor): void;
  newList(): void;
  markdown: { isOpen(): boolean; toggle(): void; copy(): void };
};

const CONTROL_TAGS = new Set(["BUTTON", "SELECT", "A", "SUMMARY", "TEXTAREA", "INPUT"]);

export function targetKind(target: EventTarget | null): TargetKind {
  if (!(target instanceof HTMLElement)) return "none";
  if (isEditing() || isTextField(target)) return "field";
  const stop = stopOf(target);
  if (stop) return stop.kind === "header" ? "header" : "task";
  if (CONTROL_TAGS.has(target.tagName) || target.tabIndex >= 0) return "control";
  return "none";
}

export function installKeyboard(env: KeyboardEnv): void {
  const { store, cursor } = env;
  let pending: Pending = "";

  window.addEventListener("focusout", () => {
    pending = ""; // a blur cancels a pending prefix
  });

  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing) return; // already handled, e.g. by the editor that just closed
    const state = store.getState();
    const overlay: Overlay = env.cheatsheet.isOpen() ? "cheatsheet" : env.confirming() !== null ? "confirm-delete" : "none";
    const res = resolveKey({
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      target: targetKind(e.target),
      pending,
      overlay,
      markdownView: env.markdown.isOpen(),
    });
    pending = res.pending;
    if (res.preventDefault) e.preventDefault();
    if (res.action && (state.doc || res.action.type === "toggle-help" || res.action.type === "toggle-markdown" || res.action.type === "copy-markdown")) run(res.action);
  });

  function run(action: Action): void {
    const doc = store.getState().doc!;
    const selected = store.getState().selected;
    switch (action.type) {
      case "toggle-help":
        if (env.cheatsheet.isOpen()) env.cheatsheet.close();
        else env.cheatsheet.open();
        return;
      case "toggle-markdown":
        env.markdown.toggle();
        return;
      case "copy-markdown":
        env.markdown.copy();
        return;
      case "confirm": {
        const list = env.confirming();
        if (list !== null) env.confirmDelete(list);
        return;
      }
      case "cancel": {
        const list = env.confirming();
        env.cancelDelete();
        if (list !== null) cursor.focusStop({ kind: "header", list });
        return;
      }
      case "new-list":
        env.newList();
        return;
      case "focus-cursor":
        cursor.focusIndex(cursor.last());
        return;
      case "view": {
        const next = cycleView(selected, doc.lists.length, action.dir);
        store.select(next);
        const first = visibleRange(next, doc.lists.length).first;
        if (doc.lists[first]) cursor.focusStop({ kind: "header", list: first });
        return;
      }
      case "undo":
      case "redo": {
        const before = doc;
        const index = cursor.hasFocus() ? cursor.index() : cursor.last();
        if (!(action.type === "undo" ? store.undo() : store.redo())) return;
        const after = store.getState().doc;
        const changed = after && firstChanged(before, after);
        if (!changed || !cursor.focusStop(changed)) cursor.focusIndex(index); // undeterminable or in a hidden list
        return;
      }
    }

    // The remaining actions act on the cursor. With none yet, the first key only puts it on the first stop.
    const current = cursor.current();
    if (!current) {
      cursor.focusIndex(cursor.last() >= 0 ? cursor.last() : 0);
      return;
    }
    const index = cursor.index();

    if (action.type === "cursor") {
      const all = cursorStops();
      cursor.focusIndex(moveCursor(all, index, action.to));
      return;
    }
    if (action.type === "add") {
      env.beginAdd(action.at, current.kind === "header" ? { kind: "header", list: current.list } : { kind: "task", path: current.path });
      return;
    }
    if (current.kind === "header") {
      if (action.type === "edit") env.renameList(current.list);
      else if (action.type === "delete") env.deleteList(current.list);
      return;
    }

    const path = current.path;
    switch (action.type) {
      case "toggle":
        env.commitFocus(toggleDone(doc, path), path);
        return;
      case "edit":
        document.activeElement?.closest(".task-row")?.dispatchEvent(new Event(BEGIN_EDIT));
        return;
      case "delete":
        store.commit(deleteTask(doc, path));
        cursor.focusIndex(index); // same position: the next stop, or the previous one when the last was deleted
        return;
      case "indent":
        env.apply(indent(doc, path));
        return;
      case "outdent":
        env.apply(outdent(doc, path));
        return;
      case "move": {
        const range = visibleRange(selected, doc.lists.length);
        env.apply(action.dir === "up" ? moveUp(doc, path, range) : moveDown(doc, path, range));
        return;
      }
    }
  }

  function cursorStops(): Stop[] {
    const { doc, selected } = store.getState();
    return doc ? stopsOf(doc, visibleRange(selected, doc.lists.length)) : [];
  }
}
