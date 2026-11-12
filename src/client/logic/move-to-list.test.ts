import { describe, expect, test } from "bun:test";
import type { TodoDocument } from "../../shared/types";
import { moveToList } from "./move";
import { listPickerRows, listPickerStart } from "./list-picker";
import { frozen, sample } from "./helpers.test-util";

const texts = (d: TodoDocument, l: number) => d.lists[l]!.tasks.map((t) => t.text);

describe("moveToList", () => {
  test("a top-level task goes to the end of the destination with its subtree", () => {
    const r = moveToList(frozen(sample()), { list: 0, task: 1 }, 1)!;
    expect(texts(r.doc, 0)).toEqual(["a0", "a2"]);
    expect(texts(r.doc, 1)).toEqual(["a1"]);
    expect(r.doc.lists[1]!.tasks[0]!.children!.map((c) => c.text)).toEqual(["a1x", "a1y"]);
    expect(r.path).toEqual({ list: 1, task: 0 });
  });
  test("a task lands after the existing tasks of a non-empty destination", () => {
    const d: TodoDocument = { filters: [], lists: [{ title: "A", tasks: [{ text: "x", done: false }] }, { title: "B", tasks: [{ text: "y", done: false }, { text: "z", done: false }] }] };
    const r = moveToList(frozen(d), { list: 0, task: 0 }, 1)!;
    expect(texts(r.doc, 1)).toEqual(["y", "z", "x"]);
    expect(r.path).toEqual({ list: 1, task: 2 });
  });
  test("a subtask leaves its parent and becomes a top-level task at the end", () => {
    const r = moveToList(frozen(sample()), { list: 0, task: 1, child: 0 }, 1)!;
    expect(texts(r.doc, 1)).toEqual(["a1x"]);
    expect(r.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1y"]);
    expect(r.path).toEqual({ list: 1, task: 0 });
  });
  test("the parent it left is checked when the remaining subtasks are all checked", () => {
    const d = sample();
    d.lists[0]!.tasks[1]!.children![0]!.done = true;
    const r = moveToList(frozen(d), { list: 0, task: 1, child: 1 }, 1)!;
    expect(r.doc.lists[0]!.tasks[1]!.done).toBe(true);
  });
  test("the last subtask leaving removes the children key", () => {
    const d: TodoDocument = { filters: [], lists: [{ title: "A", tasks: [{ text: "p", done: false, children: [{ text: "c", done: false }] }] }, { title: "B", tasks: [] }] };
    const r = moveToList(frozen(d), { list: 0, task: 0, child: 0 }, 1)!;
    expect("children" in r.doc.lists[0]!.tasks[0]!).toBe(false);
  });
  test("check states and due dates are kept", () => {
    const d: TodoDocument = { filters: [], lists: [{ title: "A", tasks: [{ text: "t -> 2026-11-22", done: true, children: [{ text: "c", done: true }] }] }, { title: "B", tasks: [] }] };
    const r = moveToList(frozen(d), { list: 0, task: 0 }, 1)!;
    expect(r.doc.lists[1]!.tasks[0]).toEqual({ text: "t -> 2026-11-22", done: true, children: [{ text: "c", done: true }] });
  });
  test("the destination equal to the source list is a no-op, even for a subtask", () => {
    expect(moveToList(sample(), { list: 0, task: 0 }, 0)).toBeNull();
    expect(moveToList(sample(), { list: 0, task: 1, child: 0 }, 0)).toBeNull();
  });
  test("an unknown task or list gives null", () => {
    expect(moveToList(sample(), { list: 0, task: 9 }, 1)).toBeNull();
    expect(moveToList(sample(), { list: 0, task: 0 }, 5)).toBeNull();
    expect(moveToList(sample(), { list: 0, task: 0 }, -1)).toBeNull();
  });
  test("it reports the moved paths", () => {
    const r = moveToList(frozen(sample()), { list: 0, task: 0 }, 1)!;
    expect(r.moves).toContainEqual({ from: { list: 0, task: 0 }, to: { list: 1, task: 0 } });
  });
});

describe("list picker rows", () => {
  const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "Home", tasks: [] }, { title: "Work", tasks: [] }, { title: "Homework", tasks: [] }, { title: "Work", tasks: [] }] });
  test("every list is a row in document order, duplicates included", () => {
    expect(listPickerRows(d, "")).toEqual([0, 1, 2, 3]);
  });
  test("typing narrows by title, ignoring case", () => {
    expect(listPickerRows(d, "work")).toEqual([1, 2, 3]);
    expect(listPickerRows(d, "HOME")).toEqual([0, 2]);
  });
  test("no match gives no row", () => {
    expect(listPickerRows(d, "zzz")).toEqual([]);
  });
  test("the start row is the first list after the source, else the first row", () => {
    expect(listPickerStart([0, 1, 2, 3], 1)).toBe(2);
    expect(listPickerStart([0, 1, 2, 3], 3)).toBe(0);
    expect(listPickerStart([1, 2, 3], 0)).toBe(0);
    expect(listPickerStart([0, 2], 1)).toBe(1);
    expect(listPickerStart([], 0)).toBe(0);
  });
});
