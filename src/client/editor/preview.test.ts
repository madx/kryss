import { describe, expect, test } from "bun:test";
import { collectNodes, inlineParser, previewSpans } from "./preview";

const nodes = (s: string) => collectNodes(inlineParser.parse(s), s);
const hidden = (s: string, at: number) =>
  previewSpans(nodes(s), [{ from: at, to: at }])
    .filter((x) => x.hide)
    .map((x) => s.slice(x.from, x.to));

describe("collectNodes", () => {
  test("finds the supported inline nodes", () => {
    const kinds = nodes("**a** *b* _c_ `d` ~~e~~ [f](https://x.y)").map((n) => n.kind);
    expect(kinds).toEqual(["strong", "em", "em", "code", "strike", "link"]);
  });
  test("ignores block syntax, images and refused links", () => {
    expect(nodes("# title").length).toBe(0);
    expect(nodes("- item").length).toBe(0);
    expect(nodes("    **x**").map((n) => n.kind)).toEqual(["strong"]);
    expect(nodes("[a](javascript:alert(1))").length).toBe(0);
    expect(nodes("<b>x</b>").length).toBe(0);
  });
  test("a snake_case word is not italic", () => {
    expect(nodes("snake_case_word").length).toBe(0);
  });
});

describe("previewSpans", () => {
  test("hides markers when the cursor is away", () => {
    expect(hidden("**bold** tail", 12)).toEqual(["**", "**"]);
  });
  test("shows markers when the cursor is in or touching the node", () => {
    expect(hidden("**bold** tail", 0)).toEqual([]);
    expect(hidden("**bold** tail", 4)).toEqual([]);
    expect(hidden("**bold** tail", 8)).toEqual([]);
  });
  test("a link hides its brackets and url, label stays", () => {
    expect(hidden("see [x](https://a.b) ok", 0)).toEqual(["[", "](https://a.b)"]);
  });
  test("a selection touching the node shows its markers", () => {
    const s = "a `c` b";
    const spans = previewSpans(nodes(s), [{ from: 0, to: 3 }]);
    expect(spans.some((x) => x.hide)).toBe(false);
  });
});
