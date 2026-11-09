import type { Task, TodoDocument } from "../../shared/types";

/** Address of a task (`child` absent) or a subtask (`child` set). All indices are 0-based. */
export type TaskPath = { list: number; task: number; child?: number };

/** Result of an operation that creates or moves a task: the new document and the new path of the task. */
export type OpResult = { doc: TodoDocument; path: TaskPath };

export function cloneDoc(doc: TodoDocument): TodoDocument {
  return structuredClone(doc);
}

export function isSubtaskPath(path: TaskPath): boolean {
  return path.child !== undefined;
}

export function samePath(a: TaskPath, b: TaskPath): boolean {
  return a.list === b.list && a.task === b.task && a.child === b.child;
}

/** Path of the parent of a subtask, or undefined for a top-level task. */
export function parentPath(path: TaskPath): TaskPath | undefined {
  return path.child === undefined ? undefined : { list: path.list, task: path.task };
}

/** Returns the task or subtask at `path` (a subtask is typed as Task, without children). */
export function getNode(doc: TodoDocument, path: TaskPath): Task | undefined {
  const task = doc.lists[path.list]?.tasks[path.task];
  if (path.child === undefined) return task;
  return task?.children?.[path.child];
}

/** Single-line text: line breaks become spaces, edges are trimmed. */
export function normalizeText(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** Finds the path of a node by identity (used on freshly cloned documents). */
export function findPath(doc: TodoDocument, node: Task): TaskPath | undefined {
  for (let l = 0; l < doc.lists.length; l++) {
    const tasks = doc.lists[l]!.tasks;
    for (let t = 0; t < tasks.length; t++) {
      if (tasks[t] === node) return { list: l, task: t };
      const c = tasks[t]!.children?.indexOf(node) ?? -1;
      if (c >= 0) return { list: l, task: t, child: c };
    }
  }
  return undefined;
}

/** Drops an empty `children` array so the JSON stays canonical. */
export function pruneChildren(task: Task): void {
  if (task.children && task.children.length === 0) delete task.children;
}

/** After a subtask left `parent`: if it still has subtasks and all are checked, it becomes checked. With no subtask left, its state is unchanged (PRD 5.3). */
export function recomputeParent(parent: Task): void {
  if (parent.children?.length && parent.children.every((c) => c.done)) parent.done = true;
}
