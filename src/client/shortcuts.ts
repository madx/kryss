// Global keyboard shortcuts: undo and redo, and the pure key resolver of PRD 5.9.
import type { CursorMove } from "./logic/cursor";
import type { AddAt } from "./logic/insert";
import type { PastePlace } from "./logic/paste";

export type Pending = "" | "g" | "d" | "y" | "c" | "s" | "f";
/** field = text input or editor focused (Insert), control = button or selector. */
export type TargetKind = "task" | "header" | "none" | "field" | "control";
export type Overlay = "none" | "cheatsheet";
export type { CursorMove } from "./logic/cursor";
export type { AddAt } from "./logic/insert";
export type Action =
  | { type: "cursor"; to: CursorMove }
  | { type: "toggle" } | { type: "edit" } | { type: "delete" } | { type: "indent" } | { type: "outdent" }
  | { type: "move"; dir: "up" | "down" } | { type: "move-list"; dir: "up" | "down" } | { type: "undo" } | { type: "redo" }
  | { type: "add"; at: AddAt } | { type: "new-list" } | { type: "toggle-help" }
  | { type: "focus-cursor" }
  | { type: "toggle-markdown" } | { type: "copy-markdown" }
  | { type: "change" } | { type: "yank" } | { type: "paste"; at: PastePlace } | { type: "set-due" } | { type: "change-list" } | { type: "move-to-list" } | { type: "open-link" } | { type: "link-picker" }
  | { type: "search-start" } | { type: "search-next" } | { type: "search-prev" } | { type: "search-end" }
  | { type: "focus-filter" } | { type: "set-filter"; text: string } | { type: "filter-list" } | { type: "filter-picker" } | { type: "toggle-siblings" } | { type: "file-picker" };
export type KeyInput = {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean;
  target: TargetKind; pending: Pending; overlay: Overlay; markdownView: boolean; search: boolean;
  /** Number of links in the text of the task under the cursor (PRD 5.20). */
  links: number;
};
export type Resolution = { action: Action | null; pending: Pending; preventDefault: boolean };

const NOTHING: Resolution = { action: null, pending: "", preventDefault: false };
const done = (action: Action | null, preventDefault = true): Resolution => ({ action, pending: "", preventDefault });

/** Keys that act on both tasks and list headers (`J` / `K` move the task or the list, `H` / `L` always move the list). */
function commonKey(key: string, onHeader: boolean): Action | null {
  switch (key) {
    case "j": case "ArrowDown": return { type: "cursor", to: "next" };
    case "k": case "ArrowUp": return { type: "cursor", to: "prev" };
    case "G": return { type: "cursor", to: "last" };
    case "h": return { type: "cursor", to: "prev-header" };
    case "l": return { type: "cursor", to: "next-header" };
    case "J": return { type: "move", dir: "down" };
    case "K": return { type: "move", dir: "up" };
    case "H": return { type: "move-list", dir: "up" };
    case "L": return { type: "move-list", dir: "down" };
    case "Delete": return { type: "delete" };
    case "i": case "Enter": return { type: "edit" };
    case "u": return { type: "undo" };
    case "U": return { type: "redo" };
    case "+": return { type: "new-list" };
    case "p": return { type: "paste", at: "after" };
    case "P": return { type: "paste", at: "before" };
    case "/": return { type: "search-start" };
    case "o": return { type: "add", at: onHeader ? "list-start" : "below" };
    case "a": return { type: "add", at: onHeader ? "list-start" : "child-end-or-below" };
    case "I": return { type: "add", at: onHeader ? "list-start" : "first-child" };
    case "A": return { type: "add", at: onHeader ? "list-end" : "last-child" };
    default: return null;
  }
}

/** Keys that only make sense on a task. */
function taskKey(key: string): Action | null {
  switch (key) {
    case "x": case " ": return { type: "toggle" };
    case "F2": return { type: "edit" };
    case ">": return { type: "indent" };
    case "<": return { type: "outdent" };
    case "O": return { type: "add", at: "above" };
    default: return null;
  }
}

const set = (text: string): Action => ({ type: "set-filter", text });

/** The second key of `f`: each one replaces the filter text, focuses the bar or opens the saved filters (PRD 5.14), or null. */
function filterKey(key: string): Action | null {
  switch (key) {
    case "a": return set("");
    case "t": return set("due:today,overdue");
    case "w": return set("due:week,overdue");
    case "l": return { type: "filter-list" };
    case "x": return set("is:done");
    case "X": return set("is:todo");
    case "f": return { type: "focus-filter" };
    case "s": return { type: "filter-picker" };
    default: return null;
  }
}

/** The second key of `g`: the file picker (PRD 5.16) or the cheat sheet, or null. */
function goKey(key: string): Action | null {
  switch (key) {
    case "o": return { type: "file-picker" };
    case "?": return { type: "toggle-help" };
    default: return null;
  }
}

