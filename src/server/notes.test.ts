import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAliases, readObsidianSettings, scanNotes } from "./notes";

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kryss-notes-"));
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

const put = (rel: string, content: string) => {
  const path = join(vault, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
};
const fm = (body: string) => `---\n${body}\n---\n`;
const DEFAULTS = { newLinkFormat: "shortest" as const, userIgnoreFilters: [] };

describe("parseAliases", () => {
  test("a YAML list", () => {
    expect(parseAliases(fm("aliases:\n  - One\n  - \"Two, too\"\n  - 'Three'"))).toEqual(["One", "Two, too", "Three"]);
  });
  test("a list that is not indented", () => {
    expect(parseAliases(fm("aliases:\n- One\n- Two\ntags: x"))).toEqual(["One", "Two"]);
  });
  test("an inline array", () => {
    expect(parseAliases(fm("aliases: [One, \"Two, too\", 'Three']"))).toEqual(["One", "Two, too", "Three"]);
  });
  test("a single string", () => {
    expect(parseAliases(fm("aliases: Only one"))).toEqual(["Only one"]);
    expect(parseAliases(fm("aliases: \"Quoted\""))).toEqual(["Quoted"]);
  });
  test("empty values, other keys and no frontmatter", () => {
    expect(parseAliases(fm("aliases:"))).toEqual([]);
    expect(parseAliases(fm("aliases: []"))).toEqual([]);
    expect(parseAliases(fm("title: x\ntags:\n  - a"))).toEqual([]);
    expect(parseAliases("")).toEqual([]);
  });
  test("a nested key named aliases is not the key", () => {
    expect(parseAliases(fm("meta:\n  aliases: no"))).toEqual([]);
  });
  test("the list stops at the next key", () => {
    expect(parseAliases(fm("aliases:\n  - A\ntags:\n  - B"))).toEqual(["A"]);
  });
});

describe("readObsidianSettings", () => {
  test("defaults when app.json is missing", async () => {
    expect(await readObsidianSettings(vault)).toEqual(DEFAULTS);
  });
  test("defaults when it is malformed or not an object", async () => {
    put(".obsidian/app.json", "{ nope");
    expect(await readObsidianSettings(vault)).toEqual(DEFAULTS);
    put(".obsidian/app.json", "[1]");
    expect(await readObsidianSettings(vault)).toEqual(DEFAULTS);
  });
  test.each(["shortest", "relative", "absolute"])("reads newLinkFormat %p", async (format) => {
    put(".obsidian/app.json", JSON.stringify({ newLinkFormat: format, useMarkdownLinks: true }));
    expect((await readObsidianSettings(vault)).newLinkFormat).toBe(format as never);
  });
  test("an unknown newLinkFormat or a wrong type means the default", async () => {
    put(".obsidian/app.json", JSON.stringify({ newLinkFormat: "weird", userIgnoreFilters: "x" }));
    expect(await readObsidianSettings(vault)).toEqual(DEFAULTS);
  });
  test("reads userIgnoreFilters and drops non-strings", async () => {
    put(".obsidian/app.json", JSON.stringify({ userIgnoreFilters: ["Private/", "Old", 3] }));
    expect((await readObsidianSettings(vault)).userIgnoreFilters).toEqual(["Private/", "Old"]);
  });
});

describe("scanNotes", () => {
  test("lists every Markdown file with name, path without extension and aliases, sorted by path", async () => {
    put("b.md", fm("aliases: [Bee]"));
    put("Folder/A note.md", "no frontmatter\n");
    put("Folder/image.png", "x");
    put("Folder/readme.txt", "x");
    expect(await scanNotes(vault)).toEqual({
      newLinkFormat: "shortest",
      notes: [
        { name: "b", path: "b", aliases: ["Bee"] },
        { name: "A note", path: "Folder/A note", aliases: [] },
      ],
    });
  });
  test("includes files that do not opt in to Kryss", async () => {
    put("plain.md", "# Title\n");
    put("kryss.md", fm("kryss-enabled: true"));
    expect((await scanNotes(vault)).notes.map((x) => x.path)).toEqual(["kryss", "plain"]);
  });
  test("skips dot folders", async () => {
    put(".obsidian/x.md", "");
    put(".trash/y.md", "");
    put("ok.md", "");
    expect((await scanNotes(vault)).notes.map((x) => x.path)).toEqual(["ok"]);
  });
  test("skips the folders of userIgnoreFilters, with or without a trailing slash, but not a similar name", async () => {
    put(".obsidian/app.json", JSON.stringify({ userIgnoreFilters: ["Private/", "Old/Deep"] }));
    put("Private/a.md", "");
    put("Private/Sub/b.md", "");
    put("Old/Deep/c.md", "");
    put("Old/d.md", "");
    put("PrivateNotes/e.md", "");
    expect((await scanNotes(vault)).notes.map((x) => x.path)).toEqual(["Old/d", "PrivateNotes/e"]);
  });
  test("two notes with one name both appear", async () => {
    put("A/Same.md", "");
    put("B/Same.md", "");
    expect((await scanNotes(vault)).notes.map((x) => x.path)).toEqual(["A/Same", "B/Same"]);
  });
  test("returns the newLinkFormat of app.json", async () => {
    put(".obsidian/app.json", JSON.stringify({ newLinkFormat: "absolute" }));
    expect((await scanNotes(vault)).newLinkFormat).toBe("absolute");
  });
  test("an unclosed frontmatter gives no aliases", async () => {
    put("x.md", "---\naliases: [A]\n");
    expect((await scanNotes(vault)).notes[0]!.aliases).toEqual([]);
  });
});
