import type { Range } from "./cursor";

/** null = All, otherwise a list index. */
export type View = number | null;

/** Cycles All, 0, 1, ..., n-1 with wrap-around. A stale index (>= listCount) cycles as if from All; no list gives null. */
export function cycleView(_current: View, _listCount: number, _dir: "next" | "prev"): View {
  throw new Error("not implemented");
}

/** Inclusive range of visible lists. */
export function visibleRange(_view: View, _listCount: number): Range {
  throw new Error("not implemented");
}
