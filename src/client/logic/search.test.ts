import { describe, expect, test } from "bun:test";
import type { TodoDocument } from "../../shared/types";
import { visibleRows, visibleStops } from "./filter";
import { firstMatch, matchingStops, renderedText, searchLabel, stepMatch } from "./search";
import { frozen } from "./helpers.test-util";

const TODAY = "2026-11-11";
const doc = (): TodoDocument =>
  frozen({
    filters: [],
    lists: [
      { title: "Groceries", tasks: [{ text: "Buy MILK", done: false }, { text: "Bread", done: false, children: [{ text: "rye bread", done: false }] }] },
      { title: "Work", tasks: [{ text: "Write [milk report](http://example.test/secret) -> 2026-11-22", done: false }, { text: "Call `grep` **now**", done: true }] },
    ],
  });
/** Stops of the unfiltered view: 0 Groceries, 1 Buy MILK, 2 Bread, 3 rye bread, 4 Work, 5 Write, 6 Call. */
const all = (filter = "") => visibleRows(doc(), filter, TODAY);
const find = (query: string, filter = "") => matchingStops(doc(), all(filter), query);

describe("renderedText", () => {
  test("drops the markers, keeps the label of a link and the date of a pill", () => {
    expect(renderedText("Write [milk report](http://example.test/secret) -> 2026-11-22")).toBe("Write milk report 2026-11-22");
    expect(renderedText("Call `grep` **now** and ~~then~~ *later*")).toBe("Call grep now and then later");
  });
});

describe("matchingStops", () => {
  test("ignores case", () => {
    expect(find("milk")).toEqual([1, 5]);
    expect(find("BUY")).toEqual([1]);
  });
  test("matches list titles", () => {
    expect(find("work")).toEqual([4]);
    expect(find("groc")).toEqual([0]);
  });
  test("matches the rendered text: link label, due date and code, but not the URL or the markers", () => {
    expect(find("report")).toEqual([5]);
    expect(find("2026-11-22")).toEqual([5]);
    expect(find("grep")).toEqual([6]);
    expect(find("secret")).toEqual([]);
    expect(find("**")).toEqual([]);
    expect(find("->")).toEqual([]);
  });
  test("a row matches on its own text only, not on its ancestors or descendants", () => {
    expect(find("rye")).toEqual([3]);
    expect(find("bread")).toEqual([2, 3]);
  });
  test("is a literal substring, with no grammar", () => {
    expect(find("list:work")).toEqual([]);
    expect(find("b.ead")).toEqual([]);
  });
  test("an empty query matches nothing", () => {
    expect(find("")).toEqual([]);
  });
  test("rows hidden by the filter never match, and the indices follow the visible stops", () => {
    const visible = all("list:work");
    expect(visibleStops(visible).length).toBe(3);
    expect(matchingStops(doc(), visible, "milk")).toEqual([1]);
    expect(matchingStops(doc(), visible, "bread")).toEqual([]);
  });
  test("a subtask hidden by the filter does not match", () => {
    const visible = all("buy");
    expect(matchingStops(doc(), visible, "rye")).toEqual([]);
  });
});

describe("firstMatch (while typing)", () => {
  test("takes the first match at or after the start row", () => {
    expect(firstMatch([1, 5], 1)).toEqual({ index: 1, wrapped: false });
    expect(firstMatch([1, 5], 2)).toEqual({ index: 5, wrapped: false });
  });
  test("wraps from the end to the start", () => {
    expect(firstMatch([1, 5], 6)).toEqual({ index: 1, wrapped: true });
  });
  test("is null with no match", () => {
    expect(firstMatch([], 3)).toBeNull();
  });
});

describe("stepMatch (n and N)", () => {
  test("next goes to the next match after the cursor row", () => {
    expect(stepMatch([1, 5], 1, "next")).toEqual({ index: 5, wrapped: false });
    expect(stepMatch([1, 5], 3, "next")).toEqual({ index: 5, wrapped: false });
  });
  test("previous goes to the previous match before the cursor row", () => {
    expect(stepMatch([1, 5], 5, "prev")).toEqual({ index: 1, wrapped: false });
    expect(stepMatch([1, 5], 3, "prev")).toEqual({ index: 1, wrapped: false });
  });
  test("wraps at both ends and says so", () => {
    expect(stepMatch([1, 5], 5, "next")).toEqual({ index: 1, wrapped: true });
    expect(stepMatch([1, 5], 1, "prev")).toEqual({ index: 5, wrapped: true });
    expect(stepMatch([1, 5], 6, "next")).toEqual({ index: 1, wrapped: true });
  });
  test("with a single match on the cursor row, it stays there and wraps", () => {
    expect(stepMatch([4], 4, "next")).toEqual({ index: 4, wrapped: true });
    expect(stepMatch([4], 4, "prev")).toEqual({ index: 4, wrapped: true });
  });
  test("is null with no match", () => {
    expect(stepMatch([], 0, "next")).toBeNull();
  });
});

describe("searchLabel", () => {
  test("shows the position of the cursor row among the matches", () => {
    expect(searchLabel("milk", [1, 5], 5)).toBe("/milk  2/2");
    expect(searchLabel("milk", [1, 5, 6], 1)).toBe("/milk  1/3");
  });
  test("shows the number of matches when the cursor is not on one", () => {
    expect(searchLabel("milk", [1, 5], 3)).toBe("/milk  2");
    expect(searchLabel("milk", [1, 5], -1)).toBe("/milk  2");
  });
  test("says no match when nothing matches", () => {
    expect(searchLabel("zzz", [], 3)).toBe("/zzz  no match");
  });
});
