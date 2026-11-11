import { describe, expect, test } from "bun:test";
import { buildLabel, iconRef, matchLink, pasteInsertion, singleUrl, type LinkRule } from "./links";

const jira: LinkRule = { match: "^https://[^/]+\\.atlassian\\.net/browse/([A-Z]+-\\d+)", label: "$1", icon: "jira" };
const github: LinkRule = { match: "^https://github\\.com/([^/]+)/([^/]+)/(?:issues|pull)/(\\d+)", label: "$1/$2#$3" };

describe("buildLabel", () => {
  test("fills the capture groups", () => {
    expect(buildLabel("$2 ($1)", ["x", "a", "b"])).toBe("b (a)");
  });
  test("a missing or unmatched group is empty", () => {
    expect(buildLabel("[$3]", ["x", "a"])).toBe("[]");
    expect(buildLabel("$1", ["x", undefined as unknown as string])).toBe("");
  });
  test("$0 is the whole match and a template without group is kept", () => {
    expect(buildLabel("$0", ["whole"])).toBe("whole");
    expect(buildLabel("Docs", [])).toBe("Docs");
  });
});

describe("matchLink", () => {
  const url = "https://acme.atlassian.net/browse/PROJ-123?x=1";
  test("returns the label and the icon of the matching rule", () => {
    expect(matchLink(url, [jira])).toEqual({ label: "PROJ-123", icon: "jira" });
  });
  test("returns no icon when the rule has none", () => {
    expect(matchLink("https://github.com/o/r/pull/7", [github])).toEqual({ label: "o/r#7", icon: undefined });
  });
  test("the first matching rule wins", () => {
    const first: LinkRule = { match: "atlassian", label: "first" };
    expect(matchLink(url, [first, jira])?.label).toBe("first");
    expect(matchLink(url, [jira, first])?.label).toBe("PROJ-123");
  });
  test("no match, no rules", () => {
    expect(matchLink("https://example.com", [jira, github])).toBeNull();
    expect(matchLink(url, [])).toBeNull();
  });
  test("an invalid regex or missing field is skipped", () => {
    const bad = [{ match: "(", label: "x" }, { label: "x" }, { match: "atlassian" }, { match: 3, label: "x" }] as unknown as LinkRule[];
    expect(matchLink(url, [...bad, jira])?.label).toBe("PROJ-123");
    expect(matchLink(url, bad)).toBeNull();
  });
  test("a rule whose label is empty does not match", () => {
    expect(matchLink(url, [{ match: "atlassian", label: "$5" }])).toBeNull();
  });
  test("an icon that is not a string is dropped", () => {
    expect(matchLink(url, [{ ...jira, icon: 4 as unknown as string }])?.icon).toBeUndefined();
  });
});

describe("iconRef", () => {
  test("a Lucide name", () => {
    expect(iconRef("jira")).toEqual({ kind: "lucide", name: "jira" });
    expect(iconRef("arrow-up-right-2")).toEqual({ kind: "lucide", name: "arrow-up-right-2" });
  });
  test("a data:image/svg+xml URL", () => {
    const url = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'></svg>";
    expect(iconRef(url)).toEqual({ kind: "data", url });
    expect(iconRef("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")?.kind).toBe("data");
  });
  test("refused values", () => {
    const refused = [
      "", "Jira", "a b", "../x", "a/b", "https://x.test/i.svg", "javascript:alert(1)", "data:text/html,<script>",
      "data:image/png;base64,AAAA", 'data:image/svg+xml,"); background:url(x', "data:image/svg+xml,a\\b", "data:image/svg+xml,a\nb",
      undefined, null, 3,
    ];
    for (const v of refused) expect(iconRef(v)).toBeNull();
  });
});

describe("singleUrl", () => {
  test("accepts one http or https URL, trimmed", () => {
    expect(singleUrl("  https://example.com/a?b=1#c \n")).toBe("https://example.com/a?b=1#c");
    expect(singleUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
  test("refuses everything else", () => {
    const refused = [
      "", "hello", "two https://a.test https://b.test", "https://a.test b", "ftp://a.test", "mailto:a@b.test", "javascript:alert(1)",
      "https://", "https:/a.test", "obsidian://open?vault=x", "https://a.test\nhttps://b.test",
    ];
    for (const v of refused) expect(singleUrl(v)).toBeNull();
  });
});

describe("pasteInsertion", () => {
  const rules = [jira];
  test("not a single URL is left to the native paste", () => {
    expect(pasteInsertion("some text", "", rules)).toBeNull();
    expect(pasteInsertion("some text", "sel", rules)).toBeNull();
    expect(pasteInsertion("ftp://a.test", "", rules)).toBeNull();
  });
  test("a selection becomes the label, whatever the rules say", () => {
    expect(pasteInsertion("https://acme.atlassian.net/browse/PROJ-1", "the ticket", rules)).toBe("[the ticket](https://acme.atlassian.net/browse/PROJ-1)");
    expect(pasteInsertion("https://example.com", "sel", [])).toBe("[sel](https://example.com)");
  });
  test("with no selection a matching rule gives its label", () => {
    expect(pasteInsertion(" https://acme.atlassian.net/browse/PROJ-1\n", "", rules)).toBe("[PROJ-1](https://acme.atlassian.net/browse/PROJ-1)");
  });
  test("with no selection and no rule the URL becomes an autolink", () => {
    expect(pasteInsertion("https://example.com/x", "", rules)).toBe("<https://example.com/x>");
    expect(pasteInsertion("  https://example.com/x\n", "", [])).toBe("<https://example.com/x>");
  });
  test("brackets in a label are escaped", () => {
    expect(pasteInsertion("https://example.com", "a [b] c", [])).toBe("[a \\[b\\] c](https://example.com)");
  });
  test("unbalanced parentheses of the URL are encoded, balanced ones kept", () => {
    expect(pasteInsertion("https://example.com/a)b", "x", [])).toBe("[x](https://example.com/a%29b)");
    expect(pasteInsertion("https://example.com/a_(b)", "x", [])).toBe("[x](https://example.com/a_(b))");
  });
});
