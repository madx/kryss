import { describe, expect, test } from "bun:test";
import { canRedo, canUndo, clear, createHistory, MAX_HISTORY, push, redo, undo } from "./index";
import type { TodoDocument } from "../../shared/types";

const doc = (n: number): TodoDocument => ({ lists: [{ title: String(n), tasks: [] }] });

describe("history", () => {
  test("undo then redo", () => {
    let h = push(push(createHistory(), doc(0)), doc(1)); // current is doc(2)
    const u = undo(h, doc(2))!;
    expect(u.doc).toEqual(doc(1));
    h = u.history;
    const u2 = undo(h, u.doc)!;
    expect(u2.doc).toEqual(doc(0));
    expect(canUndo(u2.history)).toBe(false);
    const r = redo(u2.history, u2.doc)!;
    expect(r.doc).toEqual(doc(1));
    expect(canRedo(r.history)).toBe(true);
    expect(redo(redo(r.history, r.doc)!.history, doc(2))).toBeNull();
  });
  test("empty stacks return null", () => {
    expect(undo(createHistory(), doc(0))).toBeNull();
    expect(redo(createHistory(), doc(0))).toBeNull();
  });
  test("a new push clears redo", () => {
    const u = undo(push(createHistory(), doc(0)), doc(1))!;
    expect(canRedo(u.history)).toBe(true);
    expect(canRedo(push(u.history, doc(5)))).toBe(false);
  });
  test("clear empties everything; push does not mutate", () => {
    const h = createHistory();
    push(h, doc(0));
    expect(h.past).toHaveLength(0);
    expect(clear()).toEqual({ past: [], future: [] });
  });
  test("the stack is bounded", () => {
    let h = createHistory();
    for (let i = 0; i < MAX_HISTORY + 10; i++) h = push(h, doc(i));
    expect(h.past).toHaveLength(MAX_HISTORY);
    expect(h.past[0]).toEqual(doc(10));
  });
});
