import { describe, expect, test } from "bun:test";
import { addChild, addSibling, addTask, cutTask, deleteTask, editText, toggleDone } from "./index";
import type { TodoDocument } from "../../shared/types";
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

describe("toggleDone: due date on completion (PRD 5.13)", () => {
  const TODAY = "2026-11-11";
  const d = (tasks: TodoDocument["lists"][number]["tasks"]): TodoDocument => ({ lists: [{ title: "L", tasks }], filters: [] });

  test("checking a task rewrites its overdue date", () => {
    const next = toggleDone(frozen(d([{ text: "a -> 2026-10-30", done: false }])), { list: 0, task: 0 }, TODAY);
    expect(next.lists[0]!.tasks[0]).toEqual({ text: "a -> 2026-11-11 (was 2026-10-30)", done: true });
  });

  test("a date of today or later is left alone", () => {
    const next = toggleDone(frozen(d([{ text: "a -> 2026-11-12", done: false }])), { list: 0, task: 0 }, TODAY);
    expect(next.lists[0]!.tasks[0]!.text).toBe("a -> 2026-11-12");
  });

  test("unchecking restores nothing", () => {
    const checked = toggleDone(frozen(d([{ text: "a -> 2026-10-30", done: false }])), { list: 0, task: 0 }, TODAY);
    const unchecked = toggleDone(checked, { list: 0, task: 0 }, TODAY);
    expect(unchecked.lists[0]!.tasks[0]).toEqual({ text: "a -> 2026-11-11 (was 2026-10-30)", done: false });
  });

  test("a checked parent rewrites its own date and the dates of the children it checks", () => {
    const next = toggleDone(
      frozen(d([{ text: "p -> 2026-W40", done: false, children: [{ text: "x -> 2026-10-01", done: false }, { text: "y -> 2026-10-02", done: true }, { text: "z", done: false }] }])),
      { list: 0, task: 0 },
      TODAY,
    );
    expect(next.lists[0]!.tasks[0]).toEqual({
      text: "p -> 2026-11-11 (was 2026-W40)",
      done: true,
      children: [{ text: "x -> 2026-11-11 (was 2026-10-01)", done: true }, { text: "y -> 2026-10-02", done: true }, { text: "z", done: true }],
    });
  });

  test("checking the last child rewrites the child and the parent that is checked automatically", () => {
    const next = toggleDone(
      frozen(d([{ text: "p -> 2026-10-01", done: false, children: [{ text: "x -> 2026-10-02", done: true }, { text: "y -> 2026-10-03", done: false }] }])),
      { list: 0, task: 0, child: 1 },
      TODAY,
    );
    expect(next.lists[0]!.tasks[0]).toEqual({
      text: "p -> 2026-11-11 (was 2026-10-01)",
      done: true,
      children: [{ text: "x -> 2026-10-02", done: true }, { text: "y -> 2026-11-11 (was 2026-10-03)", done: true }],
    });
  });

  test("checking a child that does not complete the parent leaves the parent alone", () => {
    const next = toggleDone(
      frozen(d([{ text: "p -> 2026-10-01", done: false, children: [{ text: "x -> 2026-10-02", done: false }, { text: "y", done: false }] }])),
      { list: 0, task: 0, child: 0 },
      TODAY,
    );
    expect(next.lists[0]!.tasks[0]!.text).toBe("p -> 2026-10-01");
    expect(next.lists[0]!.tasks[0]!.children![0]!.text).toBe("x -> 2026-11-11 (was 2026-10-02)");
  });

  test("an already checked parent is not rewritten again when its last child is checked", () => {
    const next = toggleDone(
      frozen(d([{ text: "p -> 2026-10-01", done: true, children: [{ text: "x", done: false }] }])),
      { list: 0, task: 0, child: 0 },
      TODAY,
    );
    expect(next.lists[0]!.tasks[0]!.text).toBe("p -> 2026-10-01");
  });

  test("without a today, no date is rewritten", () => {
    const next = toggleDone(frozen(d([{ text: "a -> 2026-10-30", done: false }])), { list: 0, task: 0 });
    expect(next.lists[0]!.tasks[0]!.text).toBe("a -> 2026-10-30");
  });

  test("the result is one new document, so one history entry", () => {
    const before = frozen(d([{ text: "a -> 2026-10-30", done: false }]));
    expect(toggleDone(before, { list: 0, task: 0 }, TODAY)).not.toBe(before);
    expect(before.lists[0]!.tasks[0]!.text).toBe("a -> 2026-10-30");
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
  test("deleting the last unchecked subtask checks the parent", () => {
    const d = toggleDone(sample(), { list: 0, task: 1, child: 0 }); // a1x checked, a1y unchecked
    expect(deleteTask(frozen(d), { list: 0, task: 1, child: 1 }).lists[0]!.tasks[1]!.done).toBe(true);
    expect(deleteTask(frozen(d), { list: 0, task: 1, child: 0 }).lists[0]!.tasks[1]!.done).toBe(false);
  });
  test("deleting the only subtask leaves the parent state unchanged", () => {
    let d = deleteTask(sample(), { list: 0, task: 1, child: 0 });
    d = deleteTask(frozen(d), { list: 0, task: 1, child: 0 });
    expect(d.lists[0]!.tasks[1]!.done).toBe(false);
  });
  test("editText changes text, refuses empty", () => {
    const s = frozen(sample());
    expect(editText(s, { list: 0, task: 0 }, " hi\nthere ").lists[0]!.tasks[0]!.text).toBe("hi there");
    expect(editText(s, { list: 0, task: 1, child: 1 }, "z").lists[0]!.tasks[1]!.children![1]!.text).toBe("z");
    expect(editText(s, { list: 0, task: 0 }, " ")).toBe(s);
  });
});

describe("cutTask", () => {
  test("removes a task with its subtasks and returns it as the register", () => {
    const r = cutTask(frozen(sample()), { list: 0, task: 1 })!;
    expect(r.doc.lists[0]!.tasks.map((t) => t.text)).toEqual(["a0", "a2"]);
    expect(r.register).toEqual({
      kind: "task",
      task: { text: "a1", done: false, children: [{ text: "a1x", done: false }, { text: "a1y", done: false }] },
    });
  });
  test("removes a subtask and returns it, and the parent is recomputed as in deleteTask", () => {
    const base = sample();
    base.lists[0]!.tasks[1]!.children![1]!.done = true;
    const r = cutTask(frozen(base), { list: 0, task: 1, child: 0 })!;
    expect(r.register).toEqual({ kind: "task", task: { text: "a1x", done: false } });
    expect(r.doc.lists[0]!.tasks[1]).toEqual({ text: "a1", done: true, children: [{ text: "a1y", done: true }] });
  });
  test("gives the same document as deleteTask", () => {
    const d = sample();
    expect(cutTask(d, { list: 0, task: 1, child: 1 })!.doc).toEqual(deleteTask(d, { list: 0, task: 1, child: 1 }));
  });
  test("an unknown path gives null", () => {
    expect(cutTask(sample(), { list: 0, task: 9 })).toBeNull();
  });
});
