// Header: list selector (All or one list), new list button and the sync status symbol.
import type { StoreState } from "../store";
import { el } from "./dom";
import { plusIcon } from "./icons";
import { renderNameInput, type NameInputActions } from "./name-input";

export type HeaderActions = { select(index: number | null): void; newList(): void; creating: { draft: string } | null; naming: NameInputActions };

export function renderHeader(root: HTMLElement, state: StoreState, actions: HeaderActions): void {
  const left = el("div", { class: "header-left" });
  if (state.doc) {
    const select = el("select", { class: "list-select", "aria-label": "List" });
    select.append(el("option", { value: "all" }, "All"));
    state.doc.lists.forEach((list, i) => select.append(el("option", { value: String(i) }, list.title)));
    select.value = state.selected === null ? "all" : String(state.selected);
    select.addEventListener("change", () => actions.select(select.value === "all" ? null : Number(select.value)));
    left.append(select);
    if (actions.creating) {
      left.append(renderNameInput(actions.creating.draft, "New list name", actions.naming));
    } else {
      const newList = el("button", { type: "button", class: "icon-button", title: "New list", "aria-label": "New list" }, plusIcon());
      newList.addEventListener("click", actions.newList);
      left.append(newList);
    }
  }
  root.replaceChildren(left, el("span", { id: "sync-status", class: "sync-status", role: "status" }));
}
