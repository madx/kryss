// The due date rewrite on completion (PRD 5.13). Pure: today is a parameter.
import { findDueRange } from "../markdown/inline";
import { duePeriod } from "./due";

const WAS = /^\s+\(was [^)]*\)/;

/**
 * The text of a task that has just been checked: its last due date becomes today when it is a week, a quarter or a day before today.
 * The old date stays as plain text right after the new one, `-> 2026-11-11 (was 2026-10-30)`, unless a `(was …)` already follows it.
 * Any other text is returned as it is.
 */
export function completeDue(text: string, today: string): string {
  const due = findDueRange(text);
  if (!due) return text;
  const period = duePeriod(due.value)!;
  const isDay = period.start === period.end && due.value.length === 10;
  if (isDay && due.value >= today) return text;
  const rest = text.slice(due.to);
  const suffix = WAS.test(rest) ? "" : ` (was ${due.value})`;
  return `${text.slice(0, due.from)}-> ${today}${suffix}${rest}`;
}
