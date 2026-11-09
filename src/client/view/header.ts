// Header: title, list selector (All or one list), new list button and the sync status badge.
import type { StoreState } from "../store";
import { el } from "./dom";

export type HeaderActions = { select(index: number | null): void; newList(): void };

export function renderHeader(root: HTMLElement, state: StoreState, actions: HeaderActions): void {
  const children: Node[] = [el("h1", {}, "Tasks")];
  if (state.doc) {
    const select = el("select", { class: "list-select", "aria-label": "List" });
    select.append(el("option", { value: "all" }, "All"));
    state.doc.lists.forEach((list, i) => select.append(el("option", { value: String(i) }, list.title)));
    select.value = state.selected === null ? "all" : String(state.selected);
    select.addEventListener("change", () => actions.select(select.value === "all" ? null : Number(select.value)));
    const newList = el("button", { type: "button", class: "button" }, "New list");
    newList.addEventListener("click", actions.newList);
    children.push(select, newList);
  }
  children.push(el("span", { id: "sync-status", class: "sync-status", role: "status" }));
  root.replaceChildren(...children);
}
