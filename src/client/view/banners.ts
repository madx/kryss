// Sync status symbol, banners and notices (invalid file, empty file).
import type { ParseError } from "../../shared/types";
import type { StoreState } from "../store";
import { STATUS_LABELS } from "../sync";
import { renderAlert } from "./alert";
import { el } from "./dom";
import { statusIcon } from "./icons";

export type BannerActions = { keepMine(): void; takeDisk(): void };

/** Updates the status symbol in the footer. */
export function renderStatus(state: StoreState): void {
  const badge = document.getElementById("sync-status");
  if (!badge) return;
  badge.replaceChildren(statusIcon(state.status));
  badge.title = STATUS_LABELS[state.status];
  badge.setAttribute("aria-label", STATUS_LABELS[state.status]);
  badge.dataset.status = state.status;
}

export function renderBanners(root: HTMLElement, state: StoreState, actions: BannerActions): void {
  const banners: Node[] = [];
  if (state.status === "conflict") {
    banners.push(
      renderAlert(
        "warning",
        ["The file changed on disk while you had unsaved changes."],
        [
          { label: "Keep my version", onClick: actions.keepMine },
          { label: "Take the disk version", onClick: actions.takeDisk },
        ],
      ),
    );
  } else if (state.status === "offline" && state.doc) {
    banners.push(renderAlert("warning", ["The server is unreachable. Your changes are not saved yet, saving is retried automatically."]));
  } else if (state.status === "error") {
    banners.push(renderAlert("error", ["The server refused the save (bad request). Your changes are kept in this page, the next edit tries again."]));
  }
  root.replaceChildren(...banners);
}

/** Shown in place of the lists when the file is invalid (or the server unreachable at start). */
export function renderInvalid(error: ParseError, hasLocalChanges: boolean): HTMLElement {
  const note = hasLocalChanges ? "Nothing is written to the file. Your unsaved changes are kept in this page until the file is fixed." : "Nothing is written to the file. Fix it in your editor, this page updates by itself.";
  return renderAlert("error", [el("strong", {}, "The todo file is invalid. "), `Line ${error.line}: ${error.reason}. ${note}`]);
}

export function renderUnreachable(): HTMLElement {
  return renderAlert("warning", [el("strong", {}, "Cannot reach the server. "), "Retrying automatically."]);
}

export function renderEmptyState(onCreate: () => void): HTMLElement {
  return renderAlert("warning", [el("strong", {}, "No lists yet.")], [{ label: "Create your first list", onClick: onCreate }]);
}

/** Shown in place of the lists when a filter matches nothing, or when it has a bad value (PRD 5.14). */
export function renderNoMatch(filter: string, error: string | null): HTMLElement {
  return el("div", { class: "no-match muted", role: "status" }, el("p", {}, error ?? "No matching task"), el("p", { class: "no-match-filter" }, filter));
}
