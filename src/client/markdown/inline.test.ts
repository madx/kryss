import { describe, expect, test } from "bun:test";
import { astToHtml, isAllowedUrl, parseInline } from "./inline";

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
    expect(html("![alt](http://x.y/i.png)")).toBe(
      '!<a href="http://x.y/i.png" target="_blank" rel="noopener noreferrer">alt</a>',
    );
    expect(html("# not a heading")).toBe("# not a heading");
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
