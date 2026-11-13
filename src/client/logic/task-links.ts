// The links of a task text and the narrowing of the link picker opened by `gx` (PRD 5.20): pure functions, no DOM.
import { parseInline, type InlineNode } from "../markdown/inline";

export type TaskLink = { label: string; url: string };

const plainText = (nodes: InlineNode[]): string =>
  nodes.map((n) => (n.type === "text" || n.type === "code" || n.type === "due" ? n.value : plainText(n.children))).join("");

function collect(nodes: InlineNode[], out: TaskLink[]): void {
  for (const n of nodes) {
    if (n.type === "link") out.push({ label: plainText(n.children), url: n.href });
    else if (n.type !== "text" && n.type !== "code" && n.type !== "due") collect(n.children, out);
  }
}

/** The links that render as links in `text`, in text order, one entry per occurrence. */
export function taskLinks(text: string): TaskLink[] {
  const out: TaskLink[] = [];
  collect(parseInline(text), out);
  return out;
}

/** Indexes of the links whose label or URL contains the text, ignoring case, in order (all links for an empty text). */
export function linkRows(links: readonly TaskLink[], text: string): number[] {
  const needle = text.trim().toLowerCase();
  return links.flatMap((l, i) => (l.label.toLowerCase().includes(needle) || l.url.toLowerCase().includes(needle) ? [i] : []));
}
