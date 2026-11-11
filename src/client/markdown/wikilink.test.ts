import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { astToHtml, parseInline, setVaultName } from "./inline";

const html = (s: string) => astToHtml(parseInline(s));
const a = (href: string, label: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

beforeEach(() => setVaultName("My Vault"));
afterEach(() => setVaultName(null));

describe("wikilinks in the inline parser", () => {
  test("[[Note]] is a link labelled with the note name", () => {
    expect(html("see [[Note]] now")).toBe("see " + a("obsidian://open?vault=My%20Vault&amp;file=Note", "Note") + " now");
  });
  test("[[Note|alias]] is labelled with the alias and targets the note", () => {
    expect(parseInline("[[Note|the alias]]")).toEqual([
      { type: "link", href: "obsidian://open?vault=My%20Vault&file=Note", children: [{ type: "text", value: "the alias" }] },
    ]);
  });
  test("the target is URL-encoded, with its folder and special characters", () => {
    const [node] = parseInline("[[Folder/Café & more]]");
    expect(node).toMatchObject({ type: "link", href: "obsidian://open?vault=My%20Vault&file=Folder%2FCaf%C3%A9%20%26%20more" });
  });
  test("the heading form shows Note > Heading and passes the target as it is", () => {
    expect(parseInline("[[Note#Heading]]")).toEqual([
      { type: "link", href: "obsidian://open?vault=My%20Vault&file=Note%23Heading", children: [{ type: "text", value: "Note > Heading" }] },
    ]);
  });
  test("the block form shows Note > ^block", () => {
    expect(parseInline("[[Note#^abc123]]")).toMatchObject([{ type: "link", children: [{ type: "text", value: "Note > ^abc123" }] }]);
  });
  test("an alias replaces the label of the heading form", () => {
    expect(parseInline("[[Note#Heading|short]]")).toMatchObject([
      { type: "link", href: "obsidian://open?vault=My%20Vault&file=Note%23Heading", children: [{ type: "text", value: "short" }] },
    ]);
  });
  test("an empty alias falls back to the label of the target", () => {
    expect(parseInline("[[Note|]]")).toMatchObject([{ type: "link", children: [{ type: "text", value: "Note" }] }]);
  });
  test("works inside bold and next to other links", () => {
    expect(html("**[[A]]** [x](https://e.com)")).toContain("<strong>" + a("obsidian://open?vault=My%20Vault&amp;file=A", "A") + "</strong>");
  });

  test.each(["[[]]", "[[ ]]", "[[|alias]]", "[[a|b", "[[a", "[a]]", "[[a[b]]", "[[a]b]]", "[[a|b]c]]"])("%p stays literal text", (s) => {
    expect(parseInline(s)).toEqual([{ type: "text", value: s }]);
  });
  test("an escaped bracket stays literal", () => {
    expect(parseInline("\\[[Note]]")).toEqual([{ type: "text", value: "[[Note]]" }]);
  });
  test("a wikilink is not parsed inside a Markdown link label", () => {
    expect(html("[[[Note]]](https://e.com)")).not.toContain("obsidian:");
  });
  test("a Markdown link is untouched", () => {
    expect(html("[a](https://e.com)")).toBe(a("https://e.com", "a"));
  });
  test("no vault name (single-file mode): wikilinks are literal text", () => {
    setVaultName(null);
    expect(parseInline("[[Note]] and [[Note|alias]]")).toEqual([{ type: "text", value: "[[Note]] and [[Note|alias]]" }]);
  });
});
