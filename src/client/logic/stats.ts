import type { TodoDocument } from "../../shared/types";

export type Counts = { done: number; total: number };
export type Statusline = { view: Counts; document: Counts; list: number; lists: number };

export function countTasks(doc: TodoDocument, range?: { first: number; last: number }): Counts {
  const first = Math.max(0, range?.first ?? 0);
  const last = Math.min(doc.lists.length - 1, range?.last ?? doc.lists.length - 1);
  const counts = { done: 0, total: 0 };
  for (const list of doc.lists.slice(first, Math.max(first, last + 1))) {
    for (const task of list.tasks) {
      for (const node of [task, ...(task.children ?? [])]) {
        counts.total++;
        if (node.done) counts.done++;
      }
    }
  }
  return counts;
}

export function statusline(
  doc: TodoDocument,
  range: { first: number; last: number },
  cursorList: number | null,
): Statusline {
  return {
    view: countTasks(doc, range),
    document: countTasks(doc),
    list: cursorList === null ? 0 : cursorList + 1,
    lists: doc.lists.length,
  };
}
