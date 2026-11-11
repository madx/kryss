// Header: the filter bar on the left (PRD 5.14), the siblings and Markdown view toggles on the right.
import type { FilterBar } from "../editor/filter-bar";
import { el } from "./dom";
import { markdownIcon, siblingsIcon } from "./icons";

/** Built once: the filter bar is a live editor, so the header is never rebuilt by a render. */
export function createHeader(root: HTMLElement, bar: FilterBar, toggleMarkdown: () => void, toggleSiblings: () => void) {
  const siblings = el(
    "button",
    {
      type: "button",
      class: "icon-button header-siblings",
      title: "Show all subtasks of a match (gh)",
      "aria-label": "Show all subtasks of a match",
      "aria-pressed": "false",
    },
    siblingsIcon(),
  );
  siblings.addEventListener("click", toggleSiblings);
  const markdown = el(
    "button",
    { type: "button", class: "icon-button header-markdown", title: "Export as Markdown", "aria-label": "Export as Markdown", "aria-pressed": "false" },
    markdownIcon(),
  );
  markdown.addEventListener("click", toggleMarkdown);
  root.replaceChildren(bar.el, siblings, markdown);
  return {
    setSiblings: (on: boolean) => siblings.setAttribute("aria-pressed", String(on)),
    setMarkdownOpen: (open: boolean) => markdown.setAttribute("aria-pressed", String(open)),
  };
}
