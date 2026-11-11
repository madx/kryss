// Global keyboard shortcuts: undo and redo, and the pure key resolver of PRD 5.9.
import type { CursorMove } from "./logic/cursor";
import type { AddAt } from "./logic/insert";

export type Pending = "" | "g" | "d" | "y" | "c" | "s";
/** field = text input or editor focused (Insert), control = button or selector. */
export type TargetKind = "task" | "header" | "none" | "field" | "control";
export type Overlay = "none" | "cheatsheet";
export type { CursorMove } from "./logic/cursor";
export type { AddAt } from "./logic/insert";
export type Action =
  | { type: "cursor"; to: CursorMove } | { type: "view"; dir: "next" | "prev" }
  | { type: "toggle" } | { type: "edit" } | { type: "delete" } | { type: "indent" } | { type: "outdent" }
  | { type: "move"; dir: "up" | "down" } | { type: "undo" } | { type: "redo" }
  | { type: "add"; at: AddAt } | { type: "new-list" } | { type: "toggle-help" }
  | { type: "focus-cursor" }
  | { type: "toggle-markdown" } | { type: "copy-markdown" }
  | { type: "change" } | { type: "yank" } | { type: "paste" } | { type: "set-due" };
export type KeyInput = {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean;
  target: TargetKind; pending: Pending; overlay: Overlay; markdownView: boolean;
};
export type Resolution = { action: Action | null; pending: Pending; preventDefault: boolean };

const NOTHING: Resolution = { action: null, pending: "", preventDefault: false };
const done = (action: Action | null, preventDefault = true): Resolution => ({ action, pending: "", preventDefault });

/** Keys that act on both tasks and list headers (`J` / `K` move the task or the list). */
function commonKey(key: string, onHeader: boolean): Action | null {
  switch (key) {
    case "j": case "ArrowDown": return { type: "cursor", to: "next" };
    case "k": case "ArrowUp": return { type: "cursor", to: "prev" };
    case "G": return { type: "cursor", to: "last" };
    case "h": return { type: "cursor", to: "prev-header" };
    case "l": return { type: "cursor", to: "next-header" };
    case "H": return { type: "view", dir: "prev" };
    case "L": return { type: "view", dir: "next" };
    case "J": return { type: "move", dir: "down" };
    case "K": return { type: "move", dir: "up" };
    case "Delete": return { type: "delete" };
    case "i": case "Enter": return { type: "edit" };
    case "u": return { type: "undo" };
    case "U": return { type: "redo" };
    case "N": return { type: "new-list" };
    case "p": return { type: "paste" };
    case "?": return { type: "toggle-help" };
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

/** Keys while the Markdown view is open (PRD 5.11): everything that changes a task is ignored. */
function resolveMarkdownKey({ key, pending, altKey }: KeyInput): Resolution {
  if (altKey) return NOTHING;
  if (pending === "g" && key === "m") return done({ type: "toggle-markdown" });
  if (pending === "y" && key === "y") return done({ type: "copy-markdown" });
  if (pending) return NOTHING;
  if (key === "g") return { action: null, pending: "g", preventDefault: true };
  if (key === "y") return { action: null, pending: "y", preventDefault: true };
  switch (key) {
    case "Escape": return done({ type: "toggle-markdown" });
    case "H": return done({ type: "view", dir: "prev" });
    case "L": return done({ type: "view", dir: "next" });
    case "?": return done({ type: "toggle-help" });
    default: return NOTHING;
  }
}

/** Resolves a key press into an action, the next pending prefix and whether to prevent the default. */
export function resolveKey(input: KeyInput): Resolution {
  const { key, target, pending, overlay } = input;
  const onHeader = target === "header";

  if (overlay === "cheatsheet") {
    if (key === "?" || key === "Escape") return done({ type: "toggle-help" });
    // The overlay holds no focus, so plain keys are swallowed to keep the page behind it still.
    return { action: null, pending: "", preventDefault: !input.ctrlKey && !input.metaKey && !input.altKey };
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

  if (pending === "g" && key === "m") return done({ type: "toggle-markdown" });
  if (pending === "g" && key === "g") return done({ type: "cursor", to: "first" });
  if (pending === "d" && key === "d") return done({ type: "delete" });
  if (pending === "c" && key === "c") return done({ type: "change" });
  if (pending === "y" && key === "y") return done({ type: "yank" });
  if (pending === "s" && key === "d") return done(onHeader ? null : { type: "set-due" });
  if (pending) return NOTHING;
  if (key === "g" || key === "d" || key === "c" || key === "y" || key === "s") return { action: null, pending: key, preventDefault: true };

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
