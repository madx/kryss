import type { TodoDocument } from "../../shared/types";
import type { TaskPath, OpResult } from "./paths";

export type AddAt = "below" | "above" | "child-end-or-below" | "first-child" | "last-child" | "list-start" | "list-end";
export type Anchor = { kind: "header"; list: number } | { kind: "task"; path: TaskPath };
/** Where a new task goes: top-level of `list` at `index`, or subtask of top-level task `parent` of `list` at `index`. */
export type InsertTarget = { list: number; parent?: number; index: number };

export function insertTarget(_doc: TodoDocument, _at: AddAt, _anchor: Anchor): InsertTarget | null {
  throw new Error("not implemented");
}

export function commitInsert(_doc: TodoDocument, _target: InsertTarget, _text: string): OpResult | null {
  throw new Error("not implemented");
}
