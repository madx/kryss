// One task or subtask row. Drag and drop and the editor plug in through the attributes and elements below:
// - the row carries `data-list`, `data-task` and (subtasks only) `data-child`;
// - `.drag-handle` is the drag handle spot;
// - `.task-text` holds the rendered text and is what the editor replaces while editing.
import type { Task } from "../../shared/types";
import type { TaskPath } from "../logic";
import { renderInline } from "../markdown/inline";
import { el } from "./dom";
import { startEdit, type EditEnd } from "./edit-text";

/** Dispatched on a row (by the keyboard layer) to open its editor. */
export const BEGIN_EDIT = "begin-edit";

/** Action callbacks. Those returning a boolean return false when the action was refused. */
export type TaskActions = {
  toggle(path: TaskPath): void;
  remove(path: TaskPath): void;
  edit(path: TaskPath, text: string): void;
  indent(path: TaskPath): boolean;
  outdent(path: TaskPath): boolean;
  moveUp(path: TaskPath): boolean;
  moveDown(path: TaskPath): boolean;
  /** Only offered on top-level tasks. */
  addSubtask(path: TaskPath): void;
  /** Called when an edit ends without a change, to put the focus back on the row. */
  focusRow(path: TaskPath): void;
};

export function renderTaskRow(task: Task, path: TaskPath, actions: TaskActions): HTMLElement {
  const isSubtask = path.child !== undefined;
  const row = el("div", {
    class: "task-row",
    tabindex: "0",
    "data-list": String(path.list),
    "data-task": String(path.task),
    "data-child": isSubtask ? String(path.child) : undefined,
    "data-done": task.done ? "true" : "false",
  });

  const handle = el("span", { class: "drag-handle", "aria-hidden": "true", title: "Drag to move" }, "⋮⋮");
  const checkbox = el("input", { type: "checkbox", class: "task-check", "aria-label": "Done" });
  checkbox.checked = task.done;
  checkbox.addEventListener("change", () => actions.toggle(path));

  const text = el("span", { class: "task-text" });
  text.append(renderInline(task.text));
  const beginEdit = (at?: { x: number; y: number }) =>
    startEdit(
      text,
      task.text,
      (result) => {
        if (result === null || result.trim() === "" || result === task.text) {
          text.replaceChildren(renderInline(task.text));
          actions.focusRow(path);
        } else {
          actions.edit(path, result); // the store re-renders the row
        }
      },
      { at },
    );
  text.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) return; // links open, they do not start an edit
    beginEdit({ x: e.clientX, y: e.clientY });
  });

  const buttons = el("span", { class: "task-actions" });
  if (!isSubtask) {
    const add = el("button", { type: "button", class: "icon-button", title: "Add a subtask", "aria-label": "Add a subtask" }, "+");
    add.addEventListener("click", () => actions.addSubtask(path));
    buttons.append(add);
  }
  const remove = el("button", { type: "button", class: "icon-button", title: "Delete", "aria-label": "Delete task" }, "×");
  remove.addEventListener("click", () => actions.remove(path));
  buttons.append(remove);

  row.addEventListener(BEGIN_EDIT, () => beginEdit());

  row.append(handle, checkbox, text, buttons);
  return row;
}

/**
 * The client-only empty row of a positional add. It is never part of the document, so autosave cannot send it.
 * The keyboard layer dispatches `begin-edit` on it once it is in the DOM, and `done` receives the typed text.
 */
export function renderNewTaskRow(done: (text: string | null, how: EditEnd) => void): HTMLElement {
  const text = el("span", { class: "task-text" });
  const row = el("div", { class: "task-row task-new", "data-new": "" }, text);
  row.addEventListener(BEGIN_EDIT, () => startEdit(text, "", done, { keepOnEmptyEnter: true }));
  return row;
}
