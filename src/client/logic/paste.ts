import type { Task, TodoDocument, TodoList } from "../../shared/types";
import { cloneDoc, type TaskPath } from "./paths";
import type { Register } from "./register";

/** Where the cursor is: a task or subtask, or a list header (`task` absent). */
export type PasteTarget = { list: number; task?: number; child?: number };
/** Below / after the cursor row or list (`p`), or above / before it (`P`). */
export type PastePlace = "after" | "before";
export type PasteResult = { doc: TodoDocument; path: TaskPath } | { doc: TodoDocument; list: number };

/**
 * Pastes a task (PRD 5.12): on a header it becomes the first task of the list, on a top-level task it goes right after its subtree,
 * on a subtask it becomes the next subtask, unless it has children, in which case it goes to the top level right after the parent.
 * A pasted subtask becomes a top-level task on a top-level task.
 * `before` mirrors it: right before a top-level task, as the previous subtask, or before the parent for a task with children.
 * On a header both places give the first task.
 * An unchecked task pasted as a subtask unchecks its parent.
 */
export function pasteTask(doc: TodoDocument, task: Task, target: PasteTarget, at: PastePlace = "after"): { doc: TodoDocument; path: TaskPath } | null {
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
    const index = at === "before" ? target.task : target.task + 1;
    tasks.splice(index, 0, copy);
    return { doc: next, path: { list: target.list, task: index } };
  }
  const parent = tasks[target.task]!;
  const index = at === "before" ? target.child : target.child + 1;
  parent.children!.splice(index, 0, { text: copy.text, done: copy.done });
  if (!copy.done) parent.done = false;
  return { doc: next, path: { list: target.list, task: target.task, child: index } };
}

/** Pastes a copy of a list right after (or, with `before`, right before) the list at index `target`. */
export function pasteList(doc: TodoDocument, list: TodoList, target: number, at: PastePlace = "after"): { doc: TodoDocument; list: number } | null {
  if (!doc.lists[target]) return null;
  const next = cloneDoc(doc);
  const index = at === "before" ? target : target + 1;
  next.lists.splice(index, 0, structuredClone(list));
  return { doc: next, list: index };
}

/** Pastes the register at the cursor. An empty register, or a target that does not exist, gives `null`. */
export function paste(doc: TodoDocument, register: Register | null, target: PasteTarget, at: PastePlace = "after"): PasteResult | null {
  if (!register) return null;
  return register.kind === "task" ? pasteTask(doc, register.task, target, at) : pasteList(doc, register.list, target.list, at);
}
