import type { TodoDocument, TodoList } from "../../shared/types";

/** The lists as they were before a change, with the filter text that was active when the change was made. Saved filters are never part of it. */
export type Entry = { lists: TodoList[]; filter: string };

/** Global in-memory undo / redo stack made of snapshots of the lists (documents are never mutated, so no copy). */
export type History = { past: Entry[]; future: Entry[] };

export const MAX_HISTORY = 100;

export function createHistory(): History {
  return { past: [], future: [] };
}

/** Records the lists as they were BEFORE a change, and the filter text the change is made under. Clears the redo stack. */
export function push(history: History, previous: TodoDocument, filter = ""): History {
  return { past: [...history.past, { lists: previous.lists, filter }].slice(-MAX_HISTORY), future: [] };
}

export type Step = { history: History; doc: TodoDocument; filter: string };

/** Restores the last snapshot, with the filter text of the change it undoes. `current` goes to the redo stack. Null if there is nothing to undo. */
export function undo(history: History, current: TodoDocument): Step | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    doc: { ...current, lists: entry.lists },
    filter: entry.filter,
    history: { past: history.past.slice(0, -1), future: [...history.future, { lists: current.lists, filter: entry.filter }] },
  };
}

/** Reverse of undo. Null if there is nothing to redo. */
export function redo(history: History, current: TodoDocument): Step | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) return null;
  return {
    doc: { ...current, lists: entry.lists },
    filter: entry.filter,
    history: { past: [...history.past, { lists: current.lists, filter: entry.filter }], future: history.future.slice(0, -1) },
  };
}

/** Empties both stacks (page reload, external change). */
export function clear(): History {
  return createHistory();
}

export const canUndo = (h: History): boolean => h.past.length > 0;
export const canRedo = (h: History): boolean => h.future.length > 0;
