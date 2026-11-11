import { describe, expect, test } from "bun:test";
import type { TodoDocument } from "../../shared/types";
import { clampIndex, firstChanged, indexOfStop, moveCursor, parseStoredIndex, stops, type Stop } from "./cursor";
import { frozen, sample } from "./helpers.test-util";

const H = (list: number): Stop => ({ kind: "header", list });
const T = (list: number, task: number, child?: number): Stop => ({
  kind: "task",
  path: child === undefined ? { list, task } : { list, task, child },
});

/** Three lists: two tasks, empty, one task with one subtask. */
function three(): TodoDocument {
  return {
    filters: [],
    lists: [
      { title: "X", tasks: [{ text: "x0", done: false }, { text: "x1", done: false }] },
      { title: "Y", tasks: [] },
      { title: "Z", tasks: [{ text: "z0", done: false, children: [{ text: "z0a", done: false }] }] },
    ],
  };
}

const THREE: Stop[] = [H(0), T(0, 0), T(0, 1), H(1), H(2), T(2, 0), T(2, 0, 0)];

describe("stops", () => {
  test("orders header, tasks and subtasks in document order", () => {
    expect(stops(sample())).toEqual([H(0), T(0, 0), T(0, 1), T(0, 1, 0), T(0, 1, 1), T(0, 2), H(1)]);
  });
  test("an empty list contributes only its header", () => {
    expect(stops(three())).toEqual([H(0), T(0, 0), T(0, 1), H(1), H(2), T(2, 0), T(2, 0, 0)]);
  });
  test("an empty document has no stop", () => {
    expect(stops({ lists: [], filters: [] })).toEqual([]);
  });
  test("a range restricts to one list", () => {
    expect(stops(three(), { first: 2, last: 2 })).toEqual([H(2), T(2, 0), T(2, 0, 0)]);
  });
  test("a range keeps original list indices", () => {
    expect(stops(three(), { first: 1, last: 1 })).toEqual([H(1)]);
  });
  test("a range spanning several lists includes both bounds", () => {
    expect(stops(three(), { first: 0, last: 1 })).toEqual([H(0), T(0, 0), T(0, 1), H(1)]);
  });
  test("default range is the whole document", () => {
    expect(stops(three())).toEqual(stops(three(), { first: 0, last: 2 }));
  });
  test("a task with an empty children array has no subtask stop", () => {
    const doc: TodoDocument = { lists: [{ title: "L", tasks: [{ text: "t", done: false, children: [] }] }], filters: [] };
    expect(stops(doc)).toEqual([H(0), T(0, 0)]);
  });
  test("does not mutate the document", () => {
    const doc = frozen(sample());
    expect(stops(doc, { first: 0, last: 1 })).toHaveLength(7);
  });
});

