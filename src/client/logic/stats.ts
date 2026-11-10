import type { TodoDocument, TodoList } from "../../shared/types";

export type Counts = { done: number; total: number };

/** Counts the tasks and subtasks of one list. */
export function countList(list: TodoList): Counts {
  const counts = { done: 0, total: 0 };
  for (const task of list.tasks) {
    for (const node of [task, ...(task.children ?? [])]) {
      counts.total++;
      if (node.done) counts.done++;
    }
  }
  return counts;
}

export function countTasks(doc: TodoDocument, range?: { first: number; last: number }): Counts {
  const first = Math.max(0, range?.first ?? 0);
  const last = Math.min(doc.lists.length - 1, range?.last ?? doc.lists.length - 1);
  const counts = { done: 0, total: 0 };
  for (const list of doc.lists.slice(first, Math.max(first, last + 1))) {
    const c = countList(list);
    counts.done += c.done;
    counts.total += c.total;
  }
  return counts;
}
