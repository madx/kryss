// The Markdown view of PRD 5.11: a read-only block showing the export of the current view, and a copy button.
import type { ExportResult } from "../api";
import { renderAlert } from "./alert";
import { renderInvalid } from "./banners";
import { el } from "./dom";
import { copyIcon } from "./icons";

const POPOVER_MS = 1000;

export function createMarkdownView() {
  const copyButton = el("button", { type: "button", class: "icon-button copy-button", title: "Copy as Markdown", "aria-label": "Copy as Markdown", disabled: true }, copyIcon());
  const body = el("div", { class: "markdown-body" });
  const popover = el("span", { class: "copied-popover", role: "status", hidden: true }, "Copied");
  const root = el("div", { class: "markdown-view" }, body, copyButton, popover);

  let shown: ExportResult | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const text = () => (shown?.kind === "ok" && shown.text !== "" ? shown.text : null);

  function hidePopover() {
    clearTimeout(hideTimer);
    popover.hidden = true;
    document.removeEventListener("click", hidePopover);
  }

  function copy() {
    const content = text();
    if (content === null) return;
    navigator.clipboard.writeText(content).then(
      () => {
        hidePopover();
        popover.hidden = false;
        hideTimer = setTimeout(hidePopover, POPOVER_MS);
        document.addEventListener("click", hidePopover);
      },
      () => {}, // clipboard refused: nothing to announce
    );
  }
  copyButton.addEventListener("click", copy);

  return {
    el: root,
    copy,
    /** Shows a result. The same text again leaves the DOM alone, so that a text selection survives a silent refresh. */
    show(result: ExportResult | null) {
      if (result && shown && result.kind === "ok" && shown.kind === "ok" && result.text === shown.text) return;
      shown = result;
      if (!result) body.replaceChildren();
      else if (result.kind === "invalid") body.replaceChildren(renderInvalid(result.error, false));
      else if (result.kind === "offline") body.replaceChildren(renderAlert("warning", ["Cannot reach the server."]));
      else if (result.text === "") body.replaceChildren(el("p", { class: "markdown-empty" }, "Nothing to export"));
      else body.replaceChildren(el("pre", { class: "markdown-block" }, result.text));
      copyButton.disabled = text() === null;
      if (text() === null) hidePopover();
    },
  };
}

export type MarkdownView = ReturnType<typeof createMarkdownView>;
