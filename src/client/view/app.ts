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
  moveToList,
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
import { paste, type PastePlace, type PasteTarget } from "../logic/paste";
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
import { switchRefusal } from "../logic/files";
import { createFilePicker, type FilePickerEnv } from "./file-picker";
import { createFilterPicker } from "./filter-picker";
import { createListPicker } from "./list-picker";
import { createLinkPicker } from "./link-picker";
import { isAllowedUrl } from "../markdown/inline";
import type { TaskLink } from "../logic/task-links";
import { visibleOf } from "./visible";
import { firstMatch, matchingStops, searchCounter, stepMatch } from "../logic/search";
import { visibleStops } from "../logic/filter";
import { createSearchBar } from "./search-bar";
import { highlight, markCurrent } from "./search-highlight";
import { localToday } from "../today";
import { el } from "./dom";
import { installDueRefresh } from "./due-pill";
import { installKeyboard } from "./keyboard";
import { renderListSection, type ListContext } from "./list-section";
import { BEGIN_EDIT, type TaskActions } from "./task-row";
import { isTextField } from "../shortcuts";

const NEW_LIST_NAME = "New list";

/** What the app needs in Vault mode (PRD 5.16): the open file and the calls of the file picker. */
export type VaultEnv = {
  file: string;
  list: FilePickerEnv["list"];
  create: FilePickerEnv["create"];
  open(path: string): void;
  /** What is wrong in `.kryss.json` (PRD 5.18), reported once in the statusline. */
  linkProblems?: string[];
};

