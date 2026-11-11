// The saved filter picker (PRD 5.14): a listbox below the filter bar, with a name input to save the current filter.
import type { SavedFilter } from "../../shared/types";
import { deleteFilter, pickerEntries, pickerKey, saveFilter, type PickerEntry } from "../logic/saved-filters";
import { el } from "./dom";

export type PickerEnv = {
  saved(): SavedFilter[];
  /** The text of the filter bar, saved by "Save current filter…". */
  text(): string;
  apply(text: string): void;
  /** The new list of saved filters, after a save or a delete. */
  commit(filters: SavedFilter[]): void;
  /** The picker closed: the app puts the cursor back. */
  closed(): void;
};

export function createFilterPicker(env: PickerEnv) {
  const menu = el("div", { class: "picker-menu", role: "listbox", tabindex: "0", "aria-label": "Saved filters" });
  menu.hidden = true;
  const root = el("div", { class: "filter-picker" }, menu);
  let entries: PickerEntry[] = [];
  let active = 0;
  let pendingD = false;
  let naming = false;

  const label = (e: PickerEntry) => (e.kind === "save" ? "Save current filter…" : env.saved()[e.index]!.name);

  function render() {
    const saved = env.saved();
    entries = pickerEntries(saved, env.text());
    active = Math.min(active, Math.max(entries.length - 1, 0));
    menu.replaceChildren();
    if (entries.length === 0) menu.append(el("div", { class: "picker-empty" }, "No saved filter"));
    entries.forEach((entry, i) => {
      const item = el("div", { class: "picker-item", role: "option", "aria-selected": String(i === active), "data-kind": entry.kind });
      item.append(el("span", { class: "picker-item-label" }, label(entry)));
      if (entry.kind === "saved") item.append(el("span", { class: "picker-item-text" }, saved[entry.index]!.text));
      if (i === active) item.setAttribute("data-active", "");
      item.addEventListener("click", () => pick(i));
      item.addEventListener("pointermove", () => highlight(i));
      menu.append(item);
    });
  }

  function highlight(i: number) {
    active = i;
    menu.querySelectorAll(".picker-item").forEach((item, n) => {
      item.toggleAttribute("data-active", n === i);
      item.setAttribute("aria-selected", String(n === i));
    });
  }

  function startNaming() {
    naming = true;
    const input = el("input", { type: "text", class: "picker-name", "aria-label": "Filter name", placeholder: "Name of the filter" });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const next = saveFilter(env.saved(), input.value, env.text());
        if (next) env.commit(next);
        close();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
    menu.replaceChildren(input);
    input.focus();
  }

  function pick(i: number) {
    const entry = entries[i];
    if (!entry) return;
    if (entry.kind === "save") return startNaming();
    const saved = env.saved()[entry.index];
    close(false);
    if (saved) env.apply(saved.text);
    env.closed();
  }

  const onOutside = (e: Event) => {
    if (!root.contains(e.target as Node)) close();
  };

  function open() {
    naming = false;
    pendingD = false;
    active = 0;
    render();
    menu.hidden = false;
    menu.focus();
    document.addEventListener("pointerdown", onOutside);
  }

  function close(notify = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    naming = false;
    pendingD = false;
    document.removeEventListener("pointerdown", onOutside);
    if (notify) env.closed();
  }

  menu.addEventListener("keydown", (e) => {
    if (naming) return;
    const result = pickerKey(active, entries.length, e.key, pendingD);
    if (!result) return;
    e.preventDefault();
    pendingD = result.pending === true;
    if (result.highlight !== undefined) highlight(result.highlight);
    if (result.pick !== undefined) pick(result.pick);
    if (result.close) close();
    if (result.remove !== undefined) {
      const entry = entries[result.remove];
      if (entry?.kind === "saved") {
        env.commit(deleteFilter(env.saved(), entry.index));
        render();
      }
    }
  });
  root.addEventListener("focusout", (e) => {
    if (!menu.hidden && !root.contains(e.relatedTarget as Node | null)) close();
  });

  return { el: root, open, close: () => close(), isOpen: () => !menu.hidden };
}

export type FilterPicker = ReturnType<typeof createFilterPicker>;
