// One task or subtask row. The editor plugs in through the attributes and elements below:
// - the row carries `data-list`, `data-task` and (subtasks only) `data-child`;
// - `.task-text` holds the rendered text and is what the editor replaces while editing.
import type { Task } from "../../shared/types";
import type { TaskPath } from "../logic";
import { findDueRange, renderInline } from "../markdown/inline";
import { el } from "./dom";
import { renderDuePill } from "./due-pill";
import { hiddenIcon } from "./icons";
import { startEdit, type EditEnd } from "./edit-text";

/** Dispatched on a row (by the keyboard layer) to open its editor. */
export const BEGIN_EDIT = "begin-edit";
/** Dispatched on a row to open its editor with the caret at the start (`E`). */
export const BEGIN_EDIT_START = "begin-edit-start";
/** Dispatched on a row to open its editor with an empty text (`cc`). Escape or an empty commit restores the previous text. */
export const CHANGE_EDIT = "change-edit";
/** Dispatched on a row to open its editor on the due date and its popup (`cd`). */
export const DUE_EDIT = "due-edit";

/** Action callbacks. Those returning a boolean return false when the action was refused. */
export type TaskActions = {
  toggle(path: TaskPath): void;
  edit(path: TaskPath, text: string): void;
  indent(path: TaskPath): boolean;
  outdent(path: TaskPath): boolean;
  moveUp(path: TaskPath): boolean;
  moveDown(path: TaskPath): boolean;
  /** Called when an edit ends without a change, to put the focus back on the row. */
  focusRow(path: TaskPath): void;
};

/** `hidden` is the number of subtasks the filter hides: a muted eye and that count close the row. */
export function renderTaskRow(task: Task, path: TaskPath, actions: TaskActions, hidden = 0): HTMLElement {
  const isSubtask = path.child !== undefined;
  const row = el("div", {
    class: "task-row",
    tabindex: "0",
    "data-list": String(path.list),
    "data-task": String(path.task),
    "data-child": isSubtask ? String(path.child) : undefined,
    "data-done": task.done ? "true" : "false",
  });

  const checkbox = el("input", { type: "checkbox", class: "task-check", "aria-label": "Done" });
  checkbox.checked = task.done;
  checkbox.addEventListener("change", () => actions.toggle(path));

  const text = el("span", { class: "task-text" });
  text.append(renderInline(task.text, renderDuePill));
  const beginEdit = (at?: { x: number; y: number }, empty = false, due = false, start = false) => {
    const match = due ? findDueRange(task.text) : null;
    startEdit(
      text,
      empty ? "" : task.text,
      (result) => {
        if (result === null || result.trim() === "" || result === task.text) {
          text.replaceChildren(renderInline(task.text, renderDuePill));
          actions.focusRow(path);
        } else {
          actions.edit(path, result); // the store re-renders the row
        }
      },
      due
        ? {
            initial: match ? task.text : task.text + " ->",
            select: match ? { from: match.from + 2, to: match.to } : undefined,
            openPopup: true,
          }
        : { at, caretAtStart: start },
    );
  };
  text.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) return; // links open, they do not start an edit
    beginEdit({ x: e.clientX, y: e.clientY });
  });

  row.addEventListener(BEGIN_EDIT, () => beginEdit());
  row.addEventListener(BEGIN_EDIT_START, () => beginEdit(undefined, false, false, true));
  row.addEventListener(CHANGE_EDIT, () => beginEdit(undefined, true));
  row.addEventListener(DUE_EDIT, () => beginEdit(undefined, false, true));

  row.append(checkbox, text);
  if (hidden > 0) {
    const label = `${hidden} other ${hidden === 1 ? "subtask" : "subtasks"} hidden by the filter`;
    row.append(el("span", { class: "task-hidden", title: label, "aria-label": label }, hiddenIcon(), String(hidden)));
  }
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
