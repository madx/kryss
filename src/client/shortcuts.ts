// Global keyboard shortcuts: undo and redo, and the pure key resolver of PRD 5.9.

export type Pending = "" | "g" | "d";
/** field = text input or editor focused (Insert), control = button or selector. */
export type TargetKind = "task" | "header" | "none" | "field" | "control";
export type Overlay = "none" | "cheatsheet" | "confirm-delete";
export type CursorMove = "next" | "prev" | "first" | "last" | "next-header" | "prev-header";
export type AddAt = "below" | "above" | "child-end-or-below" | "first-child" | "last-child" | "list-start" | "list-end";
export type Action =
  | { type: "cursor"; to: CursorMove } | { type: "view"; dir: "next" | "prev" }
  | { type: "toggle" } | { type: "edit" } | { type: "delete" } | { type: "indent" } | { type: "outdent" }
  | { type: "move"; dir: "up" | "down" } | { type: "undo" } | { type: "redo" }
  | { type: "add"; at: AddAt } | { type: "new-list" } | { type: "toggle-help" }
  | { type: "focus-cursor" } | { type: "confirm" } | { type: "cancel" };
export type KeyInput = {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean;
  target: TargetKind; pending: Pending; overlay: Overlay;
};
export type Resolution = { action: Action | null; pending: Pending; preventDefault: boolean };

/** Resolves a key press into an action, the next pending prefix and whether to prevent the default. */
export function resolveKey(input: KeyInput): Resolution {
  void input;
  throw new Error("not implemented");
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
