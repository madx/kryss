// The list picker opened by `cl` (PRD 5.12): a plain input and a list below the row of the task.
import type { TodoDocument } from "../../shared/types";
import { listPickerRows, listPickerStart } from "../logic/list-picker";
import { el } from "./dom";

export type ListPickerEnv = {
  doc(): TodoDocument;
  /** A list was chosen: the app moves the task there. The chosen list may be the one that already holds the task, which does nothing. */
  pick(list: number): void;
  /** The picker closed with no change: the app puts the cursor back on the row. */
  closed(): void;
};

export function createListPicker(env: ListPickerEnv) {
  const input = el("input", { type: "text", class: "list-picker-input", "aria-label": "Move to list", placeholder: "Move to list", autocomplete: "off", spellcheck: "false" });
  const menu = el("div", { class: "picker-menu", role: "listbox" });
  const root = el("div", { class: "list-picker", hidden: true }, input, menu);
  let source = 0;
  let rows: number[] = [];
  let active = 0;

  function render() {
    const doc = env.doc();
    menu.replaceChildren();
    if (rows.length === 0) menu.append(el("div", { class: "picker-empty" }, "No list"));
    rows.forEach((list, i) => {
      const item = el("div", { class: "picker-item", role: "option", "aria-selected": String(i === active) }, el("span", { class: "picker-item-label" }, doc.lists[list]!.title));
      if (list === source) item.setAttribute("aria-current", "true");
      if (i === active) item.setAttribute("data-active", "");
      item.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the focus in the input until the click
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
    menu.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }

  function pick(i: number) {
    const list = rows[i];
    if (list === undefined) return;
    close(false);
    env.pick(list);
  }

  function close(notify = true) {
    if (root.hidden) return;
    root.hidden = true; // hiding the focused input fires a blur, which must not close twice
    if (notify) env.closed();
  }

  input.addEventListener("input", () => {
    rows = listPickerRows(env.doc(), input.value);
    active = listPickerStart(rows, source);
    render();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the global keys must not see what is typed here
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length > 0) highlight(e.key === "ArrowDown" ? Math.min(active + 1, rows.length - 1) : Math.max(active - 1, 0));
    }
  });
  input.addEventListener("blur", () => {
    if (document.hasFocus()) close(); // the window losing the focus (alt-tab) leaves the picker open
  });

  return {
    el: root,
    isOpen: () => !root.hidden,
    /** Opens the picker below `row`, for a task of the list `from`. */
    open(row: Element, from: number) {
      source = from;
      input.value = "";
      rows = listPickerRows(env.doc(), "");
      active = listPickerStart(rows, source);
      render();
      const box = row.getBoundingClientRect();
      root.style.left = `${box.left}px`;
      root.style.width = `${box.width}px`;
      root.style.top = `${box.bottom + 4}px`;
      root.hidden = false;
      input.focus();
      menu.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
    },
    close: () => close(false),
  };
}

export type ListPicker = ReturnType<typeof createListPicker>;
