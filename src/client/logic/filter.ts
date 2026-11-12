// Pure filter logic (PRD 5.14): parsing the filter text, matching a task, the visible rows and the pinned rows.
// Today is always a parameter, never read here.
import type { Task, TodoDocument } from "../../shared/types";
import { findDueRange } from "../markdown/inline";
import type { Stop } from "./cursor";
import { dayPeriod, dueCompletions, duePeriod, resolveShortcut, weekPeriod, type Period } from "./due";
import { samePath, type PathMove, type TaskPath } from "./paths";

/** A due value as typed, lowercased for the words: `today`, `week`, `overdue`, a day, week or quarter, or a shortcut, with `<` or `>` in front except for `overdue`. */
export type DueValue = string;
export type Term =
  | { kind: "word"; text: string }
  | { kind: "list"; names: string[] }
  | { kind: "due"; values: DueValue[] }
  | { kind: "is"; values: ("done" | "todo")[] };
export type ParsedFilter = { terms: Term[]; error: string | null };

/** A task with the indices of the subtasks that are shown, and the number of its subtasks that are not. */
export type VisibleTask = { task: number; children: number[]; hidden: number };
export type VisibleList = { list: number; tasks: VisibleTask[] };
export type Visible = { lists: VisibleList[]; error: string | null; filtering: boolean };

const KEY = /^(list|due|is):/i;

/** One space-separated token: its comma-separated values, with quotes removed. Unclosed quotes run to the end. */
function tokenize(text: string): { values: string[]; quotedStart: boolean }[] {
  const tokens: { values: string[]; quotedStart: boolean }[] = [];
  let values: string[] | null = null;
  let current = "";
  let quoted = false;
  let quotedStart = false;
  const end = () => {
    if (values) tokens.push({ values: [...values, current], quotedStart });
    values = null;
    current = "";
  };
  for (const c of text) {
    if (!quoted && /\s/.test(c)) {
      end();
      continue;
    }
    if (!values) {
      values = [];
      quotedStart = c === '"';
    }
    if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) {
      values.push(current);
      current = "";
    } else current += c;
  }
  end();
  return tokens;
}

const OPERATOR = /^[<>]/;
/** Any day works to validate a shortcut, since only its shape matters. */
const ANY_DAY = "2000-01-03";

/** An operator with nothing after it is a value that is not typed yet. */
const isBareOperator = (value: string) => value === "<" || value === ">";

function dueValue(value: string): DueValue | null {
  const operator = OPERATOR.exec(value)?.[0] ?? "";
  const rest = value.slice(operator.length);
  const lower = rest.toLowerCase();
  if (lower === "today" || lower === "week" || (lower === "overdue" && !operator)) return operator + lower;
  return resolveShortcut(rest, ANY_DAY) ? value : null;
}

export function parseFilter(text: string): ParsedFilter {
  const terms: Term[] = [];
  let error: string | null = null;
  for (const { values, quotedStart } of tokenize(text)) {
    const head = values[0]!;
    const key = quotedStart ? null : KEY.exec(head)?.[1]!.toLowerCase();
    if (!key) {
      terms.push({ kind: "word", text: values.join(",") });
      continue;
    }
    const rest = [head.slice(key.length + 1), ...values.slice(1)].filter((v) => v !== "" && !isBareOperator(v));
    if (rest.length === 0) continue;
    if (key === "list") terms.push({ kind: "list", names: rest });
    else if (key === "due") {
      const parsed = rest.map((v) => ({ v, due: dueValue(v) }));
      const bad = parsed.find((p) => p.due === null);
      if (bad) error ??= `Unknown due value: ${bad.v}`;
      else terms.push({ kind: "due", values: parsed.map((p) => p.due!) });
    } else {
      const bad = rest.find((v) => !["done", "todo"].includes(v.toLowerCase()));
      if (bad) error ??= `Unknown is value: ${bad}`;
      else terms.push({ kind: "is", values: rest.map((v) => v.toLowerCase() as "done" | "todo") });
    }
  }
  return { terms, error };
}

/** Any non-blank text is a filter, even one whose terms are all ignored. */
export const isFiltering = (text: string): boolean => text.trim() !== "";

/** The period of a `today`, `week`, literal or shortcut word, resolved from `today`. */
function boundPeriod(word: string, today: string): Period {
  if (word === "today") return dayPeriod(today);
  if (word === "week") return weekPeriod(today);
  return duePeriod(resolveShortcut(word, today)!)!;
}

