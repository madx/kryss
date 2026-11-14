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

/** What Ctrl+B and Ctrl+I look for: bold is a run of two or more `*`, italic an odd run of `_` or `*`, so `**x**` is not italic. */
type Spec = { c: "*" | "_"; len: 1 | 2; ok: (n: number) => boolean };
const BOLD: Spec[] = [{ c: "*", len: 2, ok: (n) => n >= 2 }];
const odd = (n: number) => n % 2 === 1;
const ITALIC: Spec[] = [
  { c: "_", len: 1, ok: odd },
  { c: "*", len: 1, ok: odd },
];

type Run = { start: number; end: number };
function runsOf(text: string, c: string): Run[] {
  return [...text.matchAll(new RegExp(`\\${c}+`, "g"))].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
}
const runLength = (s: string, from: number, step: 1 | -1, c: string): number => {
  let n = 0;
  for (let i = step === 1 ? from : from - 1; s[i] === c; i += step) n++;
  return n;
};

/** A run that is not a marker: an `_` between two word characters (`snake_case`), or a run with whitespace or an edge on both sides (`2 * 3`). */
function isLiteralRun(text: string, r: Run, c: string): boolean {
  const before = text[r.start - 1], after = text[r.end];
  const word = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  const space = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
  return (c === "_" && word(before) && word(after)) || (space(before) && space(after));
}

/** With no selection: the edit that removes the markers of the span around the cursor, or of the empty pair it is in, or null. */
function unwrapAtCursor(text: string, cursor: number, specs: Spec[]): Edit | null {
  for (const { c, len } of specs) {
    const empty = runsOf(text, c).find((r) => {
      const left = cursor - r.start, right = r.end - cursor;
      return left > 0 && right > 0 && (len === 2 ? left >= 2 && right >= 2 : left === 1 && right === 1);
    });
    if (empty) return { from: cursor - len, to: cursor + len, insert: "", anchor: cursor - len, head: cursor - len };
  }
  let best: { a: Run; b: Run; len: number } | null = null;
  for (const { c, len, ok } of specs) {
    const tokens = runsOf(text, c).filter((r) => ok(r.end - r.start) && !isLiteralRun(text, r, c));
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const a = tokens[i]!, b = tokens[i + 1]!;
      if (a.end <= cursor && cursor <= b.start && (!best || a.start > best.a.start)) best = { a, b, len };
    }
  }
  if (!best) return null;
  const { a, b, len } = best;
  return { from: a.start, to: b.end, insert: text.slice(a.start + len, b.end - len), anchor: cursor - len, head: cursor - len };
}

/**
 * Ctrl+B (`**`) and Ctrl+I (`_`): wraps the selection, or removes the markers when they sit just inside or just outside it.
 * Italic is written with `_` and recognized in `_` or `*`.
 * With no selection it removes the markers of the span around the cursor, and otherwise inserts the pair, with no check of the surroundings.
 */
export function toggleMarker(text: string, from: number, to: number, marker: "**" | "_"): Edit {
  const m = marker.length;
  const specs = marker === "**" ? BOLD : ITALIC;
  if (from === to) {
    return (
      unwrapAtCursor(text, from, specs) ?? { from, to, insert: marker + marker, anchor: from + m, head: from + m, track: { at: from + m, closer: marker, open: m } }
    );
  }
  const selected = text.slice(from, to);
  for (const { c, len, ok } of specs) {
    if (ok(Math.min(runLength(text, from, -1, c), runLength(text, to, 1, c)))) {
      return { from: from - len, to: to + len, insert: selected, anchor: from - len, head: to - len };
    }
  }
  for (const { c, len, ok } of specs) {
    if (selected.length >= 2 * len && ok(Math.min(runLength(selected, selected.length, -1, c), runLength(selected, 0, 1, c)))) {
      const inner = selected.slice(len, -len);
      return { from, to, insert: inner, anchor: from, head: from + inner.length };
    }
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

/**
 * A dead key, such as `~` or the backtick on an AZERTY keyboard, is composed by the browser, so the editor already holds the character when the composition ends.
 * `before` and `after` are the document before and after it, `start` is where the cursor was and `pairs` are the tracked pairs of `after`.
 * When exactly one character was inserted at `start`, this gives the edit that a typed character would have given, as a replacement of that character.
 * `drop` and `track` are positions of `after`.
 */
export function composedEdit(before: string, after: string, start: number, pairs: readonly Pair[]): Edit | null {
  if (after.length !== before.length + 1 || after.slice(0, start) !== before.slice(0, start) || after.slice(start + 1) !== before.slice(start)) return null;
  const earlier = pairs.filter((p) => p.at !== start).map((p) => ({ ...p, at: p.at > start ? p.at - 1 : p.at }));
  const edit = typedEdit(before, start, start, after[start]!, earlier);
  if (!edit) return null;
  return { ...edit, from: start, to: start + 1, drop: edit.drop === undefined ? undefined : edit.drop >= start ? edit.drop + 1 : edit.drop };
}
