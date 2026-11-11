// The cursor is the focused row or list header (PRD 5.9). This module maps between DOM focus and the stop sequence of the pure logic.
import { clampIndex, indexOfStop, parseStoredIndex, type Stop } from "../logic/cursor";
import { fileStorageKey } from "../logic/files";
import { visibleStops as stopsOf } from "../logic/filter";
import { visibleOf } from "./visible";
import type { TaskPath } from "../logic";
import type { Store } from "../store";
export const CURSOR_KEY = "kryss.cursor";

/** Scrolls an element into view only if it is off screen, smoothly unless the user prefers reduced motion. */
export function reveal(el: Element | null | undefined, block: ScrollLogicalPosition = "nearest"): void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  el?.scrollIntoView?.({ block, behavior: reduced ? "auto" : "smooth" });
}

/** A list header brings its whole list on screen, or just its top edge when the list is taller than the scroll area. */
function revealStop(el: HTMLElement): void {
  const list = el.classList.contains("list-header") ? el.closest<HTMLElement>(".list") : null;
  if (!list) return reveal(el);
  const area = list.closest<HTMLElement>(".app-scroll");
  if (area && list.offsetHeight > area.clientHeight) reveal(el, "start");
  else reveal(list);
}

/** Focuses an element without the browser's instant jump, then reveals it smoothly. */
export function focusAndReveal(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.focus({ preventScroll: true });
  revealStop(el);
}

export const rowSelector = (p: TaskPath) =>
  `.task-row[data-list="${p.list}"][data-task="${p.task}"]` + (p.child === undefined ? ":not([data-child])" : `[data-child="${p.child}"]`);

export const stopSelector = (s: Stop) => (s.kind === "header" ? `.list-header[data-list="${s.list}"]` : rowSelector(s.path));

/** The stop an element stands for: a list header, or a task row (also when its checkbox has the focus). */
export function stopOf(target: EventTarget | null): Stop | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target.classList.contains("list-header") && target.dataset.list !== undefined) return { kind: "header", list: Number(target.dataset.list) };
  const row = target.classList.contains("task-row") ? target : target.classList.contains("task-check") ? target.closest<HTMLElement>(".task-row") : null;
  if (!row || row.classList.contains("task-new") || row.dataset.list === undefined) return null;
  const child = row.dataset.child;
  return { kind: "task", path: { list: Number(row.dataset.list), task: Number(row.dataset.task), child: child === undefined ? undefined : Number(child) } };
}

export function createCursor(main: HTMLElement, store: Store, storage?: Storage, file: string | null = null) {
  let last = -1;
  const key = fileStorageKey(CURSOR_KEY, file);

  const visibleStops = (): Stop[] => {
    const visible = visibleOf(store.getState());
    return visible ? stopsOf(visible) : [];
  };
  const safe = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch {
      return undefined; // storage can be unavailable
    }
  };

  const cursor = {
    /** The stop under the focus, or null. */
    current: (): Stop | null => (main.contains(document.activeElement) ? stopOf(document.activeElement) : null),
    /** Index of the focused stop, or -1. */
    index(): number {
      const cur = cursor.current();
      return cur ? indexOfStop(visibleStops(), cur) : -1;
    },
    /** Last known cursor index (kept when the focus moves to a control or the DOM is rebuilt). */
    last: () => last,
    count: () => visibleStops().length,
    /** Focuses the stop at `index`, clamped to the visible range. */
    focusIndex(index: number): void {
      const all = visibleStops();
      const i = clampIndex(all.length, index);
      if (i >= 0) focusAndReveal(main.querySelector<HTMLElement>(stopSelector(all[i]!)));
    },
    /** Focuses a stop; false when it is not on screen (for instance in a hidden list). */
    focusStop(stop: Stop): boolean {
      const el = main.querySelector<HTMLElement>(stopSelector(stop));
      focusAndReveal(el);
      return el !== null;
    },
    /** The stop at `index` of the visible sequence, if any. */
    stopAt: (index: number): Stop | null => visibleStops()[index] ?? null,
    /** True when the focus is on a stop, so a re-render that drops it must restore it. */
    hasFocus: (): boolean => cursor.current() !== null,
    /** Puts the cursor back on the stored index (once, on load). */
    restore(): void {
      const stored = parseStoredIndex(safe(() => storage?.getItem(key) ?? null) ?? null);
      if (stored !== null) cursor.focusIndex(stored);
    },
  };

  main.addEventListener("focusin", (e) => {
    if (!stopOf(e.target)) return;
    const i = cursor.index();
    if (i < 0) return;
    last = i;
    safe(() => storage?.setItem(key, String(i)));
  });
  return cursor;
}

export type Cursor = ReturnType<typeof createCursor>;
