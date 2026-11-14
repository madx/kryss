import { describe, expect, test } from "bun:test";
import { commitInsert, insertTarget } from "./insert";
import type { AddAt, Anchor } from "./insert";
import { frozen, sample } from "./helpers.test-util";
import type { TodoDocument } from "../../shared/types";

const task = (list: number, t: number, child?: number): Anchor => ({ kind: "task", path: { list, task: t, ...(child === undefined ? {} : { child }) } });
const header = (list: number): Anchor => ({ kind: "header", list });
const target = (at: AddAt, anchor: Anchor) => insertTarget(frozen(sample()), at, anchor);

describe("insertTarget below", () => {
  test("top-level task: right after it", () => {
    expect(target("below", task(0, 1))).toEqual({ list: 0, index: 2 });
  });
  test("last top-level task: at the end of the list", () => {
    expect(target("below", task(0, 2))).toEqual({ list: 0, index: 3 });
  });
  test("subtask: right after it, same parent", () => {
    expect(target("below", task(0, 1, 0))).toEqual({ list: 0, parent: 1, index: 1 });
  });
  test("last subtask: at the end of its parent", () => {
    expect(target("below", task(0, 1, 1))).toEqual({ list: 0, parent: 1, index: 2 });
  });
  test("a parent with subtasks still gets a top-level sibling", () => {
    expect(target("below", task(0, 1))?.parent).toBeUndefined();
  });
});

describe("insertTarget above", () => {
  test("top-level task: at its index", () => {
    expect(target("above", task(0, 1))).toEqual({ list: 0, index: 1 });
  });
  test("first top-level task: index 0", () => {
    expect(target("above", task(0, 0))).toEqual({ list: 0, index: 0 });
  });
  test("subtask: at its index, same parent", () => {
    expect(target("above", task(0, 1, 1))).toEqual({ list: 0, parent: 1, index: 1 });
  });
  test("first subtask: index 0 under the parent", () => {
    expect(target("above", task(0, 1, 0))).toEqual({ list: 0, parent: 1, index: 0 });
  });
});

describe("insertTarget first-child", () => {
  test("top-level task with subtasks: index 0 under it", () => {
    expect(target("first-child", task(0, 1))).toEqual({ list: 0, parent: 1, index: 0 });
  });
  test("top-level task without subtask: index 0 under it", () => {
    expect(target("first-child", task(0, 2))).toEqual({ list: 0, parent: 2, index: 0 });
  });
  test("subtask: index 0 under its parent", () => {
    expect(target("first-child", task(0, 1, 1))).toEqual({ list: 0, parent: 1, index: 0 });
  });
});

describe("insertTarget last-child", () => {
  test("top-level task with subtasks: after the last one", () => {
    expect(target("last-child", task(0, 1))).toEqual({ list: 0, parent: 1, index: 2 });
  });
  test("top-level task without subtask: index 0 under it", () => {
    expect(target("last-child", task(0, 0))).toEqual({ list: 0, parent: 0, index: 0 });
  });
  test("subtask: at the end of its parent", () => {
    expect(target("last-child", task(0, 1, 0))).toEqual({ list: 0, parent: 1, index: 2 });
  });
});

describe("insertTarget on a header", () => {
  test("list-start: first task of the list", () => {
    expect(target("list-start", header(0))).toEqual({ list: 0, index: 0 });
  });
  test("list-end: after the last task of the list", () => {
    expect(target("list-end", header(0))).toEqual({ list: 0, index: 3 });
  });
  test("list-start on an empty list: index 0", () => {
    expect(target("list-start", header(1))).toEqual({ list: 1, index: 0 });
  });
  test("list-end on an empty list: index 0", () => {
    expect(target("list-end", header(1))).toEqual({ list: 1, index: 0 });
  });
  test.each(["below", "above", "first-child", "last-child"] as AddAt[])("%s on a header is refused", (at) => {
    expect(target(at, header(0))).toBeNull();
  });
});

describe("insertTarget prev-list-end", () => {
  test("is refused on a header, since the previous visible list is resolved by the view", () => {
    expect(target("prev-list-end", header(1))).toBeNull();
  });
});

describe("insertTarget refusals", () => {
  test.each(["list-start", "list-end", "prev-list-end"] as AddAt[])("%s on a task anchor is refused", (at) => {
    expect(target(at, task(0, 0))).toBeNull();
  });
  test("missing list on a header", () => {
    expect(target("list-start", header(5))).toBeNull();
  });
  test("negative list on a header", () => {
    expect(target("list-end", header(-1))).toBeNull();
  });
  test("missing list on a task path", () => {
    expect(target("below", task(7, 0))).toBeNull();
  });
  test("missing task", () => {
    expect(target("below", task(0, 9))).toBeNull();
  });
  test("missing subtask", () => {
    expect(target("above", task(0, 1, 5))).toBeNull();
  });
  test("subtask path under a task without children", () => {
    expect(target("below", task(0, 0, 0))).toBeNull();
  });
  test("does not mutate a frozen document", () => {
    expect(() => insertTarget(frozen(sample()), "below", task(0, 1, 0))).not.toThrow();
  });
});

