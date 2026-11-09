import type { TodoDocument } from "../../shared/types";

/** Global in-memory undo / redo stack made of document snapshots (documents are never mutated, so no copy). */
export type History = { past: TodoDocument[]; future: TodoDocument[] };

export const MAX_HISTORY = 200;

export function createHistory(): History {
  return { past: [], future: [] };
}

/** Records the document as it was BEFORE a change. Clears the redo stack. */
export function push(history: History, previous: TodoDocument): History {
  return { past: [...history.past, previous].slice(-MAX_HISTORY), future: [] };
}

/** Restores the last snapshot. `current` goes to the redo stack. Null if there is nothing to undo. */
export function undo(history: History, current: TodoDocument): { history: History; doc: TodoDocument } | null {
  const doc = history.past[history.past.length - 1];
  if (!doc) return null;
  return { doc, history: { past: history.past.slice(0, -1), future: [...history.future, current] } };
}

/** Reverse of undo. Null if there is nothing to redo. */
export function redo(history: History, current: TodoDocument): { history: History; doc: TodoDocument } | null {
  const doc = history.future[history.future.length - 1];
  if (!doc) return null;
  return { doc, history: { past: [...history.past, current], future: history.future.slice(0, -1) } };
}

/** Empties both stacks (page reload, external change). */
export function clear(): History {
  return createHistory();
}

export const canUndo = (h: History): boolean => h.past.length > 0;
export const canRedo = (h: History): boolean => h.future.length > 0;
