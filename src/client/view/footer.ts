// Footer: mode badge (NORMAL / INSERT) and a short statusline.
import { el } from "./dom";

import type { Counts } from "../logic/stats";
export type FooterState = { mode: "normal" | "insert"; view: Counts; document: Counts; list: number; lists: number };

export function createFooter(): { el: HTMLElement; update(s: FooterState): void } {
  const badge = el("span", { class: "mode-badge" });
  const status = el("span", { class: "statusline", role: "status" });
  const root = el("footer", { class: "app-footer" }, badge, status);
  return {
    el: root,
    update(s) {
      badge.textContent = s.mode === "insert" ? "INSERT" : "NORMAL";
      badge.dataset.mode = s.mode;
      status.textContent =
        `view ${s.view.done}/${s.view.total} · doc ${s.document.done}/${s.document.total} · list ${s.list}/${s.lists}`;
    },
  };
}