function matchesDue(value: DueValue, node: Pick<Task, "text" | "done">, today: string): boolean {
  const date = findDueRange(node.text)?.value;
  const period = date ? duePeriod(date) : null;
  if (!period) return false;
  if (value === "overdue") return !node.done && period.end < today;
  const operator = OPERATOR.exec(value)?.[0];
  const bound = boundPeriod(value.slice(operator?.length ?? 0), today);
  if (operator === "<") return period.end < bound.start;
  if (operator === ">") return period.start > bound.end;
  return period.start <= bound.end && bound.start <= period.end;
}

function matchesTerm(term: Term, node: Pick<Task, "text" | "done">, listTitle: string, today: string): boolean {
  switch (term.kind) {
    case "word":
      return node.text.toLowerCase().includes(term.text.toLowerCase());
    case "list":
      return term.names.some((n) => n.toLowerCase() === listTitle.toLowerCase());
    case "is":
      return term.values.some((v) => (v === "done") === node.done);
    case "due":
      return term.values.some((v) => matchesDue(v, node, today));
  }
}

/** True when the task itself matches every term. A filter with a bad value matches nothing. */
export function matchesTask(node: Pick<Task, "text" | "done">, listTitle: string, filter: ParsedFilter, today: string): boolean {
  if (filter.error !== null) return false;
  return filter.terms.every((t) => matchesTerm(t, node, listTitle, today));
}

const pinned = (pins: TaskPath[], list: number, task: number, child?: number) =>
  pins.some((p) => p.list === list && p.task === task && p.child === child);

/**
 * The rows to show. A task is visible when it matches, or an ancestor matches, or a descendant matches, or it is pinned
 * (with its ancestors). With a non-blank filter, a list with no visible task is hidden.
 * With `showSiblings`, a task shown because a subtask matches shows all its subtasks, not only the matching ones.
 */
export function visibleRows(doc: TodoDocument, text: string, today: string, pins: TaskPath[] = [], showSiblings = false): Visible {
  const filter = parseFilter(text);
  const filtering = isFiltering(text);
  const lists: VisibleList[] = [];
  doc.lists.forEach((list, l) => {
    const tasks: VisibleTask[] = [];
    list.tasks.forEach((task, t) => {
      const parentMatches = !filtering || matchesTask(task, list.title, filter, today);
      const matching = task.children?.map((child) => matchesTask(child, list.title, filter, today)) ?? [];
      const all = parentMatches || (showSiblings && matching.some(Boolean));
      const children: number[] = [];
      task.children?.forEach((_, c) => {
        if (all || matching[c] || pinned(pins, l, t, c)) children.push(c);
      });
      if (parentMatches || pinned(pins, l, t) || children.length > 0) tasks.push({ task: t, children, hidden: (task.children?.length ?? 0) - children.length });
    });
    if (!filtering || tasks.length > 0) lists.push({ list: l, tasks });
  });
  return { lists, error: filter.error, filtering };
}

/** The cursor stops of the visible rows: each visible list header, then its visible tasks and subtasks. */
export function visibleStops(visible: Visible | VisibleList[]): Stop[] {
  const lists = Array.isArray(visible) ? visible : visible.lists;
  const out: Stop[] = [];
  for (const { list, tasks } of lists) {
    out.push({ kind: "header", list });
    for (const { task, children } of tasks) {
      out.push({ kind: "task", path: { list, task } });
      for (const child of children) out.push({ kind: "task", path: { list, task, child } });
    }
  }
  return out;
}

/** A copy of the document that holds only the visible lists, tasks and subtasks (the Markdown view and the clipboard). */
export function applyVisible(doc: TodoDocument, visible: Visible): TodoDocument {
  return {
    ...doc,
    lists: visible.lists.map(({ list, tasks }) => ({
      title: doc.lists[list]!.title,
      tasks: tasks.map(({ task, children }) => {
        const source = doc.lists[list]!.tasks[task]!;
        const copy: Task = { text: source.text, done: source.done };
        if (children.length > 0) copy.children = children.map((c) => ({ ...source.children![c]! }));
        return copy;
      }),
    })),
  };
}

/**
 * Pins a task so that it stays visible until the filter text changes.
 * An insertion (add or paste) first shifts the pins that sit at or after it, so that they follow their task.
 */
