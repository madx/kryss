// The note index of a Vault (PRD 5.17): names, paths and aliases, plus the Obsidian settings that shape the links.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { byName, listMarkdown, readFrontmatter } from "./vault";

export type NewLinkFormat = "shortest" | "relative" | "absolute";
export type ObsidianSettings = { newLinkFormat: NewLinkFormat; userIgnoreFilters: string[] };
export type Note = { name: string; path: string; aliases: string[]; modified: number };
export type NoteIndex = { newLinkFormat: NewLinkFormat; notes: Note[] };

/** `newLinkFormat` and `userIgnoreFilters` of `.obsidian/app.json`. A missing, unreadable or malformed file, or a wrong type, means the defaults. */
export async function readObsidianSettings(vaultDir: string): Promise<ObsidianSettings> {
  const settings: ObsidianSettings = { newLinkFormat: "shortest", userIgnoreFilters: [] };
  try {
    const json: unknown = JSON.parse(await readFile(join(vaultDir, ".obsidian", "app.json"), "utf8"));
    if (typeof json !== "object" || json === null || Array.isArray(json)) return settings;
    const { newLinkFormat, userIgnoreFilters } = json as Record<string, unknown>;
    if (newLinkFormat === "shortest" || newLinkFormat === "relative" || newLinkFormat === "absolute") settings.newLinkFormat = newLinkFormat;
    if (Array.isArray(userIgnoreFilters)) settings.userIgnoreFilters = userIgnoreFilters.filter((f): f is string => typeof f === "string");
  } catch {}
  return settings;
}

const unquote = (v: string) => {
  const t = v.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.endsWith(t[0]!) ? t.slice(1, -1) : t;
};

/** Splits the inside of an inline array on the commas that are not in quotes. */
function splitInline(inner: string): string[] {
  const parts: string[] = [];
  let quote = "";
  let current = "";
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

/** The `aliases` key of a frontmatter block: a YAML list, an inline array or a single string. */
export function parseAliases(frontmatter: string): string[] {
  const lines = frontmatter.split("\n").map((l) => l.replace(/\r$/, ""));
  const at = lines.findIndex((l, i) => i > 0 && /^aliases:/.test(l));
  if (at < 0) return [];
  const value = lines[at]!.slice("aliases:".length).trim();
  let aliases: string[];
  if (value.startsWith("[")) {
    aliases = value.endsWith("]") ? splitInline(value.slice(1, -1)).map(unquote) : [];
  } else if (value !== "") {
    aliases = [unquote(value)];
  } else {
    aliases = [];
    for (let i = at + 1; i < lines.length; i++) {
      const item = /^[ \t]*-[ \t]+(.*)$/.exec(lines[i]!);
      if (!item) break;
      aliases.push(unquote(item[1]!));
    }
  }
  return aliases.filter((a) => a !== "");
}

const isIgnored = (path: string, filters: string[]) =>
  filters.some((f) => {
    const folder = f.replace(/\/+$/, "");
    return folder !== "" && (path === folder || path.startsWith(folder + "/"));
  });

/** The note index: every Markdown file outside the dot folders and the ignored folders, sorted by path. Nothing is kept between calls. */
export async function scanNotes(vaultDir: string): Promise<NoteIndex> {
  const [files, settings] = await Promise.all([listMarkdown(vaultDir), readObsidianSettings(vaultDir)]);
  const kept = files.filter((f) => !isIgnored(f, settings.userIgnoreFilters)).sort(byName);
  const notes = await Promise.all(
    kept.map(async (file) => {
      const path = file.slice(0, -3);
      const full = join(vaultDir, file);
      const modified = await stat(full).then((st) => Math.round(st.mtimeMs), () => 0);
      return { name: path.slice(path.lastIndexOf("/") + 1), path, aliases: parseAliases(await readFrontmatter(full)), modified };
    }),
  );
  return { newLinkFormat: settings.newLinkFormat, notes };
}
