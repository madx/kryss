import type { ParseError, Subtask, Task, TodoDocument, TodoList } from "../shared/types";

export type ParseResult = { ok: true; doc: TodoDocument } | { ok: false; error: ParseError };

const TASK = /^([-*]) \[([ xX])\](?:\s+(.*))?$/;

// A leading `---` block closed by `---` or `...`, plus the blank lines that follow it.
const FRONTMATTER = /^---[ \t]*\r?\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/;

const withoutBom = (md: string) => (md.startsWith("\uFEFF") ? md.slice(1) : md);

/** The exact text of the leading frontmatter block (and the blank lines after it), or "" when there is none. */
export function frontmatterOf(md: string): string {
  return FRONTMATTER.exec(withoutBom(md))?.[0] ?? "";
}

/** Puts the frontmatter of the current file, byte for byte, in front of freshly serialized Markdown. */
export function withFrontmatter(current: string, markdown: string): string {
  const frontmatter = frontmatterOf(current);
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
  return { ok: true, doc: { lists } };
}
