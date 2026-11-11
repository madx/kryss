// Wires the store to the DOM: full render on content changes, light update on status changes.
import type { TodoDocument } from "../../shared/types";
import {
  addList,
  cutList,
  cutTask,
  deleteList,
  editText,
  indent,
  listMoveTarget,
  moveDown,
  moveList,
  moveUp,
  outdent,
  renameList,
  toggleDone,
  type ListPlace,
  type OpResult,
  type TaskPath,
} from "../logic";
import { commitInsert, insertTarget, type AddAt, type Anchor } from "../logic/insert";
import { isFiltering } from "../logic/filter";
import { getNode } from "../logic/paths";
import { paste, type PasteTarget } from "../logic/paste";
import { copyList, copyTask, registerText, type Register } from "../logic/register";
import type { Stop } from "../logic/cursor";
import { countVisible } from "../logic/stats";
import type { CommitOptions, Store, StoreState } from "../store";
import { renderBanners, renderEmptyState, renderInvalid, renderNoMatch, renderStatus, renderUnreachable } from "./banners";
import { isEditing, settleEditors, type EditEnd } from "./edit-text";
import { createCheatsheet } from "./cheatsheet";
import { createCursor, focusAndReveal, reveal, rowSelector, stopSelector } from "./cursor";
import { exportView } from "../logic/export";
import { createFooter } from "./footer";
import { createMarkdownView } from "./markdown-view";
import { createFilterBar } from "../editor/filter-bar";
import { createHeader } from "./header";
import { createFilterPicker } from "./filter-picker";
import { visibleOf } from "./visible";
import { localToday } from "../today";
import { el } from "./dom";
import { installDueRefresh } from "./due-pill";
import { installKeyboard } from "./keyboard";
import { renderListSection, type ListContext } from "./list-section";
import { BEGIN_EDIT, type TaskActions } from "./task-row";
import { isTextField } from "../shortcuts";

const NEW_LIST_NAME = "New list";

