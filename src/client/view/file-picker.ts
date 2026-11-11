// The file picker of a Vault (PRD 5.16): the same look and keys as the saved filter picker, with "New file…" as its first entry.
import type { CreateFileResult } from "../api";
import { fileEntries, fileLabel, type FileEntry } from "../logic/files";
import { pickerKey } from "../logic/saved-filters";
import { el } from "./dom";

export type FilePickerEnv = {
  /** The Kryss files of the Vault, or null when the list cannot be fetched. */
  list(): Promise<string[] | null>;
  create(name: string): Promise<CreateFileResult>;
  /** The file that is open, highlighted when the picker opens. */
  current(): string | null;
  /** Opens a file: the app saves the pending changes first and may refuse. */
  open(path: string): void;
  /** The picker closed without opening anything: the app puts the cursor back. */
  closed(): void;
};

export function createFilePicker(env: FilePickerEnv) {
  const menu = el("div", { class: "picker-menu", role: "listbox", tabindex: "0", "aria-label": "Files" });
  menu.hidden = true;
  const root = el("div", { class: "filter-picker file-picker" }, menu);
  let files: string[] = [];
  let entries: FileEntry[] = [];
  let active = 0;
  let naming = false;
  let busy = false;

  function render() {
    entries = fileEntries(files);
    menu.replaceChildren();
    entries.forEach((entry, i) => {
      const item = el("div", { class: "picker-item", role: "option", "aria-selected": String(i === active), "data-kind": entry.kind });
      if (entry.kind === "new") item.append(el("span", { class: "picker-item-label" }, "New file…"));
      else {
        item.append(el("span", { class: "picker-item-label" }, fileLabel(entry.path)));
        item.append(el("span", { class: "picker-item-text" }, entry.path));
        if (entry.path === env.current()) item.setAttribute("aria-current", "true");
      }
      if (i === active) item.setAttribute("data-active", "");
      item.addEventListener("click", () => pick(i));
      item.addEventListener("pointermove", () => highlight(i));
      menu.append(item);
    });
  }

  function highlight(i: number) {
    active = i;
    menu.querySelectorAll(".picker-item").forEach((item, n) => {
      item.toggleAttribute("data-active", n === i);
      item.setAttribute("aria-selected", String(n === i));
    });
  }

  function startNaming() {
    naming = true;
    const input = el("input", { type: "text", class: "picker-name", "aria-label": "File name", placeholder: "Name of the file" });
    const error = el("div", { class: "picker-error", role: "alert" });
    input.addEventListener("keydown", async (e) => {
      e.stopPropagation(); // the menu handler must not see this key
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Enter" && !busy) {
        e.preventDefault();
        busy = true;
        const result = await env.create(input.value);
        busy = false;
        if (result.kind === "ok") return env.open(result.path);
        error.textContent = result.kind === "refused" ? result.error : "The server cannot be reached";
        input.focus(); // the typed name stays
      }
    });
    menu.replaceChildren(input, error);
    input.focus();
  }

  function pick(i: number) {
    const entry = entries[i];
    if (!entry) return;
    if (entry.kind === "new") return startNaming();
    close(false);
    env.open(entry.path);
  }

  const onOutside = (e: Event) => {
    if (!root.contains(e.target as Node)) close();
  };

  /** Fetches the list each time, so that a file marked in Obsidian appears at once. */
  async function open() {
    if (!menu.hidden) return;
    menu.hidden = false;
    naming = false;
    files = (await env.list()) ?? [];
    active = Math.max(files.indexOf(env.current() ?? ""), -1) + 1; // the open file, else "New file…"
    render();
    menu.focus();
    document.addEventListener("pointerdown", onOutside);
  }

  function close(notify = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    naming = false;
    document.removeEventListener("pointerdown", onOutside);
    if (notify) env.closed();
  }

  menu.addEventListener("keydown", (e) => {
    if (naming || menu.hidden) return;
    const result = pickerKey(active, entries.length, e.key, false);
    if (!result) return;
    e.preventDefault();
    if (result.highlight !== undefined) highlight(result.highlight);
    if (result.pick !== undefined) pick(result.pick);
    if (result.close) close();
  });
  root.addEventListener("focusout", (e) => {
    if (!menu.hidden && !root.contains(e.relatedTarget as Node | null)) close();
  });

  return { el: root, open, close: () => close(), isOpen: () => !menu.hidden };
}

export type FilePicker = ReturnType<typeof createFilePicker>;
