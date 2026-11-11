// Footer: mode badge (NORMAL / INSERT / FILTER / SEARCH), the done / total counts of the current view and the sync status symbol.
import { el } from "./dom";

import type { Counts } from "../logic/stats";
export type FooterState = { mode: "normal" | "insert" | "filter" | "search"; view: Counts };

const FEEDBACK_MS = 2000;

export function createFooter(): { el: HTMLElement; update(s: FooterState): void; setSearch(text: string): void; flash(text: string, failed: boolean): void } {
  const badge = el("span", { class: "mode-badge" });
  const status = el("span", { class: "statusline", role: "status" });
  const search = el("span", { class: "search-status", role: "status" });
  const feedback = el("span", { class: "copy-feedback", role: "status" });
  const sync = el("span", { id: "sync-status", class: "sync-status", role: "status" });
  const content = el("div", { class: "footer-content" }, status, search, feedback, sync);
  const root = el("footer", { class: "app-footer" }, badge, content);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    el: root,
    update(s) {
      badge.textContent = s.mode.toUpperCase();
      badge.dataset.mode = s.mode;
      status.textContent = `${s.view.done}/${s.view.total}`;
    },
    /** The search query and counter, `/query  3/12`, or nothing when no search is active (PRD 5.15). */
    setSearch(text) {
      search.textContent = text;
    },
    /** Shows a short text after the counts for 2 seconds. A new one restarts the timer. */
    flash(text, failed) {
      clearTimeout(timer);
      feedback.textContent = text;
      feedback.dataset.failed = String(failed);
      timer = setTimeout(() => (feedback.textContent = ""), FEEDBACK_MS);
    },
  };
}
