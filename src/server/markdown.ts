import type { ParseError, SavedFilter, Subtask, Task, TodoDocument, TodoList } from "../shared/types";

export type ParseResult = { ok: true; doc: TodoDocument } | { ok: false; error: ParseError };

const TASK = /^([-*]) \[([ xX])\](?:\s+(.*))?$/;

// A leading `---` block closed by `---` or `...`, plus the blank lines that follow it.
const FRONTMATTER = /^---[ \t]*\r?\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/;

const withoutBom = (md: string) => (md.startsWith("\uFEFF") ? md.slice(1) : md);

/** The exact text of the leading frontmatter block (and the blank lines after it), or "" when there is none. */
export function frontmatterOf(md: string): string {
  return FRONTMATTER.exec(withoutBom(md))?.[0] ?? "";
}

type Block = { start: number; end: number };

const FILTER_LINE = /^[ \t]+("(?:[^"\\]|\\.)*")[ \t]*:[ \t]*("(?:[^"\\]|\\.)*")[ \t]*$/;
const stripEol = (line: string) => line.replace(/\r?\n$/, "");

/** The lines of a frontmatter with their line endings, and the index of its closing delimiter. */
function frontmatterLines(frontmatter: string) {
  const lines = frontmatter.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const closing = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)[ \t]*$/.test(stripEol(l)));
  return { lines, closing };
}

/** The `kryss-filters` key of a frontmatter: its line and the end (exclusive) of its indented block. */
function filtersBlocks(lines: string[], closing: number): Block[] {
  const blocks: Block[] = [];
  for (let i = 1; i < closing; i++) {
    if (!lines[i]!.startsWith("kryss-filters:")) continue;
    let end = i + 1;
    while (end < closing && /^[ \t]/.test(lines[end]!)) end++;
    blocks.push({ start: i, end });
    i = end - 1;
  }
  return blocks;
}

/** Reads the saved filters of a frontmatter. Lines of an error are 1-based and relative to the whole file. */
function readFilters(frontmatter: string): { filters: SavedFilter[] } | { error: ParseError } {
  const { lines, closing } = frontmatterLines(frontmatter);
  const blocks = closing < 0 ? [] : filtersBlocks(lines, closing);
  if (blocks.length === 0) return { filters: [] };
  if (blocks.length > 1) return { error: { line: blocks[1]!.start + 1, reason: 'The frontmatter has a second "kryss-filters" key' } };
  const { start, end } = blocks[0]!;
  if (stripEol(lines[start]!).trimEnd() !== "kryss-filters:") {
    return { error: { line: start + 1, reason: 'The "kryss-filters" key must be alone on its line' } };
  }
  const filters: SavedFilter[] = [];
  for (let i = start + 1; i < end; i++) {
    const n = i + 1;
    const match = FILTER_LINE.exec(stripEol(lines[i]!));
    let name = "";
    let text = "";
    try {
      if (!match) throw new Error();
      name = JSON.parse(match[1]!);
      text = JSON.parse(match[2]!);
    } catch {
      return { error: { line: n, reason: 'A saved filter must be written as "name": "text"' } };
    }
    if (name.trim() === "" || text.trim() === "") return { error: { line: n, reason: "The name and the text of a saved filter must not be empty" } };
    if (/[\r\n]/.test(name + text)) return { error: { line: n, reason: "A saved filter must be on one line" } };
    if (filters.some((f) => f.name === name)) return { error: { line: n, reason: `Duplicate saved filter name "${name}"` } };
    filters.push({ name, text });
  }
  return { filters };
}

/** The frontmatter with its `kryss-filters` block set to `filters`, the other lines untouched. */
function rewriteFilters(frontmatter: string, filters: SavedFilter[]): string {
  const { lines, closing } = frontmatterLines(frontmatter);
  const eol = (lines[0] ?? "").endsWith("\r\n") ? "\r\n" : "\n";
  const block = filters.length === 0 ? [] : ["kryss-filters:", ...filters.map((f) => `  ${JSON.stringify(f.name)}: ${JSON.stringify(f.text)}`)].map((l) => l + eol);
  if (frontmatter === "") return block.length === 0 ? "" : ["---", ...block.map(stripEol), "---", ""].join(eol) + eol;

  const found = filtersBlocks(lines, closing)[0];
  const next = found
    ? [...lines.slice(0, found.start), ...block, ...lines.slice(found.end)]
    : [...lines.slice(0, closing), ...block, ...lines.slice(closing)];
  // A frontmatter left with nothing else in it is removed.
  if (filters.length === 0 && next.slice(1, next.length - (lines.length - closing)).every((l) => l.trim() === "")) return "";
  return next.join("");
}

