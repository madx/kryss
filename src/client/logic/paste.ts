import type { Task, TodoDocument, TodoList } from "../../shared/types";
import { cloneDoc, type TaskPath } from "./paths";
import type { Register } from "./register";

/** Where the cursor is: a task or subtask, or a list header (`task` absent). */
export type PasteTarget = { list: number; task?: number; child?: number };
export type PasteResult = { doc: TodoDocument; path: TaskPath } | { doc: TodoDocument; list: number };

/**
 * Pastes a task (PRD 5.12): on a header it becomes the first task of the list, on a top-level task it goes right after its subtree,
 * on a subtask it becomes the next subtask, unless it has children, in which case it goes to the top level right after the parent.
 * A pasted subtask becomes a top-level task on a top-level task.
 * An unchecked task pasted as a subtask unchecks its parent.
 */
export function pasteTask(doc: TodoDocument, task: Task, target: PasteTarget): { doc: TodoDocument; path: TaskPath } | null {
  const list = doc.lists[target.list];
  if (!list || (target.task !== undefined && !list.tasks[target.task])) return null;
  if (target.child !== undefined && !list.tasks[target.task!]!.children?.[target.child]) return null;
  const next = cloneDoc(doc);
  const tasks = next.lists[target.list]!.tasks;
  const copy = structuredClone(task);
  if (target.task === undefined) {
    tasks.unshift(copy);
    return { doc: next, path: { list: target.list, task: 0 } };
  }
  if (target.child === undefined || copy.children?.length) {
    const at = target.task + 1;
    tasks.splice(at, 0, copy);
    return { doc: next, path: { list: target.list, task: at } };
  }
  const parent = tasks[target.task]!;
  const at = target.child + 1;
  parent.children!.splice(at, 0, { text: copy.text, done: copy.done });
  if (!copy.done) parent.done = false;
  return { doc: next, path: { list: target.list, task: target.task, child: at } };
}

/** Pastes a copy of a list right after the list `after`. */
export function pasteList(doc: TodoDocument, list: TodoList, after: number): { doc: TodoDocument; list: number } | null {
  if (!doc.lists[after]) return null;
  const next = cloneDoc(doc);
  next.lists.splice(after + 1, 0, structuredClone(list));
  return { doc: next, list: after + 1 };
}

/** Pastes the register at the cursor. An empty register, or a target that does not exist, gives `null`. */
export function paste(doc: TodoDocument, register: Register | null, target: PasteTarget): PasteResult | null {
  if (!register) return null;
  return register.kind === "task" ? pasteTask(doc, register.task, target) : pasteList(doc, register.list, target.list);
}
