import { describe, expect, test } from "bun:test";
import { serialize } from "../shared/serializer";
import { frontmatterOf, parse, withFrontmatter } from "./markdown";

function ok(md: string) {
  const r = parse(md);
  if (!r.ok) throw new Error(`unexpected error: ${JSON.stringify(r.error)}`);
  return r.doc;
}
function err(md: string) {
  const r = parse(md);
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

describe("parse", () => {
  test("empty file is zero lists", () => {
    expect(ok("")).toEqual({ lists: [], filters: [] });
    expect(ok("\n\n")).toEqual({ lists: [], filters: [] });
  });

  test("empty list", () => {
    expect(ok("## Empty\n")).toEqual({ lists: [{ title: "Empty", tasks: [] }], filters: [] });
  });

  test("lists, tasks and subtasks", () => {
    const doc = ok("## Groceries\n- [ ] Milk\n  - [x] Semi-skimmed\n- [ ] Bread\n\n## Work\n- [x] Send the report\n");
    expect(doc).toEqual({
      filters: [],
      lists: [
        {
          title: "Groceries",
          tasks: [
            { text: "Milk", done: false, children: [{ text: "Semi-skimmed", done: true }] },
            { text: "Bread", done: false },
          ],
        },
        { title: "Work", tasks: [{ text: "Send the report", done: true }] },
      ],
    });
  });

  test("names are not unique", () => {
    expect(ok("## A\n\n## A\n").lists.length).toBe(2);
  });

  test("inline Markdown is stored as-is", () => {
    expect(ok("## L\n- [ ] **bold** [x](https://a.b) `c`\n").lists[0]!.tasks[0]!.text).toBe("**bold** [x](https://a.b) `c`");
  });

  test("tolerates * bullets, [X], tabs and 4-space indentation, CRLF", () => {
    const expected = { lists: [{ title: "L", tasks: [{ text: "a", done: true, children: [{ text: "b", done: false }] }] }], filters: [] };
    expect(ok("## L\n* [X] a\n\t* [ ] b\n")).toEqual(expected);
    expect(ok("## L\n- [X] a\n    - [ ] b\n")).toEqual(expected);
    expect(ok("## L\r\n- [x] a\r\n  - [ ] b\r\n")).toEqual(expected);
  });

  test("strips a leading UTF-8 BOM", () => {
    const doc = ok("\uFEFF## L\n- [ ] a\n");
    expect(doc.lists[0]).toEqual({ title: "L", tasks: [{ text: "a", done: false }] });
    expect(serialize(doc).startsWith("\uFEFF")).toBe(false);
  });

  test("ignores frontmatter and keeps error lines relative to the file", () => {
    const doc = ok("---\ntitle: x\ntags: [a]\n---\n\n## L\n- [ ] a\n");
    expect(doc.lists).toEqual([{ title: "L", tasks: [{ text: "a", done: false }] }]);
    expect(err("---\ntitle: x\n---\n## L\nhello\n").line).toBe(5);
    expect(ok("---\n---\n").lists).toEqual([]);
  });

  test("rejects an unclosed frontmatter block", () => {
    expect(err("---\ntitle: x\n## L\n")).toMatchObject({ line: 1, reason: expect.stringMatching(/frontmatter/i) });
  });

  test("frontmatterOf returns the block and the blank lines after it", () => {
    expect(frontmatterOf("---\na: 1\n---\n\n## L\n")).toBe("---\na: 1\n---\n\n");
    expect(frontmatterOf("---\r\na: 1\r\n...\r\n## L\n")).toBe("---\r\na: 1\r\n...\r\n");
    expect(frontmatterOf("## L\n---\n---\n")).toBe("");
  });

  test("withFrontmatter keeps the block byte for byte", () => {
    const current = "---\r\ntitle:   x \r\n---\n\n## Old\n";
    expect(withFrontmatter(current, "## New\n", [])).toBe("---\r\ntitle:   x \r\n---\n\n## New\n");
    expect(withFrontmatter(current, "", [])).toBe("---\r\ntitle:   x \r\n---\n\n");
    expect(withFrontmatter("---\na: 1\n---", "## L\n", [])).toBe("---\na: 1\n---\n## L\n");
    expect(withFrontmatter("## Old\n", "## New\n", [])).toBe("## New\n");
  });

  test("rejects free text, before and inside lists", () => {
    expect(err("hello\n## L\n")).toMatchObject({ line: 1 });
    expect(err("## L\nhello\n")).toMatchObject({ line: 2 });
    expect(err("## L\n- [ ] a\n\nhello\n")).toMatchObject({ line: 4 });
  });

  test("rejects a task before the first list", () => {
    expect(err("- [ ] a\n")).toMatchObject({ line: 1 });
  });

  test("rejects # and ### headings", () => {
    expect(err("# T\n").reason).toMatch(/heading/i);
    expect(err("## L\n### S\n")).toMatchObject({ line: 2 });
  });

  test("rejects an empty list name", () => {
    expect(err("##\n")).toMatchObject({ line: 1 });
    expect(err("## L\n##   \n")).toMatchObject({ line: 2 });
  });

  test("rejects an empty task", () => {
    expect(err("## L\n- [ ]\n")).toMatchObject({ line: 2 });
    expect(err("## L\n- [x]   \n")).toMatchObject({ line: 2 });
  });

  test("rejects three levels", () => {
    expect(err("## L\n- [ ] a\n  - [ ] b\n    - [ ] c\n")).toMatchObject({ line: 4 });
    expect(err("## L\n- [ ] a\n\t- [ ] b\n\t\t- [ ] c\n")).toMatchObject({ line: 4 });
  });

  test("rejects a multi-line task description", () => {
    const e = err("## L\n- [ ] a\n  more text\n");
    expect(e.line).toBe(3);
    expect(e.reason).toMatch(/multi-line/i);
  });

  test("rejects inconsistent indentation", () => {
    expect(err("## L\n- [ ] a\n   - [ ] b\n")).toMatchObject({ line: 3 });
    expect(err("## L\n- [ ] a\n  - [ ] b\n\t- [ ] c\n")).toMatchObject({ line: 4 });
    expect(err("## L\n- [ ] a\n  - [ ] b\n    - [ ] c\n")).toMatchObject({ line: 4 });
  });

  test("rejects a subtask without a parent", () => {
    expect(err("## L\n  - [ ] a\n")).toMatchObject({ line: 2 });
  });
});

describe("serialize after parse", () => {
  test("canonical output", () => {
    const md = "## A\n- [ ] x\n  - [x] y\n\n## B\n\n## C\n- [x] z\n";
    expect(serialize(ok(md))).toBe(md);
  });

  test("normalizes tolerated syntax", () => {
    expect(serialize(ok("## L\r\n* [X] a\r\n    * [ ] b\r\n"))).toBe("## L\n- [x] a\n  - [ ] b\n");
  });

  test("round-trip is stable", () => {
    const md = "## A\n* [X] x\n\t- [ ] y\n\n\n## B\n- [ ] `z`\n";
    const once = serialize(ok(md));
    expect(serialize(ok(once))).toBe(once);
    expect(ok(once)).toEqual(ok(md));
  });
});
