import type { Task, TodoDocument, TodoList } from "../../shared/types";
import type { TaskPath } from "./paths";

/** The content of the register (PRD 5.12): a task with its subtree or a list with its tasks, as a self-contained copy. */
export type Register = { kind: "task"; task: Task } | { kind: "list"; list: TodoList };

export function copyTask(_doc: TodoDocument, _path: TaskPath): Register | null {
  return null;
}

export function copyList(_doc: TodoDocument, _list: number): Register | null {
  return null;
}

/** Canonical Markdown of the register, for the clipboard. */
export function registerText(_register: Register): string {
  return "";
}