/**
 * Puts the frontmatter of the current file in front of freshly serialized Markdown.
 * It is kept byte for byte, except for its `kryss-filters` block, which is rewritten only when `filters` differs from it.
 */
export function withFrontmatter(current: string, markdown: string, filters: SavedFilter[]): string {
  let frontmatter = frontmatterOf(current);
  const existing = readFilters(frontmatter);
  if (JSON.stringify("filters" in existing ? existing.filters : []) !== JSON.stringify(filters)) {
    frontmatter = rewriteFilters(frontmatter, filters);
  }
  if (frontmatter === "" || markdown === "") return frontmatter + markdown;
  return (frontmatter.endsWith("\n") ? frontmatter : frontmatter + "\n") + markdown;
}

export function parse(md: string): ParseResult {
  const text = withoutBom(md);
  const frontmatter = frontmatterOf(text);
  // Lines of the frontmatter are skipped, but errors still report line numbers of the whole file.
  const offset = frontmatter.split("\n").length - 1;
  const lines = text.slice(frontmatter.length).split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const lists: TodoList[] = [];
  let list: TodoList | undefined;
  let parent: Task | undefined;
  let previousWasTask = false;
  // Indentation unit, fixed by the first indented task of the file: "\t", "  " or "    ".
  let unit: string | undefined;

  const fail = (line: number, reason: string): ParseResult => ({ ok: false, error: { line: line + offset, reason } });

  if (frontmatter === "" && text.split("\n", 1)[0]!.trimEnd() === "---") return fail(1, "The frontmatter is not closed");
  const saved = readFilters(frontmatter);
  if ("error" in saved) return { ok: false, error: saved.error };

  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const raw = lines[i]!;
    if (raw.trim() === "") continue;

    const indent = /^[ \t]*/.exec(raw)![0];
    const content = raw.slice(indent.length);

    if (indent === "" && /^#+(\s|$)/.test(content)) {
      const hashes = /^#+/.exec(content)![0].length;
      if (hashes !== 2) return fail(n, `Only "##" headings are allowed, found a level ${hashes} heading`);
      const title = content.slice(2).trim();
      if (title === "") return fail(n, "The list name is empty");
      list = { title, tasks: [] };
      lists.push(list);
      parent = undefined;
      previousWasTask = false;
      continue;
    }

    const match = TASK.exec(content);
    if (!match) {
      if (indent !== "" && previousWasTask) return fail(n, "Multi-line tasks are not supported");
      return fail(n, list ? "Free text is not allowed" : "Text before the first list");
    }
    if (!list) return fail(n, "Task before the first list");

    const done = match[2] !== " ";
    const text = (match[3] ?? "").trim();
    if (text === "") return fail(n, "The task text is empty");

    let level = 0;
    if (indent !== "") {
      if (unit === undefined) {
        if (indent !== "\t" && indent !== "  " && indent !== "    ") return fail(n, "Inconsistent indentation");
        unit = indent;
      }
      const unitCount = indent.length / unit.length;
      if (!Number.isInteger(unitCount) || indent !== unit.repeat(unitCount)) return fail(n, "Inconsistent indentation");
      level = unitCount;
    }
    if (level >= 2) return fail(n, "Tasks can be nested two levels deep at most");

    if (level === 0) {
      parent = { text, done };
      list.tasks.push(parent);
    } else {
      if (!parent) return fail(n, "Subtask without a parent task");
      const child: Subtask = { text, done };
      (parent.children ??= []).push(child);
    }
    previousWasTask = true;
  }
  return { ok: true, doc: { lists, filters: saved.filters } };
}
