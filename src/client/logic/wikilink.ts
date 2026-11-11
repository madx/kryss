// Pure logic of the wikilinks (PRD 5.17): parsing `[[target|alias]]`, the `obsidian://` URL, the note index filter and the inserted text.

export type Note = { name: string; path: string; aliases: string[] };
export type NewLinkFormat = "shortest" | "relative" | "absolute";
/** One line of the popup: a note, the alias that matched (null when the name did), and its folder when another note has the same name. */
export type Suggestion = { note: Note; alias: string | null; folder: string };

export type Wikilink = { end: number; target: string; label: string };

// A target is non-empty and holds no `[`, `]` or `|`, the alias holds no `[` or `]`.
const WIKILINK = /^\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/;

/** The wikilink that starts at `i` in `s` (`end` is just after `]]`), or null when it is not a valid one. */
export function parseWikilink(s: string, i: number): Wikilink | null {
  const m = WIKILINK.exec(s.slice(i));
  const target = m?.[1]!.trim();
  if (!m || !target) return null;
  const alias = m[2]?.trim();
  const shown = target.split("#").filter((part) => part !== "").join(" > ");
  return { end: i + m[0].length, target, label: alias || shown || target };
}

/** The Obsidian URL of a target. Both the vault and the target are URL-encoded. */
export function wikilinkUrl(vault: string, target: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(target)}`;
}

const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 0));

/** The suggestions for what was typed after `[[`: names then aliases that contain it, ignoring case, the prefix matches first. */
export function filterNotes(notes: Note[], query: string): Suggestion[] {
  const q = query.toLowerCase();
  const count = new Map<string, number>();
  for (const n of notes) count.set(n.name.toLowerCase(), (count.get(n.name.toLowerCase()) ?? 0) + 1);
  const hits: { suggestion: Suggestion; key: string }[] = [];
  for (const note of notes) {
    const folder = count.get(note.name.toLowerCase())! > 1 ? dirOf(note.path) : "";
    if (note.name.toLowerCase().includes(q)) hits.push({ suggestion: { note, alias: null, folder }, key: note.name });
    if (q !== "") for (const alias of note.aliases) if (alias.toLowerCase().includes(q)) hits.push({ suggestion: { note, alias, folder }, key: alias });
  }
  const rank = (h: { key: string }) => (h.key.toLowerCase().startsWith(q) ? 0 : 1);
  hits.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.key.toLowerCase().localeCompare(b.key.toLowerCase()) ||
      (a.suggestion.note.path < b.suggestion.note.path ? -1 : a.suggestion.note.path > b.suggestion.note.path ? 1 : 0),
  );
  return hits.map((h) => h.suggestion);
}

/** The shortest tail of the path (the name, then `Folder/Name`, ...) that no other note of the index ends with. */
function shortestPath(note: Note, notes: Note[]): string {
  const segments = note.path.split("/");
  const others = notes.filter((n) => n !== note).map((n) => "/" + n.path.toLowerCase());
  for (let k = 1; k < segments.length; k++) {
    const tail = "/" + segments.slice(-k).join("/").toLowerCase();
    if (!others.some((o) => o.endsWith(tail))) return segments.slice(-k).join("/");
  }
  return note.path;
}

/** The path from the folder of the open file to the note. */
function relativePath(note: Note, file: string): string {
  const from = dirOf(file) === "" ? [] : dirOf(file).split("/");
  const to = note.path.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}

/** The text to insert for a suggestion: `[[target]]`, or `[[target|alias]]` when an alias matched. `file` is the open file, relative to the Vault. */
export function insertText(suggestion: Suggestion, notes: Note[], format: NewLinkFormat, file: string): string {
  const { note, alias } = suggestion;
  const target = format === "absolute" ? note.path : format === "relative" ? relativePath(note, file) : shortestPath(note, notes);
  return alias === null ? `[[${target}]]` : `[[${target}|${alias}]]`;
}
