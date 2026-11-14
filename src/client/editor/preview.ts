// Pure core of the live preview: which inline Markdown nodes exist, and which ranges to hide or style for a selection.
// It depends on the Lezer Markdown parser only, never on the DOM, so it can be unit-tested.
import type { Tree } from "@lezer/common";
import { Strikethrough, parser, type DelimiterType, type MarkdownConfig } from "@lezer/markdown";
import { highlightOpen, isAllowedUrl } from "../markdown/inline";
import { highlightClass, highlightColor, type HighlightColor } from "../logic/highlight";

const HighlightDelim: DelimiterType = { resolve: "Highlight", mark: "HighlightMark" };

/** The `==text==` and `==🔴text==` inline syntax of PRD 5.19. The opening mark covers the emoji and the space after it. */
const Highlight: MarkdownConfig = {
  defineNodes: [{ name: "Highlight" }, { name: "HighlightMark" }],
  parseInline: [
    {
      name: "Highlight",
      after: "Emphasis",
      parse(cx, next, pos) {
        // Only a run of exactly two `=` is a marker, as in the renderer.
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61 || cx.char(pos - 1) === 61) return -1;
        const spaceBefore = /\s|^$/.test(cx.slice(pos - 1, pos));
        const open = highlightOpen(cx.slice(pos, cx.end), 0);
        // The opener extends over the emoji and the spaces that follow it, up to the first content character.
        return cx.addDelimiter(HighlightDelim, pos, open ? pos + open.contentFrom : pos + 2, open !== null, !spaceBefore);
      },
    },
  ],
};

/** The parser restricted to the inline syntax of the PRD: no block syntax, no images, no entities, and no HTML node in the preview.
 * `HTMLTag` stays because it is also the parser of `<url>` autolinks, and a tag such as `<b>` is not a preview node. */
export const inlineParser = parser.configure([
  Strikethrough,
  Highlight,
  {
    remove: [
      "LinkReference", "IndentedCode", "FencedCode", "Blockquote", "HorizontalRule", "BulletList", "OrderedList",
      "ATXHeading", "SetextHeading", "HTMLBlock", "Entity", "Image",
    ],
  },
]);

export type Kind = "strong" | "em" | "code" | "strike" | "highlight" | "link";

/** An inline node: its whole range, and the ranges that are Markdown syntax (hidden when the selection is away). */
export type PreviewNode = { kind: Kind; from: number; to: number; markers: [number, number][]; color?: HighlightColor };

/** A decoration to apply: hide a range, or style it with a CSS class. */
export type Span = { from: number; to: number; hide: boolean; cls?: string };

const KINDS: Record<string, Kind> = {
  StrongEmphasis: "strong",
  Emphasis: "em",
  InlineCode: "code",
  Strikethrough: "strike",
  Highlight: "highlight",
  Link: "link",
  Autolink: "link",
};
const MARK_NAMES = new Set(["EmphasisMark", "CodeMark", "StrikethroughMark", "HighlightMark"]);

/** Collects the supported inline nodes of a parsed document. Links need an allowed URL, as in the renderer. */
export function collectNodes(tree: Tree, doc: string): PreviewNode[] {
  const nodes: PreviewNode[] = [];
  tree.iterate({
    enter(ref) {
      const kind = KINDS[ref.name];
      if (!kind) return;
      const node: PreviewNode = { kind, from: ref.from, to: ref.to, markers: [] };
      if (ref.name === "Autolink") {
        // `<url>`: the angle brackets are the markers, and the URL follows the same scheme rules as a link.
        // An autolink inside a link label is not drawn, as in the renderer.
        for (let p = ref.node.parent; p; p = p.parent) if (p.name === "Link") return;
        const url = ref.node.getChild("URL");
        if (!url || !isAllowedUrl(doc.slice(url.from, url.to))) return;
        node.markers.push([ref.from, ref.from + 1], [ref.to - 1, ref.to]);
      } else if (kind === "link") {
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
        if (kind === "highlight") {
          const color = highlightColor(String.fromCodePoint(doc.codePointAt(node.markers[0]![0] + 2) ?? 0));
          if (color) node.color = color;
        }
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
    spans.push({ from: n.from, to: n.to, hide: false, cls: n.kind === "highlight" ? `cm-md-highlight ${highlightClass(n.color)}` : `cm-md-${n.kind}` });
    if (touches(sel, n.from, n.to)) continue;
    for (const [from, to] of n.markers) if (to > from) spans.push({ from, to, hide: true });
  }
  return spans;
}
