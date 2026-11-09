import { describe, expect, test } from "bun:test";
import { parse, serialize } from "./markdown";

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
    expect(ok("")).toEqual({ lists: [] });
    expect(ok("\n\n")).toEqual({ lists: [] });
  });

  test("empty list", () => {
    expect(ok("## Empty\n")).toEqual({ lists: [{ title: "Empty", tasks: [] }] });
  });

  test("lists, tasks and subtasks", () => {
    const doc = ok("## Groceries\n- [ ] Milk\n  - [x] Semi-skimmed\n- [ ] Bread\n\n## Work\n- [x] Send the report\n");
    expect(doc).toEqual({
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
    const expected = { lists: [{ title: "L", tasks: [{ text: "a", done: true, children: [{ text: "b", done: false }] }] }] };
    expect(ok("## L\n* [X] a\n\t* [ ] b\n")).toEqual(expected);
    expect(ok("## L\n- [X] a\n    - [ ] b\n")).toEqual(expected);
    expect(ok("## L\r\n- [x] a\r\n  - [ ] b\r\n")).toEqual(expected);
  });

  test("rejects frontmatter", () => {
    expect(err("---\ntitle: x\n---\n## L\n").line).toBe(1);
    expect(err("---\ntitle: x\n---\n## L\n").reason).toMatch(/frontmatter/i);
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

describe("serialize", () => {
  test("empty document is an empty file", () => {
    expect(serialize({ lists: [] })).toBe("");
  });

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
