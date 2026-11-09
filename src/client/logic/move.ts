import type { Task, TodoDocument } from "../../shared/types";
import { cloneDoc, findPath, getNode, parentPath, pruneChildren, recomputeParent, samePath, type OpResult, type TaskPath } from "./paths";

/**
 * Where to drop a task.
 * `before` / `after` / `child` are relative to a target task, `end` appends to a list (also an empty one).
 */
export type Drop =
  | { kind: "before" | "after" | "child"; target: TaskPath }
  | { kind: "end"; list: number };

export type DropRefusal = "invalid" | "self" | "descendant" | "third-level";
export type DropCheck = { ok: true } | { ok: false; reason: DropRefusal };

/** Checks a drop without modifying anything (used for drop zone feedback). */
export function validateDrop(doc: TodoDocument, source: TaskPath, drop: Drop): DropCheck {
  const node = getNode(doc, source);
  if (!node) return refuse("invalid");
  if (drop.kind === "end") return doc.lists[drop.list] ? { ok: true } : refuse("invalid");
  const target = getNode(doc, drop.target);
  if (!target) return refuse("invalid");
  if (samePath(source, drop.target)) return refuse("self");
  // The target is inside the moved subtree: only a top-level source has descendants.
  if (source.child === undefined && drop.target.child !== undefined && drop.target.list === source.list && drop.target.task === source.task) {
    return refuse("descendant");
  }
  // Dropping the only subtask as a child of its own parent would change nothing.
  if (drop.kind === "child" && source.child !== undefined && drop.target.child === undefined && drop.target.list === source.list && drop.target.task === source.task && target.children!.length === 1) {
    return refuse("self");
  }
  const hasChildren = (node.children?.length ?? 0) > 0;
  // A drop becomes a subtask when it is `child`, or before / after a subtask.
  const becomesSubtask = drop.kind === "child" || drop.target.child !== undefined;
  if (becomesSubtask && (hasChildren || (drop.kind === "child" && drop.target.child !== undefined))) {
    return refuse("third-level");
  }
  return { ok: true };
}

function refuse(reason: DropRefusal): DropCheck {
  return { ok: false, reason };
}

/** Where a relocated task lands: a container array, the new parent (subtask case) and the node to insert before (absent: append). */
type Dest = { container: Task[]; parent?: Task; before?: Task };

/** First sibling after `target` that is not `skip` (the moved node, which is about to leave the array). */
function nextSibling(siblings: Task[], target: Task, skip: Task): Task | undefined {
  return siblings.slice(siblings.indexOf(target) + 1).find((t) => t !== skip);
}

/**
 * Moves a node of a cloned document to the destination computed by `locate`, and applies the check rules.
 * The destination is resolved by identity before the removal, since indices shift.
 * Dropping an unchecked task under a different parent unchecks that parent (PRD 5.3).
 * The old parent is recomputed: all remaining subtasks checked means checked.
 * Reordering under the same parent never changes a check state.
 */
function relocate(doc: TodoDocument, source: TaskPath, locate: (next: TodoDocument, node: Task) => Dest): OpResult {
  const next = cloneDoc(doc);
  const node = getNode(next, source)!;
  const oldParent = source.child === undefined ? undefined : next.lists[source.list]!.tasks[source.task]!;
  const dest = locate(next, node);

  const origin = oldParent ? oldParent.children! : next.lists[source.list]!.tasks;
  origin.splice(origin.indexOf(node), 1);
  // Insert before pruning the old parent, so that a destination inside it stays attached.
  const at = dest.before ? dest.container.indexOf(dest.before) : dest.container.length;
  dest.container.splice(at, 0, node);
  if (dest.parent) {
    delete node.children; // a subtask has no children (validated by the callers)
    if (dest.parent !== oldParent && !node.done) dest.parent.done = false;
  }
  if (oldParent) {
    pruneChildren(oldParent);
    if (oldParent !== dest.parent) recomputeParent(oldParent);
  }
  return { doc: next, path: findPath(next, node)! };
}

/**
 * Moves a task with its subtree.
 * Returns null if the drop is refused.
 * `after` a parent that has subtasks inserts the task as its first subtask (unless the task has subtasks itself, then it goes after the whole parent).
 * A drop before or after a subtask inserts at that position among the subtasks.
 */
