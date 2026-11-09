// Wires the store to the DOM: full render on content changes, light update on status changes.
import type { TodoDocument } from "../../shared/types";
import {
  addChild,
  addList,
  addTask,
  deleteList,
  deleteTask,
  editText,
  indent,
  moveDown,
  moveUp,
  outdent,
  renameList,
  toggleDone,
  type OpResult,
  type TaskPath,
} from "../logic";
import type { Store, StoreState } from "../store";
import { renderBanners, renderEmptyState, renderInvalid, renderStatus, renderUnreachable } from "./banners";
import { renderHeader } from "./header";
import { setupDnd } from "./dnd";
import { renderListSection, type ListContext } from "./list-section";
import type { TaskActions } from "./task-row";

const rowSelector = (p: TaskPath) =>
  `.task-row[data-list="${p.list}"][data-task="${p.task}"]` + (p.child === undefined ? ":not([data-child])" : `[data-child="${p.child}"]`);

export function mountApp(roots: { header: HTMLElement; banners: HTMLElement; main: HTMLElement }, store: Store): void {
  const ctx: ListContext = { addingSubtaskTo: null };
  /** CSS selector of the element to focus after the next render. */
  let pendingFocus: string | null = null;

  const doc = (): TodoDocument => store.getState().doc!;
  const dnd = setupDnd(roots.main, { getDoc: () => store.getState().doc, commit: (next) => store.commit(next) });
  const apply = (result: OpResult | null, focus = true): boolean => {
    if (!result) return false;
    if (focus) pendingFocus = rowSelector(result.path);
    store.commit(result.doc);
    return true;
  };

  const tasks: TaskActions = {
    toggle(path) {
      pendingFocus = rowSelector(path);
      store.commit(toggleDone(doc(), path));
    },
    remove(path) {
      store.commit(deleteTask(doc(), path));
    },
    edit(path, text) {
      pendingFocus = rowSelector(path);
      const before = doc();
      store.commit(editText(before, path, text));
      if (doc() === before) renderAll(store.getState()); // refused or unchanged after normalization: make sure the editor is gone
    },
    indent: (path) => apply(indent(doc(), path)),
    outdent: (path) => apply(outdent(doc(), path)),
    moveUp: (path) => apply(moveUp(doc(), path)),
    moveDown: (path) => apply(moveDown(doc(), path)),
    addSubtask(path) {
      ctx.addingSubtaskTo = { list: path.list, task: path.task };
      pendingFocus = `[data-add="child-${path.list}-${path.task}"]`;
      renderAll(store.getState());
    },
    focusRow(path) {
      document.querySelector<HTMLElement>(rowSelector(path))?.focus();
    },
  };

  const createList = () => {
    const title = window.prompt("List name");
    if (!title) return;
    const next = addList(doc(), title);
    if (next === doc()) return;
    store.commit(next);
    store.select(next.lists.length - 1);
  };

  const lists = {
    rename(index: number) {
      const title = window.prompt("Rename the list", doc().lists[index]?.title);
      if (title) store.commit(renameList(doc(), index, title));
    },
    remove(index: number) {
      const list = doc().lists[index];
      if (!list) return;
      if (list.tasks.length > 0 && !window.confirm(`Delete the list "${list.title}" and its ${list.tasks.length} task(s)?`)) return;
      const selected = store.getState().selected;
      store.commit(deleteList(doc(), index));
      if (selected === index) store.select(null);
      else if (selected !== null && selected > index) store.select(selected - 1);
    },
    addTask(index: number, text: string) {
      pendingFocus = `[data-add="list-${index}"]`;
      const result = addTask(doc(), index, text);
      if (result) store.commit(result.doc);
    },
    addSubtask(list: number, task: number, text: string) {
      pendingFocus = `[data-add="child-${list}-${task}"]`;
      const result = addChild(doc(), { list, task }, text);
      if (result) store.commit(result.doc);
    },
    cancelSubtask() {
      const from = ctx.addingSubtaskTo;
      ctx.addingSubtaskTo = null;
      if (from) pendingFocus = rowSelector(from);
      renderAll(store.getState());
    },
  };

  function renderMain(state: StoreState) {
    if (state.invalid) {
      roots.main.replaceChildren(renderInvalid(state.invalid, store.hasPendingChanges()));
    } else if (!state.doc) {
      roots.main.replaceChildren(state.status === "offline" ? renderUnreachable() : "");
    } else if (state.doc.lists.length === 0) {
      roots.main.replaceChildren(renderEmptyState(createList));
    } else {
      const shown = state.selected === null ? state.doc.lists.map((_, i) => i) : [state.selected];
      roots.main.replaceChildren(...shown.map((i) => renderListSection(state.doc!.lists[i]!, i, tasks, lists, ctx)));
    }
    dnd.refresh();
  }

  function renderAll(state: StoreState) {
    renderHeader(roots.header, state, { select: (i) => store.select(i), newList: createList });
    renderStatus(state);
    renderBanners(roots.banners, state, { keepMine: store.keepMine, takeDisk: store.takeDisk });
    renderMain(state);
    if (pendingFocus) document.querySelector<HTMLElement>(pendingFocus)?.focus();
    pendingFocus = null;
  }

  store.subscribe((state, kind) => {
    if (kind === "content") renderAll(state);
    else {
      renderStatus(state);
      renderBanners(roots.banners, state, { keepMine: store.keepMine, takeDisk: store.takeDisk });
    }
  });
  renderAll(store.getState());
}
