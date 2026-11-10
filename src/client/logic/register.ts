import { serializeList, serializeTask } from "../../shared/serializer";
import type { Task, TodoDocument, TodoList } from "../../shared/types";
import { getNode, type TaskPath } from "./paths";

/** The content of the register (PRD 5.12): a task with its subtree or a list with its tasks, as a self-contained copy. */
export type Register = { kind: "task"; task: Task } | { kind: "list"; list: TodoList };

export function copyTask(doc: TodoDocument, path: TaskPath): Register | null {
  const task = getNode(doc, path);
  return task ? { kind: "task", task: structuredClone(task) } : null;
}

export function copyList(doc: TodoDocument, list: number): Register | null {
  const found = doc.lists[list];
  return found ? { kind: "list", list: structuredClone(found) } : null;
}

/** Canonical Markdown of the register, for the clipboard. */
export function registerText(register: Register): string {
  return register.kind === "task" ? serializeTask(register.task) : serializeList(register.list);
}
