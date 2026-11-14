// The link picker opened by `gx` when a task has several links (PRD 5.20): the panel of the list picker, with a label and a muted URL on each row.
import { linkRows, type TaskLink } from "../logic/task-links";
import { el } from "./dom";

export type LinkPickerEnv = {
  /** A link was chosen: the app opens it. */
  pick(link: TaskLink): void;
  /** The picker closed: the app puts the cursor back on the row. */
  closed(): void;
};

export function createLinkPicker(env: LinkPickerEnv) {
  const input = el("input", { type: "text", class: "list-picker-input", "aria-label": "Open link", placeholder: "Open link", autocomplete: "off", spellcheck: "false" });
  const menu = el("div", { class: "picker-menu", role: "listbox" });
  const root = el("div", { class: "list-picker", hidden: true }, input, menu);
  let links: TaskLink[] = [];
  let rows: number[] = [];
  let active = 0;

  function render() {
    menu.replaceChildren();
    if (rows.length === 0) menu.append(el("div", { class: "picker-empty" }, "No link"));
    rows.forEach((n, i) => {
      const link = links[n]!;
      const item = el(
        "div",
        { class: "picker-item", role: "option", "aria-selected": String(i === active) },
        el("span", { class: "picker-item-label" }, link.label),
        el("span", { class: "picker-item-detail" }, link.url),
      );
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
    const link = links[rows[i] ?? -1];
    if (!link) return;
    close(true);
    env.pick(link);
  }

  function close(notify: boolean) {
    if (root.hidden) return;
    root.hidden = true; // hiding the focused input fires a blur, which must not close twice
    if (notify) env.closed();
  }

  input.addEventListener("input", () => {
    rows = linkRows(links, input.value);
    active = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the global keys must not see what is typed here
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length > 0) highlight(e.key === "ArrowDown" ? Math.min(active + 1, rows.length - 1) : Math.max(active - 1, 0));
    }
  });
  input.addEventListener("blur", () => {
    if (document.hasFocus()) close(true); // the window losing the focus (alt-tab) leaves the picker open
  });

  return {
    el: root,
    isOpen: () => !root.hidden,
    /** Opens the picker below `row`, on the first of `taskLinks`. The input says what Enter does: "Open link" or "Copy link". */
    open(row: Element, taskLinks: TaskLink[], mode: "open" | "copy") {
      links = taskLinks;
      const label = mode === "copy" ? "Copy link" : "Open link";
      input.placeholder = label;
      input.setAttribute("aria-label", label);
      input.value = "";
      rows = linkRows(links, "");
      active = 0;
      render();
      const box = row.getBoundingClientRect();
      root.style.left = `${box.left}px`;
      root.style.width = `${box.width}px`;
      root.style.top = `${box.bottom + 4}px`;
      root.hidden = false;
      const height = root.getBoundingClientRect().height;
      if (box.bottom + 4 + height > window.innerHeight) root.style.top = `${Math.max(box.top - height - 4, 0)}px`; // not enough room below: open above the row
      input.focus();
    },
    close: () => close(false),
  };
}

export type LinkPicker = ReturnType<typeof createLinkPicker>;
