import type { TodoDocument } from "../../shared/types";
import { cloneDoc, findPath, getNode, parentPath, pruneChildren, samePath, type OpResult, type TaskPath } from "./paths";

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

/**
 * Moves a task with its subtree.
 * Returns null if the drop is refused.
 * Dropping an unchecked task under a different checked parent unchecks that parent (PRD 5.3).
 * Reordering under the same parent never changes a check state.
 */
export function moveTask(doc: TodoDocument, source: TaskPath, drop: Drop): OpResult | null {
  if (!validateDrop(doc, source, drop).ok) return null;
  const next = cloneDoc(doc);
  const node = getNode(next, source)!;
  const sourceTask = next.lists[source.list]!.tasks[source.task]!;
  const oldParent = source.child === undefined ? undefined : sourceTask;

  // Resolve the destination by identity before removal, since indices shift.
  let container: typeof node[];
  let newParent: typeof node | undefined;
  let anchor: typeof node | undefined;
  if (drop.kind === "end") {
    container = next.lists[drop.list]!.tasks;
  } else {
    const target = getNode(next, drop.target)!;
    anchor = target;
    if (drop.kind === "child") {
      newParent = target;
      container = target.children ??= [];
    } else if (drop.target.child === undefined) {
      container = next.lists[drop.target.list]!.tasks;
    } else {
      newParent = next.lists[drop.target.list]!.tasks[drop.target.task]!;
      container = newParent.children!;
    }
  }

  // Remove the source from where it is.
  const origin = source.child === undefined ? next.lists[source.list]!.tasks : sourceTask.children!;
  origin.splice(origin.indexOf(node), 1);
  if (oldParent) pruneChildren(oldParent);

  // Insert at the destination.
  if (drop.kind === "child" || drop.kind === "end") {
    container.push(node);
  } else {
    const at = container.indexOf(anchor!);
    container.splice(drop.kind === "before" ? at : at + 1, 0, node);
  }
  if (newParent) {
    delete node.children; // a subtask has no children (validated above)
    if (newParent !== oldParent && !node.done) newParent.done = false;
  }
  return { doc: next, path: findPath(next, node)! };
}

/** Tab: makes the task the last subtask of the previous task of the same list. */
export function indent(doc: TodoDocument, path: TaskPath): OpResult | null {
  if (path.child !== undefined || path.task === 0) return null;
  return moveTask(doc, path, { kind: "child", target: { list: path.list, task: path.task - 1 } });
}

/** Shift+Tab: turns a subtask into a task right after its parent. */
export function outdent(doc: TodoDocument, path: TaskPath): OpResult | null {
  const parent = parentPath(path);
  return parent ? moveTask(doc, path, { kind: "after", target: parent }) : null;
}

/** Alt+Up: swaps with the previous sibling (same level and parent). Null at the edge. */
export function moveUp(doc: TodoDocument, path: TaskPath): OpResult | null {
  const index = path.child ?? path.task;
  if (index === 0) return null;
  const target = path.child === undefined ? { ...path, task: index - 1 } : { ...path, child: index - 1 };
  return moveTask(doc, path, { kind: "before", target });
}

/** Alt+Down: swaps with the next sibling (same level and parent). Null at the edge. */
export function moveDown(doc: TodoDocument, path: TaskPath): OpResult | null {
  const index = path.child ?? path.task;
  const siblings = path.child === undefined ? doc.lists[path.list]?.tasks : doc.lists[path.list]?.tasks[path.task]?.children;
  if (!siblings || index >= siblings.length - 1) return null;
  const target = path.child === undefined ? { ...path, task: index + 1 } : { ...path, child: index + 1 };
  return moveTask(doc, path, { kind: "after", target });
}
