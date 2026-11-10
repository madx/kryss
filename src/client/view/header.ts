// Header: list selector (All or one list), new list button and the sync status symbol.
import type { StoreState } from "../store";
import { el } from "./dom";
import { plusIcon } from "./icons";
import { renderNameInput, type NameInputActions } from "./name-input";
import { renderSelector } from "./selector";

export type HeaderActions = { select(index: number | null): void; newList(): void; creating: { draft: string } | null; naming: NameInputActions };

export function renderHeader(root: HTMLElement, state: StoreState, actions: HeaderActions): void {
  const left = el("div", { class: "header-left" });
  if (state.doc) {
    if (actions.creating) {
      // The name input replaces the selector while it is open.
      left.append(renderNameInput(actions.creating.draft, "New list name", actions.naming));
    } else {
      left.append(renderSelector(state.doc, state.selected, actions.select));
      const newList = el("button", { type: "button", class: "icon-button", title: "New list", "aria-label": "New list" }, plusIcon());
      newList.addEventListener("click", actions.newList);
      left.append(newList);
    }
  }
  root.replaceChildren(left, el("span", { id: "sync-status", class: "sync-status", role: "status" }));
}
