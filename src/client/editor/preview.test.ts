import { describe, expect, test } from "bun:test";
import { parseInline } from "../markdown/inline";
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

describe("autolinks", () => {
  test("an allowed autolink is a link node whose markers are the angle brackets", () => {
    for (const url of ["https://a.b/c", "http://a.b", "mailto:me@a.b", "obsidian://open?vault=v"]) {
      const s = `see <${url}> ok`;
      const found = nodes(s);
      expect(found.map((n) => n.kind)).toEqual(["link"]);
      expect(s.slice(found[0]!.from, found[0]!.to)).toBe(`<${url}>`);
      expect(found[0]!.markers.map(([a, b]) => s.slice(a, b))).toEqual(["<", ">"]);
    }
  });
  test("a refused scheme, plain angle brackets and a bare url give no node", () => {
    expect(nodes("<javascript:alert(1)>").length).toBe(0);
    expect(nodes("<data:text/html,x>").length).toBe(0);
    expect(nodes("a < b > c").length).toBe(0);
    expect(nodes("https://a.b").length).toBe(0);
  });
  test("an autolink keeps its neighbours intact", () => {
    expect(nodes("**b** <https://a.b> `c`").map((n) => n.kind)).toEqual(["strong", "link", "code"]);
  });
  test("an autolink inside a link label adds no node", () => {
    expect(nodes("[x <https://a.b> y](https://c.d)").map((n) => n.kind)).toEqual(["link"]);
  });
  test("the angle brackets are hidden away from the cursor and shown next to it", () => {
    const s = "see <https://a.b> ok";
    expect(hidden(s, 19)).toEqual(["<", ">"]);
    expect(hidden(s, 4)).toEqual([]);
    expect(hidden(s, 10)).toEqual([]);
    expect(hidden(s, 17)).toEqual([]);
  });
  test("the whole range is styled as a link", () => {
    const s = "see <https://a.b> ok";
    const styled = previewSpans(nodes(s), [{ from: 19, to: 19 }]).filter((x) => !x.hide);
    expect(styled.map((x) => [x.cls, s.slice(x.from, x.to)])).toEqual([["cm-md-link", "<https://a.b>"]]);
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

describe("highlights in the live preview (PRD 5.19)", () => {
  const spans = (s: string, at: number) => previewSpans(nodes(s), [{ from: at, to: at }]);

  test("finds a default and a colored highlight with their color", () => {
    expect(nodes("==a==").map((n) => [n.kind, n.color])).toEqual([["highlight", undefined]]);
    expect(nodes("==🔴a==").map((n) => [n.kind, n.color])).toEqual([["highlight", "red"]]);
  });

  test("the classes are those of the rendered highlight", () => {
    expect(spans("==🟢a==", 20).find((x) => !x.hide)?.cls).toBe("cm-md-highlight hl hl-green");
  });

  test("hides both markers and the emoji when the cursor is away, and shows them when it touches", () => {
    expect(hidden("==🔴a== tail", 11)).toEqual(["==🔴", "=="]);
    expect(hidden("==🔴a== tail", 3)).toEqual([]);
  });

  test("follows the rules of the renderer for the literal cases", () => {
    for (const s of ["==a", "====", "==🔴==", "a == b", "a == b == c", "\\==a=="]) expect(nodes(s)).toEqual([]);
  });

  test("holds and sits inside the other emphasis", () => {
    expect(nodes("==**a**==").map((n) => n.kind).sort()).toEqual(["highlight", "strong"]);
    expect(nodes("**==a==**").map((n) => n.kind).sort()).toEqual(["highlight", "strong"]);
  });
});

describe("the live preview and the renderer agree on highlights", () => {
  const rendered = (s: string): string[] => parseInline(s).flatMap(function walk(n): string[] {
    if (n.type === "highlight") return [n.color ?? "default"];
    return "children" in n ? n.children.flatMap(walk) : [];
  });
  const previewed = (s: string): string[] => nodes(s).filter((n) => n.kind === "highlight").map((n) => n.color ?? "default");
  const cases = [
    "==a==", "==🔴a==", "==🍎a==", "==a 🔴b==", "==🔴 a==", "==a", "====", "==🔴==", "a == b", "a == b == c",
    "==a == b==", "==a====", "==a===", "==🔴a=====", "===a===", "\\==a==", "\\===a==", "==a\\==", "==**a**==", "**==a==**",
    "==a== ==b==", "==🔴" + " ".repeat(15) + "a==", "1==2 and 3==4",
  ];
  for (const c of cases) test(JSON.stringify(c), () => expect(previewed(c)).toEqual(rendered(c)));
});
