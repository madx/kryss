// Header: list selector (All or one list) on the left, Markdown view toggle on the right.
import type { StoreState } from "../store";
import { el } from "./dom";
import { markdownIcon } from "./icons";
import { renderSelector } from "./selector";

export type HeaderActions = { select(index: number | null): void; markdown: { open: boolean; toggle(): void } };

export function renderHeader(root: HTMLElement, state: StoreState, actions: HeaderActions): void {
  const left = el("div", { class: "header-left" });
  if (state.doc) {
    left.append(renderSelector(state.doc, state.selected, actions.select));
    const markdown = el(
      "button",
      { type: "button", class: "icon-button header-markdown", title: "Export as Markdown", "aria-label": "Export as Markdown", "aria-pressed": String(actions.markdown.open) },
      markdownIcon(),
    );
    markdown.addEventListener("click", actions.markdown.toggle);
    left.append(markdown);
  }
  root.replaceChildren(left);
}
