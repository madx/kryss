// Footer: mode badge (NORMAL / INSERT), the done / total counts of the current view and the sync status symbol.
import { el } from "./dom";

import type { Counts } from "../logic/stats";
export type FooterState = { mode: "normal" | "insert"; view: Counts };

export function createFooter(): { el: HTMLElement; update(s: FooterState): void } {
  const badge = el("span", { class: "mode-badge" });
  const status = el("span", { class: "statusline", role: "status" });
  const sync = el("span", { id: "sync-status", class: "sync-status", role: "status" });
  const content = el("div", { class: "footer-content" }, status, sync);
  const root = el("footer", { class: "app-footer" }, badge, content);
  return {
    el: root,
    update(s) {
      badge.textContent = s.mode === "insert" ? "INSERT" : "NORMAL";
      badge.dataset.mode = s.mode;
      status.textContent = `${s.view.done}/${s.view.total}`;
    },
  };
}
