// Sync badge, banners and notices (invalid file, empty file).
import type { ParseError } from "../../shared/types";
import type { StoreState } from "../store";
import { STATUS_LABELS } from "../sync";
import { el } from "./dom";

export type BannerActions = { keepMine(): void; takeDisk(): void };

/** Updates the status badge in the header (it exists after `renderHeader`). */
export function renderStatus(state: StoreState): void {
  const badge = document.getElementById("sync-status");
  if (!badge) return;
  badge.textContent = STATUS_LABELS[state.status];
  badge.dataset.status = state.status;
}

export function renderBanners(root: HTMLElement, state: StoreState, actions: BannerActions): void {
  const banners: Node[] = [];
  if (state.status === "conflict") {
    const keep = el("button", { type: "button", class: "button" }, "Keep my version");
    keep.addEventListener("click", actions.keepMine);
    const take = el("button", { type: "button", class: "button" }, "Take the disk version");
    take.addEventListener("click", actions.takeDisk);
    banners.push(
      el(
        "div",
        { class: "banner banner-warning", role: "alert" },
        el("p", {}, "The file changed on disk while you had unsaved changes."),
        el("div", { class: "banner-actions" }, keep, take),
      ),
    );
  } else if (state.status === "offline" && state.doc) {
    banners.push(el("div", { class: "banner banner-warning", role: "alert" }, el("p", {}, "The server is unreachable. Your changes are not saved yet, saving is retried automatically.")));
  } else if (state.status === "error") {
    banners.push(el("div", { class: "banner banner-warning", role: "alert" }, el("p", {}, "The server refused the save (bad request). Your changes are kept in this page, the next edit tries again.")));
  }
  root.replaceChildren(...banners);
}

/** Shown in place of the lists when the file is invalid (or the server unreachable at start). */
export function renderInvalid(error: ParseError, hasLocalChanges: boolean): HTMLElement {
  return el(
    "div",
    { class: "notice notice-error", role: "alert" },
    el("h2", {}, "The todo file is invalid"),
    el("p", {}, `Line ${error.line}: ${error.reason}`),
    el("p", { class: "muted" }, hasLocalChanges ? "Nothing is written to the file. Your unsaved changes are kept in this page until the file is fixed." : "Nothing is written to the file. Fix it in your editor, this page updates by itself."),
  );
}

export function renderUnreachable(): HTMLElement {
  return el("div", { class: "notice" }, el("h2", {}, "Cannot reach the server"), el("p", { class: "muted" }, "Retrying automatically."));
}

export function renderEmptyState(onCreate: () => void): HTMLElement {
  const button = el("button", { type: "button", class: "button button-primary" }, "Create your first list");
  button.addEventListener("click", onCreate);
  return el("div", { class: "notice" }, el("h2", {}, "No lists yet"), button);
}
