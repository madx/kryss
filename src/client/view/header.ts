// Header: list selector (All or one list), new list button and the sync status symbol.
import type { StoreState } from "../store";
import { el } from "./dom";
import { plusIcon } from "./icons";
import { renderSelector } from "./selector";

export type HeaderActions = { select(index: number | null): void; newList(): void };

export function renderHeader(root: HTMLElement, state: StoreState, actions: HeaderActions): void {
  const left = el("div", { class: "header-left" });
  if (state.doc) {
    left.append(renderSelector(state.doc, state.selected, actions.select));
    const newList = el("button", { type: "button", class: "icon-button", title: "New list", "aria-label": "New list" }, plusIcon());
    newList.addEventListener("click", actions.newList);
    left.append(newList);
  }
  root.replaceChildren(left, el("span", { id: "sync-status", class: "sync-status", role: "status" }));
}