export function moveTask(doc: TodoDocument, source: TaskPath, drop: Drop): OpResult | null {
  if (!validateDrop(doc, source, drop).ok) return null;
  return relocate(doc, source, (next, node) => {
    if (drop.kind === "end") return { container: next.lists[drop.list]!.tasks };
    const target = getNode(next, drop.target)!;
    const tasks = next.lists[drop.target.list]!.tasks;
    if (drop.kind === "child") return { container: (target.children ??= []), parent: target };
    if (drop.target.child !== undefined) {
      const parent = tasks[drop.target.task]!;
      const siblings = parent.children!;
      return { container: siblings, parent, before: drop.kind === "before" ? target : nextSibling(siblings, target, node) };
    }
    if (drop.kind === "before") return { container: tasks, before: target };
    if (target.children?.length && !node.children?.length) {
      return { container: target.children, parent: target, before: target.children.find((c) => c !== node) };
    }
    return { container: tasks, before: nextSibling(tasks, target, node) };
  });
}

/** Tab: makes the task the last subtask of the previous task of the same list. */
export function indent(doc: TodoDocument, path: TaskPath): OpResult | null {
  if (path.child !== undefined || path.task === 0) return null;
  return moveTask(doc, path, { kind: "child", target: { list: path.list, task: path.task - 1 } });
}

/** Shift+Tab: turns a subtask into a task right after its parent. */
export function outdent(doc: TodoDocument, path: TaskPath): OpResult | null {
  const parent = parentPath(path);
  if (!parent || !getNode(doc, path)) return null;
  return relocate(doc, path, (next, node) => {
    const tasks = next.lists[path.list]!.tasks;
    return { container: tasks, before: nextSibling(tasks, tasks[path.task]!, node) };
  });
}

/** Indices of the first and last visible lists, which bound the keyboard moves. */
export type ListBounds = { first: number; last: number };

function fullBounds(doc: TodoDocument): ListBounds {
  return { first: 0, last: doc.lists.length - 1 };
}

/**
 * Alt+Up moves the task one step up, across parents and lists (PRD 5.2).
 * A top-level task swaps with the previous task, and at the top of a list goes to the end of the previous list.
 * A subtask swaps with the previous subtask, and at the top of its parent becomes the last subtask of the previous top-level task, or does nothing when there is none.
 * Only the visible lists (`bounds`, default: the whole document) are crossed.
 * Null at the very top of the visible lists.
 */
export function moveUp(doc: TodoDocument, path: TaskPath, bounds: ListBounds = fullBounds(doc)): OpResult | null {
  if (!getNode(doc, path)) return null;
  if (path.child === undefined) {
    if (path.task > 0) return moveTask(doc, path, { kind: "before", target: { ...path, task: path.task - 1 } });
    return path.list > bounds.first ? moveTask(doc, path, { kind: "end", list: path.list - 1 }) : null;
  }
  if (path.child > 0) return moveTask(doc, path, { kind: "before", target: { ...path, child: path.child - 1 } });
  return path.task > 0 ? moveTask(doc, path, { kind: "child", target: { list: path.list, task: path.task - 1 } }) : null;
}

/**
 * Alt+Down moves the task one step down, across parents and lists (PRD 5.2).
 * A top-level task swaps with the next task, and at the end of a list goes to the start of the next list.
 * A subtask swaps with the next subtask, and at the end of its parent becomes the first subtask of the next top-level task, or does nothing when there is none.
 * Only the visible lists (`bounds`, default: the whole document) are crossed.
 * Null at the very bottom of the visible lists.
 */
export function moveDown(doc: TodoDocument, path: TaskPath, bounds: ListBounds = fullBounds(doc)): OpResult | null {
  if (!getNode(doc, path)) return null;
  const tasks = doc.lists[path.list]!.tasks;
  if (path.child === undefined) {
    if (path.task < tasks.length - 1) return swapDown(doc, path, { ...path, task: path.task + 1 });
    if (path.list >= bounds.last) return null;
    const nextHasTasks = doc.lists[path.list + 1]!.tasks.length > 0;
    return nextHasTasks
      ? moveTask(doc, path, { kind: "before", target: { list: path.list + 1, task: 0 } })
      : moveTask(doc, path, { kind: "end", list: path.list + 1 });
  }
  const siblings = tasks[path.task]!.children!;
  if (path.child < siblings.length - 1) return moveTask(doc, path, { kind: "after", target: { ...path, child: path.child + 1 } });
  const next = tasks[path.task + 1];
  if (!next) return null;
  return next.children?.length
    ? moveTask(doc, path, { kind: "before", target: { list: path.list, task: path.task + 1, child: 0 } })
    : moveTask(doc, path, { kind: "child", target: { list: path.list, task: path.task + 1 } });
}

/** Swap with the next top-level task: the task goes after it, but never into it, even when it has subtasks. */
function swapDown(doc: TodoDocument, path: TaskPath, target: TaskPath): OpResult | null {
  if (!validateDrop(doc, path, { kind: "after", target }).ok) return null;
  return relocate(doc, path, (next, node) => {
    const tasks = next.lists[path.list]!.tasks;
    return { container: tasks, before: nextSibling(tasks, tasks[target.task]!, node) };
  });
}