export function mountApp(roots: { header: HTMLElement; banners: HTMLElement; main: HTMLElement }, store: Store, storage?: Storage): void {
  const ctx: ListContext = { renaming: null, placeholder: null };
  const footer = createFooter();
  const cheatsheet = createCheatsheet();
  document.body.append(footer.el, cheatsheet.el);
  const cursor = createCursor(roots.main, store, storage);
  const bar = createFilterBar({
    initial: store.getState().filter,
    listTitles: () => store.getState().doc?.lists.map((l) => l.title) ?? [],
    onInput: (text) => store.setFilter(text),
    onEnter() {
      bar.blur();
      cursor.focusIndex(0); // the first visible stop
    },
  });
  const header = createHeader(roots.header, bar, () => toggleMarkdown());
  const picker = createFilterPicker({
    saved: () => store.getState().doc?.filters ?? [],
    text: () => store.getState().filter,
    apply: (text) => store.setFilter(text),
    commit: (filters) => store.commitFilters(filters),
    closed: () => cursor.focusIndex(0), // the first visible stop, as after Enter in the bar
  });
  roots.header.append(picker.el);
  let cursorRestored = false;
  const markdownView = createMarkdownView(copyText);
  let markdownOpen = false;
  /** CSS selector of the element to focus after the next render. */
  let pendingFocus: string | null = null;

  const doc = (): TodoDocument => store.getState().doc!;
  /** Moves only run with no filter (PRD 5.14), so they cross every list. */
  const allLists = () => ({ first: 0, last: doc().lists.length - 1 });
  /** Commits with a focus request. The render is synchronous, so a request left over means nothing rendered and must not leak into a later render. */
  const commitFocus = (next: TodoDocument, selector: string | null, options?: CommitOptions) => {
    pendingFocus = selector;
    store.commit(next, options);
    pendingFocus = null;
  };
  const apply = (result: OpResult | null, focus = true): boolean => {
    if (!result) return false;
    commitFocus(result.doc, focus ? rowSelector(result.path) : null);
    return true;
  };

  const tasks: TaskActions = {
    toggle(path) {
      commitFocus(toggleDone(doc(), path, localToday()), rowSelector(path), { pin: path, pinChildren: true });
    },
    edit(path, text) {
      pendingFocus = rowSelector(path);
      const before = doc();
      store.commit(editText(before, path, text), { pin: path });
      if (doc() === before) renderAll(store.getState()); // refused or unchanged after normalization: make sure the editor is gone
    },
    indent: (path) => apply(indent(doc(), path)),
    outdent: (path) => apply(outdent(doc(), path)),
    moveUp: (path) => apply(moveUp(doc(), path, allLists())),
    moveDown: (path) => apply(moveDown(doc(), path, allLists())),
    focusRow(path) {
      document.querySelector<HTMLElement>(rowSelector(path))?.focus();
    },
  };

  /** Adds a list called "New list" at once, clears the filter so that it is visible, and opens its name input with the name selected. */
  const createList = () => {
    const next = addList(doc(), NEW_LIST_NAME);
    const created = next.lists.length - 1;
    ctx.renaming = { list: created, draft: NEW_LIST_NAME };
    pendingFocus = "[data-name-input]";
    store.commit(next, { clearPins: true }); // before the filter is cleared, so that undo goes back to the filter of the change
    if (isFiltering(store.getState().filter)) {
      pendingFocus = "[data-name-input]"; // the commit may have used the request while the new list was hidden
      store.setFilter("");
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
      renderAll(store.getState());
    },
  };

  const lists = {
    naming,
    /** Opens the name input. `empty` (`cc`) starts it with no text: Escape or an empty commit keeps the old name. */
    rename(index: number, empty = false) {
        ctx.renaming = { list: index, draft: empty ? "" : doc().lists[index]?.title ?? "" };
      pendingFocus = "[data-name-input]";
      renderAll(store.getState());
    },
    /** Deletes a list. `next` is the document without it when the caller already computed it (`dd`). */
    remove(index: number, next?: TodoDocument) {
        if (!doc().lists[index]) return;
      store.commit(next ?? deleteList(doc(), index), { clearPins: true });
    },
    /** Moves a list (never under a filter, PRD 5.14) and leaves the cursor on its header. */
    move(list: number, target: number, place: ListPlace): boolean {
      const result = moveList(doc(), list, target, place);
      if (!result) return false;
      // The rename is keyed by list index, which shifts.
      ctx.renaming = null;
      commitFocus(result.doc, stopSelector({ kind: "header", list: result.list }));
      return true;
    },
    moveByKey(list: number, dir: "up" | "down") {
      const step = listMoveTarget(list, dir, allLists());
      if (step) lists.move(list, step.target, step.place);
    },
  };

  /** The notice shown in place of the lists when the page holds no document: the invalid file, the unreachable server, or nothing while loading. */
  function noDocumentNotice(state: StoreState): Node {
    if (state.invalid) return renderInvalid(state.invalid, store.hasPendingChanges());
    return state.status === "offline" ? renderUnreachable() : document.createTextNode("");
  }

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
    if (markdownOpen) {
      // Rebuilt on every render from the document of the page, unsaved edits included.
      const visible = visibleOf(state);
      if (state.doc && visible) markdownView.show({ kind: "ok", text: exportView(state.doc, visible) });
      else markdownView.show({ kind: "notice", node: noDocumentNotice(state) });
      if (roots.main.firstChild !== markdownView.el || roots.main.childNodes.length !== 1) roots.main.replaceChildren(markdownView.el);
    } else if (state.invalid || !state.doc) {
      roots.main.replaceChildren(noDocumentNotice(state));
    } else if (state.doc.lists.length === 0) {
      roots.main.replaceChildren(renderEmptyState(createList));
    } else {
      const visible = visibleOf(state)!;
      if (visible.lists.length === 0) roots.main.replaceChildren(renderNoMatch(state.filter, visible.error));
      else roots.main.replaceChildren(...visible.lists.map((v) => renderListSection(state.doc!.lists[v.list]!, v.list, v, tasks, lists, ctx)));
    }
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
    const visible = visibleOf(state)!;
    const insert = isEditing() || isTextField(document.activeElement);
    footer.update({ mode: bar.isFocused() ? "search" : insert ? "insert" : "normal", view: countVisible(state.doc, visible.lists) });
  }

  function renderAll(state: StoreState, focus: string | null = null) {
    if (focus) pendingFocus = focus;
    header.setMarkdownOpen(markdownOpen);
    bar.setText(state.filter);
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

  /** Opens the Markdown view, or closes it. It needs no save: it shows the document held by the page. */
  function toggleMarkdown() {
    markdownOpen = !markdownOpen;
    renderAll(store.getState());
  }

  store.subscribe((state, kind) => {
    if (kind === "external") {
      // The disk version wins: a list name being typed is discarded, and clearing it first keeps the blur on removal from committing it.
      ctx.renaming = null;
      ctx.placeholder = null;
    }
    if (kind !== "status") {
      renderAll(state);
    } else {
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
        commitFocus(result.doc, how === "escape" ? rowSelector(result.path) : null, { pin: result.path, inserted: true });
      },
    };
    ctx.placeholder = self;
  };
  const openPlaceholder = (target: Target, originSelector: string | null) => {
    setPlaceholder(target, originSelector);
    renderAll(store.getState());
  };

  /** Writes the text to the clipboard. A refusal never blocks the edit: it only shows "Copy failed". */
  function copyText(text: string) {
    let written: Promise<void>;
    try {
      written = navigator.clipboard.writeText(text);
    } catch {
      written = Promise.reject(new Error("clipboard unavailable"));
    }
    written.then(
      () => footer.flash("Copied", false),
      () => footer.flash("Copy failed", true),
    );
  }

  /** The register of PRD 5.12: one in-memory slot, never stored and untouched by external changes. */
  let register: Register | null = null;
  const pasteTarget = (stop: Stop): PasteTarget => (stop.kind === "header" ? { list: stop.list } : { list: stop.path.list, task: stop.path.task, child: stop.path.child });
  const fillRegister = (content: Register) => {
    register = content;
    copyText(registerText(content));
  };
  const registerKeys = {
    yank(stop: Stop) {
      const copy = stop.kind === "header" ? copyList(doc(), stop.list) : copyTask(doc(), stop.path);
      if (copy) fillRegister(copy);
    },
    /** `dd`: deletes at once, a list included, and fills the register and the clipboard with what was removed. */
    cut(stop: Stop) {
      if (stop.kind === "header") {
        const cut = cutList(doc(), stop.list);
        if (!cut) return;
        fillRegister(cut.register);
        lists.remove(stop.list, cut.doc);
        return;
      }
      const cut = cutTask(doc(), stop.path);
      if (!cut) return;
      fillRegister(cut.register);
      store.commit(cut.doc, { clearPins: true });
    },
    paste(stop: Stop) {
      const result = paste(doc(), register, pasteTarget(stop));
      if (!result) return;
      if (!("list" in result)) {
        commitFocus(result.doc, rowSelector(result.path), { pin: result.path, inserted: true });
        return;
      }
      // List indices shift: a rename is keyed by index.
      ctx.renaming = null;
      const focus = stopSelector({ kind: "header", list: result.list });
      pendingFocus = focus;
      store.commit(result.doc, { clearPins: true }); // before the filter is cleared, so that undo goes back to the filter of the paste
      pendingFocus = null;
      if (isFiltering(store.getState().filter)) {
        pendingFocus = focus; // the pasted list is shown once the filter is empty
        store.setFilter("");
        pendingFocus = null;
      }
    },
  };

  installDueRefresh();
  installKeyboard({
    store,
    cursor,
    cheatsheet,
    apply: (result) => void apply(result),
    toggle: tasks.toggle,
    filters: {
      focus: () => bar.focus(),
      set: (text) => store.setFilter(text),
      appendList: () => bar.appendListTerm(),
      openPicker: () => picker.open(),
    },
    renameList: lists.rename,
    registerKeys,
    changeList: (list) => lists.rename(list, true),
    moveList: lists.moveByKey,
    beginAdd,
    newList: createList,
    markdown: { isOpen: () => markdownOpen, toggle: toggleMarkdown, copy: markdownView.copy },
  });
  renderAll(store.getState());
}