export function pinTask(pins: TaskPath[], path: TaskPath, inserted = false): TaskPath[] {
  let next = pins;
  if (inserted) {
    next = pins.map((p) => {
      if (p.list !== path.list) return p;
      if (path.child === undefined) return p.task >= path.task ? { ...p, task: p.task + 1 } : p;
      return p.task === path.task && p.child !== undefined && p.child >= path.child ? { ...p, child: p.child + 1 } : p;
    });
  }
  if (next.some((p) => p.list === path.list && p.task === path.task && p.child === path.child)) return next;
  return [...next, path];
}

/**
 * The pins after a move: each one follows its task to the new path.
 * The moves apply at once, so two tasks that swap each keep their pin.
 */
export function followPins(pins: TaskPath[], moves: PathMove[]): TaskPath[] {
  return pins.map((p) => moves.find((m) => samePath(m.from, p))?.to ?? p);
}

export type Range = { from: number; to: number };
export type Pill = { key: Range; value: Range };

/** The `list:`, `due:` and `is:` terms of the text, as the range of the key (with its colon) and of its value, for the pills of the bar. */
export function filterPills(text: string): Pill[] {
  const pills: Pill[] = [];
  let quoted = false;
  let start = -1;
  const end = (to: number) => {
    if (start < 0) return;
    const token = text.slice(start, to);
    const key = text[start] === '"' ? undefined : KEY.exec(token)?.[1]!.toLowerCase();
    if (key === "list" || key === "due" || key === "is") {
      const split = start + key.length + 1;
      pills.push({ key: { from: start, to: split }, value: { from: split, to } });
    }
    start = -1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (!quoted && /\s/.test(c)) end(i);
    else {
      if (start < 0) start = i;
      if (c === '"') quoted = !quoted;
    }
  }
  end(text.length);
  return pills;
}

export type CompletionOption = { label: string; apply: string; detail?: string };
export type Completion = { from: number; options: CompletionOption[] };

const needsQuotes = (title: string) => /[\s,]/.test(title);

/**
 * The popup of the filter bar for the value being typed at `cursor`, after `list:` or `due:` and after a comma.
 * `from` is where the replaced text starts. Null when there is nothing to offer.
 */
export function filterCompletion(text: string, cursor: number, listTitles: string[], today: string): Completion | null {
  // Find the start of the token under the cursor and of its current comma-separated value, honoring quotes.
  let quoted = false;
  let tokenStart = 0;
  let valueStart = 0;
  for (let i = 0; i < cursor; i++) {
    const c = text[i]!;
    if (c === '"') quoted = !quoted;
    else if (!quoted && /\s/.test(c)) tokenStart = valueStart = i + 1;
    else if (!quoted && c === "," && i >= tokenStart) valueStart = i + 1;
  }
  const token = text.slice(tokenStart, cursor);
  const key = KEY.exec(token)?.[1]!.toLowerCase();
  if (!key || token.startsWith('"')) return null;
  const from = Math.max(valueStart, tokenStart + key.length + 1);
  const typed = text.slice(from, cursor).replace(/^"/, "");
  const lower = typed.toLowerCase();

  if (key === "list") {
    const titles = [...new Set(listTitles)].filter((t) => !t.includes('"') && t.toLowerCase().includes(lower));
    const options = titles.map((t) => ({ label: t, apply: needsQuotes(t) ? `"${t}"` : t }));
    return options.length > 0 ? { from, options } : null;
  }
  if (key === "due") {
    // An operator is typed text that stays in place, so the entries replace what follows it.
    const operator = OPERATOR.exec(typed)?.[0];
    const word = typed.slice(operator?.length ?? 0);
    const start = from + (typed.length - word.length);
    const options: CompletionOption[] = (operator ? ["today", "week"] : ["today", "week", "overdue"])
      .filter((w) => w.startsWith(word.toLowerCase()))
      .map((w) => ({ label: w, apply: w }));
    if (!options.some((o) => o.label === word)) {
      const date = resolveShortcut(word, today);
      if (date) options.push(date === word ? { label: word, apply: word } : { label: word, apply: word, detail: date });
      for (const e of dueCompletions(word, today)) options.push({ label: e.label, apply: e.label, detail: e.date });
    }
    return options.length > 0 ? { from: start, options } : null;
  }
  return null;
}
