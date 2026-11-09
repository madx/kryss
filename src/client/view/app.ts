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
import { getNode } from "../logic/paths";
import type { Store, StoreState } from "../store";
import { renderBanners, renderEmptyState, renderInvalid, renderStatus, renderUnreachable } from "./banners";
import { settleEditors } from "./edit-text";
import { renderHeader } from "./header";
import { setupDnd } from "./dnd";
import { renderListSection, type ListContext } from "./list-section";
import type { TaskActions } from "./task-row";

const rowSelector = (p: TaskPath) =>
  `.task-row[data-list="${p.list}"][data-task="${p.task}"]` + (p.child === undefined ? ":not([data-child])" : `[data-child="${p.child}"]`);

export function mountApp(roots: { header: HTMLElement; banners: HTMLElement; main: HTMLElement }, store: Store): void {
  const ctx: ListContext = { addingSubtaskTo: null, renaming: null, confirmingRemove: null, drafts: new Map() };
  /** Create-list input open in the header, with the text typed so far. */
  let creating: { draft: string } | null = null;
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
      for (const key of ctx.drafts.keys()) if (key.startsWith("child-")) ctx.drafts.delete(key); // keyed by parent, which may have shifted
      pendingFocus = `[data-add="child-${path.list}-${path.task}"]`;
      renderAll(store.getState());
    },
    focusRow(path) {
      document.querySelector<HTMLElement>(rowSelector(path))?.focus();
    },
  };

  const createList = () => {
    creating = { draft: "" };
    pendingFocus = "[data-name-input]";
    renderAll(store.getState());
  };

  /** Callbacks shared by the create and rename inputs (only one of them is open at a time). */
  const naming = {
    input(draft: string) {
      if (creating) creating.draft = draft;
      else if (ctx.renaming) ctx.renaming.draft = draft;
    },
    submit(name: string) {
      const rename = ctx.renaming;
      const create = creating;
      creating = null;
      ctx.renaming = null;
      if (create) {
        const next = addList(doc(), name);
        if (next !== doc()) {
          store.commit(next);
          store.select(next.lists.length - 1);
          return;
        }
      } else if (rename) {
        const next = renameList(doc(), rename.list, name);
        if (next !== doc()) {
          store.commit(next);
          return;
        }
      }
      renderAll(store.getState());
    },
    cancel() {
      if (!creating && !ctx.renaming) return;
      creating = null;
      ctx.renaming = null;
      renderAll(store.getState());
    },
  };

  const lists = {
    naming,
    rename(index: number) {
      creating = null;
      ctx.confirmingRemove = null;
      ctx.renaming = { list: index, draft: doc().lists[index]?.title ?? "" };
      pendingFocus = "[data-name-input]";
      renderAll(store.getState());
    },
    confirmRemove(index: number) {
      ctx.confirmingRemove = index;
      pendingFocus = "[data-cancel-remove]";
      renderAll(store.getState());
    },
    cancelRemove() {
      ctx.confirmingRemove = null;
      renderAll(store.getState());
    },
    remove(index: number) {
      ctx.confirmingRemove = null;
      if (!doc().lists[index]) return;
      const selected = store.getState().selected;
      // Add input drafts are keyed by list index, which shifts.
      ctx.drafts.clear();
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
      for (const key of ctx.drafts.keys()) if (key.startsWith("child-")) ctx.drafts.delete(key);
      if (from) pendingFocus = rowSelector(from);
      renderAll(store.getState());
    },
  };

  /** Settles the open editors first (their commit may change the document), then renders from the up-to-date state. */
  function renderMain() {
    settleEditors((host) => {
      const row = host.closest<HTMLElement>(".task-row");
      const d = store.getState().doc;
      if (!row || !d) return undefined;
      const child = row.dataset.child;
      return getNode(d, { list: Number(row.dataset.list), task: Number(row.dataset.task), child: child === undefined ? undefined : Number(child) })?.text;
    });
    const state = store.getState();
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
    renderHeader(roots.header, state, { select: (i) => store.select(i), newList: createList, creating, naming });
    renderStatus(state);
    renderBanners(roots.banners, state, { keepMine: store.keepMine, takeDisk: store.takeDisk });
    renderMain();
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