describe("commitInsert", () => {
  test("inserts a top-level task at the index and returns its path", () => {
    const r = commitInsert(frozen(sample()), { list: 0, index: 1 }, "new");
    expect(r!.path).toEqual({ list: 0, task: 1 });
    expect(r!.doc.lists[0]!.tasks.map((t) => t.text)).toEqual(["a0", "new", "a1", "a2"]);
  });
  test("the new task is unchecked", () => {
    const r = commitInsert(frozen(sample()), { list: 0, index: 0 }, "new");
    expect(r!.doc.lists[0]!.tasks[0]).toEqual({ text: "new", done: false });
  });
  test("inserts at the end of an empty list", () => {
    const r = commitInsert(frozen(sample()), { list: 1, index: 0 }, "new");
    expect(r!.doc.lists[1]!.tasks).toEqual([{ text: "new", done: false }]);
    expect(r!.path).toEqual({ list: 1, task: 0 });
  });
  test("inserts a subtask at the index and returns its path", () => {
    const r = commitInsert(frozen(sample()), { list: 0, parent: 1, index: 1 }, "new");
    expect(r!.path).toEqual({ list: 0, task: 1, child: 1 });
    expect(r!.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1x", "new", "a1y"]);
  });
  test("first subtask of a task without children creates its children", () => {
    const r = commitInsert(frozen(sample()), { list: 0, parent: 0, index: 0 }, "new");
    expect(r!.doc.lists[0]!.tasks[0]!.children).toEqual([{ text: "new", done: false }]);
  });
  test("a subtask under a checked parent unchecks the parent", () => {
    const doc = sample();
    doc.lists[0]!.tasks[1]!.done = true;
    doc.lists[0]!.tasks[1]!.children!.forEach((c) => (c.done = true));
    const r = commitInsert(frozen(doc), { list: 0, parent: 1, index: 2 }, "new");
    expect(r!.doc.lists[0]!.tasks[1]!.done).toBe(false);
  });
  test("a top-level task leaves other check states unchanged", () => {
    const doc = sample();
    doc.lists[0]!.tasks[0]!.done = true;
    const r = commitInsert(frozen(doc), { list: 0, index: 2 }, "new");
    expect(r!.doc.lists[0]!.tasks[0]!.done).toBe(true);
  });
  test("trims the text", () => {
    const r = commitInsert(frozen(sample()), { list: 0, index: 0 }, "  new  ");
    expect(r!.doc.lists[0]!.tasks[0]!.text).toBe("new");
  });
  test("line breaks become spaces", () => {
    const r = commitInsert(frozen(sample()), { list: 0, index: 0 }, "one\ntwo");
    expect(r!.doc.lists[0]!.tasks[0]!.text).toBe("one two");
  });
  test("empty text returns null", () => {
    expect(commitInsert(frozen(sample()), { list: 0, index: 0 }, "")).toBeNull();
  });
  test("blank text returns null", () => {
    expect(commitInsert(frozen(sample()), { list: 0, index: 0 }, " \n\t ")).toBeNull();
  });
  test("empty text under a parent returns null", () => {
    expect(commitInsert(frozen(sample()), { list: 0, parent: 1, index: 0 }, "  ")).toBeNull();
  });
  test("missing list returns null", () => {
    expect(commitInsert(frozen(sample()), { list: 4, index: 0 }, "new")).toBeNull();
  });
  test("missing parent returns null", () => {
    expect(commitInsert(frozen(sample()), { list: 0, parent: 8, index: 0 }, "new")).toBeNull();
  });
  test("does not mutate the input document", () => {
    const before = structuredClone(sample());
    const input = frozen(sample());
    commitInsert(input, { list: 0, parent: 1, index: 0 }, "new");
    expect(input).toEqual(before);
  });
  test("never produces an empty-text task", () => {
    const empties = (d: TodoDocument) => d.lists.flatMap((l) => l.tasks.flatMap((t) => [t, ...(t.children ?? [])])).filter((t) => t.text === "");
    for (const text of ["", " ", "\n", "ok"]) {
      for (const tgt of [{ list: 0, index: 0 }, { list: 0, parent: 1, index: 1 }, { list: 1, index: 0 }]) {
        const r = commitInsert(frozen(sample()), tgt, text);
        if (r) expect(empties(r.doc)).toEqual([]);
        else expect(text.trim()).toBe("");
      }
    }
  });
});

describe("Enter chain", () => {
  test("below the new top-level task gives the next sibling position", () => {
    const t1 = insertTarget(sample(), "below", task(0, 0))!;
    const r1 = commitInsert(frozen(sample()), t1, "n1")!;
    const t2 = insertTarget(r1.doc, "below", { kind: "task", path: r1.path })!;
    expect(t2).toEqual({ list: 0, index: 2 });
    const r2 = commitInsert(frozen(r1.doc), t2, "n2")!;
    expect(r2.doc.lists[0]!.tasks.map((t) => t.text)).toEqual(["a0", "n1", "n2", "a1", "a2"]);
  });
  test("chaining works for subtasks", () => {
    const t1 = insertTarget(sample(), "last-child", task(0, 1))!;
    const r1 = commitInsert(frozen(sample()), t1, "n1")!;
    const t2 = insertTarget(r1.doc, "below", { kind: "task", path: r1.path })!;
    expect(t2).toEqual({ list: 0, parent: 1, index: 3 });
    const r2 = commitInsert(frozen(r1.doc), t2, "n2")!;
    expect(r2.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1x", "a1y", "n1", "n2"]);
    expect(r2.path).toEqual({ list: 0, task: 1, child: 3 });
  });
  test("chaining from a list header stays in the list", () => {
    const t1 = insertTarget(sample(), "list-start", header(1))!;
    const r1 = commitInsert(frozen(sample()), t1, "n1")!;
    const t2 = insertTarget(r1.doc, "below", { kind: "task", path: r1.path })!;
    expect(t2).toEqual({ list: 1, index: 1 });
  });
});
