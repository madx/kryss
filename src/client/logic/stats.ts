import type { TodoDocument } from "../../shared/types";

export type Counts = { done: number; total: number };
export type Statusline = { view: Counts; document: Counts; list: number; lists: number };

export function countTasks(_doc: TodoDocument, _range?: { first: number; last: number }): Counts {
  throw new Error("not implemented");
}

export function statusline(
  _doc: TodoDocument,
  _range: { first: number; last: number },
  _cursorList: number | null,
): Statusline {
  throw new Error("not implemented");
}
