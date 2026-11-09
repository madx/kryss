// One list: title with rename / delete, its tasks with their subtasks, and the add input.
import type { TodoList } from "../../shared/types";
import { renderAddInput } from "./add-input";
import { el } from "./dom";
import { renderTaskRow, type TaskActions } from "./task-row";

export type ListActions = {
  rename(list: number): void;
  remove(list: number): void;
  addTask(list: number, text: string): void;
  addSubtask(list: number, task: number, text: string): void;
  cancelSubtask(): void;
};

export type ListContext = { addingSubtaskTo: { list: number; task: number } | null };

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
  remove.addEventListener("click", () => actions.remove(index));

  // `data-list` on the <ul> makes it a drop target for empty lists later on.
  const ul = el("ul", { class: "tasks", "data-list": String(index) });
  list.tasks.forEach((task, t) => {
    const item = el("li", { class: "task-item" });
    item.append(renderTaskRow(task, { list: index, task: t }, tasks));
    const adding = ctx.addingSubtaskTo?.list === index && ctx.addingSubtaskTo.task === t;
    if (task.children?.length || adding) {
      const sub = el("ul", { class: "subtasks" });
      task.children?.forEach((child, c) => {
        sub.append(el("li", { class: "task-item" }, renderTaskRow(child, { list: index, task: t, child: c }, tasks)));
      });
      if (adding) {
        sub.append(
          el(
            "li",
            { class: "task-item" },
            renderAddInput(`child-${index}-${t}`, "Add a subtask", (text) => actions.addSubtask(index, t, text), actions.cancelSubtask),
          ),
        );
      }
      item.append(sub);
    }
    ul.append(item);
  });

  return el(
    "section",
    { class: "list", "data-list": String(index) },
    el("header", { class: "list-header" }, el("h2", { class: "list-title" }, list.title), el("span", { class: "list-actions" }, rename, remove)),
    ul,
    renderAddInput(`list-${index}`, "Add a task", (text) => actions.addTask(index, text)),
  );
}
