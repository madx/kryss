// One list: title, counts, and its tasks with their subtasks.
import type { TodoList } from "../../shared/types";
import type { VisibleList } from "../logic/filter";
import { countVisibleList } from "../logic/stats";
import { el } from "./dom";
import { renderNameInput, type NameInputActions } from "./name-input";
import type { InsertTarget } from "../logic/insert";
import type { EditEnd } from "./edit-text";
import { renderNewTaskRow, renderTaskRow, type TaskActions } from "./task-row";

export type ListActions = {
  rename(list: number): void;
  remove(list: number): void;
  naming: NameInputActions;
};

export type ListContext = {
  /** List being renamed, with the text typed so far. */
  renaming: { list: number; draft: string } | null;
  /** Client-only empty task being typed by a positional add (PRD 5.9). */
  placeholder: { target: InsertTarget; done: (text: string | null, how: EditEnd) => void } | null;
};

/** Position of the document index `at` among the rendered rows, which are only the visible ones. */
const slot = (shown: number[], at: number) => shown.filter((i) => i < at).length;

/** Renders one list with only its visible rows (`visible`, PRD 5.14). Document indices stay in the `data-*` attributes. */
export function renderListSection(
  list: TodoList,
  index: number,
  visible: VisibleList,
  tasks: TaskActions,
  actions: ListActions,
  ctx: ListContext,
): HTMLElement {
  const ul = el("ul", { class: "tasks", "data-list": String(index) });
  const ph = ctx.placeholder;
  for (const { task: t, children } of visible.tasks) {
    const task = list.tasks[t]!;
    const item = el("li", { class: "task-item" });
    item.append(renderTaskRow(task, { list: index, task: t }, tasks));
    const newChild = ph && ph.target.list === index && ph.target.parent === t ? ph : null;
    if (children.length || newChild) {
      const sub = el("ul", { class: "subtasks" });
      for (const c of children) {
        sub.append(el("li", { class: "task-item" }, renderTaskRow(task.children![c]!, { list: index, task: t, child: c }, tasks)));
      }
      if (newChild) sub.insertBefore(el("li", { class: "task-item" }, renderNewTaskRow(newChild.done)), sub.children[slot(children, newChild.target.index)] ?? null);
      item.append(sub);
    }
    ul.append(item);
  }

  if (ph && ph.target.list === index && ph.target.parent === undefined) {
    ul.insertBefore(el("li", { class: "task-item" }, renderNewTaskRow(ph.done)), ul.children[slot(visible.tasks.map((v) => v.task), ph.target.index)] ?? null);
  }

  const renaming = ctx.renaming?.list === index ? ctx.renaming : null;
  const title = renaming
    ? renderNameInput(renaming.draft, "List name", actions.naming)
    : el("h2", { class: "list-title" }, list.title);
  // Like the text of a task, the title starts the edit on a click.
  if (!renaming) title.addEventListener("click", () => actions.rename(index));
  const header = el("header", { class: "list-header", tabindex: "0", "data-list": String(index) });
  const { done, total } = countVisibleList(list, visible);
  header.append(title, el("span", { class: "list-count" }, `${done}/${total}`));

  return el("section", { class: "list", "data-list": String(index) }, header, ul);
}
