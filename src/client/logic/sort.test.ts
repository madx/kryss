import { describe, expect, test } from "bun:test";
import type { Subtask, Task, TodoDocument, TodoList } from "../../shared/types";
import { compareSortDates, dueSortDate, listSortDate, sortAll, sortList, sortLists, taskSortDate } from "./sort";
import { frozen } from "./helpers.test-util";

const t = (text: string, done = false, children?: Subtask[]): Task => (children ? { text, done, children } : { text, done });
const list = (title: string, ...tasks: Task[]): TodoList => ({ title, tasks });
const docOf = (...lists: TodoList[]): TodoDocument => ({ filters: [], lists });
const texts = (l: TodoList) => l.tasks.map((x) => x.text);
const date = (d: string) => dueSortDate(`x -> ${d}`);
const cmp = (a: string, b: string) => compareSortDates(date(a), date(b));

describe("dueSortDate", () => {
  test("a text with no date has no sort date", () => {
    expect(dueSortDate("plain")).toBeNull();
  });
  test("an invalid date is plain text", () => {
    expect(dueSortDate("a -> 2026-02-30")).toBeNull();
    expect(dueSortDate("a -> 2026-W60")).toBeNull();
  });
  test("only the last valid date counts", () => {
    expect(dueSortDate("a -> 2026-11-01 b -> 2026-12-01")).toEqual(date("2026-12-01"));
    expect(dueSortDate("a -> 2026-12-01 b -> 2026-13-45")).toEqual(date("2026-12-01"));
  });
});

describe("compareSortDates", () => {
  test("compares by the last day of the period", () => {
    expect(cmp("2026-11-20", "2026-11-21")).toBeLessThan(0);
    expect(cmp("2026-W47", "2026-11-23")).toBeLessThan(0); // the week ends on Sunday 22 November
    expect(cmp("2026-Q4", "2026-12-30")).toBeGreaterThan(0);
  });
  test("on the same last day the finer period comes first: day, week, quarter", () => {
    expect(cmp("2026-11-22", "2026-W47")).toBeLessThan(0);
    expect(cmp("2026-W47", "2026-11-22")).toBeGreaterThan(0);
    expect(cmp("2026-12-31", "2026-Q4")).toBeLessThan(0);
  });
  test("a week and a quarter ending the same day: the week first", () => {
    // 2024-W13 ends on Sunday 31 March 2024, the last day of 2024-Q1
    expect(cmp("2024-W13", "2024-Q1")).toBeLessThan(0);
    expect(cmp("2024-Q1", "2024-W13")).toBeGreaterThan(0);
  });
  test("equal dates compare as zero", () => {
    expect(cmp("2026-11-20", "2026-11-20")).toBe(0);
    expect(compareSortDates(null, null)).toBe(0);
  });
  test("no date comes last", () => {
    expect(compareSortDates(null, date("2030-01-01"))).toBeGreaterThan(0);
    expect(compareSortDates(date("2030-01-01"), null)).toBeLessThan(0);
  });
});

describe("taskSortDate and listSortDate", () => {
  test("an unchecked task takes the earliest date of its unchecked subtree", () => {
    const task = t("p -> 2026-12-01", false, [t("c -> 2026-11-20"), t("d -> 2026-11-10", true)]);
    expect(taskSortDate(task)).toEqual(date("2026-11-20"));
  });
  test("a parent with no date is ranked by a subtask", () => {
    expect(taskSortDate(t("p", false, [t("c -> 2026-11-20")]))).toEqual(date("2026-11-20"));
  });
  test("a checked task takes the earliest date of its whole subtree", () => {
    const task = t("p -> 2026-12-01", true, [t("c -> 2026-11-20"), t("d -> 2026-11-10", true)]);
    expect(taskSortDate(task)).toEqual(date("2026-11-10"));
  });
  test("a task with no date in its subtree has none", () => {
    expect(taskSortDate(t("p", false, [t("c")]))).toBeNull();
  });
  test("a list takes the earliest date of its unchecked tasks, subtasks included", () => {
    const l = list("L", t("a -> 2026-11-30", true), t("b", false, [t("c -> 2026-12-05")]), t("d -> 2026-12-09"));
    expect(listSortDate(l)).toEqual(date("2026-12-05"));
  });
  test("a list with only checked or undated tasks has no sort date", () => {
    expect(listSortDate(list("L", t("a -> 2026-11-30", true), t("b")))).toBeNull();
    expect(listSortDate(list("L"))).toBeNull();
  });
});

