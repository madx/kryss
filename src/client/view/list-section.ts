// One list: title with rename / delete, its tasks with their subtasks, and the add input.
import type { TodoList } from "../../shared/types";
import { renderAddInput } from "./add-input";
import { el } from "./dom";
import { renderNameInput, type NameInputActions } from "./name-input";
import type { InsertTarget } from "../logic/insert";
import type { EditEnd } from "./edit-text";
import { renderNewTaskRow, renderTaskRow, type TaskActions } from "./task-row";

export type ListActions = {
  rename(list: number): void;
  remove(list: number): void;
  addTask(list: number, text: string): void;
  addSubtask(list: number, task: number, text: string): void;
  cancelSubtask(): void;
  /** Delete confirmation for a non-empty list. */
  confirmRemove(list: number): void;
  cancelRemove(): void;
  naming: NameInputActions;
};

export type ListContext = {
  addingSubtaskTo: { list: number; task: number } | null;
  /** List being renamed, with the text typed so far. */
  renaming: { list: number; draft: string } | null;
  /** List whose deletion awaits confirmation. */
  confirmingRemove: number | null;
  /** Half-typed text of the add inputs, by `data-add` key. */
  drafts: Map<string, string>;
  /** Client-only empty task being typed by a positional add (PRD 5.9). */
  placeholder: { target: InsertTarget; done: (text: string | null, how: EditEnd) => void } | null;
};

export function renderListSection(
  list: TodoList,
  index: number,
  tasks: TaskActions,
  actions: ListActions,
  ctx: ListContext,
): HTMLElement {
  const rename = el("button", { type: "button", class: "icon-button", title: "Rename list", "aria-label": "Rename list" }, "✎");
  rename.addEventListener("click", () => actions.rename(index));
  const remove = el("button", { type: "button", class: "icon-button", title: "Delete list", "aria-label": "Delete list" }, "×");
  remove.addEventListener("click", () => actions.confirmRemove(index));

  // `data-list` on the <ul> makes it a drop target for empty lists later on.
  const ul = el("ul", { class: "tasks", "data-list": String(index) });
  const ph = ctx.placeholder;
  list.tasks.forEach((task, t) => {
    const item = el("li", { class: "task-item" });
    item.append(renderTaskRow(task, { list: index, task: t }, tasks));
    const adding = ctx.addingSubtaskTo?.list === index && ctx.addingSubtaskTo.task === t;
    const newChild = ph && ph.target.list === index && ph.target.parent === t ? ph : null;
    if (task.children?.length || adding || newChild) {
      const sub = el("ul", { class: "subtasks" });
      task.children?.forEach((child, c) => {
        sub.append(el("li", { class: "task-item" }, renderTaskRow(child, { list: index, task: t, child: c }, tasks)));
      });
      if (newChild) sub.insertBefore(el("li", { class: "task-item" }, renderNewTaskRow(newChild.done)), sub.children[newChild.target.index] ?? null);
      if (adding) {
        sub.append(
          el(
            "li",
            { class: "task-item" },
            renderAddInput(`child-${index}-${t}`, "Add a subtask", ctx.drafts, (text) => actions.addSubtask(index, t, text), actions.cancelSubtask),
          ),
        );
      }
      item.append(sub);
    }
    ul.append(item);
  });

  if (ph && ph.target.list === index && ph.target.parent === undefined) {
    ul.insertBefore(el("li", { class: "task-item" }, renderNewTaskRow(ph.done)), ul.children[ph.target.index] ?? null);
  }

  const renaming = ctx.renaming?.list === index ? ctx.renaming : null;
  const title = renaming
    ? renderNameInput(renaming.draft, "List name", actions.naming)
    : el("h2", { class: "list-title" }, list.title);
  const header = el("header", { class: "list-header", tabindex: "0", "data-list": String(index) }, title, el("span", { class: "list-actions" }, rename, remove));
  if (ctx.confirmingRemove === index) {
    const yes = el("button", { type: "button", class: "button button-danger", "data-confirm-remove": "" }, "Delete");
    yes.addEventListener("click", () => actions.remove(index));
    const no = el("button", { type: "button", class: "button", "data-cancel-remove": "" }, "Cancel");
    no.addEventListener("click", actions.cancelRemove);
    header.append(
      el("div", { class: "list-confirm", role: "alert" }, el("span", {}, list.tasks.length > 0 ? `Delete this list and its ${list.tasks.length} task(s)?` : "Delete this empty list?"), yes, no),
    );
  }

  return el(
    "section",
    { class: "list", "data-list": String(index) },
    header,
    ul,
    renderAddInput(`list-${index}`, "Add a task", ctx.drafts, (text) => actions.addTask(index, text)),
  );
}
