// Pure core of the live preview: which inline Markdown nodes exist, and which ranges to hide or style for a selection.
// It depends on the Lezer Markdown parser only, never on the DOM, so it can be unit-tested.
import type { Tree } from "@lezer/common";
import { Strikethrough, parser } from "@lezer/markdown";
import { isAllowedUrl } from "../markdown/inline";

/** The parser restricted to the inline syntax of the PRD: no block syntax, no HTML, no images, no entities. */
export const inlineParser = parser.configure([
  Strikethrough,
  {
    remove: [
      "LinkReference", "IndentedCode", "FencedCode", "Blockquote", "HorizontalRule", "BulletList", "OrderedList",
      "ATXHeading", "SetextHeading", "HTMLBlock", "HTMLTag", "Entity", "Image",
    ],
  },
]);

export type Kind = "strong" | "em" | "code" | "strike" | "link";

/** An inline node: its whole range, and the ranges that are Markdown syntax (hidden when the selection is away). */
export type PreviewNode = { kind: Kind; from: number; to: number; markers: [number, number][] };

/** A decoration to apply: hide a range, or style it with a CSS class. */
export type Span = { from: number; to: number; hide: boolean; cls?: string };

const KINDS: Record<string, Kind> = {
  StrongEmphasis: "strong",
  Emphasis: "em",
  InlineCode: "code",
  Strikethrough: "strike",
  Link: "link",
};
const MARK_NAMES = new Set(["EmphasisMark", "CodeMark", "StrikethroughMark"]);

/** Collects the supported inline nodes of a parsed document. Links need an allowed URL, as in the renderer. */
export function collectNodes(tree: Tree, doc: string): PreviewNode[] {
  const nodes: PreviewNode[] = [];
  tree.iterate({
    enter(ref) {
      const kind = KINDS[ref.name];
      if (!kind) return;
      const node: PreviewNode = { kind, from: ref.from, to: ref.to, markers: [] };
      if (kind === "link") {
        const marks: number[] = [];
        let url: [number, number] | null = null;
        for (let c = ref.node.firstChild; c; c = c.nextSibling) {
          if (c.name === "LinkMark") marks.push(c.from);
          else if (c.name === "URL") url = [c.from, c.to];
        }
        // Expected shape: `[` label `]` `(` url `)`, so the marks are at least `[`, `]`, `(`, `)`.
        if (!url || marks.length < 4 || !isAllowedUrl(doc.slice(url[0], url[1]))) return;
        node.markers.push([marks[0]!, marks[0]! + 1], [marks[1]!, ref.to]);
      } else {
        for (let c = ref.node.firstChild; c; c = c.nextSibling) {
          if (MARK_NAMES.has(c.name)) node.markers.push([c.from, c.to]);
        }
        if (node.markers.length < 2) return;
      }
      nodes.push(node);
    },
  });
  return nodes;
}

/** True when a selection range is in or touching [from, to]. */
function touches(sel: readonly { from: number; to: number }[], from: number, to: number): boolean {
  return sel.some((r) => r.from <= to && r.to >= from);
}

/** Style spans for every node, plus hide spans for the markers of the nodes the selection is away from. */
export function previewSpans(nodes: PreviewNode[], sel: readonly { from: number; to: number }[]): Span[] {
  const spans: Span[] = [];
  for (const n of nodes) {
    spans.push({ from: n.from, to: n.to, hide: false, cls: `cm-md-${n.kind}` });
    if (touches(sel, n.from, n.to)) continue;
    for (const [from, to] of n.markers) if (to > from) spans.push({ from, to, hide: true });
  }
  return spans;
}
