// Sort by due date (PRD 5.21): pure functions, with the immutable and `null` conventions of PRD 5.7.
import type { Task, TodoDocument, TodoList } from "../../shared/types";
import { findDueRange } from "../markdown/inline";
import type { Stop } from "./cursor";
import { changedPaths, cloneDoc, pathsByNode, samePath, type PathMove } from "./paths";
import { duePeriod } from "./due";

/** The last day of a due date, and the precision of its period (0 day, 1 week, 2 quarter) for ties. */
export type SortDate = { end: string; rank: number };

/** `lists[i]` is the old index of the list now at index `i`. `moves` are the tasks whose path changed. */
export type SortResult = { doc: TodoDocument; moves: PathMove[]; lists: number[] };

/** The sort date of one text: its last valid due date, or null. */
export function dueSortDate(text: string): SortDate | null {
  const value = findDueRange(text)?.value;
  const period = value ? duePeriod(value) : null;
  if (!value || !period) return null;
  return { end: period.end, rank: value.includes("W") ? 1 : value.includes("Q") ? 2 : 0 };
}

/** Ascending order, with a missing date after every date and equal dates as 0 (so that a stable sort keeps the order). */
export function compareSortDates(a: SortDate | null, b: SortDate | null): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return a.end < b.end ? -1 : a.end > b.end ? 1 : a.rank - b.rank;
}

const earliest = (a: SortDate | null, b: SortDate | null) => (compareSortDates(a, b) <= 0 ? a : b);

/** The earliest date of a task and its subtasks, leaving the checked ones out when `uncheckedOnly`. */
function earliestIn(task: Task, uncheckedOnly: boolean): SortDate | null {
  let best = uncheckedOnly && task.done ? null : dueSortDate(task.text);
  for (const child of task.children ?? []) best = earliest(best, earliestIn(child, uncheckedOnly));
  return best;
}

/** An unchecked task counts its unchecked subtree, a checked one its whole subtree. */
export function taskSortDate(task: Task): SortDate | null {
  return earliestIn(task, !task.done);
}

/** The earliest date among the unchecked tasks of a list, subtasks included. */
export function listSortDate(list: TodoList): SortDate | null {
  return list.tasks.reduce<SortDate | null>((best, task) => earliest(best, earliestIn(task, true)), null);
}

/** Sorts tasks in place in two groups, unchecked then checked, each by sort date. Stable. */
function sortTasks(tasks: Task[]): void {
  const keyed = tasks.map((task) => ({ task, date: taskSortDate(task) }));
  keyed.sort((a, b) => Number(a.task.done) - Number(b.task.done) || compareSortDates(a.date, b.date));
  keyed.forEach((k, i) => (tasks[i] = k.task));
  for (const task of tasks) if (task.children) sortTasks(task.children);
}

function result(after: TodoDocument, order: number[], before: ReturnType<typeof pathsByNode>): SortResult | null {
  const moves = changedPaths(before, after);
  const listsChanged = order.some((old, i) => old !== i);
  return moves.length === 0 && !listsChanged ? null : { doc: after, moves, lists: order };
}

const identity = (doc: TodoDocument) => doc.lists.map((_, i) => i);

/** Sorts the tasks of one list. Null when the order does not change or the list does not exist. */
export function sortList(doc: TodoDocument, list: number): SortResult | null {
  if (!doc.lists[list]) return null;
  const next = cloneDoc(doc);
  const before = pathsByNode(next);
  sortTasks(next.lists[list]!.tasks);
  return result(next, identity(doc), before);
}

/** Sorts the tasks of every list on its own. Null when no order changes. */
export function sortAll(doc: TodoDocument): SortResult | null {
  const next = cloneDoc(doc);
  const before = pathsByNode(next);
  for (const list of next.lists) sortTasks(list.tasks);
  return result(next, identity(doc), before);
}

/** Sorts the lists by their sort date and leaves their tasks alone. Null when the order does not change. */
export function sortLists(doc: TodoDocument): SortResult | null {
  const next = cloneDoc(doc);
  const before = pathsByNode(next);
  const keyed = next.lists.map((list, old) => ({ list, old, date: listSortDate(list) }));
  keyed.sort((a, b) => compareSortDates(a.date, b.date));
  next.lists = keyed.map((k) => k.list);
  return result(next, keyed.map((k) => k.old), before);
}

/** Where a stop is after a sort: a header follows its list, a task follows its path. */
export function sortedStop(stop: Stop, sorted: SortResult): Stop {
  if (stop.kind === "header") return { kind: "header", list: sorted.lists.indexOf(stop.list) };
  const move = sorted.moves.find((m) => samePath(m.from, stop.path));
  return move ? { kind: "task", path: move.to } : stop;
}
