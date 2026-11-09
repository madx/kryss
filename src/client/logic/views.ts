import type { Range } from "./cursor";

/** null = All, otherwise a list index. */
export type View = number | null;

/** Cycles All, 0, 1, ..., n-1 with wrap-around. A stale index (>= listCount) cycles as if from All; no list gives null. */
export function cycleView(current: View, listCount: number, dir: "next" | "prev"): View {
  if (listCount <= 0) return null;
  const pos = current === null || current >= listCount || current < 0 ? 0 : current + 1;
  const next = (pos + (dir === "next" ? 1 : -1) + listCount + 1) % (listCount + 1);
  return next === 0 ? null : next - 1;
}

/** Inclusive range of visible lists. */
export function visibleRange(view: View, listCount: number): Range {
  return view === null ? { first: 0, last: listCount - 1 } : { first: view, last: view };
}
