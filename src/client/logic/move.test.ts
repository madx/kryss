import { describe, expect, test } from "bun:test";
import type { TodoDocument } from "../../shared/types";
import { indent, moveDown, moveTask, moveUp, outdent, toggleDone, validateDrop } from "./index";
import { frozen, sample } from "./helpers.test-util";

const texts = (d: TodoDocument, l = 0) => d.lists[l]!.tasks.map((t) => t.text);

describe("indent / outdent", () => {
  test("indent makes the task the last child of the previous task", () => {
    const r = indent(frozen(sample()), { list: 0, task: 2 })!;
    expect(r.path).toEqual({ list: 0, task: 1, child: 2 });
    expect(texts(r.doc)).toEqual(["a0", "a1"]);
  });
  test("indent refuses the first task, a subtask and a task with subtasks", () => {
    const s = frozen(sample());
    expect(indent(s, { list: 0, task: 0 })).toBeNull();
    expect(indent(s, { list: 0, task: 1, child: 1 })).toBeNull();
    expect(indent(s, { list: 0, task: 1 })).toBeNull();
  });
  test("indent unchecks a checked parent when the task is unchecked", () => {
    const d = toggleDone(sample(), { list: 0, task: 0 });
    const r = indent(frozen(d), { list: 0, task: 1 });
    expect(r).toBeNull(); // a1 has children
    const r2 = indent(frozen(toggleDone(sample(), { list: 0, task: 1 })), { list: 0, task: 2 })!;
    expect(r2.doc.lists[0]!.tasks[1]!.done).toBe(false);
  });
  test("outdent puts the subtask right after its parent", () => {
    const r = outdent(frozen(sample()), { list: 0, task: 1, child: 0 })!;
    expect(r.path).toEqual({ list: 0, task: 2 });
    expect(texts(r.doc)).toEqual(["a0", "a1", "a1x", "a2"]);
    expect(outdent(sample(), { list: 0, task: 0 })).toBeNull();
  });
  test("outdent of the last subtask removes the children key", () => {
    const one = outdent(sample(), { list: 0, task: 1, child: 0 })!.doc;
    const two = outdent(frozen(one), { list: 0, task: 1, child: 0 })!.doc;
    expect("children" in two.lists[0]!.tasks[1]!).toBe(false);
  });
});

describe("old parent recompute", () => {
  const halfChecked = () => toggleDone(sample(), { list: 0, task: 1, child: 0 }); // a1x checked, a1y unchecked
  test("moving the last unchecked subtask out checks the parent", () => {
    const r = moveTask(frozen(halfChecked()), { list: 0, task: 1, child: 1 }, { kind: "after", target: { list: 0, task: 2 } })!;
    expect(r.doc.lists[0]!.tasks[1]!.done).toBe(true);
  });
  test("outdent checks the parent when the remaining subtasks are all checked", () => {
    const r = outdent(frozen(halfChecked()), { list: 0, task: 1, child: 1 })!;
    expect(r.doc.lists[0]!.tasks[1]!.done).toBe(true);
    expect(outdent(frozen(halfChecked()), { list: 0, task: 1, child: 0 })!.doc.lists[0]!.tasks[1]!.done).toBe(false);
  });
  test("a parent left with no subtask keeps its state", () => {
    const one = outdent(sample(), { list: 0, task: 1, child: 0 })!.doc;
    expect(outdent(frozen(one), { list: 0, task: 1, child: 0 })!.doc.lists[0]!.tasks[1]!.done).toBe(false);
    const checked = toggleDone(one, { list: 0, task: 1 });
    expect(outdent(frozen(checked), { list: 0, task: 1, child: 0 })!.doc.lists[0]!.tasks[1]!.done).toBe(true);
  });
});

