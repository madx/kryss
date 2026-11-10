import type { TodoDocument } from "../../shared/types";

/** A document snapshot with the view ("All" is null, otherwise a list index) that was active when the change was made. */
export type Entry = { doc: TodoDocument; view: number | null };

/** Global in-memory undo / redo stack made of document snapshots (documents are never mutated, so no copy). */
export type History = { past: Entry[]; future: Entry[] };

export const MAX_HISTORY = 100;

export function createHistory(): History {
  return { past: [], future: [] };
}

/** Records the document as it was BEFORE a change, and the view the change is made in. Clears the redo stack. */
export function push(history: History, previous: TodoDocument, view: number | null = null): History {
  return { past: [...history.past, { doc: previous, view }].slice(-MAX_HISTORY), future: [] };
}

export type Step = { history: History; doc: TodoDocument; view: number | null };

/** Restores the last snapshot, with the view of the change it undoes. `current` goes to the redo stack. Null if there is nothing to undo. */
export function undo(history: History, current: TodoDocument): Step | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return { doc: entry.doc, view: entry.view, history: { past: history.past.slice(0, -1), future: [...history.future, { doc: current, view: entry.view }] } };
}

/** Reverse of undo. Null if there is nothing to redo. */
export function redo(history: History, current: TodoDocument): Step | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) return null;
  return { doc: entry.doc, view: entry.view, history: { past: [...history.past, { doc: current, view: entry.view }], future: history.future.slice(0, -1) } };
}

/** Empties both stacks (page reload, external change). */
export function clear(): History {
  return createHistory();
}

export const canUndo = (h: History): boolean => h.past.length > 0;
export const canRedo = (h: History): boolean => h.future.length > 0;
