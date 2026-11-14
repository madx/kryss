// The single global keydown listener: resolves the key with the pure `resolveKey`, then applies the action to the focused stop.
import type { TodoDocument } from "../../shared/types";
import { indent, moveDown, moveUp, outdent, type OpResult, type TaskPath } from "../logic";
import { firstChanged, moveCursor, type Stop } from "../logic/cursor";
import type { AddAt, Anchor } from "../logic/insert";
import type { PastePlace } from "../logic/paste";
import { visibleStops } from "../logic/filter";
import { visibleOf } from "./visible";
import { getNode } from "../logic/paths";
import { taskLinks, type TaskLink } from "../logic/task-links";
import { isTextField, resolveKey, type Action, type Overlay, type Pending, type TargetKind } from "../shortcuts";
import type { Store } from "../store";
import type { Cursor } from "./cursor";
import { stopOf } from "./cursor";
import { isEditing } from "./edit-text";
import { BEGIN_EDIT, CHANGE_EDIT, DUE_EDIT } from "./task-row";

/** What the keyboard layer needs from the app: operations that touch its render state. */
export type KeyboardEnv = {
  store: Store;
  cursor: Cursor;
  cheatsheet: { open(): void; close(): void; isOpen(): boolean };
  /** Applies a pure operation and focuses the task at its new path. */
  apply(result: OpResult | null): void;
  /** Toggles the task at `path` (the due date rewrite and the pin included) and keeps the focus on it. */
  toggle(path: TaskPath): void;
  /** The filter bar and the saved filter picker (PRD 5.14). */
  filters: { focus(): void; set(text: string): void; startList(): void; openPicker(): void };
  /** The file picker of a Vault (PRD 5.16): it does nothing in single-file mode. */
  files: { openPicker(): void };
  renameList(list: number): void;
  /** The register keys (PRD 5.12): they fill the register and the clipboard, or paste. `cut` deletes at once, a list included. */
  registerKeys: { yank(stop: Stop): void; cut(stop: Stop): void; paste(stop: Stop, at: PastePlace): void };
  /** `cl` on a task: opens the list picker below its row. */
  moveToList(path: TaskPath): void;
  /** `gx` (PRD 5.20): opens the only link of a task, or the picker of its links. */
  openLink(path: TaskPath, link: TaskLink): void;
  linkPicker(path: TaskPath, links: TaskLink[]): void;
  /** `gX`: the same with the URL copied to the clipboard instead of opened. */
  copyLink(link: TaskLink): void;
  copyLinkPicker(path: TaskPath, links: TaskLink[]): void;
  /** `cc` on a header: opens the name input with no text. */
  changeList(list: number): void;
  /** Incremental search (PRD 5.15). `step` moves the cursor to the next or previous match. */
  search: { active(): boolean; start(): void; step(dir: "next" | "prev"): void; end(): void };
  /** `J` / `K` on a header: moves the list down or up, over the visible lists under a filter. */
  moveList(list: number, dir: "up" | "down", focus?: Stop): void;
  /** `Sl`, `SL`, `SA` (PRD 5.21): `stop` is the cursor, null when it has none. */
  sort(kind: "list" | "lists" | "all", stop: Stop | null): void;
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
  if (target.closest(".markdown-view")) return "none"; // the copy button must not swallow the keys of the view
  if (CONTROL_TAGS.has(target.tagName) || target.tabIndex >= 0) return "control";
  return "none";
}

/** Actions that make sense when the page holds no document. */
const NO_DOCUMENT_ACTIONS = new Set<Action["type"]>(["toggle-help", "toggle-markdown", "copy-markdown", "focus-filter", "clear-focus-filter", "set-filter", "filter-list", "filter-picker", "file-picker"]);

