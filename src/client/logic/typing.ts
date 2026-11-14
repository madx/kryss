// Typing aids of the task editor (PRD 5.22): pure decisions, the CodeMirror part is in editor/typing.ts.

/** A closer that the editor inserted and that has not been stepped over yet. `at` is where the closer starts, `open` the length of the opener. */
export type Pair = { at: number; closer: string; open: number };

/** A replacement of `[from, to)` by `insert`, the selection after it, and the tracked pair to forget (`drop`, an `at` before the change) and to add (`track`, after it). */
export type Edit = { from: number; to: number; insert: string; anchor: number; head: number; track?: Pair; drop?: number };

export function typedEdit(_text: string, _from: number, _to: number, _ch: string, _pairs: readonly Pair[]): Edit | null {
  return null;
}

export function emptyPairRemoval(_text: string, _cursor: number, _pairs: readonly Pair[]): { from: number; to: number } | null {
  return null;
}

export function toggleMarker(_text: string, _from: number, _to: number, _marker: "**" | "*"): Edit {
  return { from: 0, to: 0, insert: "", anchor: 0, head: 0 };
}

export function linkEdit(_text: string, _from: number, _to: number, _clipboard: string | null): Edit {
  return { from: 0, to: 0, insert: "", anchor: 0, head: 0 };
}
