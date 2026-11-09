// One task or subtask row. Drag and drop and the editor plug in through the attributes and elements below:
// - the row carries `data-list`, `data-task` and (subtasks only) `data-child`;
// - `.drag-handle` is the drag handle spot;
// - `.task-text` holds the rendered text and is what the editor replaces while editing.
import type { Task } from "../../shared/types";
import type { TaskPath } from "../logic";
import { renderInline } from "../markdown/inline";
import { el } from "./dom";
import { startEdit } from "./edit-text";

/** Action callbacks. Those returning a boolean return false when the action was refused (the key then keeps its default). */
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
  const beginEdit = () =>
    startEdit(text, task.text, (result) => {
      if (result === null || result.trim() === "" || result === task.text) {
        text.replaceChildren(renderInline(task.text));
        actions.focusRow(path);
      } else {
        actions.edit(path, result); // the store re-renders the row
      }
    });
  text.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) return; // links open, they do not start an edit
    beginEdit();
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

  row.addEventListener("keydown", (e) => {
    if (e.target !== row && e.target !== checkbox) return;
    let handled = true;
    if (e.altKey && e.key === "ArrowUp") actions.moveUp(path);
    else if (e.altKey && e.key === "ArrowDown") actions.moveDown(path);
    else if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) handled = e.shiftKey ? actions.outdent(path) : actions.indent(path);
    else if (e.key === "Enter" || e.key === "F2") beginEdit();
    else if (e.key === "Delete") actions.remove(path);
    else handled = false;
    if (handled) e.preventDefault();
  });

  row.append(handle, checkbox, text, buttons);
  return row;
}
