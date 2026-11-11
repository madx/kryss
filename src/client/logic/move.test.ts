import { describe, expect, test } from "bun:test";
import type { TodoDocument } from "../../shared/types";
import { indent, moveDown, moveTask, moveUp, outdent, toggleDone, validateDrop } from "./index";
import { visibleRows } from "./filter";
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
  test("the first subtask of the first task does nothing on Alt+Up", () => {
    const d = moveTask(sample(), { list: 0, task: 0 }, { kind: "end", list: 1 })!.doc; // a1 is now first
    expect(moveUp(frozen(d), { list: 0, task: 0, child: 0 })).toBeNull();
  });
  test("the keyboard moves stay within the visible lists", () => {
    const d = frozen(moveTask(sample(), { list: 0, task: 2 }, { kind: "end", list: 1 })!.doc); // a2 is alone in list 1
    const only = (list: number) => ({ lists: [{ list, tasks: [] }], error: null, filtering: true });
    expect(moveUp(d, { list: 1, task: 0 }, only(1))).toBeNull();
    expect(moveDown(d, { list: 0, task: 1 }, only(0))).toBeNull(); // last task of the only visible list
    expect(moveDown(d, { list: 0, task: 1 })!.path.list).toBe(1);
    expect(moveUp(d, { list: 1, task: 0 })!.path.list).toBe(0);
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
  test("the last subtask of the last task does nothing on Alt+Down", () => {
    const d = moveTask(sample(), { list: 0, task: 2 }, { kind: "before", target: { list: 0, task: 0 } })!.doc; // a2, a0, a1
    expect(moveDown(frozen(d), { list: 0, task: 2, child: 1 })).toBeNull();
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

// --- Moves over the visible rows (PRD 5.14) ---

const TODAY = "2026-11-11";
const t = (text: string, ...children: string[]) => ({ text, done: false, ...(children.length ? { children: children.map((c) => ({ text: c, done: false })) } : {}) });
const kids = (d: TodoDocument, l: number, task: number) => d.lists[l]!.tasks[task]!.children!.map((c) => c.text);
/** The filter `x` shows the tasks and subtasks whose text has an x. */
const rows = (d: TodoDocument, siblings = false) => visibleRows(d, "x", TODAY, [], siblings);

describe("moves under a filter", () => {
  const flat = () =>
    frozen<TodoDocument>({
      filters: [],
      lists: [
        { title: "A", tasks: [t("x0"), t("h1"), t("x2"), t("h3")] },
        { title: "B", tasks: [t("h4")] },
        { title: "C", tasks: [t("h5"), t("x6"), t("h7")] },
      ],
    });

  test("moving down jumps over hidden siblings and lands right after the next visible task", () => {
    const d = flat();
    const r = moveDown(d, { list: 0, task: 0 }, rows(d))!;
    expect(texts(r.doc)).toEqual(["h1", "x2", "x0", "h3"]);
    expect(r.path).toEqual({ list: 0, task: 2 });
  });
  test("moving up jumps over hidden siblings and lands right before the previous visible task", () => {
    const d = flat();
    const r = moveUp(d, { list: 0, task: 2 }, rows(d))!;
    expect(texts(r.doc)).toEqual(["x2", "x0", "h1", "h3"]);
    expect(r.path).toEqual({ list: 0, task: 0 });
  });
  test("a task with subtasks moves with its whole subtree, hidden subtasks included", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [t("xp", "hb", "xc"), t("h1"), t("x2")] }] });
    const r = moveDown(d, { list: 0, task: 0 }, rows(d))!;
    expect(texts(r.doc)).toEqual(["h1", "x2", "xp"]);
    expect(kids(r.doc, 0, 2)).toEqual(["hb", "xc"]);
  });
  test("the last visible task crosses to the next visible list, before its first visible task, jumping over hidden lists", () => {
    const d = flat();
    const r = moveDown(d, { list: 0, task: 2 }, rows(d))!;
    expect(r.path).toEqual({ list: 2, task: 1 });
    expect(texts(r.doc, 2)).toEqual(["h5", "x2", "x6", "h7"]);
    expect(texts(r.doc, 1)).toEqual(["h4"]);
  });
  test("the first visible task crosses to the previous visible list, after its last visible task", () => {
    const d = flat();
    const r = moveUp(d, { list: 2, task: 1 }, rows(d))!;
    expect(r.path).toEqual({ list: 0, task: 3 });
    expect(texts(r.doc)).toEqual(["x0", "h1", "x2", "x6", "h3"]);
  });
  test("crossing up lands after the whole subtree of the last visible task", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [t("xp", "xa")] }, { title: "B", tasks: [t("x1")] }] });
    const r = moveUp(d, { list: 1, task: 0 }, rows(d))!;
    expect(r.path).toEqual({ list: 0, task: 1 });
    expect(texts(r.doc)).toEqual(["xp", "x1"]);
    expect(kids(r.doc, 0, 0)).toEqual(["xa"]);
  });
  test("nothing happens at the edges of the visible rows", () => {
    const d = flat();
    expect(moveUp(d, { list: 0, task: 0 }, rows(d))).toBeNull();
    expect(moveDown(d, { list: 2, task: 1 }, rows(d))).toBeNull();
  });

  const sub = () => frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [t("p0", "xa", "hb", "xc")] }] });
  test("a subtask moves among its visible siblings only", () => {
    const d = sub();
    const down = moveDown(d, { list: 0, task: 0, child: 0 }, rows(d))!;
    expect(kids(down.doc, 0, 0)).toEqual(["hb", "xc", "xa"]);
    expect(down.path).toEqual({ list: 0, task: 0, child: 2 });
    const up = moveUp(d, { list: 0, task: 0, child: 2 }, rows(d))!;
    expect(kids(up.doc, 0, 0)).toEqual(["xc", "xa", "hb"]);
  });
  test("with the siblings toggle on, the hidden subtasks shown count as neighbours", () => {
    const d = sub();
    const r = moveDown(d, { list: 0, task: 0, child: 0 }, rows(d, true))!;
    expect(kids(r.doc, 0, 0)).toEqual(["hb", "xa", "xc"]);
  });
  test("a subtask at the edge joins the previous or next visible top-level task, jumping over hidden ones", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [t("pa", "xa"), t("hz"), t("pb", "hb2", "xb")] }] });
    const down = moveDown(d, { list: 0, task: 0, child: 0 }, rows(d))!;
    expect(down.path).toEqual({ list: 0, task: 2, child: 1 });
    expect(kids(down.doc, 0, 2)).toEqual(["hb2", "xa", "xb"]);
    const up = moveUp(d, { list: 0, task: 2, child: 1 }, rows(d))!;
    expect(up.path).toEqual({ list: 0, task: 0, child: 1 });
    expect(kids(up.doc, 0, 0)).toEqual(["xa", "xb"]);
  });
  test("a subtask with no visible top-level task to join does nothing", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [t("pa", "xa")] }] });
    expect(moveUp(d, { list: 0, task: 0, child: 0 }, rows(d))).toBeNull();
    expect(moveDown(d, { list: 0, task: 0, child: 0 }, rows(d))).toBeNull();
  });

  test("indent makes the task the last subtask of the previous visible task, after its hidden subtasks", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [t("p0", "xa", "hb"), t("h1"), t("x2")] }] });
    const r = indent(d, { list: 0, task: 2 }, rows(d))!;
    expect(r.path).toEqual({ list: 0, task: 0, child: 2 });
    expect(texts(r.doc)).toEqual(["p0", "h1"]);
    expect(kids(r.doc, 0, 0)).toEqual(["xa", "hb", "x2"]);
  });
  test("indent does nothing without a previous visible top-level task, or for a task with subtasks", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [t("h0"), t("x1"), t("xp", "xa")] }] });
    expect(indent(d, { list: 0, task: 1 }, rows(d))).toBeNull();
    expect(indent(d, { list: 0, task: 2 }, rows(d))).toBeNull();
  });
});

