import type { TodoDocument } from "../../shared/types";
import type { TaskPath } from "./paths";

/** A place the keyboard cursor can rest on: a list header or a task or subtask. */
export type Stop = { kind: "header"; list: number } | { kind: "task"; path: TaskPath };

/** Visible list range, inclusive; same shape as ListBounds in move.ts. */
export type Range = { first: number; last: number };

export type CursorMove = "next" | "prev" | "first" | "last" | "next-header" | "prev-header";

/** Flat sequence of stops in document order: header, its tasks, each task followed by its subtasks. */
export function stops(_doc: TodoDocument, _range?: Range): Stop[] {
  throw new Error("not implemented");
}

/** New cursor index after a move. No wrap-around; -1 when there is no stop. */
export function moveCursor(_stops: Stop[], _index: number, _to: CursorMove): number {
  throw new Error("not implemented");
}

/** -1 when `count` is 0, else `index` clamped to [0, count - 1]. */
export function clampIndex(_count: number, _index: number): number {
  throw new Error("not implemented");
}

/** Non-negative integer string to number, anything else to null. */
export function parseStoredIndex(_raw: string | null): number | null {
  throw new Error("not implemented");
}

/** Index of `target` in `stops`, or -1 when absent. */
export function indexOfStop(_stops: Stop[], _target: Stop): number {
  throw new Error("not implemented");
}

/** First stop (document order, over `after`) whose title, text, done state or position differs from `before`; null when identical or undeterminable. */
export function firstChanged(_before: TodoDocument, _after: TodoDocument): Stop | null {
  throw new Error("not implemented");
}
