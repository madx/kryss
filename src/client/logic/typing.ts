// Typing aids of the task editor (PRD 5.22): pure decisions, the CodeMirror part is in editor/typing.ts.
import { escapeLabel, safeTarget, singleUrl } from "./links";

/** A closer that the editor inserted and that has not been stepped over yet. `at` is where the closer starts, `open` the length of the opener. */
export type Pair = { at: number; closer: string; open: number };

/** A replacement of `[from, to)` by `insert`, the selection after it, and the tracked pair to forget (`drop`, an `at` before the change) and to add (`track`, after it). */
export type Edit = { from: number; to: number; insert: string; anchor: number; head: number; track?: Pair; drop?: number };

/** The characters that pair on their own, with their closer. */
const PAIRS: Record<string, string> = { "*": "*", _: "_", "`": "`", "[": "]", "(": ")", '"': '"' };
/** The characters that wrap a selection: the pairing ones, and `~` and `=`, which only pair on their second keystroke. */
const WRAPS: Record<string, string> = { ...PAIRS, "~": "~", "=": "=" };
/** The pairs that grow when their opener is typed again right away. */
const GROWS: Record<string, string> = { "*": "*", "[": "]" };

const WORD_BEFORE = /[\p{L}\p{N}]$/u;
const CLOSING_AFTER = /^(\s|[)\]}"'`.,;:!?*_~=])/;

/** The pairing guard: no letter or digit before, and a space, the end or a closing character after. */
function mayPair(before: string, after: string): boolean {
  return !WORD_BEFORE.test(before) && (after === "" || CLOSING_AFTER.test(after));
}

function pairEdit(from: number, ch: string, closer: string): Edit {
  return { from, to: from, insert: ch + closer, anchor: from + 1, head: from + 1, track: { at: from + 1, closer, open: 1 } };
}

/**
 * The edit for a typed character, or null when the keystroke stays native.
 * With a selection it wraps (PRD 5.22), otherwise it grows, steps over, or pairs, in that order.
 */
export function typedEdit(text: string, from: number, to: number, ch: string, pairs: readonly Pair[]): Edit | null {
  if (ch.length !== 1) return null;
  if (from !== to) {
    const closer = WRAPS[ch];
    if (closer === undefined) return null;
    const insert = ch + text.slice(from, to) + closer;
    return { from, to, insert, anchor: from + 1, head: to + 1 };
  }
  const here = pairs.find((p) => p.at === from && text.startsWith(p.closer, from));
  const growCloser = GROWS[ch];
  if (growCloser !== undefined && here && here.open === 1 && here.closer === growCloser && text[from - 1] === ch) {
    return { from, to, insert: ch + growCloser, anchor: from + 1, head: from + 1, drop: here.at, track: { at: from + 1, closer: growCloser.repeat(2), open: 2 } };
  }
  const stepping = pairs.find((p) => p.at === from && p.closer[0] === ch && text.startsWith(p.closer, from));
  if (stepping) {
    const rest = stepping.closer.slice(1);
    return { from, to, insert: "", anchor: from + 1, head: from + 1, drop: stepping.at, ...(rest ? { track: { at: from + 1, closer: rest, open: stepping.open } } : {}) };
  }
  if (ch === "~" || ch === "=") {
    // The second one: the check is made on the character before the first one.
    if (text[from - 1] !== ch || text[from - 2] === ch || !mayPair(text.slice(0, from - 1), text.slice(from))) return null;
    return { from, to, insert: ch + ch + ch, anchor: from + 1, head: from + 1, track: { at: from + 1, closer: ch + ch, open: 2 } };
  }
  const closer = PAIRS[ch];
  if (closer === undefined || !mayPair(text.slice(0, from), text.slice(from))) return null;
  return pairEdit(from, ch, closer);
}

/** The range to delete for Backspace inside an empty pair that the editor inserted, or null for the native Backspace. */
export function emptyPairRemoval(text: string, cursor: number, pairs: readonly Pair[]): { from: number; to: number } | null {
  const opener = (closer: string) => [...closer].map((c) => (c === "]" ? "[" : c === ")" ? "(" : c)).join("");
  const p = pairs.find((q) => q.at === cursor && q.closer.length === q.open && text.startsWith(q.closer, cursor) && text.slice(cursor - q.open, cursor) === opener(q.closer));
  return p ? { from: cursor - p.open, to: cursor + p.closer.length } : null;
}

/** Whether a run of `n` asterisks on each side holds `marker`: bold needs two, italic an odd count, so `**x**` is not italic. */
const hasMarker = (n: number, marker: "**" | "*") => (marker === "**" ? n >= 2 : n % 2 === 1);
const run = (s: string, from: number, step: 1 | -1): number => {
  let n = 0;
  for (let i = step === 1 ? from : from - 1; s[i] === "*"; i += step) n++;
  return n;
};

/**
 * Ctrl+B (`**`) and Ctrl+I (`*`): wraps the selection, or removes the marker when it sits just inside or just outside the selection.
 * With no selection it inserts the pair, with no check of the surroundings.
 */
export function toggleMarker(text: string, from: number, to: number, marker: "**" | "*"): Edit {
  const m = marker.length;
  if (from === to) return { from, to, insert: marker + marker, anchor: from + m, head: from + m, track: { at: from + m, closer: marker, open: m } };
  const selected = text.slice(from, to);
  if (hasMarker(Math.min(run(text, from, -1), run(text, to, 1)), marker)) {
    return { from: from - m, to: to + m, insert: selected, anchor: from - m, head: to - m };
  }
  if (selected.length >= 2 * m && hasMarker(Math.min(run(selected, selected.length, -1), run(selected, 0, 1)), marker)) {
    const inner = selected.slice(m, -m);
    return { from, to, insert: inner, anchor: from, head: from + inner.length };
  }
  return { from, to, insert: marker + selected + marker, anchor: from + m, head: to + m };
}

/**
 * Ctrl+K: a link around the selection, or an empty one.
 * `clipboard` is the text read from the system clipboard, or null when the read failed or was refused.
 * Only a single `http` or `https` URL fills the link, anything else leaves an empty URL part with the cursor in it.
 */
export function linkEdit(text: string, from: number, to: number, clipboard: string | null): Edit {
  const url = clipboard === null ? null : singleUrl(clipboard);
  const label = escapeLabel(text.slice(from, to));
  const insert = `[${label}](${url === null ? "" : safeTarget(url)})`;
  const cursor = from === to ? from + 1 : url === null ? from + insert.length - 1 : from + insert.length;
  return { from, to, insert, anchor: cursor, head: cursor };
}

export function composedEdit(_before: string, _after: string, _start: number, _pairs: readonly Pair[]): Edit | null {
  return null;
}
