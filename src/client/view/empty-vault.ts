// The page of a Vault that holds no Kryss file yet (PRD 5.16): it explains how to get one and lets `go` create the first.
import type { FilePickerEnv } from "./file-picker";
import { createFilePicker } from "./file-picker";
import { el } from "./dom";

export function mountEmptyVault(roots: { header: HTMLElement; main: HTMLElement }, env: Pick<FilePickerEnv, "list" | "create" | "open">): void {
  const picker = createFilePicker({ ...env, current: () => null, closed: () => {} });
  const button = el("button", { type: "button", class: "empty-vault-button" }, "New file…");
  button.addEventListener("click", () => void picker.open());
  roots.header.replaceChildren(picker.el);
  roots.main.replaceChildren(
    el(
      "div",
      { class: "no-match" },
      el("p", {}, "This Vault has no Kryss file yet."),
      el("p", { class: "no-match-filter" }, "Add kryss-enabled: true to the frontmatter of a note, or create a file here."),
      button,
    ),
  );
  let pendingG = false;
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    if (pendingG && e.key === "o") void picker.open();
    pendingG = e.key === "g";
  });
}
