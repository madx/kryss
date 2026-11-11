// Header: the filter bar on the left (PRD 5.14), the Markdown view toggle on the right.
import type { FilterBar } from "../editor/filter-bar";
import { el } from "./dom";
import { markdownIcon } from "./icons";

/** Built once: the filter bar is a live editor, so the header is never rebuilt by a render. */
export function createHeader(root: HTMLElement, bar: FilterBar, toggleMarkdown: () => void) {
  const markdown = el(
    "button",
    { type: "button", class: "icon-button header-markdown", title: "Export as Markdown", "aria-label": "Export as Markdown", "aria-pressed": "false" },
    markdownIcon(),
  );
  markdown.addEventListener("click", toggleMarkdown);
  root.replaceChildren(bar.el, markdown);
  return {
    setMarkdownOpen: (open: boolean) => markdown.setAttribute("aria-pressed", String(open)),
  };
}
