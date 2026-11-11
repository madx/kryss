// Pure incremental search logic (PRD 5.15): the matching stops, the next and previous match with wrap, and the label.
import type { TodoDocument } from "../../shared/types";
import { parseInline, type InlineNode } from "../markdown/inline";
import { visibleStops, type Visible } from "./filter";
import { getNode } from "./paths";

export type Step = { index: number; wrapped: boolean };

const plain = (nodes: InlineNode[]): string =>
  nodes.map((n) => (n.type === "text" || n.type === "code" || n.type === "due" ? n.value : plain(n.children))).join("");

/** The text of a task as it is shown: no Markdown markers, the label of a link and the date of a due pill, no `->` and no URL. */
export function renderedText(text: string): string {
  return plain(parseInline(text));
}

/** The indices, in the visible stop sequence, of the rows whose own text contains the query (a literal, ignoring case). */
export function matchingStops(doc: TodoDocument, visible: Visible, query: string): number[] {
  const needle = query.toLowerCase();
  if (needle === "") return [];
  const out: number[] = [];
  visibleStops(visible).forEach((stop, i) => {
    const text = stop.kind === "header" ? doc.lists[stop.list]?.title : renderedText(getNode(doc, stop.path)?.text ?? "");
    if (text?.toLowerCase().includes(needle)) out.push(i);
  });
  return out;
}

/** The first match at or after `from`, wrapping to the first one. */
export function firstMatch(matches: number[], from: number): Step | null {
  const index = matches.find((m) => m >= from);
  if (index !== undefined) return { index, wrapped: false };
  return matches.length > 0 ? { index: matches[0]!, wrapped: true } : null;
}

/** The next or previous match strictly after or before `from`, wrapping at both ends. */
export function stepMatch(matches: number[], from: number, dir: "next" | "prev"): Step | null {
  if (matches.length === 0) return null;
  const index = dir === "next" ? matches.find((m) => m > from) : [...matches].reverse().find((m) => m < from);
  if (index !== undefined) return { index, wrapped: false };
  return { index: dir === "next" ? matches[0]! : matches[matches.length - 1]!, wrapped: true };
}

/** The counter of the search: `3/12` (cursor row among the matches), `12` off a match, or `no match`. */
export function searchCounter(matches: number[], cursor: number): string {
  if (matches.length === 0) return "no match";
  const position = matches.indexOf(cursor);
  return `${position >= 0 ? `${position + 1}/` : ""}${matches.length}`;
}

/** The text of the search in the footer: `/query  3/12`, `/query  12` off a match, or `/query  no match`. */
export function searchLabel(query: string, matches: number[], cursor: number): string {
  return `/${query}  ${searchCounter(matches, cursor)}`;
}
