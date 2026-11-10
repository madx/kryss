// Header: list selector (All or one list) and new list button.
import type { StoreState } from "../store";
import { el } from "./dom";
import { markdownIcon, plusIcon } from "./icons";
import { renderSelector } from "./selector";

export type HeaderActions = { select(index: number | null): void; newList(): void; markdown: { open: boolean; toggle(): void } };

export function renderHeader(root: HTMLElement, state: StoreState, actions: HeaderActions): void {
  const left = el("div", { class: "header-left" });
  if (state.doc) {
    left.append(renderSelector(state.doc, state.selected, actions.select));
    const newList = el("button", { type: "button", class: "icon-button", title: "New list", "aria-label": "New list" }, plusIcon());
    newList.addEventListener("click", actions.newList);
    left.append(newList);
    const markdown = el(
      "button",
      { type: "button", class: "icon-button", title: "Export as Markdown", "aria-label": "Export as Markdown", "aria-pressed": String(actions.markdown.open) },
      markdownIcon(),
    );
    markdown.addEventListener("click", actions.markdown.toggle);
    left.append(markdown);
  }
  root.replaceChildren(left);
}
