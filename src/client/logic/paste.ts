import type { Task, TodoDocument, TodoList } from "../../shared/types";
import type { TaskPath } from "./paths";
import type { Register } from "./register";

/** Where the cursor is: a task or subtask, or a list header (`task` absent). */
export type PasteTarget = { list: number; task?: number; child?: number };
export type PasteResult = { doc: TodoDocument; path: TaskPath } | { doc: TodoDocument; list: number };

export function pasteTask(_doc: TodoDocument, _task: Task, _target: PasteTarget): { doc: TodoDocument; path: TaskPath } | null {
  return null;
}

export function pasteList(_doc: TodoDocument, _list: TodoList, _after: number): { doc: TodoDocument; list: number } | null {
  return null;
}

/** Pastes the register at the cursor. An empty register, or a target that does not exist, gives `null`. */
export function paste(_doc: TodoDocument, _register: Register | null, _target: PasteTarget): PasteResult | null {
  return null;
}