export function installKeyboard(env: KeyboardEnv): void {
  const { store, cursor } = env;
  let pending: Pending = "";

  window.addEventListener("focusout", () => {
    pending = ""; // a blur cancels a pending prefix
  });

  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing) return; // already handled, e.g. by the editor that just closed
    const state = store.getState();
    const overlay: Overlay = env.cheatsheet.isOpen() ? "cheatsheet" : "none";
    const at = cursor.current();
    const cursorLinks = pending === "g" && at?.kind === "task" && state.doc ? taskLinks(getNode(state.doc, at.path)?.text ?? "") : [];
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
      search: env.search.active(),
      links: cursorLinks.length,
    });
    pending = res.pending;
    if (res.preventDefault) e.preventDefault();
    if (res.action && (state.doc || NO_DOCUMENT_ACTIONS.has(res.action.type))) run(res.action);
  });

  function run(action: Action): void {
    const doc = store.getState().doc!;
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
      case "new-list":
        env.newList();
        return;
      case "search-start":
        env.search.start();
        return;
      case "search-next":
      case "search-prev":
        env.search.step(action.type === "search-next" ? "next" : "prev");
        return;
      case "search-end":
        env.search.end();
        return;
      case "focus-cursor":
        cursor.focusIndex(cursor.last());
        return;
      case "focus-filter":
        env.filters.focus();
        return;
      case "clear-focus-filter":
        env.filters.set(""); // like fa, then like ff: the bar keeps the focus
        env.filters.focus();
        return;
      case "set-filter":
        env.filters.set(action.text);
        cursor.focusIndex(0); // the first visible stop
        return;
      case "filter-list":
        env.filters.startList();
        return;
      case "filter-picker":
        env.filters.openPicker();
        return;
      case "file-picker":
        env.files.openPicker();
        return;
      case "toggle-siblings":
        store.toggleSiblings();
        return;
      case "sort-list": {
        const at = cursor.current();
        if (at) env.sort("list", at); // with no cursor there is no list to sort
        return;
      }
      case "sort-lists":
      case "sort-all":
        env.sort(action.type === "sort-lists" ? "lists" : "all", cursor.current());
        return;
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
    if (action.type === "change-list") return env.changeList(current.kind === "header" ? current.list : current.path.list);
    if (action.type === "yank") return env.registerKeys.yank(current);
    if (action.type === "paste") return env.registerKeys.paste(current, action.at);
    if (action.type === "move-list") {
      const list = current.kind === "header" ? current.list : current.path.list;
      env.moveList(list, action.dir, current.kind === "header" ? undefined : current);
      return;
    }
    if (current.kind === "header") {
      if (action.type === "edit") env.renameList(current.list);
      else if (action.type === "change") env.changeList(current.list);
      else if (action.type === "delete") {
        env.registerKeys.cut(current);
        cursor.focusIndex(index); // same position, clamped
      } else if (action.type === "move") env.moveList(current.list, action.dir);
      return;
    }

    const path = current.path;
    switch (action.type) {
      case "toggle":
        env.toggle(path);
        return;
      case "edit":
        document.activeElement?.closest(".task-row")?.dispatchEvent(new Event(BEGIN_EDIT));
        return;
      case "change":
        document.activeElement?.closest(".task-row")?.dispatchEvent(new Event(CHANGE_EDIT));
        return;
      case "move-to-list":
        env.moveToList(path);
        return;
      case "open-link":
      case "link-picker":
      case "copy-link":
      case "copy-link-picker": {
        const links = taskLinks(getNode(doc, path)?.text ?? "");
        const first = links[0];
        if (!first) return;
        if (action.type === "open-link") env.openLink(path, first);
        else if (action.type === "copy-link") env.copyLink(first);
        else if (action.type === "link-picker") env.linkPicker(path, links);
        else env.copyLinkPicker(path, links);
        return;
      }
      case "set-due":
        document.activeElement?.closest(".task-row")?.dispatchEvent(new Event(DUE_EDIT));
        return;
      case "delete":
        env.registerKeys.cut(current);
        cursor.focusIndex(index); // same position: the next stop, or the previous one when the last was deleted
        return;
      case "indent":
        env.apply(indent(doc, path, visibleOf(store.getState()) ?? undefined));
        return;
      case "outdent":
        env.apply(outdent(doc, path));
        return;
      case "move": {
        const visible = visibleOf(store.getState()) ?? undefined;
        env.apply(action.dir === "up" ? moveUp(doc, path, visible) : moveDown(doc, path, visible));
        return;
      }
    }
  }

  function cursorStops(): Stop[] {
    const visible = visibleOf(store.getState());
    return visible ? visibleStops(visible) : [];
  }
}
