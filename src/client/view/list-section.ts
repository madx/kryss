// One list: title with rename / delete, its tasks with their subtasks, and the add line.
import type { TodoList } from "../../shared/types";
import { countList } from "../logic/stats";
import { renderAddInput } from "./add-input";
import { renderAlert } from "./alert";
import { el } from "./dom";
import { closeIcon } from "./icons";
import { renderNameInput, type NameInputActions } from "./name-input";
import type { InsertTarget } from "../logic/insert";
import type { Reveal } from "../logic/reveal";
import type { EditEnd } from "./edit-text";
import { renderNewTaskRow, renderTaskRow, type TaskActions } from "./task-row";

export type ListActions = {
  rename(list: number): void;
  remove(list: number): void;
  addTask(list: number, text: string): void;
  addSubtask(list: number, task: number, text: string): void;
  /** Escape in the subtask line: hides it. */
  cancelSubtask(): void;
  /** Delete confirmation for a non-empty list. */
  confirmRemove(list: number): void;
  cancelRemove(): void;
  naming: NameInputActions;
};

export type ListContext = {
  /** Top-level task whose "Add a subtask" line a mouse click revealed (PRD 5.10). */
  reveal: Reveal;
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
  const remove = el("button", { type: "button", class: "icon-button", title: "Delete list", "aria-label": "Delete list", tabindex: "-1" }, closeIcon());
  remove.addEventListener("click", () => actions.confirmRemove(index));

  // `data-list` on the <ul> makes it a drop target for empty lists later on.
  const ul = el("ul", { class: "tasks", "data-list": String(index) });
  const ph = ctx.placeholder;
  list.tasks.forEach((task, t) => {
    const item = el("li", { class: "task-item" });
    item.append(renderTaskRow(task, { list: index, task: t }, tasks));
    const adding = ctx.reveal?.list === index && ctx.reveal.task === t;
    const newChild = ph && ph.target.list === index && ph.target.parent === t ? ph : null;
    if (task.children?.length || adding || newChild) {
      const sub = el("ul", { class: "subtasks" });
      task.children?.forEach((child, c) => {
        sub.append(el("li", { class: "task-item" }, renderTaskRow(child, { list: index, task: t, child: c }, tasks)));
      });
      if (newChild) sub.insertBefore(el("li", { class: "task-item" }, renderNewTaskRow(newChild.done)), sub.children[newChild.target.index] ?? null);
      if (adding) sub.append(renderSubtaskLine(index, t, actions, ctx));
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
  // Like the text of a task, the title starts the edit on a click (a drag does not click).
  if (!renaming) title.addEventListener("click", () => actions.rename(index));
  const header = el("header", { class: "list-header", tabindex: "0", "data-list": String(index) });
  if (ctx.confirmingRemove === index) {
    const message = list.tasks.length > 0 ? `Delete this list and its ${list.tasks.length} task(s)?` : "Delete this empty list?";
    header.append(
      renderAlert(
        "error",
        [message],
        [
          { label: "Delete", onClick: () => actions.remove(index), attrs: { "data-confirm-remove": "" } },
          { label: "Cancel", onClick: actions.cancelRemove, attrs: { "data-cancel-remove": "" } },
        ],
      ),
    );
  } else {
    const { done, total } = countList(list);
    header.append(title, el("span", { class: "list-actions" }, remove), el("span", { class: "list-count" }, `${done}/${total}`));
  }

  return el(
    "section",
    { class: "list", "data-list": String(index) },
    header,
    ul,
    renderAddInput(`list-${index}`, "Add a task", ctx.drafts, (text) => actions.addTask(index, text)),
  );
}

/** The revealed "Add a subtask" line of a top-level task, as a list item. */
export function renderSubtaskLine(list: number, task: number, actions: ListActions, ctx: ListContext): HTMLElement {
  return el(
    "li",
    { class: "task-item", "data-reveal": "" },
    renderAddInput(`child-${list}-${task}`, "Add a subtask", ctx.drafts, (text) => actions.addSubtask(list, task, text), actions.cancelSubtask),
  );
}
