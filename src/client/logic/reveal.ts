import type { TodoDocument } from "../../shared/types";
import type { TaskPath } from "./paths";

/** Top-level task whose "Add a subtask" line is revealed by a mouse click, or null. */
export type Reveal = TaskPath | null;

export type ClickTarget = { kind: "text"; path: TaskPath } | { kind: "checkbox" } | { kind: "other" };

/** A click on a task's text reveals the line of its top-level task, a click on a checkbox changes nothing, any other click hides it. */
export function revealAfterClick(current: Reveal, target: ClickTarget): Reveal {
  if (target.kind === "checkbox") return current;
  if (target.kind === "other") return null;
  return { list: target.path.list, task: target.path.task };
}

/** Escape hides the line. No other key shows it: keyboard focus never reveals it. */
export function revealAfterKey(current: Reveal, key: string): Reveal {
  return key === "Escape" ? null : current;
}

/** Drops a reveal whose task no longer exists. */
export function revealOrNull(current: Reveal, doc: TodoDocument): Reveal {
  return current && doc.lists[current.list]?.tasks[current.task] ? current : null;
}
