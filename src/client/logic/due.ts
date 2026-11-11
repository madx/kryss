// Pure due date logic (PRD 5.13). Dates are ISO strings, today is always a parameter.

export type Period = { start: string; end: string };
export type DueState = "overdue" | "now" | "later";
export type DueEntry = { label: string; date: string };

/** The period covered by a valid day, ISO week or quarter, or null when the text is not a strictly valid date. */
export function duePeriod(_text: string): Period | null {
  return null;
}

/** The state of a due date against a horizon, or null when the date is invalid. */
export function dueState(_text: string, _horizon: Period): DueState | null {
  return null;
}

/** The horizon made of one day. */
export function dayPeriod(_day: string): Period {
  return { start: "", end: "" };
}

/** Resolves a shortcut word (without the arrow) to a date, or null when it is unknown. */
export function resolveShortcut(_word: string, _today: string): string | null {
  return null;
}

/** The popup entries for what was typed after `->`. */
export function dueEntries(_word: string, _today: string): DueEntry[] {
  return [];
}
