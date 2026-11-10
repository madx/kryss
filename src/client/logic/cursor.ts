import type { TodoDocument } from "../../shared/types";
import { getNode, samePath, type TaskPath } from "./paths";

/** A place the keyboard cursor can rest on: a list header or a task or subtask. */
export type Stop = { kind: "header"; list: number } | { kind: "task"; path: TaskPath };

/** Visible list range, inclusive; same shape as ListBounds in move.ts. */
export type Range = { first: number; last: number };

export type CursorMove = "next" | "prev" | "first" | "last" | "next-header" | "prev-header";

/** Flat sequence of stops in document order: header, its tasks, each task followed by its subtasks. */
export function stops(doc: TodoDocument, range?: Range): Stop[] {
  const out: Stop[] = [];
  const first = range?.first ?? 0;
  const last = Math.min(range?.last ?? doc.lists.length - 1, doc.lists.length - 1);
  for (let list = Math.max(first, 0); list <= last; list++) {
    out.push({ kind: "header", list });
    doc.lists[list]!.tasks.forEach((task, t) => {
      out.push({ kind: "task", path: { list, task: t } });
      task.children?.forEach((_, child) => out.push({ kind: "task", path: { list, task: t, child } }));
    });
  }
  return out;
}

/** New cursor index after a move. No wrap-around; -1 when there is no stop. */
export function moveCursor(stops: Stop[], index: number, to: CursorMove): number {
  const n = stops.length;
  if (n === 0) return -1;
  switch (to) {
    case "next":
      return Math.min(index + 1, n - 1);
    case "prev":
      return Math.max(index - 1, 0);
    case "first":
      return 0;
    case "last":
      return n - 1;
    case "next-header":
      for (let i = index + 1; i < n; i++) if (stops[i]!.kind === "header") return i;
      return index;
    case "prev-header":
      for (let i = index - 1; i >= 0; i--) if (stops[i]!.kind === "header") return i;
      return index;
  }
}

/** -1 when `count` is 0, else `index` clamped to [0, count - 1]. */
export function clampIndex(count: number, index: number): number {
  return count <= 0 ? -1 : Math.min(Math.max(index, 0), count - 1);
}

/** Non-negative integer string to number, anything else to null. */
export function parseStoredIndex(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** Index of `target` in `stops`, or -1 when absent. */
export function indexOfStop(stops: Stop[], target: Stop): number {
  return stops.findIndex((s) => sameStop(s, target));
}

/** First stop (document order, over `after`) whose title, text, done state or position differs from `before`; null when identical or undeterminable. */
export function firstChanged(before: TodoDocument, after: TodoDocument): Stop | null {
  const a = stops(before);
  const b = stops(after);
  for (let i = 0; i < b.length; i++) {
    const s = b[i]!;
    const prev = a[i];
    if (!prev || !sameStop(prev, s) || content(before, prev) !== content(after, s)) return s;
  }
  return null;
}

function sameStop(a: Stop, b: Stop): boolean {
  if (a.kind === "header") return b.kind === "header" && a.list === b.list;
  return b.kind === "task" && samePath(a.path, b.path);
}

function content(doc: TodoDocument, s: Stop): string {
  if (s.kind === "header") return doc.lists[s.list]?.title ?? "";
  const node = getNode(doc, s.path);
  return JSON.stringify([node?.text, node?.done]);
}