describe("keyboard move", () => {
  test("moveUp / moveDown swap with a sibling and carry the subtree", () => {
    const s = frozen(sample());
    expect(texts(moveUp(s, { list: 0, task: 2 })!.doc)).toEqual(["a0", "a2", "a1"]);
    const down = moveDown(s, { list: 0, task: 1 })!;
    expect(texts(down.doc)).toEqual(["a0", "a2", "a1"]);
    expect(down.path).toEqual({ list: 0, task: 2 });
    expect(down.doc.lists[0]!.tasks[2]!.children).toHaveLength(2);
  });
  test("null at the very edges of the document", () => {
    const s = frozen(sample());
    expect(moveUp(s, { list: 0, task: 0 })).toBeNull();
    expect(moveDown(s, { list: 1, task: 0 })).toBeNull();
    const last = moveTask(s, { list: 0, task: 2 }, { kind: "end", list: 1 })!.doc;
    expect(moveDown(frozen(last), { list: 1, task: 0 })).toBeNull();
    expect(moveUp(s, { list: 0, task: 99 })).toBeNull();
  });
  test("a top-level task crosses to the end of the previous list and the start of the next", () => {
    const s = frozen(sample());
    const down = moveDown(s, { list: 0, task: 2 })!;
    expect(down.path).toEqual({ list: 1, task: 0 });
    expect(texts(down.doc, 0)).toEqual(["a0", "a1"]);
    const back = moveUp(frozen(down.doc), down.path)!;
    expect(back.path).toEqual({ list: 0, task: 2 });
    const nonEmpty = frozen(moveTask(s, { list: 0, task: 0 }, { kind: "end", list: 1 })!.doc); // list 1: a0
    const d3 = moveDown(nonEmpty, { list: 0, task: 1 })!; // list 0: a1, a2 ; a2 goes to the start of list 1
    expect(d3.path).toEqual({ list: 1, task: 0 });
    expect(texts(d3.doc, 1)).toEqual(["a2", "a0"]);
    const up = moveUp(frozen(d3.doc), { list: 1, task: 0 })!;
    expect(up.path).toEqual({ list: 0, task: 1 });
  });
  test("a top-level task swaps past a previous or next task that has subtasks without entering it", () => {
    const s = frozen(sample());
    expect(moveDown(s, { list: 0, task: 0 })!.path).toEqual({ list: 0, task: 1 });
    expect(texts(moveDown(s, { list: 0, task: 0 })!.doc)).toEqual(["a1", "a0", "a2"]);
    expect(texts(moveUp(s, { list: 0, task: 2 })!.doc)).toEqual(["a0", "a2", "a1"]);
  });
  test("a subtask swaps with its siblings", () => {
    const r = moveDown(frozen(sample()), { list: 0, task: 1, child: 0 })!;
    expect(r.path).toEqual({ list: 0, task: 1, child: 1 });
  });
  test("the first subtask moves to the previous top-level task as its last subtask", () => {
    const r = moveUp(frozen(sample()), { list: 0, task: 1, child: 0 })!;
    expect(r.path).toEqual({ list: 0, task: 0, child: 0 });
    expect(r.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1y"]);
  });
  test("the first subtask of the first task becomes a task just before its parent", () => {
    const d = moveTask(sample(), { list: 0, task: 0 }, { kind: "end", list: 1 })!.doc; // a1 is now first
    const r = moveUp(frozen(d), { list: 0, task: 0, child: 0 })!;
    expect(r.path).toEqual({ list: 0, task: 0 });
    expect(texts(r.doc)).toEqual(["a1x", "a1", "a2"]);
  });
  test("the last subtask moves to the next top-level task as its first subtask", () => {
    const r = moveDown(frozen(sample()), { list: 0, task: 1, child: 1 })!;
    expect(r.path).toEqual({ list: 0, task: 2, child: 0 });
    expect(r.doc.lists[0]!.tasks[2]!.children!.map((c) => c.text)).toEqual(["a1y"]);
  });
  test("the last subtask goes before the first subtask of a next task that has subtasks", () => {
    const d = moveTask(sample(), { list: 0, task: 0 }, { kind: "child", target: { list: 0, task: 2 } })!.doc; // a1, a2(a0)
    const r = moveDown(frozen(d), { list: 0, task: 0, child: 1 })!;
    expect(r.path).toEqual({ list: 0, task: 1, child: 0 });
    expect(r.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1y", "a0"]);
  });
  test("the last subtask of the last task becomes a task just after its parent", () => {
    const d = moveTask(sample(), { list: 0, task: 2 }, { kind: "before", target: { list: 0, task: 0 } })!.doc; // a2, a0, a1
    const r = moveDown(frozen(d), { list: 0, task: 2, child: 1 })!;
    expect(r.path).toEqual({ list: 0, task: 3 });
    expect(texts(r.doc)).toEqual(["a2", "a0", "a1", "a1y"]);
  });
  test("an unchecked subtask landing under a checked task unchecks it, and the old parent is recomputed", () => {
    let d = toggleDone(sample(), { list: 0, task: 1, child: 0 }); // a1x checked
    d = toggleDone(d, { list: 0, task: 0 }); // a0 checked
    const r = moveUp(frozen(d), { list: 0, task: 1, child: 0 })!; // a1x (checked) to a0
    expect(r.doc.lists[0]!.tasks[0]!.done).toBe(true);
    const r2 = moveUp(frozen(toggleDone(d, { list: 0, task: 1, child: 1 })), { list: 0, task: 1, child: 1 })!; // a1y checked? toggled to checked
    expect(r2.path.child).toBe(0);
    const r3 = moveDown(frozen(d), { list: 0, task: 1, child: 1 })!; // a1y unchecked onto a2
    expect(r3.doc.lists[0]!.tasks[1]!.done).toBe(true); // a1 keeps only checked a1x
    const e = toggleDone(d, { list: 0, task: 2 }); // a2 checked
    expect(moveDown(frozen(e), { list: 0, task: 1, child: 1 })!.doc.lists[0]!.tasks[2]!.done).toBe(false);
  });
  test("subtasks stay under their parent and never change its state", () => {
    const d = toggleDone(sample(), { list: 0, task: 1 }); // parent and children checked
    const u = toggleDone(d, { list: 0, task: 1, child: 1 }); // child y unchecked, parent unchecked
    const rechecked = { ...u, lists: [{ ...u.lists[0]!, tasks: u.lists[0]!.tasks.map((t, i) => (i === 1 ? { ...t, done: true } : t)) }, u.lists[1]!] };
    const r = moveUp(frozen(rechecked), { list: 0, task: 1, child: 1 })!;
    expect(r.path).toEqual({ list: 0, task: 1, child: 0 });
    expect(r.doc.lists[0]!.tasks[1]!.done).toBe(true);
    expect(r.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1y", "a1x"]);
  });
});

describe("drag and drop", () => {
  test("before / after / child", () => {
    const s = frozen(sample());
    expect(texts(moveTask(s, { list: 0, task: 2 }, { kind: "before", target: { list: 0, task: 0 } })!.doc)).toEqual(["a2", "a0", "a1"]);
    expect(texts(moveTask(s, { list: 0, task: 0 }, { kind: "after", target: { list: 0, task: 2 } })!.doc)).toEqual(["a1", "a2", "a0"]);
    const c = moveTask(s, { list: 0, task: 0 }, { kind: "child", target: { list: 0, task: 2 } })!;
    expect(c.path).toEqual({ list: 0, task: 1, child: 0 });
    expect(c.doc.lists[0]!.tasks[1]).toEqual({ text: "a2", done: false, children: [{ text: "a0", done: false }] });
  });
  test("a subtask dropped before / after a top-level task becomes a task", () => {
    const r = moveTask(frozen(sample()), { list: 0, task: 1, child: 1 }, { kind: "before", target: { list: 0, task: 0 } })!;
    expect(texts(r.doc)).toEqual(["a1y", "a0", "a1", "a2"]);
    expect(r.path).toEqual({ list: 0, task: 0 });
  });
  test("before / after a subtask makes the task a subtask of that parent", () => {
    const r = moveTask(frozen(sample()), { list: 0, task: 0 }, { kind: "after", target: { list: 0, task: 1, child: 0 } })!;
    expect(r.path).toEqual({ list: 0, task: 0, child: 1 });
    expect(r.doc.lists[0]!.tasks[0]!.children!.map((c) => c.text)).toEqual(["a1x", "a0", "a1y"]);
  });
  test("after a parent with subtasks inserts the task as its first subtask", () => {
    const r = moveTask(frozen(sample()), { list: 0, task: 0 }, { kind: "after", target: { list: 0, task: 1 } })!;
    expect(r.path).toEqual({ list: 0, task: 0, child: 0 });
    expect(r.doc.lists[0]!.tasks[0]!.children!.map((c) => c.text)).toEqual(["a0", "a1x", "a1y"]);
    expect(texts(r.doc)).toEqual(["a1", "a2"]);
  });
  test("after a parent with subtasks, a task that has subtasks goes after the whole parent", () => {
    const d = moveTask(sample(), { list: 0, task: 2 }, { kind: "child", target: { list: 0, task: 0 } })!.doc; // a0 has a2
    const r = moveTask(frozen(d), { list: 0, task: 1 }, { kind: "after", target: { list: 0, task: 0 } })!;
    expect(texts(r.doc)).toEqual(["a0", "a1"]);
    expect(r.path).toEqual({ list: 0, task: 1 });
  });
  test("after its own parent, a subtask becomes the first subtask", () => {
    const r = moveTask(frozen(sample()), { list: 0, task: 1, child: 1 }, { kind: "after", target: { list: 0, task: 1 } })!;
    expect(r.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1y", "a1x"]);
  });
  test("after a parent without subtasks stays a sibling", () => {
    const r = moveTask(frozen(sample()), { list: 0, task: 1 }, { kind: "after", target: { list: 0, task: 0 } })!;
    expect(texts(r.doc)).toEqual(["a0", "a1", "a2"]);
  });
  test("between subtasks inserts at that position", () => {
    const r = moveTask(frozen(sample()), { list: 0, task: 2 }, { kind: "before", target: { list: 0, task: 1, child: 1 } })!;
    expect(r.path).toEqual({ list: 0, task: 1, child: 1 });
    expect(r.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1x", "a2", "a1y"]);
  });
  test("across lists, including into an empty list", () => {
    const s = frozen(sample());
    const r = moveTask(s, { list: 0, task: 1 }, { kind: "end", list: 1 })!;
    expect(r.path).toEqual({ list: 1, task: 0 });
    expect(r.doc.lists[1]!.tasks[0]!.children).toHaveLength(2);
    expect(texts(r.doc)).toEqual(["a0", "a2"]);
    const r2 = moveTask(s, { list: 0, task: 0 }, { kind: "child", target: { list: 0, task: 1 } })!;
    expect(r2.path.child).toBe(2);
  });
  test("forbids a drop into a descendant, onto itself and a third level", () => {
    const s = frozen(sample());
    const ok = (src: any, drop: any) => validateDrop(s, src, drop);
    expect(ok({ list: 0, task: 1 }, { kind: "child", target: { list: 0, task: 1, child: 0 } })).toEqual({ ok: false, reason: "descendant" });
    expect(ok({ list: 0, task: 1 }, { kind: "after", target: { list: 0, task: 1, child: 0 } })).toEqual({ ok: false, reason: "descendant" });
    expect(ok({ list: 0, task: 0 }, { kind: "before", target: { list: 0, task: 0 } })).toEqual({ ok: false, reason: "self" });
    expect(ok({ list: 0, task: 1 }, { kind: "child", target: { list: 0, task: 2 } })).toEqual({ ok: false, reason: "third-level" });
    expect(ok({ list: 0, task: 1 }, { kind: "before", target: { list: 0, task: 1, child: 0 } }).ok).toBe(false);
    expect(ok({ list: 0, task: 0 }, { kind: "child", target: { list: 0, task: 1, child: 0 } })).toEqual({ ok: false, reason: "third-level" });
    expect(ok({ list: 0, task: 1 }, { kind: "after", target: { list: 1, task: 0 } })).toEqual({ ok: false, reason: "invalid" });
    expect(moveTask(s, { list: 0, task: 1 }, { kind: "child", target: { list: 0, task: 2 } })).toBeNull();
  });
  test("a task with children may be dropped before / after another top-level task", () => {
    expect(validateDrop(sample(), { list: 0, task: 1 }, { kind: "after", target: { list: 0, task: 2 } }).ok).toBe(true);
  });
  test("an unchecked task dropped under a checked parent unchecks it; a checked one does not", () => {
    const checked = toggleDone(sample(), { list: 0, task: 2 });
    const r = moveTask(frozen(checked), { list: 0, task: 0 }, { kind: "child", target: { list: 0, task: 2 } })!;
    expect(r.doc.lists[0]!.tasks[1]!.done).toBe(false);
    const both = toggleDone(toggleDone(sample(), { list: 0, task: 2 }), { list: 0, task: 0 });
    const r2 = moveTask(frozen(both), { list: 0, task: 0 }, { kind: "child", target: { list: 0, task: 2 } })!;
    expect(r2.doc.lists[0]!.tasks[1]!.done).toBe(true);
  });
  test("dropping the only subtask as a child of its own parent is refused and loses nothing", () => {
    const one = outdent(sample(), { list: 0, task: 1, child: 0 })!.doc; // a1 keeps only a1y
    const drop = { kind: "child", target: { list: 0, task: 1 } } as const;
    expect(validateDrop(frozen(one), { list: 0, task: 1, child: 0 }, drop).ok).toBe(false);
    expect(moveTask(one, { list: 0, task: 1, child: 0 }, drop)).toBeNull();
  });
  test("dropping a subtask as a child of its own parent moves it last", () => {
    const r = moveTask(frozen(sample()), { list: 0, task: 1, child: 0 }, { kind: "child", target: { list: 0, task: 1 } })!;
    expect(r.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["a1y", "a1x"]);
    expect(r.path).toEqual({ list: 0, task: 1, child: 1 });
  });
  test("does not mutate its input", () => {
    const s = frozen(sample());
    expect(() => moveTask(s, { list: 0, task: 1 }, { kind: "end", list: 1 })).not.toThrow();
  });
});
