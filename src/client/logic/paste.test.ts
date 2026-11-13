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

describe("pasteTask: before", () => {
  test("on a top-level task goes right before it, and the path points at it", () => {
    const r = pasteTask(frozen(sample()), leaf, { list: 0, task: 1 }, "before")!;
    expect(texts(r.doc)).toEqual(["a0", "p", "a1", "a2"]);
    expect(r.path).toEqual({ list: 0, task: 1 });
  });
  test("on a top-level task that has children leaves its subtree untouched", () => {
    const r = pasteTask(sample(), leaf, { list: 0, task: 1 }, "before")!;
    expect(r.doc.lists[0]!.tasks[2]).toEqual(sample().lists[0]!.tasks[1]!);
  });
  test("a task without children pasted on a subtask becomes the previous subtask", () => {
    const r = pasteTask(frozen(sample()), leaf, { list: 0, task: 1, child: 1 }, "before")!;
    expect(r.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1x", "p", "a1y"]);
    expect(r.path).toEqual({ list: 0, task: 1, child: 1 });
  });
  test("a task with children pasted on a subtask goes to the top level right before the parent", () => {
    const r = pasteTask(frozen(sample()), parent, { list: 0, task: 1, child: 1 }, "before")!;
    expect(texts(r.doc)).toEqual(["a0", "pp", "a1", "a2"]);
    expect(r.doc.lists[0]!.tasks[1]).toEqual(parent);
    expect(r.path).toEqual({ list: 0, task: 1 });
  });
  test("a subtask pasted on a top-level task becomes a top-level task", () => {
    const r = pasteTask(sample(), { text: "s", done: false }, { list: 0, task: 2 }, "before")!;
    expect(r.doc.lists[0]!.tasks[2]).toEqual({ text: "s", done: false });
  });
  test("on a header it becomes the first task, also on an empty list", () => {
    const r = pasteTask(sample(), leaf, { list: 0 }, "before")!;
    expect(texts(r.doc)).toEqual(["p", "a0", "a1", "a2"]);
    expect(r.path).toEqual({ list: 0, task: 0 });
    const e = pasteTask(sample(), leaf, { list: 1 }, "before")!;
    expect(texts(e.doc, 1)).toEqual(["p"]);
  });
  test("an unchecked task pasted as a subtask unchecks a checked parent, a checked one does not", () => {
    const base = sample();
    base.lists[0]!.tasks[1]!.done = true;
    base.lists[0]!.tasks[1]!.children!.forEach((c) => (c.done = true));
    expect(pasteTask(base, leaf, { list: 0, task: 1, child: 0 }, "before")!.doc.lists[0]!.tasks[1]!.done).toBe(false);
    expect(pasteTask(base, { text: "d", done: true }, { list: 0, task: 1, child: 0 }, "before")!.doc.lists[0]!.tasks[1]!.done).toBe(true);
  });
  test("two pastes give independent copies, and an unknown target gives null", () => {
    const first = pasteTask(sample(), parent, { list: 0 }, "before")!;
    const second = pasteTask(first.doc, parent, { list: 0 }, "before")!;
    second.doc.lists[0]!.tasks[0]!.children![0]!.text = "edited";
    expect(second.doc.lists[0]!.tasks[1]!.children![0]!.text).toBe("pc");
    expect(pasteTask(sample(), leaf, { list: 0, task: 9 }, "before")).toBeNull();
    expect(pasteTask(sample(), leaf, { list: 0, task: 1, child: 9 }, "before")).toBeNull();
  });
});

describe("pasteList: before", () => {
  test("goes at the index of the given list and returns it", () => {
    const r = pasteList(frozen(sample()), { title: "New", tasks: [leaf] }, 1, "before")!;
    expect(r.doc.lists.map((l) => l.title)).toEqual(["A", "New", "Empty"]);
    expect(r.list).toBe(1);
  });
  test("keeps a title that another list already has, right before it", () => {
    const r = pasteList(sample(), sample().lists[0]!, 0, "before")!;
    expect(r.doc.lists.map((l) => l.title)).toEqual(["A", "A", "Empty"]);
    expect(r.list).toBe(0);
  });
  test("an unknown list gives null", () => {
    expect(pasteList(sample(), { title: "N", tasks: [] }, 7, "before")).toBeNull();
  });
});

describe("paste: before", () => {
  test("a task register is pasted above the task", () => {
    const r = paste(sample(), { kind: "task", task: leaf }, { list: 0, task: 0 }, "before")!;
    expect(texts(r.doc)).toEqual(["p", "a0", "a1", "a2"]);
    expect(r).toHaveProperty("path", { list: 0, task: 0 });
  });
  test("a list register is pasted before the list of the cursor, from its header or from a subtask", () => {
    const reg: Register = { kind: "list", list: { title: "N", tasks: [] } };
    for (const target of [{ list: 1 }, { list: 0, task: 1, child: 0 }]) {
      const r = paste(sample(), reg, target, "before")!;
      expect(r.doc.lists.map((l) => l.title)).toEqual(target.list === 1 ? ["A", "N", "Empty"] : ["N", "A", "Empty"]);
      expect(r).toHaveProperty("list", target.list);
    }
  });
  test("an empty register pastes nothing", () => {
    expect(paste(sample(), null, { list: 0, task: 0 }, "before")).toBeNull();
  });
});
