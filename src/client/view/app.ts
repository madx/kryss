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
import { commitInsert, insertTarget, type AddAt, type Anchor } from "../logic/insert";
import { getNode } from "../logic/paths";
import { statusline } from "../logic/stats";
import { visibleRange } from "../logic/views";
import type { Store, StoreState } from "../store";
import { renderBanners, renderEmptyState, renderInvalid, renderStatus, renderUnreachable } from "./banners";
import { isEditing, settleEditors, type EditEnd } from "./edit-text";
import { createCheatsheet } from "./cheatsheet";
import { createCursor, rowSelector, stopSelector } from "./cursor";
import { createFooter } from "./footer";
import { renderHeader } from "./header";
import { installKeyboard } from "./keyboard";
import { setupDnd } from "./dnd";
import { renderListSection, type ListContext } from "./list-section";
import { BEGIN_EDIT, type TaskActions } from "./task-row";
import { isTextField } from "../shortcuts";

export function mountApp(roots: { header: HTMLElement; banners: HTMLElement; main: HTMLElement }, store: Store, storage?: Storage): void {
  const ctx: ListContext = { addingSubtaskTo: null, renaming: null, confirmingRemove: null, drafts: new Map(), placeholder: null };
  const footer = createFooter();
  const cheatsheet = createCheatsheet();
  document.body.append(footer.el, cheatsheet.el);
  const cursor = createCursor(roots.main, store, storage);
  let cursorRestored = false;
  /** Create-list input open in the header, with the text typed so far. */
  let creating: { draft: string } | null = null;
  /** CSS selector of the element to focus after the next render. */
  let pendingFocus: string | null = null;

  const doc = (): TodoDocument => store.getState().doc!;
  const dnd = setupDnd(roots.main, { getDoc: () => store.getState().doc, commit: (next) => store.commit(next) });
  /** Keyboard moves only cross the lists on screen. */
  const visibleBounds = () => {
    const selected = store.getState().selected;
    return selected === null ? { first: 0, last: doc().lists.length - 1 } : { first: selected, last: selected };
  };
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
    moveUp: (path) => apply(moveUp(doc(), path, visibleBounds())),
    moveDown: (path) => apply(moveDown(doc(), path, visibleBounds())),
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
      if (!rename && !create) return; // the input was discarded (e.g. by an external change)
      creating = null;
      ctx.renaming = null;
      if (create) {
        const next = addList(doc(), name);
        if (next !== doc()) {
          store.commit(next);
          if (store.getState().selected !== null) store.select(next.lists.length - 1); // a single-list view must show the new list
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

  /** Opens the editor of the pending positional-add row, once it is in the DOM. */
  function startPlaceholder() {
    if (ctx.placeholder) roots.main.querySelector(".task-new")?.dispatchEvent(new Event(BEGIN_EDIT));
  }

  function updateFooter() {
    const state = store.getState();
    if (!state.doc) return;
    const range = visibleRange(state.selected, state.doc.lists.length);
    const stop = cursor.current();
    const insert = isEditing() || isTextField(document.activeElement);
    footer.update({ mode: insert ? "insert" : "normal", ...statusline(state.doc, range, stop ? (stop.kind === "header" ? stop.list : stop.path.list) : null) });
  }

  function renderAll(state: StoreState) {
    const hadCursor = cursor.hasFocus();
    renderHeader(roots.header, state, { select: (i) => store.select(i), newList: createList, creating, naming });
    renderStatus(state);
    renderBanners(roots.banners, state, { keepMine: store.keepMine, takeDisk: store.takeDisk });
    renderMain();
    if (pendingFocus) document.querySelector<HTMLElement>(pendingFocus)?.focus();
    else if (hadCursor) cursor.focusIndex(cursor.last()); // the rebuilt DOM lost the cursor: same position, clamped
    pendingFocus = null;
    if (!cursorRestored && state.doc && !state.invalid) {
      cursorRestored = true;
      if (!document.activeElement || document.activeElement === document.body) cursor.restore();
    }
    startPlaceholder();
    updateFooter();
  }

  store.subscribe((state, kind) => {
    if (kind === "external") {
      // The disk version wins: a list name being typed is discarded, and clearing it first keeps the blur on removal from committing it.
      creating = null;
      ctx.renaming = null;
      ctx.placeholder = null;
    }
    if (kind !== "status") renderAll(state);
    else {
      renderStatus(state);
      renderBanners(roots.banners, state, { keepMine: store.keepMine, takeDisk: store.takeDisk });
    }
  });
  document.addEventListener("focusin", updateFooter);
  document.addEventListener("focusout", () => setTimeout(updateFooter, 0));

  /** A positional add: the empty row exists only in the client, it is committed (or dropped) when its editor ends. */
  const beginAdd = (at: AddAt, anchor: Anchor) => {
    const target = insertTarget(doc(), at, anchor);
    if (!target) return;
    const origin = cursor.current();
    openPlaceholder(target, origin ? stopSelector(origin) : null);
  };
  const openPlaceholder = (target: NonNullable<ReturnType<typeof insertTarget>>, originSelector: string | null) => {
    ctx.placeholder = {
      target,
      done(text: string | null, how: EditEnd) {
        ctx.placeholder = null;
        if (text === null) return; // discarded by a re-render
        const result = text.trim() === "" ? null : commitInsert(doc(), target, text);
        if (!result) {
          // Nothing typed: the empty task is dropped and the cursor goes back where it started.
          if (how !== "blur") pendingFocus = originSelector;
          renderAll(store.getState());
          return;
        }
        if (how === "enter") {
          const next = insertTarget(result.doc, "below", { kind: "task", path: result.path });
          if (next) openPlaceholder(next, rowSelector(result.path));
        } else if (how === "escape") pendingFocus = rowSelector(result.path);
        store.commit(result.doc);
        if (ctx.placeholder) renderAll(store.getState()); // commit may not render when the document is unchanged
      },
    };
    renderAll(store.getState());
  };

  installKeyboard({
    store,
    cursor,
    cheatsheet,
    apply: (result) => void apply(result),
    commitFocus(next, path) {
      pendingFocus = rowSelector(path);
      store.commit(next);
    },
    renameList: lists.rename,
    deleteList(index) {
      if (doc().lists[index]?.tasks.length) lists.confirmRemove(index);
      else {
        lists.remove(index);
        cursor.focusIndex(cursor.last());
      }
    },
    confirming: () => ctx.confirmingRemove,
    confirmDelete(index) {
      lists.remove(index);
      cursor.focusIndex(cursor.last());
    },
    cancelDelete: lists.cancelRemove,
    beginAdd,
    newList: createList,
  });
  renderAll(store.getState());
}
