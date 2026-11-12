// Pure due date logic (PRD 5.13). Dates are ISO strings, today is always a parameter.
// ISO strings of the same form compare correctly as plain strings.

export type Period = { start: string; end: string };
export type DueState = "overdue" | "now" | "week" | "later";
export type DueEntry = { label: string; date: string };

const DAY_MS = 86_400_000;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DEFAULT_WORDS = ["today", "tomorrow", "+1d", "+1w", "+1m", "+1y", "+mon", "W", "Q", "+1W", "+1Q"];

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fromIso = (day: string) => Date.parse(day + "T00:00:00Z");
const addDays = (day: string, n: number) => toIso(fromIso(day) + n * DAY_MS);
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** Monday = 0 … Sunday = 6. */
const weekdayIndex = (day: string) => (new Date(fromIso(day)).getUTCDay() + 6) % 7;

/** Monday of ISO week 1: the week that holds January 4th. */
const week1Monday = (year: number) => addDays(`${pad(year, 4)}-01-04`, -weekdayIndex(`${pad(year, 4)}-01-04`));
const weeksInYear = (year: number) => Math.round((fromIso(week1Monday(year + 1)) - fromIso(week1Monday(year))) / (7 * DAY_MS));

function isRealDay(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** The period covered by a valid day, ISO week or quarter, or null when the text is not a strictly valid date. */
export function duePeriod(text: string): Period | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDay(y, mo, d) ? { start: text, end: text } : null;
  }
  m = /^(\d{4})-W(\d{2})$/.exec(text);
  if (m) {
    const [y, w] = [Number(m[1]), Number(m[2])];
    if (w < 1 || w > weeksInYear(y)) return null;
    const start = addDays(week1Monday(y), (w - 1) * 7);
    return { start, end: addDays(start, 6) };
  }
  m = /^(\d{4})-Q(\d)$/.exec(text);
  if (m) {
    const [y, q] = [Number(m[1]), Number(m[2])];
    if (q < 1 || q > 4) return null;
    const firstMonth = (q - 1) * 3 + 1;
    return {
      start: `${m[1]}-${pad(firstMonth)}-01`,
      end: `${m[1]}-${pad(firstMonth + 2)}-${pad(daysInMonth(y, firstMonth + 2))}`,
    };
  }
  return null;
}

/** The state of a due date against a horizon, or null when the date is invalid. */
export function dueState(text: string, horizon: Period): DueState | null {
  const period = duePeriod(text);
  if (!period) return null;
  if (period.end < horizon.start) return "overdue";
  if (period.start > horizon.end) return period.start <= weekPeriod(horizon.end).end ? "week" : "later";
  return "now";
}

/** The ISO week (Monday to Sunday) that holds `today`. */
export function weekPeriod(today: string): Period {
  return duePeriod(resolveShortcut("W", today)!)!;
}

/** True when two periods share at least one day. */
export function overlaps(a: Period, b: Period): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** The horizon made of one day. */
export function dayPeriod(day: string): Period {
  return { start: day, end: day };
}

/** Day `n` months or years later, clamped to the end of the target month. */
function shiftMonths(day: string, months: number): string {
  const y = Number(day.slice(0, 4));
  const mo = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  const index = y * 12 + (mo - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  return `${pad(ty, 4)}-${pad(tm)}-${pad(Math.min(d, daysInMonth(ty, tm)))}`;
}

/** ISO year and week of a day: the year of the Thursday of its week. */
function isoWeek(day: string): { year: number; week: number } {
  const thursday = addDays(day, 3 - weekdayIndex(day));
  const year = Number(thursday.slice(0, 4));
  return { year, week: Math.floor((fromIso(thursday) - fromIso(week1Monday(year))) / (7 * DAY_MS)) + 1 };
}

function shiftWeeks(day: string, n: number): string {
  const monday = addDays(day, -weekdayIndex(day) + 7 * n);
  const { year, week } = isoWeek(monday);
  return `${pad(year, 4)}-W${pad(week)}`;
}

function shiftQuarters(day: string, n: number): string {
  const y = Number(day.slice(0, 4));
  const quarter = Math.floor((Number(day.slice(5, 7)) - 1) / 3);
  const index = y * 4 + quarter + n;
  return `${pad(Math.floor(index / 4), 4)}-Q${(index % 4) + 1}`;
}

/** Resolves a shortcut word (without the arrow) to a date, or null when it is unknown or leaves the valid years. */
export function resolveShortcut(word: string, today: string): string | null {
  try {
    const resolved = resolveWord(word, today);
    return resolved !== null && duePeriod(resolved) ? resolved : null;
  } catch {
    return null; // a shift so large that the date is not representable
  }
}

function resolveWord(word: string, today: string): string | null {
  if (word === "today") return today;
  if (word === "tomorrow") return addDays(today, 1);
  if (word === "W") return shiftWeeks(today, 0);
  if (word === "Q") return shiftQuarters(today, 0);
  if (duePeriod(word)) return word;

  const weekday = /^([+-])([a-z]{3})$/.exec(word);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]!);
    if (target < 0) return null;
    const current = weekdayIndex(today);
    if (weekday[1] === "+") return addDays(today, ((target - current + 6) % 7) + 1);
    return addDays(today, -(((current - target + 6) % 7) + 1));
  }

  const shift = /^([+-])([1-9]\d*)([dwmyWQ])$/.exec(word);
  if (!shift) return null;
  const n = Number(shift[2]) * (shift[1] === "-" ? -1 : 1);
  switch (shift[3]) {
    case "d": return addDays(today, n);
    case "w": return addDays(today, 7 * n);
    case "m": return shiftMonths(today, n);
    case "y": return shiftMonths(today, 12 * n);
    case "W": return shiftWeeks(today, n);
    default: return shiftQuarters(today, n);
  }
}

const UNITS = ["d", "w", "m", "y", "W", "Q"];

/**
 * The completion of a sign and a number (one entry per unit) or of a sign and a weekday prefix (the matching weekdays).
 * It lists nothing for a bare sign, a complete shortcut or any other word. Shared by the `->` and `due:` popups.
 */
export function dueCompletions(word: string, today: string): DueEntry[] {
  const labels = /^[+-][1-9]\d*$/.test(word)
    ? UNITS.map((u) => word + u)
    : /^[+-][a-z]{1,2}$/.test(word)
      ? WEEKDAYS.filter((d) => d.startsWith(word.slice(1))).map((d) => word[0] + d)
      : [];
  const entries = labels.map((label) => ({ label, date: resolveShortcut(label, today) }));
  return entries.filter((e): e is DueEntry => e.date !== null);
}

/** The popup entries for what was typed after `->`. */
export function dueEntries(word: string, today: string): DueEntry[] {
  const entries: DueEntry[] = [];
  for (const label of DEFAULT_WORDS) {
    if (!label.startsWith(word)) continue;
    entries.push({ label, date: resolveShortcut(label, today)! });
  }
  if (!DEFAULT_WORDS.includes(word)) {
    const date = resolveShortcut(word, today);
    if (date) entries.push({ label: word, date });
  }
  for (const entry of dueCompletions(word, today)) {
    if (!entries.some((e) => e.label === entry.label)) entries.push(entry);
  }
  return entries;
}

/** Replaces a trailing `->shortcut` with `-> DATE`, or null when there is none or the word is unknown. */
export function resolveTrailing(text: string, today: string): string | null {
  const m = /(?<=^|\s)->(\S+)$/.exec(text);
  const date = m ? resolveShortcut(m[1]!, today) : null;
  return m && date ? text.slice(0, m.index) + "-> " + date : null;
}
