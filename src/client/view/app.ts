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
  /** Commits with a focus request. The render is synchronous, so a request left over means nothing rendered and must not leak into a later render. */
  const commitFocus = (next: TodoDocument, selector: string | null) => {
    pendingFocus = selector;
    store.commit(next);
    pendingFocus = null;
  };
  const apply = (result: OpResult | null, focus = true): boolean => {
    if (!result) return false;
    commitFocus(result.doc, focus ? rowSelector(result.path) : null);
    return true;
  };

  const tasks: TaskActions = {
    toggle(path) {
      commitFocus(toggleDone(doc(), path), rowSelector(path));
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
          const created = next.lists.length - 1;
          if (store.getState().selected !== null) store.select(created); // a single-list view must show the new list
          // The cursor goes to the new list and its first task is typed right away.
          const target = insertTarget(doc(), "list-start", { kind: "header", list: created });
          if (target) openPlaceholder(target, stopSelector({ kind: "header", list: created }));
          roots.main.querySelector(`.list[data-list="${created}"]`)?.scrollIntoView?.({ block: "nearest" }); // show the whole new list
          return;
        }
      } else if (rename) {
        const next = renameList(doc(), rename.list, name);
        if (next !== doc()) {
          commitFocus(next, stopSelector({ kind: "header", list: rename.list }));
          return;
        }
        pendingFocus = stopSelector({ kind: "header", list: rename.list });
      }
      renderAll(store.getState());
    },
    cancel() {
      if (!creating && !ctx.renaming) return;
      if (ctx.renaming) pendingFocus = stopSelector({ kind: "header", list: ctx.renaming.list });
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
      const result = addTask(doc(), index, text);
      if (result) commitFocus(result.doc, `[data-add="list-${index}"]`);
    },
    addSubtask(list: number, task: number, text: string) {
      const result = addChild(doc(), { list, task }, text);
      if (result) commitFocus(result.doc, `[data-add="child-${list}-${task}"]`);
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
    const row = ctx.placeholder ? roots.main.querySelector(".task-new") : null;
    row?.dispatchEvent(new Event(BEGIN_EDIT));
    row?.scrollIntoView?.({ block: "nearest" });
  }

  function updateFooter() {
    const state = store.getState();
    if (!state.doc) return;
    const range = visibleRange(state.selected, state.doc.lists.length);
    const stop = cursor.current() ?? cursor.stopAt(cursor.last()); // keeps the list number while a field has the focus
    const insert = isEditing() || isTextField(document.activeElement);
    footer.update({ mode: insert ? "insert" : "normal", ...statusline(state.doc, range, stop ? (stop.kind === "header" ? stop.list : stop.path.list) : null) });
  }

  function renderAll(state: StoreState, focus: string | null = null) {
    if (focus) pendingFocus = focus;
    renderHeader(roots.header, state, { select: (i) => store.select(i), newList: createList, creating, naming });
    renderStatus(state);
    renderBanners(roots.banners, state, { keepMine: store.keepMine, takeDisk: store.takeDisk });
    renderMain();
    const wanted = pendingFocus ? document.querySelector<HTMLElement>(pendingFocus) : null;
    pendingFocus = null;
    if (wanted) wanted.focus();
    else if (cursor.last() >= 0 && (!document.activeElement || document.activeElement === document.body)) {
      cursor.focusIndex(cursor.last()); // the rebuilt DOM lost the focus: back to the same position, clamped
    }
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
  type Target = NonNullable<ReturnType<typeof insertTarget>>;
  /** Registers the empty row for `target`. The caller renders (directly, or through a commit). */
  const setPlaceholder = (target: Target, originSelector: string | null) => {
    const self: NonNullable<ListContext["placeholder"]> = {
      target,
      done(text: string | null, how: EditEnd) {
        if (ctx.placeholder === self) ctx.placeholder = null; // a stale closure must not drop a newer placeholder
        if (text === null) return; // discarded by a re-render
        const result = text.trim() === "" ? null : commitInsert(doc(), target, text);
        if (!result) {
          // Nothing typed: the empty task is dropped and the cursor goes back where it started.
          renderAll(store.getState(), how === "blur" ? null : originSelector);
          return;
        }
        if (how === "enter") {
          const next = insertTarget(result.doc, "below", { kind: "task", path: result.path });
          if (next) setPlaceholder(next, rowSelector(result.path)); // rendered by the commit below
        }
        commitFocus(result.doc, how === "escape" ? rowSelector(result.path) : null);
      },
    };
    ctx.placeholder = self;
  };
  const openPlaceholder = (target: Target, originSelector: string | null) => {
    setPlaceholder(target, originSelector);
    renderAll(store.getState());
  };

  installKeyboard({
    store,
    cursor,
    cheatsheet,
    apply: (result) => void apply(result),
    commitFocus: (next, path) => commitFocus(next, rowSelector(path)),
    renameList: lists.rename,
    deleteList: lists.confirmRemove,
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
