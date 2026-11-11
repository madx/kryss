import { describe, expect, test } from "bun:test";
import type { SavedFilter } from "../shared/types";
import { parse, withFrontmatter } from "./markdown";

const filtersOf = (md: string) => {
  const r = parse(md);
  if (!r.ok) throw new Error(`unexpected error: ${JSON.stringify(r.error)}`);
  return r.doc.filters;
};
const err = (md: string) => {
  const r = parse(md);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};
const write = (current: string, filters: SavedFilter[], markdown = "## L\n") => withFrontmatter(current, markdown, filters);

const A = { name: "A", text: "list:Work" };
const B = { name: "B", text: "is:todo" };

describe("reading the filters block", () => {
  test("no frontmatter, no key or an empty key means no filters", () => {
    expect(filtersOf("## L\n")).toEqual([]);
    expect(filtersOf("---\ntitle: x\n---\n## L\n")).toEqual([]);
    expect(filtersOf("---\nkryss-filters:\n---\n## L\n")).toEqual([]);
  });

  test("reads the filters in file order and ignores the other keys", () => {
    const md = '---\ntitle: x\nkryss-filters:\n  "A": "list:Work"\n  "B": "is:todo"\ntags: [a]\n---\n\n## L\n';
    expect(filtersOf(md)).toEqual([A, B]);
  });

  test("a block runs to the closing delimiter", () => {
    expect(filtersOf('---\nkryss-filters:\n  "A": "list:Work"\n...\n## L\n')).toEqual([A]);
  });

  test("reads JSON escapes, colons and unicode", () => {
    expect(filtersOf('---\nkryss-filters:\n  "a \\"q\\": é": "due:2026-11-11 \\"x y\\""\n---\n')).toEqual([{ name: 'a "q": é', text: 'due:2026-11-11 "x y"' }]);
  });

  test("tolerates CRLF line endings", () => {
    expect(filtersOf('---\r\nkryss-filters:\r\n  "A": "list:Work"\r\n---\r\n## L\r\n')).toEqual([A]);
  });

  test("rejects a second filters key, with the line of the second", () => {
    expect(err('---\nkryss-filters:\n  "A": "x"\ntitle: y\nkryss-filters:\n---\n')).toMatchObject({ line: 5 });
  });

  test("rejects a line that is not a name and a text, with its line", () => {
    expect(err('---\nkryss-filters:\n  "A": "x"\n  nope\n---\n')).toMatchObject({ line: 4 });
    expect(err('---\nkryss-filters:\n  "A": x\n---\n')).toMatchObject({ line: 3 });
    expect(err('---\nkryss-filters:\n  "A" "x"\n---\n')).toMatchObject({ line: 3 });
    expect(err('---\nkryss-filters:\n  "A": "x" "y"\n---\n')).toMatchObject({ line: 3 });
  });

  test("rejects an empty name or an empty text", () => {
    expect(err('---\nkryss-filters:\n  "": "x"\n---\n')).toMatchObject({ line: 3 });
    expect(err('---\nkryss-filters:\n  "A": ""\n---\n')).toMatchObject({ line: 3 });
    expect(err('---\nkryss-filters:\n  "A": "  "\n---\n')).toMatchObject({ line: 3 });
  });

  test("rejects a duplicate name, with the line of the second", () => {
    expect(err('---\nkryss-filters:\n  "A": "x"\n  "A": "y"\n---\n')).toMatchObject({ line: 4 });
  });

  test("rejects another YAML style instead of rewriting it", () => {
    expect(err('---\nkryss-filters: {"A": "x"}\n---\n')).toMatchObject({ line: 2 });
    expect(err("---\nkryss-filters:\n  'A': 'x'\n---\n")).toMatchObject({ line: 3 });
    expect(err("---\nkryss-filters:\n  - A\n---\n")).toMatchObject({ line: 3 });
  });

  test("error lines count the frontmatter lines of a file with a filters block", () => {
    expect(err('---\nkryss-filters:\n  "A": "x"\n---\n## L\nhello\n')).toMatchObject({ line: 6 });
  });
});

describe("writing the filters block", () => {
  const withBlock = '---\ntitle:   x \nkryss-filters:\n  "A": "list:Work"\ntags: [a]\n---\n\n';

  test("unchanged filters leave the frontmatter byte for byte, whatever the spacing", () => {
    const odd = '---\nkryss-filters:\n   "A":   "list:Work"  \n---\n\n';
    expect(write(odd, [A])).toBe(odd + "## L\n");
    expect(write(withBlock, [A])).toBe(withBlock + "## L\n");
  });

  test("changed filters replace the block in place", () => {
    expect(write(withBlock, [A, B])).toBe('---\ntitle:   x \nkryss-filters:\n  "A": "list:Work"\n  "B": "is:todo"\ntags: [a]\n---\n\n## L\n');
    expect(write(withBlock, [{ name: "A", text: "new" }])).toBe('---\ntitle:   x \nkryss-filters:\n  "A": "new"\ntags: [a]\n---\n\n## L\n');
  });

  test("adds the block before the closing delimiter when the key was absent", () => {
    expect(write("---\ntitle: x\n---\n\n", [A])).toBe('---\ntitle: x\nkryss-filters:\n  "A": "list:Work"\n---\n\n## L\n');
    expect(write("---\n---\n", [A])).toBe('---\nkryss-filters:\n  "A": "list:Work"\n---\n## L\n');
    expect(write("---\ntitle: x\n...\n", [A])).toBe('---\ntitle: x\nkryss-filters:\n  "A": "list:Work"\n...\n## L\n');
  });

  test("an added block follows the line endings of the frontmatter", () => {
    expect(write("---\r\ntitle: x\r\n---\r\n", [A])).toBe('---\r\ntitle: x\r\nkryss-filters:\r\n  "A": "list:Work"\r\n---\r\n## L\n');
  });

  test("deleting the last filter removes the key and keeps the other lines", () => {
    expect(write(withBlock, [])).toBe("---\ntitle:   x \ntags: [a]\n---\n\n## L\n");
  });

  test("deleting the last filter of a frontmatter that holds nothing else removes the frontmatter", () => {
    expect(write('---\nkryss-filters:\n  "A": "x"\n---\n\n', [])).toBe("## L\n");
  });

  test("an empty key with no filters is left alone, and one with filters is filled", () => {
    expect(write("---\nkryss-filters:\ntitle: x\n---\n", [])).toBe("---\nkryss-filters:\ntitle: x\n---\n## L\n");
    expect(write("---\nkryss-filters:\ntitle: x\n---\n", [A])).toBe('---\nkryss-filters:\n  "A": "list:Work"\ntitle: x\n---\n## L\n');
  });

  test("creates a frontmatter followed by a blank line when there is none", () => {
    expect(write("## Old\n", [A, B])).toBe('---\nkryss-filters:\n  "A": "list:Work"\n  "B": "is:todo"\n---\n\n## L\n');
    expect(write("", [A])).toBe('---\nkryss-filters:\n  "A": "list:Work"\n---\n\n## L\n');
  });

  test("creates nothing when there are no filters and no frontmatter", () => {
    expect(write("## Old\n", [])).toBe("## L\n");
  });

  test("what is written reads back the same", () => {
    const filters = [{ name: 'a "q": é', text: "x\\y" }, B];
    expect(filtersOf(write("", filters))).toEqual(filters);
    expect(filtersOf(write(withBlock, filters))).toEqual(filters);
  });
});
