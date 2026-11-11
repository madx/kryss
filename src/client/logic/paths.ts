import type { Task, TodoDocument } from "../../shared/types";

/** Address of a task (`child` absent) or a subtask (`child` set). All indices are 0-based. */
export type TaskPath = { list: number; task: number; child?: number };

/** A node that changed path in a move. */
export type PathMove = { from: TaskPath; to: TaskPath };

/**
 * Result of an operation that creates or moves a task: the new document and the new path of the task.
 * A move also lists every node whose path changed (the moved subtree and the siblings it shifted), so that the pins can follow.
 */
export type OpResult = { doc: TodoDocument; path: TaskPath; moves?: PathMove[] };

/** Path of every node of the document, by identity. */
export function pathsByNode(doc: TodoDocument): Map<Task, TaskPath> {
  const map = new Map<Task, TaskPath>();
  doc.lists.forEach((list, l) =>
    list.tasks.forEach((task, t) => {
      map.set(task, { list: l, task: t });
      task.children?.forEach((child, c) => map.set(child, { list: l, task: t, child: c }));
    }),
  );
  return map;
}

/** The nodes of `after` that are at another path than in `before`, where `after` was cloned from `before` and `before` paths come from `pathsByNode`. */
export function changedPaths(before: Map<Task, TaskPath>, after: TodoDocument): PathMove[] {
  const moves: PathMove[] = [];
  for (const [node, to] of pathsByNode(after)) {
    const from = before.get(node);
    if (from && !samePath(from, to)) moves.push({ from, to });
  }
  return moves;
}

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
