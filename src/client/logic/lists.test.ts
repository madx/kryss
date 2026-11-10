import { describe, expect, test } from "bun:test";
import type { TodoDocument } from "../../shared/types";
import { addList, cutList, deleteList, listMoveTarget, moveList, renameList } from "./index";
import { frozen, sample } from "./helpers.test-util";

describe("lists", () => {
  test("addList appends an empty list", () => {
    const d = addList(frozen(sample()), " New ");
    expect(d.lists).toHaveLength(3);
    expect(d.lists[2]).toEqual({ title: "New", tasks: [] });
  });
  test("addList works on an empty document and refuses an empty title", () => {
    expect(addList({ lists: [] }, "A").lists).toHaveLength(1);
    const s = frozen(sample());
    expect(addList(s, " ")).toBe(s);
  });
  test("renameList", () => {
    const s = frozen(sample());
    expect(renameList(s, 1, "Done").lists[1]!.title).toBe("Done");
    expect(renameList(s, 1, "")).toBe(s);
    expect(renameList(s, 7, "x")).toBe(s);
  });
  test("deleteList", () => {
    const s = frozen(sample());
    expect(deleteList(s, 0).lists.map((l) => l.title)).toEqual(["Empty"]);
    expect(deleteList(s, 7)).toBe(s);
  });
});

const four = (): TodoDocument => ({
  lists: ["A", "B", "C", "D"].map((title) => ({ title, tasks: [{ text: `${title.toLowerCase()}0`, done: true }] })),
});
const titles = (d: TodoDocument) => d.lists.map((l) => l.title).join("");

describe("moveList", () => {
  test("moves a list before a later target", () => {
    const r = moveList(frozen(four()), 0, 2, "before")!;
    expect(titles(r.doc)).toBe("BACD");
    expect(r.list).toBe(1);
  });
  test("moves a list after an earlier target", () => {
    const r = moveList(frozen(four()), 3, 0, "after")!;
    expect(titles(r.doc)).toBe("ADBC");
    expect(r.list).toBe(1);
  });
  test("moves the first list after the last one", () => {
    const r = moveList(frozen(four()), 0, 3, "after")!;
    expect(titles(r.doc)).toBe("BCDA");
    expect(r.list).toBe(3);
  });
  test("moves the last list before the first one", () => {
    const r = moveList(frozen(four()), 3, 0, "before")!;
    expect(titles(r.doc)).toBe("DABC");
    expect(r.list).toBe(0);
  });
  test("a list moved before or after itself is a no-op", () => {
    expect(moveList(four(), 1, 1, "before")).toBeNull();
    expect(moveList(four(), 1, 1, "after")).toBeNull();
  });
  test("placing a list where it already is returns null", () => {
    expect(moveList(four(), 1, 0, "after")).toBeNull();
    expect(moveList(four(), 1, 2, "before")).toBeNull();
    expect(moveList(four(), 0, 1, "before")).toBeNull();
    expect(moveList(four(), 3, 2, "after")).toBeNull();
  });
  test("keeps the tasks and does not mutate the input", () => {
    const d = frozen(four());
    const r = moveList(d, 1, 3, "after")!;
    expect(r.doc.lists[3]).toEqual(d.lists[1]!);
    expect(titles(d)).toBe("ABCD");
  });
  test("an unknown list or target returns null", () => {
    expect(moveList(four(), 7, 0, "before")).toBeNull();
    expect(moveList(four(), 0, 7, "after")).toBeNull();
    expect(moveList(four(), -1, 0, "after")).toBeNull();
  });
});

describe("listMoveTarget", () => {
  const all = { first: 0, last: 3 };
  test("down targets the next list, after it", () => {
    expect(listMoveTarget(1, "down", all)).toEqual({ target: 2, place: "after" });
  });
  test("up targets the previous list, before it", () => {
    expect(listMoveTarget(2, "up", all)).toEqual({ target: 1, place: "before" });
  });
  test("returns null at both edges", () => {
    expect(listMoveTarget(0, "up", all)).toBeNull();
    expect(listMoveTarget(3, "down", all)).toBeNull();
  });
  test("returns null at the edges of a visible range, even with lists beyond it", () => {
    const range = { first: 1, last: 2 };
    expect(listMoveTarget(1, "up", range)).toBeNull();
    expect(listMoveTarget(2, "down", range)).toBeNull();
    expect(listMoveTarget(1, "down", range)).toEqual({ target: 2, place: "after" });
  });
  test("a single visible list never moves", () => {
    expect(listMoveTarget(1, "up", { first: 1, last: 1 })).toBeNull();
    expect(listMoveTarget(1, "down", { first: 1, last: 1 })).toBeNull();
  });
});

describe("cutList", () => {
  test("removes the list and returns it with its tasks as the register", () => {
    const r = cutList(frozen(sample()), 0)!;
    expect(r.doc.lists.map((l) => l.title)).toEqual(["Empty"]);
    expect(r.register).toEqual({ kind: "list", list: sample().lists[0]! });
  });
  test("an unknown list gives null", () => {
    expect(cutList(sample(), 5)).toBeNull();
  });
});
