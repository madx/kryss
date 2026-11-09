import type { ParseError, Subtask, Task, TodoDocument, TodoList } from "../shared/types";

export type ParseResult = { ok: true; doc: TodoDocument } | { ok: false; error: ParseError };

const TASK = /^([-*]) \[([ xX])\](?:\s+(.*))?$/;

export function parse(md: string): ParseResult {
  const lines = (md.startsWith("\uFEFF") ? md.slice(1) : md).split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const lists: TodoList[] = [];
  let list: TodoList | undefined;
  let parent: Task | undefined;
  let previousWasTask = false;
  // Indentation unit, fixed by the first indented task of the file: "\t", "  " or "    ".
  let unit: string | undefined;

  const fail = (line: number, reason: string): ParseResult => ({ ok: false, error: { line, reason } });

  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    if (n === 1 && raw.trimEnd() === "---") return fail(n, "Frontmatter is not supported");

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

export function serialize(doc: TodoDocument): string {
  const box = (done: boolean) => (done ? "[x]" : "[ ]");
  return doc.lists
    .map((list) => {
      const out = [`## ${list.title}`];
      for (const task of list.tasks) {
        out.push(`- ${box(task.done)} ${task.text}`);
        for (const child of task.children ?? []) out.push(`  - ${box(child.done)} ${child.text}`);
      }
      return out.join("\n") + "\n";
    })
    .join("\n");
}
