// Pure logic of the Vault files (PRD 5.16): which file opens, the storage keys, the picker entries and the switch rule.
import type { SyncStatus } from "../sync";

export const LAST_FILE_KEY = "kryss.lastFile";

/** The file to open: the one of the URL, else the last used, else the first, each only when it is listed. Null when nothing is listed. */
export function chooseFile(urlFile: string | null, last: string | null, files: string[]): string | null {
  for (const candidate of [urlFile, last]) if (candidate !== null && files.includes(candidate)) return candidate;
  return files[0] ?? null;
}

/** The name shown in the header: no folder and no extension. */
export function fileLabel(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

/** The query string that opens `path`. */
export const fileHref = (path: string): string => `?${new URLSearchParams({ file: path })}`;

/** A `localStorage` key kept per file: the base key alone in single-file mode. */
export const fileStorageKey = (base: string, file: string | null): string => (file === null ? base : `${base}:${file}`);

export type FileEntry = { kind: "new" } | { kind: "file"; path: string };

/** "New file…" first, then the files in the order of the server. */
export const fileEntries = (files: string[]): FileEntry[] => [{ kind: "new" }, ...files.map((path): FileEntry => ({ kind: "file", path }))];

/** Why a switch of file is refused, or null: a save that fails or is in conflict would be lost by the navigation. */
export function switchRefusal(status: SyncStatus): string | null {
  switch (status) {
    case "conflict": return "Resolve the conflict before switching file";
    case "invalid": return "Fix the invalid file before switching file";
    case "offline":
    case "error": return "Changes are not saved yet, so the file cannot be switched";
    default: return null;
  }
}