describe("path moves", () => {
  test("a move reports every node whose path changed", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [t("x0"), t("h1"), t("x2"), t("h3")] }] });
    const r = moveDown(d, { list: 0, task: 0 }, rows(d))!;
    expect(r.moves).toHaveLength(3);
    expect(r.moves).toEqual(expect.arrayContaining([
      { from: { list: 0, task: 0 }, to: { list: 0, task: 2 } },
      { from: { list: 0, task: 1 }, to: { list: 0, task: 0 } },
      { from: { list: 0, task: 2 }, to: { list: 0, task: 1 } },
    ]));
  });
  test("a moved subtree reports its subtasks too", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [t("xp", "xa"), t("x1")] }] });
    const r = moveDown(d, { list: 0, task: 0 }, rows(d))!;
    expect(r.moves).toEqual(expect.arrayContaining([{ from: { list: 0, task: 0, child: 0 }, to: { list: 0, task: 1, child: 0 } }]));
  });
  test("an outdent reports the outdented subtask and the tasks it shifts", () => {
    const r = outdent(frozen(sample()), { list: 0, task: 1, child: 0 })!;
    expect(r.moves).toEqual(expect.arrayContaining([
      { from: { list: 0, task: 1, child: 0 }, to: { list: 0, task: 2 } },
      { from: { list: 0, task: 2 }, to: { list: 0, task: 3 } },
      { from: { list: 0, task: 1, child: 1 }, to: { list: 0, task: 1, child: 0 } },
    ]));
  });
});

describe("an outdented subtask under a filter", () => {
  test("stays visible when pinned, although it no longer matches", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [t("xp", "hb")] }] });
    const r = outdent(d, { list: 0, task: 0, child: 0 })!;
    expect(rows(r.doc).lists).toEqual([{ list: 0, tasks: [{ task: 0, children: [], hidden: 0 }] }]); // hb is hidden
    const pinned = visibleRows(r.doc, "x", TODAY, [r.path]);
    expect(pinned.lists[0]!.tasks.map((v) => v.task)).toEqual([0, 1]);
  });
});

describe("check rules under a filter", () => {
  test("an unchecked subtask moved under a checked visible task unchecks it", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [{ text: "pa", done: true, children: [{ text: "xa", done: true }] }, t("hz"), { text: "pb", done: true, children: [{ text: "xb", done: false }, { text: "xc", done: true }] }] }] });
    const r = moveUp(d, { list: 0, task: 2, child: 0 }, rows(d))!;
    expect(r.doc.lists[0]!.tasks[0]!.done).toBe(false);
  });
  test("a subtask leaving a parent whose other subtasks are checked checks the parent", () => {
    const d = frozen<TodoDocument>({ filters: [], lists: [{ title: "A", tasks: [{ text: "pb", done: false, children: [{ text: "xb", done: true }, { text: "xc", done: false }] }, t("pc", "xd")] }] });
    const r = moveDown(d, { list: 0, task: 0, child: 1 }, rows(d))!;
    expect(r.doc.lists[0]!.tasks[0]!.done).toBe(true);
  });
});
