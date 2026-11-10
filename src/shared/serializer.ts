// Canonical Markdown serialization (PRD 3.4), shared by the server (file) and the client (Markdown view, clipboard).
// A task and a list carry no trailing newline, so that their text can be copied as is.
import type { Task, TodoDocument, TodoList } from "./types";

const box = (done: boolean) => (done ? "[x]" : "[ ]");

/** The task line, followed by its subtask lines indented by 2 spaces. */
export function serializeTask(task: Task): string {
  const lines = [`- ${box(task.done)} ${task.text}`];
  for (const child of task.children ?? []) lines.push(`  - ${box(child.done)} ${child.text}`);
  return lines.join("\n");
}

/** The `## Title` line, followed by its tasks. */
export function serializeList(list: TodoList): string {
  return [`## ${list.title}`, ...list.tasks.map(serializeTask)].join("\n");
}

/** The lists separated by a blank line, with one final newline. An empty document is an empty string. */
export function serialize(doc: TodoDocument): string {
  return doc.lists.length === 0 ? "" : doc.lists.map(serializeList).join("\n\n") + "\n";
}
