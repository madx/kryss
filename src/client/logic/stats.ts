import type { TodoDocument, TodoList } from "../../shared/types";
import type { VisibleList } from "./filter";

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

/** Counts the visible tasks and subtasks of one list. */
export function countVisibleList(list: TodoList, visible: VisibleList): Counts {
  const counts = { done: 0, total: 0 };
  for (const { task, children } of visible.tasks) {
    const source = list.tasks[task]!;
    for (const node of [source, ...children.map((c) => source.children![c]!)]) {
      counts.total++;
      if (node.done) counts.done++;
    }
  }
  return counts;
}

/** Counts the visible tasks and subtasks of the visible lists. */
export function countVisible(doc: TodoDocument, visible: VisibleList[]): Counts {
  const counts = { done: 0, total: 0 };
  for (const v of visible) {
    const c = countVisibleList(doc.lists[v.list]!, v);
    counts.done += c.done;
    counts.total += c.total;
  }
  return counts;
}