/** Keys while the Markdown view is open (PRD 5.11): everything that changes a task is ignored. */
function resolveMarkdownKey({ key, pending, altKey }: KeyInput): Resolution {
  if (altKey) return NOTHING;
  if (pending === "s" && key === "m") return done({ type: "toggle-markdown" });
  if (pending === "s" && key === "h") return done({ type: "toggle-siblings" });
  if (pending === "g" && goKey(key)) return done(goKey(key));
  if (pending === "f" && filterKey(key)) return done(filterKey(key));
  if (pending === "y" && key === "y") return done({ type: "copy-markdown" });
  if (pending) return NOTHING;
  if (key === "g" || key === "s" || key === "y" || key === "f") return { action: null, pending: key, preventDefault: true };
  return key === "Escape" ? done({ type: "toggle-markdown" }) : NOTHING;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock"]);

/** Resolves a key press into an action, the next pending prefix and whether to prevent the default. */
export function resolveKey(input: KeyInput): Resolution {
  const { key, target, pending, overlay } = input;
  const onHeader = target === "header";

  // Pressing Shift for the second key of `g?` is a key press of its own: it must not drop the prefix.
  if (MODIFIER_KEYS.has(key)) return { action: null, pending, preventDefault: false };

  if (overlay === "cheatsheet") {
    if (key === "Escape" || (pending === "g" && key === "?")) return done({ type: "toggle-help" });
    // The overlay holds no focus, so plain keys are swallowed to keep the page behind it still. `g` still starts `g?`.
    const plain = !input.ctrlKey && !input.metaKey && !input.altKey;
    return { action: null, pending: plain && key === "g" ? "g" : "", preventDefault: plain };
  }
  if (target === "field") return NOTHING;
  if (target === "control") {
    if (key === "Escape" && input.markdownView) return done({ type: "toggle-markdown" });
    if (key === "Escape") return done({ type: "focus-cursor" });
    const undo = (input.ctrlKey || input.metaKey) && !input.markdownView ? undoActionFor(input) : null;
    return undo ? done({ type: undo }) : NOTHING;
  }

  if (input.markdownView) return input.ctrlKey || input.metaKey ? NOTHING : resolveMarkdownKey(input);
  if (input.ctrlKey || input.metaKey) {
    const undo = undoActionFor(input);
    return undo ? done({ type: undo }) : NOTHING;
  }
  if (input.altKey) {
    if (key !== "ArrowDown" && key !== "ArrowUp") return NOTHING;
    return done({ type: "move", dir: key === "ArrowDown" ? "down" : "up" });
  }

  if (pending === "s" && key === "m") return done({ type: "toggle-markdown" });
  if (pending === "s" && key === "h") return done({ type: "toggle-siblings" });
  if (pending === "g" && goKey(key)) return done(goKey(key));
  if (pending === "g" && key === "x") return done(target !== "task" || input.links === 0 ? null : { type: input.links === 1 ? "open-link" : "link-picker" });
  if (pending === "f" && filterKey(key)) return done(filterKey(key));
  if (pending === "g" && key === "g") return done({ type: "cursor", to: "first" });
  if (pending === "d" && key === "d") return done({ type: "delete" });
  if (pending === "c" && key === "c") return done({ type: "change" });
  if (pending === "c" && key === "d") return done(onHeader ? null : { type: "set-due" });
  if (pending === "c" && key === "L") return done({ type: "change-list" });
  if (pending === "c" && key === "l") return done(onHeader ? null : { type: "move-to-list" });
  if (pending === "y" && key === "y") return done({ type: "yank" });
  if (pending) return NOTHING;
  if (key === "g" || key === "d" || key === "c" || key === "y" || key === "s" || key === "f") return { action: null, pending: key, preventDefault: true };

  if (input.search && key === "Escape") return done({ type: "search-end" });
  if (input.search && key === "n") return done({ type: "search-next" });
  if (input.search && key === "N") return done({ type: "search-prev" });

  const action = commonKey(key, onHeader) ?? (onHeader ? null : taskKey(key));
  return action ? done(action) : NOTHING;
}

export type UndoAction = "undo" | "redo";

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };

/** Maps a key event to an undo action. Ctrl+Z undoes, Ctrl+Shift+Z (or Ctrl+Y) redoes. */
export function undoActionFor(e: KeyLike): UndoAction | null {
  if (e.altKey || !(e.ctrlKey || e.metaKey)) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && !e.shiftKey) return "redo";
  return null;
}

/** Text fields keep their own undo, so the global one must stay out of the way. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" && (target as HTMLInputElement).type === "text"
    || target.tagName === "TEXTAREA"
    || target.isContentEditable;
}
