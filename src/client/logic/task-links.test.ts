import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setVaultName } from "../markdown/inline";
import { linkRows, taskLinks, type TaskLink } from "./task-links";

afterEach(() => setVaultName(null));

describe("taskLinks", () => {
  test("a Markdown link gives its label and its URL", () => {
    expect(taskLinks("see [the docs](https://example.com/a) now")).toEqual([{ label: "the docs", url: "https://example.com/a" }]);
  });
  test("the label is the plain text of the link label", () => {
    expect(taskLinks("[**bold** and *it*](https://example.com)")).toEqual([{ label: "bold and it", url: "https://example.com" }]);
  });
  test("an autolink is labelled with its URL", () => {
    expect(taskLinks("<https://example.com/x>")).toEqual([{ label: "https://example.com/x", url: "https://example.com/x" }]);
  });
  test("mailto and obsidian links are accepted", () => {
    expect(taskLinks("[mail](mailto:a@example.com) [note](obsidian://open?vault=V&file=N)").map((l) => l.url)).toEqual([
      "mailto:a@example.com",
      "obsidian://open?vault=V&file=N",
    ]);
  });
  test("a refused scheme is ignored", () => {
    expect(taskLinks("[x](javascript:alert(1)) [y](ftp://example.com)")).toEqual([]);
  });
  test("a URL with whitespace is ignored", () => {
    expect(taskLinks("[x](https://example.com/a b)")).toEqual([]);
  });
  describe("wikilinks", () => {
    beforeEach(() => setVaultName("My Vault"));
    test("[[Note|alias]] is labelled with the alias and gives the obsidian URL", () => {
      expect(taskLinks("[[Note|the alias]]")).toEqual([{ label: "the alias", url: "obsidian://open?vault=My%20Vault&file=Note" }]);
    });
    test("[[Note]] is labelled with the note name", () => {
      expect(taskLinks("[[Note]]")).toEqual([{ label: "Note", url: "obsidian://open?vault=My%20Vault&file=Note" }]);
    });
    test("a wikilink is ignored in single-file mode", () => {
      setVaultName(null);
      expect(taskLinks("[[Note]]")).toEqual([]);
    });
  });
  test("links come in text order, one entry per occurrence", () => {
    const labels = taskLinks("[b](https://example.com/b) <https://example.com/a> [c](https://example.com/b)").map((l) => l.label);
    expect(labels).toEqual(["b", "https://example.com/a", "c"]);
    expect(taskLinks("[a](https://example.com) [a](https://example.com)")).toHaveLength(2);
  });
  test("a link inside bold, strikethrough or a highlight is found", () => {
    expect(taskLinks("**[a](https://example.com/1)** ~~[b](https://example.com/2)~~ ==[c](https://example.com/3)==").map((l) => l.label)).toEqual(["a", "b", "c"]);
  });
  test("a link inside a code span is not one", () => {
    expect(taskLinks("`[a](https://example.com)`")).toEqual([]);
  });
  test("a text with no link, or an empty one, gives an empty list", () => {
    expect(taskLinks("buy milk -> 2026-11-22")).toEqual([]);
    expect(taskLinks("")).toEqual([]);
  });
});

describe("linkRows", () => {
  const links: TaskLink[] = [
    { label: "Docs", url: "https://example.com/guide" },
    { label: "Tracker", url: "https://Issues.example.org/42" },
    { label: "Mail", url: "mailto:a@example.com" },
  ];
  test("an empty text keeps every link", () => {
    expect(linkRows(links, "")).toEqual([0, 1, 2]);
    expect(linkRows(links, "  ")).toEqual([0, 1, 2]);
  });
  test("it matches the label, ignoring case", () => {
    expect(linkRows(links, "tRaCk")).toEqual([1]);
  });
  test("it matches the URL, ignoring case", () => {
    expect(linkRows(links, "ISSUES.example")).toEqual([1]);
    expect(linkRows(links, "example")).toEqual([0, 1, 2]);
  });
  test("it gives the indexes in the order of the links", () => {
    expect(linkRows(links, "m")).toEqual([0, 1, 2]);
    expect(linkRows(links, "mailto")).toEqual([2]);
  });
  test("no match gives no row", () => {
    expect(linkRows(links, "zzz")).toEqual([]);
  });
  test("it does not change the links", () => {
    const copy = structuredClone(links);
    linkRows(links, "doc");
    expect(links).toEqual(copy);
  });
});
