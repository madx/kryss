import { describe, expect, test } from "bun:test";
import type { Task, TodoDocument } from "../../shared/types";
import { paste, pasteList, pasteTask } from "./paste";
import { frozen, sample } from "./helpers.test-util";
import type { Register } from "./register";

const texts = (doc: TodoDocument, list = 0) => doc.lists[list]!.tasks.map((t) => t.text);
const leaf: Task = { text: "p", done: false };
const parent: Task = { text: "pp", done: true, children: [{ text: "pc", done: true }] };

describe("pasteTask: on a task", () => {
  test("goes right after the whole subtree of a top-level task", () => {
    const r = pasteTask(frozen(sample()), leaf, { list: 0, task: 1 })!;
    expect(texts(r.doc)).toEqual(["a0", "a1", "p", "a2"]);
    expect(r.path).toEqual({ list: 0, task: 2 });
  });
  test("a task with children is pasted with its subtree on a top-level task", () => {
    const r = pasteTask(sample(), parent, { list: 0, task: 0 })!;
    expect(r.doc.lists[0]!.tasks[1]).toEqual(parent);
    expect(r.path).toEqual({ list: 0, task: 1 });
  });
  test("a subtask pasted on a top-level task becomes a top-level task", () => {
    const r = pasteTask(sample(), { text: "s", done: false }, { list: 0, task: 2 })!;
    expect(r.doc.lists[0]!.tasks[3]).toEqual({ text: "s", done: false });
    expect(r.doc.lists[0]!.tasks[3]).not.toHaveProperty("children");
  });
  test("a task without children pasted on a subtask becomes the next sibling subtask", () => {
    const r = pasteTask(frozen(sample()), leaf, { list: 0, task: 1, child: 0 })!;
    expect(r.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1x", "p", "a1y"]);
    expect(r.path).toEqual({ list: 0, task: 1, child: 1 });
  });
  test("a task with children pasted on a subtask goes to the top level right after the parent", () => {
    const r = pasteTask(frozen(sample()), parent, { list: 0, task: 1, child: 1 })!;
    expect(texts(r.doc)).toEqual(["a0", "a1", "pp", "a2"]);
    expect(r.doc.lists[0]!.tasks[2]).toEqual(parent);
    expect(r.path).toEqual({ list: 0, task: 2 });
  });
  test("no task ends up three levels deep", () => {
    const r = pasteTask(sample(), parent, { list: 0, task: 1, child: 0 })!;
    for (const t of r.doc.lists[0]!.tasks) for (const c of t.children ?? []) expect(c).not.toHaveProperty("children");
  });
});

describe("pasteTask: on a header", () => {
  test("becomes the first task of the list", () => {
    const r = pasteTask(sample(), leaf, { list: 0 })!;
    expect(texts(r.doc)).toEqual(["p", "a0", "a1", "a2"]);
    expect(r.path).toEqual({ list: 0, task: 0 });
  });
  test("works on an empty list", () => {
    const r = pasteTask(sample(), leaf, { list: 1 })!;
    expect(texts(r.doc, 1)).toEqual(["p"]);
    expect(r.path).toEqual({ list: 1, task: 0 });
  });
});

describe("pasteTask: check states", () => {
  test("keeps the check states of the task and of its children", () => {
    const r = pasteTask(sample(), parent, { list: 0 })!;
    expect(r.doc.lists[0]!.tasks[0]).toEqual({ text: "pp", done: true, children: [{ text: "pc", done: true }] });
  });
  test("an unchecked task pasted as a subtask unchecks a checked parent", () => {
    const base = sample();
    base.lists[0]!.tasks[1]!.done = true;
    base.lists[0]!.tasks[1]!.children!.forEach((c) => (c.done = true));
    const r = pasteTask(base, leaf, { list: 0, task: 1, child: 1 })!;
    expect(r.doc.lists[0]!.tasks[1]!.done).toBe(false);
  });
  test("a checked task pasted as a subtask leaves the parent as it is", () => {
    const r = pasteTask(sample(), { text: "d", done: true }, { list: 0, task: 1, child: 0 })!;
    expect(r.doc.lists[0]!.tasks[1]!.done).toBe(false);
  });
});

describe("pasteTask: copies and bad targets", () => {
  test("two pastes give two independent copies", () => {
    const first = pasteTask(sample(), parent, { list: 0 })!;
    const second = pasteTask(first.doc, parent, { list: 0 })!;
    second.doc.lists[0]!.tasks[0]!.children![0]!.text = "edited";
    expect(second.doc.lists[0]!.tasks[1]!.children![0]!.text).toBe("pc");
    expect(parent.children![0]!.text).toBe("pc");
  });
  test("an unknown target gives null", () => {
    expect(pasteTask(sample(), leaf, { list: 9 })).toBeNull();
    expect(pasteTask(sample(), leaf, { list: 0, task: 9 })).toBeNull();
  });
});

describe("pasteList", () => {
  test("goes right after the given list and returns its index", () => {
    const r = pasteList(frozen(sample()), { title: "New", tasks: [leaf] }, 0)!;
    expect(r.doc.lists.map((l) => l.title)).toEqual(["A", "New", "Empty"]);
    expect(r.list).toBe(1);
  });
  test("keeps a title that another list already has", () => {
    const r = pasteList(sample(), sample().lists[0]!, 0)!;
    expect(r.doc.lists.map((l) => l.title)).toEqual(["A", "A", "Empty"]);
  });
  test("two pastes give two independent copies", () => {
    const list = { title: "N", tasks: [{ text: "t", done: false }] };
    const first = pasteList(sample(), list, 1)!;
    const second = pasteList(first.doc, list, 1)!;
    second.doc.lists[2]!.tasks[0]!.text = "edited";
    expect(second.doc.lists[3]!.tasks[0]!.text).toBe("t");
    expect(list.tasks[0]!.text).toBe("t");
  });
  test("an unknown list gives null", () => {
    expect(pasteList(sample(), { title: "N", tasks: [] }, 7)).toBeNull();
  });
});

describe("paste", () => {
  test("a task register is pasted at a task target", () => {
    const r = paste(sample(), { kind: "task", task: leaf }, { list: 0, task: 0 })!;
    expect(texts(r.doc)).toEqual(["a0", "p", "a1", "a2"]);
    expect(r).toHaveProperty("path", { list: 0, task: 1 });
  });
  test("a list register is pasted after the list of the cursor, on its header or on one of its tasks", () => {
    const reg: Register = { kind: "list", list: { title: "N", tasks: [] } };
    for (const target of [{ list: 0 }, { list: 0, task: 1, child: 0 }]) {
      const r = paste(sample(), reg, target)!;
      expect(r.doc.lists.map((l) => l.title)).toEqual(["A", "N", "Empty"]);
      expect(r).toHaveProperty("list", 1);
    }
  });
  test("an empty register pastes nothing", () => {
    expect(paste(sample(), null, { list: 0, task: 0 })).toBeNull();
  });
});
