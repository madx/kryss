import { describe, expect, test } from "bun:test";
import { astToHtml, findDueRange, isAllowedUrl, parseInline } from "./inline";

const html = (s: string) => astToHtml(parseInline(s));

describe("parseInline", () => {
  test("plain text and empty input", () => {
    expect(parseInline("")).toEqual([]);
    expect(parseInline("hello world")).toEqual([{ type: "text", value: "hello world" }]);
  });

  test("each supported syntax", () => {
    expect(html("**b**")).toBe("<strong>b</strong>");
    expect(html("*i*")).toBe("<em>i</em>");
    expect(html("_i_")).toBe("<em>i</em>");
    expect(html("`c`")).toBe("<code>c</code>");
    expect(html("~~s~~")).toBe("<del>s</del>");
    expect(html("[l](https://a.b/c)")).toBe(
      '<a href="https://a.b/c" target="_blank" rel="noopener noreferrer">l</a>',
    );
  });

  test("nesting and surrounding text", () => {
    expect(html("a **b *c* d** e")).toBe("a <strong>b <em>c</em> d</strong> e");
    expect(html("[**bold** link](http://x.y)")).toBe(
      '<a href="http://x.y" target="_blank" rel="noopener noreferrer"><strong>bold</strong> link</a>',
    );
  });

  test("code content is literal", () => {
    expect(html("`**not bold**`")).toBe("<code>**not bold**</code>");
    expect(html("**a `*` b**")).toBe("<strong>a <code>*</code> b</strong>");
  });

  test("unmatched markers are literal", () => {
    expect(html("**a")).toBe("**a");
    expect(html("a * b * c")).toBe("a * b * c");
    expect(html("`a")).toBe("`a");
    expect(html("~~a")).toBe("~~a");
    expect(html("[a](b")).toBe("[a](b");
    expect(html("2 * 3 * 4")).toBe("2 * 3 * 4");
    expect(html("****")).toBe("****");
  });

  test("underscores inside words are literal", () => {
    expect(html("snake_case_name")).toBe("snake_case_name");
  });

  test("raw HTML and images are literal text, escaped on output", () => {
    expect(html("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
    expect(html('<img src=x onerror="a()">')).toBe("&lt;img src=x onerror=&quot;a()&quot;&gt;");
    expect(html("# not a heading")).toBe("# not a heading");
  });

  test("images render as nothing", () => {
    expect(parseInline("![alt](http://x.y/i.png)")).toEqual([]);
    expect(parseInline("a ![alt](http://x.y/i.png) b")).toEqual([{ type: "text", value: "a  b" }]);
    expect(parseInline("![alt](javascript:x)")).toEqual([]);
    expect(html("**![a](http://x.y/i.png)b**")).toBe("<strong>b</strong>");
    expect(html("wow! [a](http://x.y)")).toBe('wow! <a href="http://x.y" target="_blank" rel="noopener noreferrer">a</a>');
  });

  test("backslash escapes", () => {
    expect(html("\\*a\\*")).toBe("*a*");
    expect(html("a \\\\ b")).toBe("a \\ b");
    expect(html("a \\q b")).toBe("a \\q b");
    expect(html("trailing \\")).toBe("trailing \\");
  });

  test("disallowed link targets render as the literal source text", () => {
    expect(html("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
    expect(html("[x](data:text/html,hi)")).toBe("[x](data:text/html,hi)");
    expect(html("[x](/relative)")).toBe("[x](/relative)");
    expect(parseInline("[x](javascript:a)")).toEqual([
      { type: "text", value: "[x](javascript:a)" },
    ]);
  });

  test("links are not nested", () => {
    expect(html("[a [b](http://x.y)](http://z.y)")).toBe(
      '<a href="http://z.y" target="_blank" rel="noopener noreferrer">a [b](http://x.y)</a>',
    );
  });

  test("parentheses in urls", () => {
    expect(html("[w](https://en.wikipedia.org/wiki/A_(b))")).toContain(
      'href="https://en.wikipedia.org/wiki/A_(b)"',
    );
  });

  test("attribute-breaking characters are escaped", () => {
    expect(html('[x](https://a.b/"onmouseover="y)')).toContain("&quot;");
    expect(html('[x](https://a.b/"onmouseover="y)')).not.toContain('"onmouseover');
  });
});

describe("isAllowedUrl", () => {
  test.each([
    "http://a.b",
    "https://a.b",
    "HTTPS://A.B",
    "mailto:a@b.c",
    "obsidian://open?vault=v&file=f",
    "Obsidian://open",
  ])("allows %s", (u) => expect(isAllowedUrl(u)).toBe(true));

  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    " javascript:alert(1)",
    "\u0001javascript:alert(1)",
    "java\u0000script:alert(1)",
    "​javascript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "file:///etc/passwd",
    "//evil.com",
    "/path",
    "relative",
    "",
    "httpx://a.b",
    "http//a.b",
  ])("refuses %j", (u) => expect(isAllowedUrl(u)).toBe(false));
});

describe("parseInline: due dates", () => {
  const due = (value: string) => ({ type: "due" as const, value });
  test("a trailing valid date becomes a due node", () => {
    expect(parseInline("Buy milk -> 2026-11-22")).toEqual([{ type: "text", value: "Buy milk " }, due("2026-11-22")]);
  });
  test("weeks and quarters are recognized, with text after the date", () => {
    expect(parseInline("a -> 2026-W47 b")).toEqual([{ type: "text", value: "a " }, due("2026-W47"), { type: "text", value: " b" }]);
    expect(parseInline("a -> 2026-Q4")).toEqual([{ type: "text", value: "a " }, due("2026-Q4")]);
  });
  test("the marker can be at the start of the text", () => {
    expect(parseInline("-> 2026-11-22")).toEqual([due("2026-11-22")]);
  });
  test("the marker needs whitespace before it and one space after it", () => {
    expect(parseInline("a->  2026-11-22")).toEqual([{ type: "text", value: "a->  2026-11-22" }]);
    expect(parseInline("a-> 2026-11-22")).toEqual([{ type: "text", value: "a-> 2026-11-22" }]);
    expect(parseInline("a ->2026-11-22")).toEqual([{ type: "text", value: "a ->2026-11-22" }]);
    expect(parseInline("a ->  2026-11-22")).toEqual([{ type: "text", value: "a ->  2026-11-22" }]);
  });
  test("the date must end at whitespace or at the end", () => {
    expect(parseInline("a -> 2026-11-22x")).toEqual([{ type: "text", value: "a -> 2026-11-22x" }]);
    expect(parseInline("a -> 2026-11-22.")).toEqual([{ type: "text", value: "a -> 2026-11-22." }]);
  });
  test("an invalid date and a prose arrow stay literal", () => {
    expect(parseInline("a -> 2026-02-30")).toEqual([{ type: "text", value: "a -> 2026-02-30" }]);
    expect(parseInline("A -> B")).toEqual([{ type: "text", value: "A -> B" }]);
  });
  test("only the last valid date counts, earlier ones stay literal", () => {
    expect(parseInline("a -> 2026-11-01 b -> 2026-11-22")).toEqual([
      { type: "text", value: "a -> 2026-11-01 b " }, due("2026-11-22"),
    ]);
  });
  test("an invalid date after a valid one does not hide it", () => {
    expect(parseInline("a -> 2026-11-01 b -> 2026-02-30")).toEqual([
      { type: "text", value: "a " }, due("2026-11-01"), { type: "text", value: " b -> 2026-02-30" },
    ]);
  });
  test("a date inside a code span stays literal", () => {
    expect(parseInline("`a -> 2026-11-22`")).toEqual([{ type: "code", value: "a -> 2026-11-22" }]);
    expect(parseInline("`x -> 2026-11-22` -> 2026-12-01")).toEqual([
      { type: "code", value: "x -> 2026-11-22" }, { type: "text", value: " " }, due("2026-12-01"),
    ]);
  });
  test("a date inside a link label stays literal", () => {
    expect(html("[a -> 2026-11-22](https://x.y)")).toBe(
      '<a href="https://x.y" target="_blank" rel="noopener noreferrer">a -&gt; 2026-11-22</a>',
    );
  });
  test("other inline syntax still works around a date", () => {
    expect(parseInline("**b** -> 2026-11-22")).toEqual([
      { type: "strong", children: [{ type: "text", value: "b" }] }, { type: "text", value: " " }, due("2026-11-22"),
    ]);
  });
});

describe("findDueRange", () => {
  test("gives the range of the last valid `-> DATE`, with the date text", () => {
    expect(findDueRange("Renew -> 2026-12-01")).toEqual({ from: 6, to: 19, dateFrom: 9, value: "2026-12-01" });
    expect(findDueRange("a -> 2026-11-01 b -> 2026-W47 c")).toEqual({ from: 18, to: 29, dateFrom: 21, value: "2026-W47" });
  });
  test("null without a valid date, for a bare arrow or a prose arrow", () => {
    expect(findDueRange("a ->")).toBeNull();
    expect(findDueRange("A -> B")).toBeNull();
    expect(findDueRange("a -> 2026-02-30")).toBeNull();
    expect(findDueRange("a->2026-11-22")).toBeNull();
  });
  test("agrees with the parser: code spans, link labels and emphasis are literal", () => {
    expect(findDueRange("`run -> 2026-11-22 now`")).toBeNull();
    expect(findDueRange("[x -> 2026-11-22 y](https://a.b)")).toBeNull();
    expect(findDueRange("**a -> 2026-11-22**")).toBeNull();
  });
  test("a valid date after a bare arrow is found", () => {
    expect(findDueRange("a -> -> 2026-11-22")).toEqual({ from: 5, to: 18, dateFrom: 8, value: "2026-11-22" });
    expect(parseInline("a -> -> 2026-11-22")).toEqual([{ type: "text", value: "a -> " }, { type: "due", value: "2026-11-22" }]);
  });
  test("a date inside emphasis is plain text", () => {
    expect(parseInline("**a -> 2026-11-22**")).toEqual([
      { type: "strong", children: [{ type: "text", value: "a -> 2026-11-22" }] },
    ]);
  });
});

describe("autolinks", () => {
  test("<https://example.com> is a link whose label is the URL", () => {
    expect(parseInline("see <https://example.com/a?b=1> now")).toEqual([
      { type: "text", value: "see " },
      { type: "link", href: "https://example.com/a?b=1", children: [{ type: "text", value: "https://example.com/a?b=1" }] },
      { type: "text", value: " now" },
    ]);
  });
  test("follows the scheme allow-list", () => {
    expect(parseInline("<mailto:a@b.test>")[0]?.type).toBe("link");
    expect(parseInline("<obsidian://open?vault=v>")[0]?.type).toBe("link");
    expect(parseInline("<HTTP://EXAMPLE.COM>")[0]?.type).toBe("link");
  });
  test("<javascript:…> and other refused schemes stay literal", () => {
    expect(parseInline("<javascript:alert(1)>")).toEqual([{ type: "text", value: "<javascript:alert(1)>" }]);
    expect(parseInline("<data:text/html,x>")).toEqual([{ type: "text", value: "<data:text/html,x>" }]);
  });
  test("not an autolink: spaces, unclosed, no scheme, empty", () => {
    for (const s of ["<https://a.test b>", "<https://a.test", "<b>", "<>", "a < b > c"]) {
      expect(parseInline(s).every((n) => n.type === "text")).toBe(true);
    }
  });
  test("no autolink inside a label", () => {
    expect(parseInline("[<https://a.test>](https://b.test)")).toEqual([
      { type: "link", href: "https://b.test", children: [{ type: "text", value: "<https://a.test>" }] },
    ]);
  });
});

describe("highlights (PRD 5.19)", () => {
  test("the default and each of the six colors", () => {
    expect(html("==a==")).toBe('<mark class="hl">a</mark>');
    const colors = { "🔴": "red", "🟠": "orange", "🟡": "yellow", "🟢": "green", "🔵": "blue", "🟣": "purple" };
    for (const [emoji, color] of Object.entries(colors)) {
      expect(html(`==${emoji}a==`)).toBe(`<mark class="hl hl-${color}">a</mark>`);
    }
  });

  test("the node carries an optional color", () => {
    expect(parseInline("==🔴a==")).toEqual([{ type: "highlight", color: "red", children: [{ type: "text", value: "a" }] }]);
    expect(parseInline("==a==")).toEqual([{ type: "highlight", children: [{ type: "text", value: "a" }] }]);
  });

  test("another emoji or a circle further in is content in the default color", () => {
    expect(html("==🍎a==")).toBe('<mark class="hl">🍎a</mark>');
    expect(html("==a 🔴b==")).toBe('<mark class="hl">a 🔴b</mark>');
  });

  test("a space after the emoji is trimmed", () => {
    expect(html("==🔴 a==")).toBe('<mark class="hl hl-red">a</mark>');
  });

  test("text around a highlight is kept", () => {
    expect(html("x ==🟢a b== y")).toBe('x <mark class="hl hl-green">a b</mark> y');
  });

  test("an unclosed pair stays literal", () => {
    expect(html("==a")).toBe("==a");
    expect(html("==🔴a")).toBe("==🔴a");
  });

  test("an empty content stays literal and keeps the emoji", () => {
    expect(html("====")).toBe("====");
    expect(html("==🔴==")).toBe("==🔴==");
  });

  test("an escaped marker is literal", () => {
    expect(html("\\==a==")).toBe("==a==");
  });

  test("a comparison is not a highlight", () => {
    expect(html("a == b")).toBe("a == b");
    expect(html("a == b == c")).toBe("a == b == c");
  });

  test("it holds bold, italic, code, strikethrough and links", () => {
    expect(html("==**a** *b* `c` ~~d~~==")).toBe('<mark class="hl"><strong>a</strong> <em>b</em> <code>c</code> <del>d</del></mark>');
    expect(html("==[l](http://x.y)==")).toBe(
      '<mark class="hl"><a href="http://x.y" target="_blank" rel="noopener noreferrer">l</a></mark>',
    );
  });

  test("it sits inside bold, italic, strikethrough and links", () => {
    expect(html("**==a==**")).toBe('<strong><mark class="hl">a</mark></strong>');
    expect(html("*==🔴a==*")).toBe('<em><mark class="hl hl-red">a</mark></em>');
    expect(html("~~==a==~~")).toBe('<del><mark class="hl">a</mark></del>');
    expect(html("[==a==](http://x.y)")).toBe(
      '<a href="http://x.y" target="_blank" rel="noopener noreferrer"><mark class="hl">a</mark></a>',
    );
  });

  test("highlights do not nest", () => {
    expect(html("==a ==b== c==")).toBe('<mark class="hl">a ==b</mark> c==');
  });

  test("a due date inside is plain text", () => {
    expect(html("==a -> 2026-11-22==")).toBe('<mark class="hl">a -> 2026-11-22</mark>');
    expect(findDueRange("==a -> 2026-11-22==")).toBeNull();
  });
});
