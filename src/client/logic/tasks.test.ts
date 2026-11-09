import { describe, expect, test } from "bun:test";
import { addChild, addSibling, addTask, deleteTask, editText, toggleDone } from "./index";
import { frozen, sample } from "./helpers.test-util";

describe("toggleDone", () => {
  test("checking a parent checks its children", () => {
    const d = toggleDone(frozen(sample()), { list: 0, task: 1 });
    expect(d.lists[0]!.tasks[1]).toEqual({ text: "a1", done: true, children: [{ text: "a1x", done: true }, { text: "a1y", done: true }] });
  });
  test("unchecking a parent changes only the parent", () => {
    const checked = toggleDone(sample(), { list: 0, task: 1 });
    const d = toggleDone(frozen(checked), { list: 0, task: 1 });
    expect(d.lists[0]!.tasks[1]!.done).toBe(false);
    expect(d.lists[0]!.tasks[1]!.children!.every((c) => c.done)).toBe(true);
  });
  test("checking the last child checks the parent", () => {
    let d = toggleDone(sample(), { list: 0, task: 1, child: 0 });
    expect(d.lists[0]!.tasks[1]!.done).toBe(false);
    d = toggleDone(frozen(d), { list: 0, task: 1, child: 1 });
    expect(d.lists[0]!.tasks[1]!.done).toBe(true);
  });
  test("unchecking a child unchecks the parent", () => {
    const all = toggleDone(sample(), { list: 0, task: 1 });
    const d = toggleDone(frozen(all), { list: 0, task: 1, child: 0 });
    expect(d.lists[0]!.tasks[1]!.done).toBe(false);
    expect(d.lists[0]!.tasks[1]!.children![1]!.done).toBe(true);
  });
  test("a childless task simply toggles; invalid path returns the same document", () => {
    const s = frozen(sample());
    expect(toggleDone(s, { list: 0, task: 0 }).lists[0]!.tasks[0]!.done).toBe(true);
    expect(toggleDone(s, { list: 9, task: 0 })).toBe(s);
  });
});

describe("add / edit / delete", () => {
  test("addTask appends or inserts, trims, refuses empty text", () => {
    const s = frozen(sample());
    expect(addTask(s, 0, "  new ")!.path).toEqual({ list: 0, task: 3 });
    expect(addTask(s, 0, "mid", 1)!.doc.lists[0]!.tasks[1]!.text).toBe("mid");
    expect(addTask(s, 1, "x")!.doc.lists[1]!.tasks).toHaveLength(1);
    expect(addTask(s, 0, "  ")).toBeNull();
    expect(addTask(s, 5, "x")).toBeNull();
  });
  test("addChild unchecks a checked parent", () => {
    const checked = toggleDone(sample(), { list: 0, task: 0 });
    const r = addChild(frozen(checked), { list: 0, task: 0 }, "sub")!;
    expect(r.path).toEqual({ list: 0, task: 0, child: 0 });
    expect(r.doc.lists[0]!.tasks[0]).toEqual({ text: "a0", done: false, children: [{ text: "sub", done: false }] });
  });
  test("addChild refuses a subtask parent", () => {
    expect(addChild(sample(), { list: 0, task: 1, child: 0 }, "x")).toBeNull();
  });
  test("addSibling inserts right after, at the same level", () => {
    expect(addSibling(frozen(sample()), { list: 0, task: 0 }, "n")!.path).toEqual({ list: 0, task: 1 });
    expect(addSibling(frozen(sample()), { list: 0, task: 1, child: 0 }, "n")!.path).toEqual({ list: 0, task: 1, child: 1 });
  });
  test("deleteTask removes a task with its subtree, or a subtask", () => {
    const s = frozen(sample());
    expect(deleteTask(s, { list: 0, task: 1 }).lists[0]!.tasks.map((t) => t.text)).toEqual(["a0", "a2"]);
    expect(deleteTask(s, { list: 0, task: 1, child: 0 }).lists[0]!.tasks[1]!.children).toEqual([{ text: "a1y", done: false }]);
  });
  test("deleting the last subtask drops the children key", () => {
    let d = deleteTask(sample(), { list: 0, task: 1, child: 0 });
    d = deleteTask(frozen(d), { list: 0, task: 1, child: 0 });
    expect("children" in d.lists[0]!.tasks[1]!).toBe(false);
  });
  test("editText changes text, refuses empty", () => {
    const s = frozen(sample());
    expect(editText(s, { list: 0, task: 0 }, " hi\nthere ").lists[0]!.tasks[0]!.text).toBe("hi there");
    expect(editText(s, { list: 0, task: 1, child: 1 }, "z").lists[0]!.tasks[1]!.children![1]!.text).toBe("z");
    expect(editText(s, { list: 0, task: 0 }, " ")).toBe(s);
  });
});