export function mountApp(roots: { header: HTMLElement; banners: HTMLElement; main: HTMLElement }, store: Store, storage?: Storage, vault?: VaultEnv): { refresh(): void } {
  const ctx: ListContext = { renaming: null, placeholder: null };
  const footer = createFooter();
  const cheatsheet = createCheatsheet();
  const searchBar = createSearchBar({
    input: (query) => typeSearch(query),
    close: (refocus) => closeSearchInput(refocus),
    end: (refocus) => endSearch(refocus ? searchOrigin : null),
  });
  document.body.append(searchBar.el, footer.el, cheatsheet.el);
  const cursor = createCursor(roots.main, store, storage, vault?.file ?? null);
  const bar = createFilterBar({
    initial: store.getState().filter,
    listTitles: () => store.getState().doc?.lists.map((l) => l.title) ?? [],
    onInput: (text) => store.setFilter(text),
    onEnter() {
      store.setFilter(store.getState().filter); // applying the same text drops the pins: the view is refreshed
      bar.blur();
      cursor.focusIndex(0); // the first visible stop
    },
  });
  const header = createHeader(roots.header, bar, () => toggleMarkdown(), () => store.toggleSiblings(), vault?.file ?? null);
  const picker = createFilterPicker({
    saved: () => store.getState().doc?.filters ?? [],
    text: () => store.getState().filter,
    apply: (text) => store.setFilter(text),
    commit: (filters) => store.commitFilters(filters),
    closed: () => cursor.focusIndex(0), // the first visible stop, as after Enter in the bar
  });
  roots.header.append(picker.el);
  const filePicker = vault
    ? createFilePicker({
        list: vault.list,
        create: vault.create,
        current: () => vault.file,
        open: (path) => void switchFile(path),
        closed: () => cursor.focusIndex(cursor.last()),
      })
    : null;
  if (filePicker) roots.header.append(filePicker.el);
  /** The task whose list the `cl` picker is choosing. */
  let moving: TaskPath | null = null;
  const listPicker = createListPicker({
    doc: () => doc(),
    pick(list) {
      const path = moving;
      moving = null;
      if (!path) return;
      if (!apply(moveToList(doc(), path, list))) cursor.focusStop({ kind: "task", path });
    },
    closed() {
      const path = moving;
      moving = null;
      if (path) cursor.focusStop({ kind: "task", path });
    },
  });
  document.body.append(listPicker.el);
  /** The task whose links the `gx` picker is listing. */
  let linking: TaskPath | null = null;
  /** What the `gx` picker does with the chosen link: `gX` copies the URL instead of opening it. */
  let linkMode: "open" | "copy" = "open";
  const linkPicker = createLinkPicker({
    pick(link) {
      if (linkMode === "copy") copyLinkUrl(link);
      else openLink(link);
    },
    closed() {
      const path = linking;
      linking = null;
      if (path) cursor.focusStop({ kind: "task", path });
    },
  });
  document.body.append(linkPicker.el);
  /** Copies the URL of a link (PRD 5.20), with no message and no effect on a refused write. The cursor stays on the row. */
  function copyLinkUrl(link: TaskLink) {
    const path = linking;
    linking = null;
    try {
      navigator.clipboard.writeText(link.url).catch(() => {});
    } catch {
      // clipboard unavailable: silent, as gx is
    }
    if (path) cursor.focusStop({ kind: "task", path });
  }
  function openLinkPicker(path: TaskPath, links: TaskLink[], mode: "open" | "copy") {
    const row = document.querySelector(rowSelector(path));
    if (!row) return;
    linking = path;
    linkMode = mode;
    linkPicker.open(row, links, mode);
  }
  /** Opens a link of a task in a new tab (PRD 5.20), under the scheme rules of 5.5. The cursor stays on the row. */
  function openLink(link: TaskLink) {
    const path = linking;
    linking = null;
    if (isAllowedUrl(link.url)) {
      // An anchor click, as for a rendered link (5.5): `window.open` can leave a blank tab for `obsidian:` and `mailto:`.
      const a = document.createElement("a");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    }
    if (path) cursor.focusStop({ kind: "task", path });
  }
  if (vault?.linkProblems?.length) footer.flash(`.kryss.json: ${vault.linkProblems[0]}${vault.linkProblems.length > 1 ? ` (+${vault.linkProblems.length - 1})` : ""}`, true);

  /** A switch is a navigation, after the pending changes are saved, and it is refused while a save fails or is in conflict. */
  async function switchFile(path: string) {
    if (!vault || path === vault.file) return filePicker?.close();
    let refusal = switchRefusal(store.getState().status);
    if (refusal === null) {
      await store.flush();
      refusal = switchRefusal(store.getState().status);
    }
    if (refusal !== null) {
      footer.flash(refusal, true);
      return filePicker?.close();
    }
    vault.open(path);
  }
  let cursorRestored = false;
  const markdownView = createMarkdownView(copyText);
  let markdownOpen = false;
  /** The active search query (PRD 5.15), or null. In memory only. */
  let search: string | null = null;
  /** Cursor index where `/` was pressed, and the matching row the cursor is on while the input has the focus. */
  let searchOrigin = 0;
  let searchIndex = 0;
  /** CSS selector of the element to focus after the next render. */
  let pendingFocus: string | null = null;

  const doc = (): TodoDocument => store.getState().doc!;
  /** The visible rows, which the keyboard moves work on (PRD 5.14). */
  const rows = () => visibleOf(store.getState()) ?? undefined;
  /** Commits with a focus request. The render is synchronous, so a request left over means nothing rendered and must not leak into a later render. */
  const commitFocus = (next: TodoDocument, selector: string | null, options?: CommitOptions) => {
    pendingFocus = selector;
    store.commit(next, options);
    pendingFocus = null;
  };
  const apply = (result: OpResult | null, focus = true): boolean => {
    if (!result) return false;
    // The moved task is pinned, and the other pins follow their tasks (PRD 5.14).
    commitFocus(result.doc, focus ? rowSelector(result.path) : null, { pin: result.path, moves: result.moves });
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
    indent: (path) => apply(indent(doc(), path, rows())),
    outdent: (path) => apply(outdent(doc(), path)),
    moveUp: (path) => apply(moveUp(doc(), path, rows())),
    moveDown: (path) => apply(moveDown(doc(), path, rows())),
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
    /** Moves a list (over the visible lists under a filter, PRD 5.14) and leaves the cursor on its header, or on the task it was on. */
    move(list: number, target: number, place: ListPlace, focus?: Stop): boolean {
      const result = moveList(doc(), list, target, place);
      if (!result) return false;
      // The rename is keyed by list index, which shifts.
      ctx.renaming = null;
      // `focus` is the task the cursor was on: it keeps the cursor, in the moved list.
      commitFocus(result.doc, stopSelector(focus && focus.kind === "task" ? { kind: "task", path: { ...focus.path, list: result.list } } : { kind: "header", list: result.list }), { moves: result.moves }); // the pins follow their lists
      return true;
    },
    moveByKey(list: number, dir: "up" | "down", focus?: Stop) {
      const step = listMoveTarget(list, dir, (rows()?.lists ?? []).map((l) => l.list));
      if (step) lists.move(list, step.target, step.place, focus);
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
    footer.update({ mode: bar.isFocused() ? "filter" : searchBar.isFocused() ? "search" : insert ? "insert" : "normal", view: countVisible(state.doc, visible.lists) });
  }

  const stopElement = (index: number): HTMLElement | null => {
    const visible = visibleOf(store.getState());
    const stop = visible ? visibleStops(visible)[index] : undefined;
    return stop ? roots.main.querySelector<HTMLElement>(stopSelector(stop)) : null;
  };
  const searchMatches = (): number[] => {
    const state = store.getState();
    const visible = visibleOf(state);
    return state.doc && visible && search ? matchingStops(state.doc, visible, search) : [];
  };
  /** Where the cursor is for the search: the matching row while typing, the focused stop otherwise. */
  const searchCursor = () => (searchBar.isFocused() ? searchIndex : cursor.hasFocus() ? cursor.index() : cursor.last());
  /** Recomputes the highlights, the cursor row mark and the muted line from the document and the filter (PRD 5.15). */
  function refreshSearch() {
    const last = Math.max(0, cursor.count() - 1); // a re-render while the input is open can remove rows
    searchOrigin = Math.min(searchOrigin, last);
    searchIndex = Math.min(searchIndex, last);
    const active = search !== null && !markdownOpen;
    highlight(roots.main, active ? search : null);
    markCurrent(roots.main, active ? stopElement(searchCursor()) : null);
    footer.setSearch(active ? search : null, searchCounter(searchMatches(), searchCursor()));
  }
  function startSearch() {
    if (markdownOpen) return;
    searchOrigin = Math.max(0, cursor.hasFocus() ? cursor.index() : cursor.last());
    searchIndex = searchOrigin;
    search = "";
    searchBar.open();
    refreshSearch();
  }
  /** Live typing: the cursor goes to the first match at or after the starting row, or back to it when there is none. */
  function typeSearch(query: string) {
    search = query;
    searchIndex = firstMatch(searchMatches(), searchOrigin)?.index ?? searchOrigin;
    refreshSearch();
    reveal(stopElement(searchIndex));
  }
  /** Enter or Escape in the input with a query: it closes, the cursor stays on the matching row and the search stays active. */
  function closeSearchInput(refocus: boolean) {
    if (search === null) return;
    searchBar.hide();
    if (refocus) cursor.focusIndex(searchIndex);
    refreshSearch();
  }
  /** Ends the search: the query is forgotten and the highlights and the bar disappear. `focusAt` puts the cursor back on that index. */
  function endSearch(focusAt: number | null = null) {
    if (search === null) return;
    search = null;
    searchBar.hide();
    if (focusAt !== null) cursor.focusIndex(focusAt);
    refreshSearch();
    updateFooter();
  }
  function stepSearch(dir: "next" | "prev") {
    const step = stepMatch(searchMatches(), searchCursor(), dir);
    if (!step) return;
    cursor.focusIndex(step.index);
    if (step.wrapped) footer.flash("Wrapped", false);
    refreshSearch();
  }

  function renderAll(state: StoreState, focus: string | null = null) {
    if (focus) pendingFocus = focus;
    header.setMarkdownOpen(markdownOpen);
    header.setSiblings(state.showSiblings);
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
    refreshSearch();
  }

  /** Opens the Markdown view, or closes it. It needs no save: it shows the document held by the page. */
  function toggleMarkdown() {
    markdownOpen = !markdownOpen;
    if (markdownOpen) endSearch(); // opening the view ends the search (PRD 5.15)
    renderAll(store.getState());
  }

  store.subscribe((state, kind) => {
    if (kind === "external") {
      // The disk version wins: a list name being typed is discarded, and clearing it first keeps the blur on removal from committing it.
      ctx.renaming = null;
      ctx.placeholder = null;
      moving = null; // the picker holds list indexes and a path of the old document
      listPicker.close();
      linking = null;
      linkPicker.close();
    }
    if (kind !== "status") {
      renderAll(state);
    } else {
      renderStatus(state);
      renderBanners(roots.banners, state, { keepMine: store.keepMine, takeDisk: store.takeDisk });
    }
  });
  document.addEventListener("focusin", updateFooter);
  document.addEventListener("focusin", () => search !== null && refreshSearch()); // the cursor row changes with the focus
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
    paste(stop: Stop, at: PastePlace) {
      const result = paste(doc(), register, pasteTarget(stop), at);
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
      startList: () => bar.startListTerm(),
      openPicker: () => picker.open(),
    },
    files: { openPicker: () => void filePicker?.open() },
    renameList: lists.rename,
    registerKeys,
    changeList: (list) => lists.rename(list, true),
    moveToList(path) {
      const row = document.querySelector(rowSelector(path));
      if (!row) return;
      moving = path;
      listPicker.open(row, path.list);
    },
    openLink(path, link) {
      linking = path;
      openLink(link);
    },
    linkPicker(path, links) {
      openLinkPicker(path, links, "open");
    },
    copyLink: (link) => copyLinkUrl(link),
    copyLinkPicker(path, links) {
      openLinkPicker(path, links, "copy");
    },
    search: { active: () => search !== null, start: startSearch, step: stepSearch, end: () => endSearch() },
    moveList: lists.moveByKey,
    beginAdd,
    newList: createList,
    markdown: { isOpen: () => markdownOpen, toggle: toggleMarkdown, copy: markdownView.copy },
  });
  renderAll(store.getState());
  return {
    /** Draws the lists again, for what changed outside the document (the link rules). It waits while a task or a list name is being typed. */
    refresh() {
      if (!isEditing() && !ctx.renaming && !ctx.placeholder) renderAll(store.getState());
    },
  };
}
