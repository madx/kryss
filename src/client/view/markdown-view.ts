// The Markdown view of PRD 5.11: a read-only block showing the export of the current view, and a copy button.
import { el } from "./dom";
import { copyIcon } from "./icons";

/** What the view shows: the Markdown of the page's document, or the notice of the task UI when the page holds no document. */
export type MarkdownContent = { kind: "ok"; text: string } | { kind: "notice"; node: Node };

/** `onCopy` receives the text to copy, and the app writes it to the clipboard and shows the footer feedback (PRD 5.12). */
export function createMarkdownView(onCopy: (text: string) => void) {
  const copyButton = el("button", { type: "button", class: "icon-button copy-button", title: "Copy as Markdown", "aria-label": "Copy as Markdown", disabled: true }, copyIcon());
  const body = el("div", { class: "markdown-body" });
  const root = el("div", { class: "markdown-view" }, body, copyButton);

  let shown: MarkdownContent | null = null;

  const text = () => (shown?.kind === "ok" && shown.text !== "" ? shown.text : null);

  function copy() {
    const content = text();
    if (content !== null) onCopy(content);
  }
  copyButton.addEventListener("click", copy);

  return {
    el: root,
    copy,
    /** Shows a content. The same text again leaves the DOM alone, so that a text selection survives a rebuild. */
    show(result: MarkdownContent) {
      if (shown && result.kind === "ok" && shown.kind === "ok" && result.text === shown.text) return;
      shown = result;
      if (result.kind === "notice") body.replaceChildren(result.node);
      else if (result.text === "") body.replaceChildren(el("p", { class: "markdown-empty" }, "Nothing to export"));
      else body.replaceChildren(el("pre", { class: "markdown-block" }, result.text));
      copyButton.disabled = text() === null;
    },
  };
}

export type MarkdownView = ReturnType<typeof createMarkdownView>;