describe("sortList", () => {
  test("unchecked tasks come first, then checked, dated before undated", () => {
    const d = docOf(list("L",
      t("none"), t("late -> 2026-12-01"), t("doneB -> 2026-11-05", true), t("early -> 2026-11-10"), t("doneA -> 2026-11-01", true), t("doneNone", true)));
    const r = sortList(frozen(d), 0)!;
    expect(texts(r.doc.lists[0]!)).toEqual(["early -> 2026-11-10", "late -> 2026-12-01", "none", "doneA -> 2026-11-01", "doneB -> 2026-11-05", "doneNone"]);
  });
  test("a checked parent holding an unchecked subtask goes with the checked tasks", () => {
    const d = docOf(list("L", t("p", true, [t("c -> 2026-11-01")]), t("u -> 2026-12-01")));
    expect(texts(sortList(d, 0)!.doc.lists[0]!)).toEqual(["u -> 2026-12-01", "p"]);
  });
  test("the sort is recursive and a parent is ranked by its subtask", () => {
    const d = docOf(list("L",
      t("p1 -> 2026-12-20", false, [t("z -> 2026-12-25"), t("y -> 2026-12-21"), t("w", true)]),
      t("p2", false, [t("c2 -> 2026-11-02")])));
    const r = sortList(d, 0)!;
    expect(texts(r.doc.lists[0]!)).toEqual(["p2", "p1 -> 2026-12-20"]);
    expect(r.doc.lists[0]!.tasks[1]!.children!.map((c) => c.text)).toEqual(["y -> 2026-12-21", "z -> 2026-12-25", "w"]);
  });
  test("nesting, text and check states are unchanged", () => {
    const d = docOf(list("L", t("b -> 2026-12-01", true, [t("bc", true)]), t("a -> 2026-11-01", false, [t("ac")])));
    const r = sortList(d, 0)!;
    const shape = (l: TodoList) => l.tasks.map((x) => JSON.stringify([x.text, x.done, x.children?.map((c) => [c.text, c.done])])).sort();
    expect(shape(r.doc.lists[0]!)).toEqual(shape(d.lists[0]!));
  });
  test("ties keep the current order", () => {
    const d = docOf(list("L", t("b -> 2026-11-01"), t("a -> 2026-11-01"), t("n2"), t("n1"), t("c -> 2026-10-01")));
    expect(texts(sortList(d, 0)!.doc.lists[0]!)).toEqual(["c -> 2026-10-01", "b -> 2026-11-01", "a -> 2026-11-01", "n2", "n1"]);
  });
  test("it only touches the given list and leaves the lists in place", () => {
    const d = docOf(list("A", t("b -> 2026-12-01"), t("a -> 2026-11-01")), list("B", t("y -> 2026-12-01"), t("x -> 2026-11-01")));
    const r = sortList(d, 0)!;
    expect(r.doc.lists.map((l) => l.title)).toEqual(["A", "B"]);
    expect(texts(r.doc.lists[1]!)).toEqual(texts(d.lists[1]!));
    expect(r.lists).toEqual([0, 1]);
  });
  test("it reports the tasks whose path changed", () => {
    const d = docOf(list("L", t("b -> 2026-12-01"), t("a -> 2026-11-01")));
    const r = sortList(d, 0)!;
    expect(r.moves).toContainEqual({ from: { list: 0, task: 0 }, to: { list: 0, task: 1 } });
    expect(r.moves).toContainEqual({ from: { list: 0, task: 1 }, to: { list: 0, task: 0 } });
  });
  test("it returns null when already sorted, unknown list or empty list", () => {
    expect(sortList(docOf(list("L", t("a -> 2026-11-01"), t("b -> 2026-12-01"), t("n"), t("c", true))), 0)).toBeNull();
    expect(sortList(docOf(list("L", t("a"))), 3)).toBeNull();
    expect(sortList(docOf(list("L")), 0)).toBeNull();
  });
  test("it returns null when only the subtasks are sorted already", () => {
    expect(sortList(docOf(list("L", t("p", false, [t("a -> 2026-11-01"), t("b -> 2026-12-01")]))), 0)).toBeNull();
  });
});

describe("sortLists", () => {
  const three = () => docOf(
    list("Late", t("a -> 2026-12-01")),
    list("None", t("n")),
    list("Soon", t("b -> 2026-11-01"), t("c -> 2026-11-30")),
    list("Checked", t("d -> 2026-10-01", true)),
  );
  test("lists are ordered by their sort date, undated lists last in their current order", () => {
    const r = sortLists(frozen(three()))!;
    expect(r.doc.lists.map((l) => l.title)).toEqual(["Soon", "Late", "None", "Checked"]);
    expect(r.lists).toEqual([2, 0, 1, 3]);
  });
  test("the tasks inside the lists are left alone", () => {
    const d = docOf(list("B", t("z -> 2026-12-01"), t("y -> 2026-11-01")), list("A", t("x -> 2026-10-01")));
    const r = sortLists(d)!;
    expect(r.doc.lists.map((l) => l.title)).toEqual(["A", "B"]);
    expect(texts(r.doc.lists[1]!)).toEqual(["z -> 2026-12-01", "y -> 2026-11-01"]);
  });
  test("it returns null when the order does not change", () => {
    expect(sortLists(docOf(list("A", t("a -> 2026-11-01")), list("B", t("b -> 2026-12-01")), list("C")))).toBeNull();
    expect(sortLists(docOf())).toBeNull();
  });
  test("it reports the tasks whose path changed", () => {
    const r = sortLists(docOf(list("B", t("b -> 2026-12-01")), list("A", t("a -> 2026-11-01"))))!;
    expect(r.moves).toContainEqual({ from: { list: 0, task: 0 }, to: { list: 1, task: 0 } });
  });
});

describe("sortAll", () => {
  test("it sorts the tasks of every list on its own and leaves the lists", () => {
    const d = docOf(
      list("B", t("b2 -> 2026-12-01"), t("b1 -> 2026-11-01")),
      list("A", t("a2 -> 2026-09-01"), t("a1 -> 2026-08-01")));
    const r = sortAll(frozen(d))!;
    expect(r.doc.lists.map((l) => l.title)).toEqual(["B", "A"]);
    expect(texts(r.doc.lists[0]!)).toEqual(["b1 -> 2026-11-01", "b2 -> 2026-12-01"]);
    expect(texts(r.doc.lists[1]!)).toEqual(["a1 -> 2026-08-01", "a2 -> 2026-09-01"]);
    expect(r.lists).toEqual([0, 1]);
  });
  test("it takes only the document, so a filter cannot hide anything from it", () => {
    expect(sortAll.length).toBe(1);
  });
  test("it returns null when every list is sorted already", () => {
    expect(sortAll(docOf(list("A", t("a -> 2026-11-01"), t("b")), list("B")))).toBeNull();
  });
});
