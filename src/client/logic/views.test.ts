import { describe, expect, test } from "bun:test";
import { cycleView, visibleRange } from "./views";

describe("cycleView", () => {
  test("next from All goes to the first list", () => {
    expect(cycleView(null, 3, "next")).toBe(0);
  });
  test("next from a list goes to the following list", () => {
    expect(cycleView(0, 3, "next")).toBe(1);
  });
  test("next from the last list wraps to All", () => {
    expect(cycleView(2, 3, "next")).toBeNull();
  });
  test("prev from All goes to the last list", () => {
    expect(cycleView(null, 3, "prev")).toBe(2);
  });
  test("prev from a list goes to the preceding list", () => {
    expect(cycleView(2, 3, "prev")).toBe(1);
  });
  test("prev from the first list goes to All", () => {
    expect(cycleView(0, 3, "prev")).toBeNull();
  });
  test("full forward cycle returns to the start", () => {
    let v: number | null = null;
    const seen: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      v = cycleView(v, 3, "next");
      seen.push(v);
    }
    expect(seen).toEqual([0, 1, 2, null]);
  });
  test("full backward cycle returns to the start", () => {
    let v: number | null = null;
    const seen: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      v = cycleView(v, 3, "prev");
      seen.push(v);
    }
    expect(seen).toEqual([2, 1, 0, null]);
  });
  test("a single list alternates between All and that list", () => {
    expect(cycleView(null, 1, "next")).toBe(0);
    expect(cycleView(0, 1, "next")).toBeNull();
    expect(cycleView(null, 1, "prev")).toBe(0);
    expect(cycleView(0, 1, "prev")).toBeNull();
  });
  test("a stale index cycles forward as if from All", () => {
    expect(cycleView(5, 3, "next")).toBe(0);
  });
  test("a stale index cycles backward as if from All", () => {
    expect(cycleView(5, 3, "prev")).toBe(2);
  });
  test("an index equal to the list count is stale", () => {
    expect(cycleView(3, 3, "next")).toBe(0);
  });
  test("zero lists gives All whatever the direction", () => {
    expect(cycleView(null, 0, "next")).toBeNull();
    expect(cycleView(null, 0, "prev")).toBeNull();
  });
  test("zero lists with a stale index gives All", () => {
    expect(cycleView(2, 0, "next")).toBeNull();
  });
});

describe("visibleRange", () => {
  test("All covers every list", () => {
    expect(visibleRange(null, 4)).toEqual({ first: 0, last: 3 });
  });
  test("one list covers only that list", () => {
    expect(visibleRange(2, 4)).toEqual({ first: 2, last: 2 });
  });
  test("the first list alone", () => {
    expect(visibleRange(0, 4)).toEqual({ first: 0, last: 0 });
  });
  test("All with a single list", () => {
    expect(visibleRange(null, 1)).toEqual({ first: 0, last: 0 });
  });
  test("All with no list gives an empty range", () => {
    expect(visibleRange(null, 0)).toEqual({ first: 0, last: -1 });
  });
});