describe("moveCursor", () => {
  const s: Stop[] = [H(0), T(0, 0), T(0, 1), T(0, 1, 0), T(0, 1, 1), T(0, 2), H(1)];
  test("next moves one stop down", () => {
    expect(moveCursor(s, 1, "next")).toBe(2);
  });
  test("prev moves one stop up", () => {
    expect(moveCursor(s, 3, "prev")).toBe(2);
  });
  test("next does not wrap at the end", () => {
    expect(moveCursor(s, s.length - 1, "next")).toBe(s.length - 1);
  });
  test("prev does not wrap at the start", () => {
    expect(moveCursor(s, 0, "prev")).toBe(0);
  });
  test("first goes to index 0", () => {
    expect(moveCursor(s, 4, "first")).toBe(0);
  });
  test("last goes to the final stop", () => {
    expect(moveCursor(s, 2, "last")).toBe(s.length - 1);
  });
  test("next-header jumps to the next header", () => {
    expect(moveCursor(s, 0, "next-header")).toBe(6);
  });
  test("next-header from a task jumps to the following header", () => {
    expect(moveCursor(s, 3, "next-header")).toBe(6);
  });
  test("next-header stays put when no header is further", () => {
    expect(moveCursor(s, 6, "next-header")).toBe(6);
    expect(moveCursor(s, 4, "next-header")).toBe(6);
    const one: Stop[] = [H(0), T(0, 0), T(0, 1), T(0, 1, 0), T(0, 1, 1), T(0, 2)];
    expect(moveCursor(one, 2, "next-header")).toBe(2);
  });
  test("prev-header from a task jumps to the header of its own list", () => {
    expect(moveCursor(s, 4, "prev-header")).toBe(0);
  });
  test("prev-header from a header jumps to the previous header", () => {
    expect(moveCursor(s, 6, "prev-header")).toBe(0);
  });
  test("prev-header stays put on the first header", () => {
    expect(moveCursor(s, 0, "prev-header")).toBe(0);
  });
  test("prev-header from a header skips tasks of the previous list", () => {
    const t = THREE;
    expect(moveCursor(t, 4, "prev-header")).toBe(3);
    expect(moveCursor(t, 3, "prev-header")).toBe(0);
  });
  test("next-header passes over an empty list header", () => {
    const t = THREE;
    expect(moveCursor(t, 1, "next-header")).toBe(3);
    expect(moveCursor(t, 3, "next-header")).toBe(4);
  });
  test("empty stops give -1 for every move", () => {
    for (const to of ["next", "prev", "first", "last", "next-header", "prev-header"] as const) {
      expect(moveCursor([], 0, to)).toBe(-1);
      expect(moveCursor([], -1, to)).toBe(-1);
    }
  });
  test("a single stop stays put", () => {
    const one: Stop[] = [H(0)];
    expect(moveCursor(one, 0, "next")).toBe(0);
    expect(moveCursor(one, 0, "prev")).toBe(0);
  });
  test("does not mutate the stops", () => {
    const f = frozen([H(0), T(0, 0), T(0, 1)]);
    expect(moveCursor(f, 1, "next")).toBe(2);
  });
});

describe("clampIndex", () => {
  test("returns -1 when there is no stop", () => {
    expect(clampIndex(0, 0)).toBe(-1);
    expect(clampIndex(0, 5)).toBe(-1);
  });
  test("keeps an index in range", () => {
    expect(clampIndex(5, 2)).toBe(2);
  });
  test("clamps a too large index to the last stop", () => {
    expect(clampIndex(5, 9)).toBe(4);
  });
  test("an index equal to the count clamps to the last stop", () => {
    expect(clampIndex(5, 5)).toBe(4);
  });
  test("clamps a negative index to 0 when stops exist", () => {
    expect(clampIndex(5, -1)).toBe(0);
    expect(clampIndex(5, -10)).toBe(0);
  });
  test("same position after a deletion, previous stop when it was last", () => {
    expect(clampIndex(4, 2)).toBe(2);
    expect(clampIndex(4, 4)).toBe(3);
  });
});

describe("parseStoredIndex", () => {
  test("parses zero", () => {
    expect(parseStoredIndex("0")).toBe(0);
  });
  test("parses a positive integer", () => {
    expect(parseStoredIndex("12")).toBe(12);
  });
  test("rejects a negative number", () => {
    expect(parseStoredIndex("-1")).toBeNull();
  });
  test("rejects a decimal", () => {
    expect(parseStoredIndex("1.5")).toBeNull();
  });
  test("rejects text", () => {
    expect(parseStoredIndex("abc")).toBeNull();
  });
  test("rejects mixed text", () => {
    expect(parseStoredIndex("3x")).toBeNull();
  });
  test("rejects the empty string", () => {
    expect(parseStoredIndex("")).toBeNull();
  });
  test("rejects null", () => {
    expect(parseStoredIndex(null)).toBeNull();
  });
  test("rejects whitespace", () => {
    expect(parseStoredIndex(" 1")).toBeNull();
  });
});

