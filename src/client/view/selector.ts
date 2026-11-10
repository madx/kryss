// Custom list selector: a button showing the current view and a listbox menu (PRD 5.10). No dependency.
import type { TodoDocument } from "../../shared/types";
import { menuKey, menuStart, menuView } from "../logic/menu";
import type { View } from "../logic/views";
import { el } from "./dom";
import { caretIcon, checkIcon } from "./icons";

export function renderSelector(doc: TodoDocument, view: View, onSelect: (view: View) => void): HTMLElement {
  const titles = ["All", ...doc.lists.map((l) => l.title)];
  const count = doc.lists.length;
  const current = menuStart(view, count);

  const label = el("span", { class: "selector-label" }, titles[current]!);
  const button = el("button", { type: "button", class: "selector-button", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": "List" }, label, caretIcon());
  const menu = el("div", { class: "selector-menu", role: "listbox", tabindex: "0", "aria-label": "List" });
  menu.hidden = true;
  const wrap = el("div", { class: "selector" }, button, menu);

  const items = titles.map((title, i) => {
    const item = el("div", { class: "selector-item", role: "option", "aria-selected": String(i === current), id: `selector-item-${i}` }, el("span", { class: "selector-item-label" }, title));
    const mark = el("span", { class: "selector-check" });
    if (i === current) mark.append(checkIcon());
    item.append(mark);
    item.addEventListener("click", () => pick(menuView(i)));
    item.addEventListener("pointermove", () => highlight(i));
    menu.append(item);
    return item;
  });

  let active = current;
  function highlight(i: number) {
    active = i;
    items.forEach((item, n) => (n === i ? item.setAttribute("data-active", "") : item.removeAttribute("data-active")));
    menu.setAttribute("aria-activedescendant", `selector-item-${i}`);
    items[i]?.scrollIntoView({ block: "nearest" });
  }

  const onOutside = (e: Event) => {
    if (!wrap.isConnected) document.removeEventListener("pointerdown", onOutside);
    else if (!wrap.contains(e.target as Node)) close(false);
  };
  function open() {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    highlight(current);
    menu.focus();
    document.addEventListener("pointerdown", onOutside);
  }
  function close(refocus: boolean) {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside);
    if (refocus) button.focus();
  }
  function pick(v: View) {
    close(true);
    onSelect(v);
  }

  button.addEventListener("click", () => (menu.hidden ? open() : close(true)));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (menu.hidden) open();
    }
  });
  menu.addEventListener("keydown", (e) => {
    const res = menuKey(active, count, e.key);
    if (!res) return;
    e.preventDefault();
    if ("highlight" in res) highlight(res.highlight);
    else if ("pick" in res) pick(res.pick);
    else close(true);
  });
  return wrap;
}
