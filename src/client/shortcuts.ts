// Global keyboard shortcuts: undo and redo.

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
