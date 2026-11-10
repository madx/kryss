import type { View } from "./views";

/** Menu items: 0 is "All", i + 1 is list i. */
export type MenuResult = { highlight: number } | { pick: View } | { close: true } | null;

/** The highlight starts on the current view; a stale index starts on All. */
export function menuStart(view: View, listCount: number): number {
  return view === null || view < 0 || view >= listCount ? 0 : view + 1;
}

export function menuView(item: number): View {
  return item === 0 ? null : item - 1;
}

/** Keyboard handling of the open selector menu: no wrap-around. */
export function menuKey(highlight: number, listCount: number, key: string): MenuResult {
  if (key === "ArrowDown") return { highlight: Math.min(highlight + 1, listCount) };
  if (key === "ArrowUp") return { highlight: Math.max(highlight - 1, 0) };
  if (key === "Enter") return { pick: menuView(highlight) };
  if (key === "Escape") return { close: true };
  return null;
}