describe("indexOfStop", () => {
  const s: Stop[] = [H(0), T(0, 0), T(0, 1), T(0, 1, 0), T(0, 1, 1), T(0, 2), H(1)];
  test("finds a header", () => {
    expect(indexOfStop(s, H(1))).toBe(6);
  });
  test("finds a task", () => {
    expect(indexOfStop(s, T(0, 2))).toBe(5);
  });
  test("finds a subtask", () => {
    expect(indexOfStop(s, T(0, 1, 1))).toBe(4);
  });
  test("a header and a task with the same numbers differ", () => {
    expect(indexOfStop(s, H(0))).toBe(0);
    expect(indexOfStop(s, T(0, 0))).toBe(1);
  });
  test("returns -1 when absent", () => {
    expect(indexOfStop(s, T(3, 0))).toBe(-1);
    expect(indexOfStop(s, H(2))).toBe(-1);
  });
  test("returns -1 on empty stops", () => {
    expect(indexOfStop([], H(0))).toBe(-1);
  });
});

describe("firstChanged", () => {
  test("undoing an add leaves fewer stops and nothing to point at", () => {
    const before = sample();
    const after = { ...before, lists: [{ ...before.lists[0]!, tasks: before.lists[0]!.tasks.slice(0, 2) }, before.lists[1]!] };
    expect(firstChanged(before, after)).toEqual({ kind: "header", list: 1 });
  });
  test("null for identical documents", () => {
    expect(firstChanged(sample(), sample())).toBeNull();
  });
  test("edited task text", () => {
    const after = sample();
    after.lists[0]!.tasks[2]!.text = "changed";
    expect(firstChanged(sample(), after)).toEqual(T(0, 2));
  });
  test("edited subtask text", () => {
    const after = sample();
    after.lists[0]!.tasks[1]!.children![1]!.text = "changed";
    expect(firstChanged(sample(), after)).toEqual(T(0, 1, 1));
  });
  test("toggled done", () => {
    const after = sample();
    after.lists[0]!.tasks[0]!.done = true;
    expect(firstChanged(sample(), after)).toEqual(T(0, 0));
  });
  test("renamed list header", () => {
    const after = sample();
    after.lists[1]!.title = "Renamed";
    expect(firstChanged(sample(), after)).toEqual(H(1));
  });
  test("inserted task is the first changed stop", () => {
    const after = sample();
    after.lists[0]!.tasks.splice(1, 0, { text: "new", done: false });
    expect(firstChanged(sample(), after)).toEqual(T(0, 1));
  });
  test("task appended at the end of a list", () => {
    const after = sample();
    after.lists[0]!.tasks.push({ text: "new", done: false });
    expect(firstChanged(sample(), after)).toEqual(T(0, 3));
  });
  test("removed task points at the stop now in its place", () => {
    const after = sample();
    after.lists[0]!.tasks.splice(0, 1);
    expect(firstChanged(sample(), after)).toEqual(T(0, 0));
  });
  test("removing the last task of the document gives null or the following stop", () => {
    const before = sample();
    const after = sample();
    after.lists[0]!.tasks.pop();
    expect(firstChanged(before, after)).toEqual(H(1));
  });
  test("returns the earliest difference when several exist", () => {
    const after = sample();
    after.lists[0]!.tasks[2]!.done = true;
    after.lists[0]!.tasks[0]!.text = "first";
    expect(firstChanged(sample(), after)).toEqual(T(0, 0));
  });
  test("a moved task is reported at its earliest affected position", () => {
    const after = sample();
    const [t] = after.lists[0]!.tasks.splice(2, 1);
    after.lists[0]!.tasks.unshift(t!);
    expect(firstChanged(sample(), after)).toEqual(T(0, 0));
  });
  test("added list is reported at its header", () => {
    const after = sample();
    after.lists.push({ title: "New", tasks: [] });
    expect(firstChanged(sample(), after)).toEqual(H(2));
  });
  test("does not mutate its inputs", () => {
    const before = frozen(sample());
    const after = frozen(sample());
    expect(firstChanged(before, after)).toBeNull();
  });
});
