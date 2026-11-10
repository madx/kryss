import type { TodoDocument } from "../../shared/types";
import { copyTask, type Register } from "./register";
import {
  cloneDoc,
  getNode,
  isSubtaskPath,
  normalizeText,
  pruneChildren,
  recomputeParent,
  type OpResult,
  type TaskPath,
} from "./paths";

/**
 * Toggles a task or subtask with the PRD 5.3 rules.
 * Checking a parent checks its children, unchecking a parent changes only the parent.
 * A subtask toggle checks the parent when all children are checked and unchecks it otherwise.
 * Returns the same document if the path is invalid.
 */
export function toggleDone(doc: TodoDocument, path: TaskPath): TodoDocument {
  if (!getNode(doc, path)) return doc;
  const next = cloneDoc(doc);
  const node = getNode(next, path)!;
  node.done = !node.done;
  const task = next.lists[path.list]!.tasks[path.task]!;
  if (path.child === undefined) {
    if (node.done) for (const child of task.children ?? []) child.done = true;
  } else {
    task.done = task.children!.every((c) => c.done);
  }
  return next;
}

/** Adds a top-level task to a list (default: at the end). Empty text is refused (null). */
export function addTask(doc: TodoDocument, list: number, text: string, index?: number): OpResult | null {
  const clean = normalizeText(text);
  if (!doc.lists[list] || clean === "") return null;
  const next = cloneDoc(doc);
  const tasks = next.lists[list]!.tasks;
  const at = Math.max(0, Math.min(index ?? tasks.length, tasks.length));
  tasks.splice(at, 0, { text: clean, done: false });
  return { doc: next, path: { list, task: at } };
}

/** Adds a subtask to a top-level task (default: last) and unchecks the parent. */
export function addChild(doc: TodoDocument, parent: TaskPath, text: string, index?: number): OpResult | null {
  const clean = normalizeText(text);
  if (isSubtaskPath(parent) || !getNode(doc, parent) || clean === "") return null;
  const next = cloneDoc(doc);
  const task = next.lists[parent.list]!.tasks[parent.task]!;
  const children = (task.children ??= []);
  const at = Math.max(0, Math.min(index ?? children.length, children.length));
  children.splice(at, 0, { text: clean, done: false });
  task.done = false;
  return { doc: next, path: { list: parent.list, task: parent.task, child: at } };
}

/** Adds an unchecked sibling right after the task or subtask at `path` (Enter key). */
export function addSibling(doc: TodoDocument, path: TaskPath, text: string): OpResult | null {
  if (!getNode(doc, path)) return null;
  return path.child === undefined
    ? addTask(doc, path.list, text, path.task + 1)
    : addChild(doc, { list: path.list, task: path.task }, text, path.child + 1);
}

/** Deletes a task (with its subtasks) or a subtask. Deleting the last unchecked subtask checks the parent, deleting the last subtask leaves its state unchanged. */
export function deleteTask(doc: TodoDocument, path: TaskPath): TodoDocument {
  if (!getNode(doc, path)) return doc;
  const next = cloneDoc(doc);
  const task = next.lists[path.list]!.tasks[path.task]!;
  if (path.child === undefined) {
    next.lists[path.list]!.tasks.splice(path.task, 1);
  } else {
    task.children!.splice(path.child, 1);
    pruneChildren(task);
    recomputeParent(task);
  }
  return next;
}

/** Changes the text. Empty text is refused (same document returned). */
export function editText(doc: TodoDocument, path: TaskPath, text: string): TodoDocument {
  const clean = normalizeText(text);
  const node = getNode(doc, path);
  if (!node || clean === "" || node.text === clean) return doc;
  const next = cloneDoc(doc);
  getNode(next, path)!.text = clean;
  return next;
}


/** Like `deleteTask`, and also returns the removed task as a register. Unknown path: `null`. */
export function cutTask(doc: TodoDocument, path: TaskPath): { doc: TodoDocument; register: Register } | null {
  const register = copyTask(doc, path);
  return register ? { doc: deleteTask(doc, path), register } : null;
}
