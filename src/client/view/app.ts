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
import { revealAfterClick, revealAfterKey, revealOrNull, type ClickTarget, type Reveal } from "../logic/reveal";
import { statusline } from "../logic/stats";
import { visibleRange } from "../logic/views";
import type { Store, StoreState } from "../store";
import { renderBanners, renderEmptyState, renderInvalid, renderStatus, renderUnreachable } from "./banners";
import { isEditing, settleEditors, type EditEnd } from "./edit-text";
import { createCheatsheet } from "./cheatsheet";
import { createCursor, focusAndReveal, reveal, rowSelector, stopSelector } from "./cursor";
import { createFooter } from "./footer";
import { renderHeader } from "./header";
import { el } from "./dom";
import { installKeyboard } from "./keyboard";
import { setupDnd } from "./dnd";
import { renderListSection, renderSubtaskLine, type ListContext } from "./list-section";
import { BEGIN_EDIT, type TaskActions } from "./task-row";
import { isTextField } from "../shortcuts";

const NEW_LIST_NAME = "New list";

export function mountApp(roots: { header: HTMLElement; banners: HTMLElement; main: HTMLElement }, store: Store, storage?: Storage): void {
  const ctx: ListContext = { reveal: null, renaming: null, confirmingRemove: null, drafts: new Map(), placeholder: null };
  const footer = createFooter();
  const cheatsheet = createCheatsheet();
  document.body.append(footer.el, cheatsheet.el);
  const cursor = createCursor(roots.main, store, storage);
  let cursorRestored = false;
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
    focusRow(path) {
      document.querySelector<HTMLElement>(rowSelector(path))?.focus();
    },
  };

  /** Adds a list called "New list" at once, switches a single-list view to it and opens its name input with the name selected. */
  const createList = () => {
    const next = addList(doc(), NEW_LIST_NAME);
    const created = next.lists.length - 1;
    ctx.confirmingRemove = null;
    ctx.renaming = { list: created, draft: NEW_LIST_NAME };
    pendingFocus = "[data-name-input]";
    store.commit(next);
    if (store.getState().selected !== null) {
      pendingFocus = "[data-name-input]"; // the commit may have used the request while the old list was shown
      store.select(created); // the selector must show the new list
    }
    const input = document.querySelector<HTMLInputElement>("[data-name-input]");
    input?.select();
    reveal(roots.main.querySelector(`.list[data-list="${created}"]`)); // show the whole new list
  };

  /** Callbacks of the name input of a rename, or of the list just created. */
  const naming = {
    input(draft: string) {
      if (!ctx.renaming) return;
      ctx.renaming.draft = draft;
      // The selector shows the title of the selected list, so it follows what is typed.
      const label = document.querySelector(".selector-label");
      if (label && store.getState().selected === ctx.renaming.list) label.textContent = draft.trim() !== "" ? draft : doc().lists[ctx.renaming.list]?.title ?? "";
    },
    submit(name: string) {
      const rename = ctx.renaming;
      if (!rename) return; // the input was discarded (e.g. by an external change)
      ctx.renaming = null;
      const next = renameList(doc(), rename.list, name);
      if (next !== doc()) {
        commitFocus(next, stopSelector({ kind: "header", list: rename.list }));
        return;
      }
      pendingFocus = stopSelector({ kind: "header", list: rename.list });
      renderAll(store.getState());
    },
    cancel() {
      if (!ctx.renaming) return;
      pendingFocus = stopSelector({ kind: "header", list: ctx.renaming.list });
      ctx.renaming = null;
      renderAll(store.getState()); // the selector goes back to the stored title
    },
  };

  const lists = {
    naming,
    rename(index: number) {
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
      const from = ctx.reveal;
      for (const key of ctx.drafts.keys()) if (key.startsWith("child-")) ctx.drafts.delete(key);
      ctx.reveal = null;
      if (from) pendingFocus = rowSelector(from);
      renderAll(store.getState());
    },
  };

  /** Shows or hides the revealed "Add a subtask" line without a render, which would close the editor a click just opened. */
  function syncReveal(next: Reveal) {
    if (next === ctx.reveal) return;
    ctx.reveal = next;
    for (const key of ctx.drafts.keys()) if (key.startsWith("child-")) ctx.drafts.delete(key); // a stale draft must not reappear on another task
    roots.main.querySelector("[data-reveal]")?.remove();
    for (const ul of Array.from(roots.main.querySelectorAll(".subtasks:not(:has(li))"))) ul.remove();
    if (!next) return;
    const item = roots.main.querySelector(`.task-row[data-list="${next.list}"][data-task="${next.task}"]:not([data-child])`)?.parentElement;
    if (!item) return;
    let sub = item.querySelector(":scope > .subtasks");
    if (!sub) item.append((sub = el("ul", { class: "subtasks" })));
    sub.append(renderSubtaskLine(next.list, next.task, lists, ctx));
    dnd.refresh(); // the DOM changed under the registered rows
    for (const row of Array.from(roots.main.querySelectorAll<HTMLElement>(".task-row:has(.cm-editor)"))) row.draggable = false; // refresh made it draggable again
  }

  /** What a click landed on, for the reveal of PRD 5.10. */
  function clickTarget(target: EventTarget | null): ClickTarget {
    if (!(target instanceof Element) || !roots.main.contains(target)) return { kind: "other" };
    if (target.closest(".add-line, .task-new, .task-check")) return { kind: "checkbox" }; // changes nothing
    const row = target.closest<HTMLElement>(".task-row");
    if (row && target.closest(".task-text") && row.dataset.list !== undefined) {
      const { list, task, child } = row.dataset;
      return { kind: "text", path: { list: Number(list), task: Number(task), ...(child === undefined ? {} : { child: Number(child) }) } };
    }
    return { kind: "other" };
  }
  document.addEventListener("click", (e) => syncReveal(revealAfterClick(ctx.reveal, clickTarget(e.target))));
  // Capture phase, so that the editor's own Escape handling cannot hide it from here. The subtask line handles its own Escape.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !(e.target instanceof Element && e.target.closest(".add-line"))) syncReveal(revealAfterKey(ctx.reveal, e.key));
    },
    true,
  );

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
    ctx.reveal = state.doc ? revealOrNull(ctx.reveal, state.doc) : null;
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
    reveal(row);
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
    renderHeader(roots.header, state, { select: (i) => store.select(i), newList: createList });
    renderStatus(state);
    renderBanners(roots.banners, state, { keepMine: store.keepMine, takeDisk: store.takeDisk });
    renderMain();
    const wanted = pendingFocus ? document.querySelector<HTMLElement>(pendingFocus) : null;
    pendingFocus = null;
    if (wanted) focusAndReveal(wanted);
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
