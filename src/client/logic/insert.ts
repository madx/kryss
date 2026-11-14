import type { TodoDocument } from "../../shared/types";
import { getNode } from "./paths";
import type { TaskPath, OpResult } from "./paths";
import { addChild, addTask } from "./tasks";

export type AddAt = "below" | "above" | "first-child" | "last-child" | "list-start" | "list-end" | "prev-list-end";
export type Anchor = { kind: "header"; list: number } | { kind: "task"; path: TaskPath };
/** Where a new task goes: top-level of `list` at `index`, or subtask of top-level task `parent` of `list` at `index`. */
export type InsertTarget = { list: number; parent?: number; index: number };

export function insertTarget(doc: TodoDocument, at: AddAt, anchor: Anchor): InsertTarget | null {
  if (anchor.kind === "header") {
    const tasks = doc.lists[anchor.list]?.tasks;
    if (!tasks) return null;
    if (at === "list-start") return { list: anchor.list, index: 0 };
    if (at === "list-end") return { list: anchor.list, index: tasks.length };
    // "prev-list-end" needs the visible lists: the view turns it into "list-end" on the header above.
    return null;
  }
  const { path } = anchor;
  const node = getNode(doc, path);
  if (!node || at === "list-start" || at === "list-end" || at === "prev-list-end") return null;
  const { list, task, child } = path;
  const sub = (index: number): InsertTarget => ({ list, parent: task, index });
  if (child !== undefined) {
    if (at === "above") return sub(child);
    if (at === "first-child") return sub(0);
    if (at === "last-child") return sub(doc.lists[list]!.tasks[task]!.children!.length);
    return sub(child + 1);
  }
  switch (at) {
    case "above":
      return { list, index: task };
    case "below":
      return { list, index: task + 1 };
    case "first-child":
      return sub(0);
    default:
      return sub(node.children?.length ?? 0); // "last-child"
  }
}

export function commitInsert(doc: TodoDocument, target: InsertTarget, text: string): OpResult | null {
  return target.parent === undefined
    ? addTask(doc, target.list, text, target.index)
    : addChild(doc, { list: target.list, task: target.parent }, text, target.index);
}
