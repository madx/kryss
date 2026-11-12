import type { Task, TodoDocument } from "../../shared/types";
import { changedPaths, cloneDoc, findPath, getNode, parentPath, pathsByNode, pruneChildren, recomputeParent, samePath, type OpResult, type TaskPath } from "./paths";
import { visibleRows, type Visible } from "./filter";

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
 * Moves a node of a cloned document to the destination computed by `where`, and applies the check rules.
 * The destination is resolved by identity before the removal, since indices shift.
 * Dropping an unchecked task under a different parent unchecks that parent (PRD 5.3).
 * The old parent is recomputed: all remaining subtasks checked means checked.
 * Reordering under the same parent never changes a check state.
 */
function relocate(doc: TodoDocument, source: TaskPath, where: (next: TodoDocument, node: Task) => Dest): OpResult {
  const next = cloneDoc(doc);
  const before = pathsByNode(next);
  const node = getNode(next, source)!;
  const oldParent = source.child === undefined ? undefined : next.lists[source.list]!.tasks[source.task]!;
  const dest = where(next, node);

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
  return { doc: next, path: findPath(next, node)!, moves: changedPaths(before, next) };
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

/**
 * Moves a task with its subtree, or a subtask as a top-level task, to the end of another list (PRD 5.12).
 * Returns null for an unknown task or list, and when the list already holds the task.
 */
export function moveToList(doc: TodoDocument, source: TaskPath, list: number): OpResult | null {
  if (list === source.list || !doc.lists[list]) return null;
  return moveTask(doc, source, { kind: "end", list });
}

/** The rows a keyboard move works on: the visible rows under a filter, and the whole document by default. */
function rowsOf(doc: TodoDocument, visible?: Visible): Visible {
  return visible ?? visibleRows(doc, "", "");
}

/** Visible position of a top-level task: its visible list, its index among the visible tasks, and the visible subtasks. */
function locate(visible: Visible, path: TaskPath) {
  const list = visible.lists.find((l) => l.list === path.list);
  const index = list ? list.tasks.findIndex((v) => v.task === path.task) : -1;
  if (!list || index < 0) return null;
  return { list, index, tasks: list.tasks, visibleTask: list.tasks[index]! };
}

/** Moves a top-level task to another list, right after the whole subtree of a top-level task (or at the end of an empty list). */
function landAfter(doc: TodoDocument, source: TaskPath, list: number, task: number | undefined): OpResult | null {
  if (task === undefined) return moveTask(doc, source, { kind: "end", list });
  return relocate(doc, source, (next, node) => {
    const tasks = next.lists[list]!.tasks;
    return { container: tasks, before: nextSibling(tasks, tasks[task]!, node) };
  });
}

/** Makes the task the last subtask of the previous visible top-level task, after its hidden subtasks. */
export function indent(doc: TodoDocument, path: TaskPath, visible?: Visible): OpResult | null {
  if (path.child !== undefined || !getNode(doc, path)) return null;
  const at = locate(rowsOf(doc, visible), path);
  const previous = at?.tasks[at.index - 1];
  if (!at || !previous) return null;
  return moveTask(doc, path, { kind: "child", target: { list: path.list, task: previous.task } });
}

/** Turns a subtask into a task right after its parent. */
export function outdent(doc: TodoDocument, path: TaskPath): OpResult | null {
  const parent = parentPath(path);
  if (!parent || !getNode(doc, path)) return null;
  return relocate(doc, path, (next, node) => {
    const tasks = next.lists[path.list]!.tasks;
    return { container: tasks, before: nextSibling(tasks, tasks[path.task]!, node) };
  });
}

/**
 * Alt+Up moves the task one step up over the visible rows (the whole document by default), across parents and lists (PRD 5.2, 5.14).
 * A top-level task lands right before the previous visible task, jumping over the hidden ones, and at the top of its list goes after the last visible task of the previous visible list.
 * A subtask lands before the previous visible subtask, and at the top of its parent becomes the last subtask of the previous visible top-level task, or does nothing when there is none.
 * Null at the very top of the visible rows.
 */
export function moveUp(doc: TodoDocument, path: TaskPath, visible?: Visible): OpResult | null {
  if (!getNode(doc, path)) return null;
  const rows = rowsOf(doc, visible);
  const at = locate(rows, path);
  if (!at) return null;
  if (path.child === undefined) {
    const previous = at.tasks[at.index - 1];
    if (previous) return moveTask(doc, path, { kind: "before", target: { list: path.list, task: previous.task } });
    const lists = rows.lists;
    const before = lists[lists.findIndex((l) => l.list === path.list) - 1];
    return before ? landAfter(doc, path, before.list, before.tasks.at(-1)?.task) : null;
  }
  const index = at.visibleTask.children.indexOf(path.child);
  const previous = at.visibleTask.children[index - 1];
  if (index < 0) return null;
  if (previous !== undefined) return moveTask(doc, path, { kind: "before", target: { ...path, child: previous } });
  const parent = at.tasks[at.index - 1];
  return parent ? moveTask(doc, path, { kind: "child", target: { list: path.list, task: parent.task } }) : null;
}

/**
 * Alt+Down moves the task one step down over the visible rows (the whole document by default), across parents and lists (PRD 5.2, 5.14).
 * A top-level task lands right after the next visible task, never into it, and at the end of its list goes before the first visible task of the next visible list.
 * A subtask lands after the next visible subtask, and at the end of its parent becomes the first visible subtask of the next visible top-level task, or does nothing when there is none.
 * Null at the very bottom of the visible rows.
 */
export function moveDown(doc: TodoDocument, path: TaskPath, visible?: Visible): OpResult | null {
  if (!getNode(doc, path)) return null;
  const rows = rowsOf(doc, visible);
  const at = locate(rows, path);
  if (!at) return null;
  const next = at.tasks[at.index + 1];
  if (path.child === undefined) {
    if (next) return swapDown(doc, path, { list: path.list, task: next.task });
    const lists = rows.lists;
    const after = lists[lists.findIndex((l) => l.list === path.list) + 1];
    if (!after) return null;
    const first = after.tasks[0];
    return first
      ? moveTask(doc, path, { kind: "before", target: { list: after.list, task: first.task } })
      : moveTask(doc, path, { kind: "end", list: after.list });
  }
  const index = at.visibleTask.children.indexOf(path.child);
  const sibling = at.visibleTask.children[index + 1];
  if (index < 0) return null;
  if (sibling !== undefined) return moveTask(doc, path, { kind: "after", target: { ...path, child: sibling } });
  if (!next) return null;
  const first = next.children[0];
  return first !== undefined
    ? moveTask(doc, path, { kind: "before", target: { list: path.list, task: next.task, child: first } })
    : moveTask(doc, path, { kind: "child", target: { list: path.list, task: next.task } });
}

/** Swap with a following top-level task: the task goes after it, but never into it, even when it has subtasks. */
function swapDown(doc: TodoDocument, path: TaskPath, target: TaskPath): OpResult | null {
  if (!validateDrop(doc, path, { kind: "after", target }).ok) return null;
  return relocate(doc, path, (next, node) => {
    const tasks = next.lists[path.list]!.tasks;
    return { container: tasks, before: nextSibling(tasks, tasks[target.task]!, node) };
  });
}
