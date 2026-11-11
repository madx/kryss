// Pure logic of the saved filter picker (PRD 5.14).
import type { SavedFilter } from "../../shared/types";

export type PickerEntry = { kind: "save" } | { kind: "saved"; index: number };

/** "Save current filter…" first (only with a non-empty text), then the saved filters in file order. */
export function pickerEntries(saved: SavedFilter[], text: string): PickerEntry[] {
  const entries: PickerEntry[] = text.trim() === "" ? [] : [{ kind: "save" }];
  saved.forEach((_, index) => entries.push({ kind: "saved", index }));
  return entries;
}

/** Saves a text under a name: an existing name is overwritten in place, a new one is appended. An empty name or text gives `null`. */
export function saveFilter(saved: SavedFilter[], name: string, text: string): SavedFilter[] | null {
  const n = name.trim();
  const t = text.trim();
  if (n === "" || t === "") return null;
  return saved.some((f) => f.name === n) ? saved.map((f) => (f.name === n ? { name: n, text: t } : f)) : [...saved, { name: n, text: t }];
}

export function deleteFilter(saved: SavedFilter[], index: number): SavedFilter[] {
  return saved[index] ? saved.filter((_, i) => i !== index) : saved;
}

export type PickerKeyResult = { highlight?: number; pick?: number; remove?: number; close?: true; pending?: true; cancel?: true } | null;

/** Keyboard handling of the open picker: no wrap-around, and `dd` deletes the highlighted entry. */
export function pickerKey(highlight: number, count: number, key: string, pendingD: boolean): PickerKeyResult {
  if (key === "Escape") return { close: true };
  if (count === 0) return null;
  const move = key === "ArrowDown" || key === "j" ? Math.min(highlight + 1, count - 1) : key === "ArrowUp" || key === "k" ? Math.max(highlight - 1, 0) : null;
  if (pendingD) {
    if (key === "d") return { remove: highlight };
    return move === null ? { cancel: true } : { highlight: move, cancel: true };
  }
  if (move !== null) return { highlight: move };
  if (key === "Enter") return { pick: highlight };
  if (key === "d") return { pending: true };
  return null;
}
