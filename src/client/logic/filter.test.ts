import { describe, expect, test } from "bun:test";
import type { TodoDocument } from "../../shared/types";
import { appendTerm, applyVisible, filterCompletion, filterPills, isFiltering, followPins, matchesTask, parseFilter, pinTask, visibleRows, visibleStops } from "./filter";
import { frozen } from "./helpers.test-util";

// Wednesday 2026-11-11, ISO week 2026-W46, quarter 2026-Q4.
const TODAY = "2026-11-11";

const doc = (): TodoDocument => ({
  filters: [],
  lists: [
    {
      title: "Work",
      tasks: [
        { text: "Send the report -> 2026-11-11", done: false },
        { text: "Plan the sprint -> 2026-11-05", done: false, children: [{ text: "Book a room", done: false }, { text: "Invite the team -> 2026-11-20", done: true }] },
        { text: "Archive old files", done: true },
      ],
    },
    {
      title: "Side projects",
      tasks: [
        { text: "Fix the bike -> 2026-W46", done: false },
        { text: "Read a book -> 2026-Q4", done: false },
        { text: "Buy a gift -> 2026-12-24", done: false },
      ],
    },
    { title: "Empty", tasks: [] },
  ],
});

const match = (text: string, node: { text: string; done: boolean }, list = "Work") => matchesTask(node, list, parseFilter(text), TODAY);
const t = (text: string, done = false) => ({ text, done });

describe("parseFilter", () => {
  test("an empty text has no terms and no error", () => {
    expect(parseFilter("")).toEqual({ terms: [], error: null });
    expect(parseFilter("   ")).toEqual({ terms: [], error: null });
  });

  test("bare words become word terms", () => {
    expect(parseFilter("buy  milk").terms).toEqual([{ kind: "word", text: "buy" }, { kind: "word", text: "milk" }]);
  });

  test("list, due and is terms hold their values", () => {
    expect(parseFilter("list:Work due:today,overdue is:done").terms).toEqual([
      { kind: "list", names: ["Work"] },
      { kind: "due", values: ["today", "overdue"] },
      { kind: "is", values: ["done"] },
    ]);
  });

  test("keys and values ignore case", () => {
    expect(parseFilter("LIST:Work Due:TODAY IS:Todo").terms).toEqual([
      { kind: "list", names: ["Work"] },
      { kind: "due", values: ["today"] },
      { kind: "is", values: ["todo"] },
    ]);
  });

  test("a quoted list name keeps its spaces, and a comma separates several names", () => {
    expect(parseFilter('list:"Side projects",Work').terms).toEqual([{ kind: "list", names: ["Side projects", "Work"] }]);
  });

  test("a comma inside quotes is part of the name", () => {
    expect(parseFilter('list:"A,B",C').terms).toEqual([{ kind: "list", names: ["A,B", "C"] }]);
  });

  test("a quote that is not closed runs to the end of the text", () => {
    expect(parseFilter('list:"Side proj').terms).toEqual([{ kind: "list", names: ["Side proj"] }]);
    expect(parseFilter('is:todo list:"Side projects').terms).toEqual([{ kind: "is", values: ["todo"] }, { kind: "list", names: ["Side projects"] }]);
  });

  test("a quoted bare word keeps its spaces", () => {
    expect(parseFilter('"buy milk" eggs').terms).toEqual([{ kind: "word", text: "buy milk" }, { kind: "word", text: "eggs" }]);
  });

  test("a comma in a bare word stays in the word", () => {
    expect(parseFilter("a,b").terms).toEqual([{ kind: "word", text: "a,b" }]);
  });

  test("an unknown key is a plain word, whole", () => {
    expect(parseFilter("foo:bar https://example.com/x").terms).toEqual([
      { kind: "word", text: "foo:bar" },
      { kind: "word", text: "https://example.com/x" },
    ]);
  });

  test("a due value can be a literal day, week or quarter", () => {
    expect(parseFilter("due:2026-11-10,2026-W47,2026-Q1")).toEqual({ terms: [{ kind: "due", values: ["2026-11-10", "2026-W47", "2026-Q1"] }], error: null });
  });

  test("a known key with no value yet is ignored", () => {
    expect(parseFilter("due:")).toEqual({ terms: [], error: null });
    expect(parseFilter("list: is: due:,")).toEqual({ terms: [], error: null });
    expect(parseFilter("due:today,").terms).toEqual([{ kind: "due", values: ["today"] }]);
  });

  test("a bad value is reported with its reason", () => {
    expect(parseFilter("due:foo").error).toBe("Unknown due value: foo");
    expect(parseFilter("due:2026-02-30").error).toBe("Unknown due value: 2026-02-30");
    expect(parseFilter("is:xyz").error).toBe("Unknown is value: xyz");
    expect(parseFilter("due:today,nope is:todo").error).toBe("Unknown due value: nope");
  });

  test("a due value can be a shortcut, kept as typed", () => {
    expect(parseFilter("due:+1w,-tue,W,+1Q,tomorrow")).toEqual({ terms: [{ kind: "due", values: ["+1w", "-tue", "W", "+1Q", "tomorrow"] }], error: null });
  });

  test("a due value can start with < or >, for a literal, a shortcut, today and week", () => {
    expect(parseFilter("due:<+1w").terms).toEqual([{ kind: "due", values: ["<+1w"] }]);
    expect(parseFilter("due:>2026-W47").terms).toEqual([{ kind: "due", values: [">2026-W47"] }]);
    expect(parseFilter("due:>TODAY,<Week").terms).toEqual([{ kind: "due", values: [">today", "<week"] }]);
  });

  test("each comma value has its own operator", () => {
    expect(parseFilter("due:<-1w,>+1w").terms).toEqual([{ kind: "due", values: ["<-1w", ">+1w"] }]);
    expect(parseFilter("due:<today,2026-W50").terms).toEqual([{ kind: "due", values: ["<today", "2026-W50"] }]);
  });

  test("overdue is invalid after an operator", () => {
    expect(parseFilter("due:<overdue").error).toBe("Unknown due value: <overdue");
    expect(parseFilter("due:overdue").error).toBeNull();
  });

  test("a bad value after an operator, a double operator and a bad shortcut are reported", () => {
    expect(parseFilter("due:<foo").error).toBe("Unknown due value: <foo");
    expect(parseFilter("due:<<today").error).toBe("Unknown due value: <<today");
    expect(parseFilter("due:+3x").error).toBe("Unknown due value: +3x");
    expect(parseFilter("due:<2026-02-30").error).toBe("Unknown due value: <2026-02-30");
    expect(parseFilter("due:>+0d").error).toBe("Unknown due value: >+0d");
  });

  test("a shift out of range is an unknown value, not a crash", () => {
    expect(parseFilter("due:+8000y").error).toBe("Unknown due value: +8000y");
    expect(parseFilter("due:<+99999999999d").error).toBe("Unknown due value: <+99999999999d");
  });

  test("an operator alone is ignored, like a key with no value yet", () => {
    expect(parseFilter("due:<")).toEqual({ terms: [], error: null });
    expect(parseFilter("due:>,")).toEqual({ terms: [], error: null });
    expect(parseFilter("due:<,today").terms).toEqual([{ kind: "due", values: ["today"] }]);
    expect(parseFilter("due:<today,>").terms).toEqual([{ kind: "due", values: ["<today"] }]);
  });

  test("a space ends the term, so an operator followed by a space is ignored and the next word is bare", () => {
    expect(parseFilter("due:< today")).toEqual({ terms: [{ kind: "word", text: "today" }], error: null });
  });

  test("the first bad value is the one reported", () => {
    expect(parseFilter("is:x due:y").error).toBe("Unknown is value: x");
  });
});

describe("isFiltering", () => {
  test("any non-blank text is a filter, a bad or empty-valued one included", () => {
    expect(isFiltering("")).toBe(false);
    expect(isFiltering("  ")).toBe(false);
    expect(isFiltering("due:")).toBe(true);
    expect(isFiltering("x")).toBe(true);
  });
});

describe("matchesTask", () => {
  test("no term matches everything", () => {
    expect(match("", t("a"))).toBe(true);
  });

  test("a bare word is a case-insensitive substring of the text", () => {
    expect(match("REPORT", t("Send the report"))).toBe(true);
    expect(match("rep", t("Send the report"))).toBe(true);
    expect(match("sprint", t("Send the report"))).toBe(false);
  });

  test("a quoted word matches with its spaces", () => {
    expect(match('"the rep"', t("Send the report"))).toBe(true);
    expect(match('"report the"', t("Send the report"))).toBe(false);
  });

  test("list: matches the title of the list, whole and ignoring case", () => {
    expect(match("list:work", t("a"), "Work")).toBe(true);
    expect(match("list:wor", t("a"), "Work")).toBe(false);
    expect(match('list:"side projects"', t("a"), "Side projects")).toBe(true);
    expect(match("list:Home,Work", t("a"), "Work")).toBe(true);
  });

  test("every term must match", () => {
    expect(match("report is:todo", t("Send the report"))).toBe(true);
    expect(match("report is:done", t("Send the report"))).toBe(false);
    expect(match("list:Home report", t("Send the report"), "Work")).toBe(false);
  });

  test("is:done and is:todo read the box of the task itself", () => {
    expect(match("is:done", t("a", true))).toBe(true);
    expect(match("is:done", t("a", false))).toBe(false);
    expect(match("is:todo", t("a", false))).toBe(true);
    expect(match("is:todo", t("a", true))).toBe(false);
    expect(match("is:done,todo", t("a", true))).toBe(true);
  });

  test("due:today matches a day, a week and a quarter that hold today", () => {
    expect(match("due:today", t("x -> 2026-11-11"))).toBe(true);
    expect(match("due:today", t("x -> 2026-W46"))).toBe(true);
    expect(match("due:today", t("x -> 2026-Q4"))).toBe(true);
  });

  test("due:today does not match a late or a later date", () => {
    expect(match("due:today", t("x -> 2026-11-10"))).toBe(false);
    expect(match("due:today", t("x -> 2026-11-12"))).toBe(false);
    expect(match("due:today", t("x -> 2026-W45"))).toBe(false);
  });

  test("due:week matches a period that overlaps the current ISO week", () => {
    expect(match("due:week", t("x -> 2026-11-09"))).toBe(true); // Monday
    expect(match("due:week", t("x -> 2026-11-15"))).toBe(true); // Sunday
    expect(match("due:week", t("x -> 2026-11-16"))).toBe(false);
    expect(match("due:week", t("x -> 2026-11-08"))).toBe(false);
    expect(match("due:week", t("x -> 2026-W46"))).toBe(true);
    expect(match("due:week", t("x -> 2026-Q4"))).toBe(true);
  });

  test("due:overdue matches a period that ended before today, if the task is not done", () => {
    expect(match("due:overdue", t("x -> 2026-11-10"))).toBe(true);
    expect(match("due:overdue", t("x -> 2026-W45"))).toBe(true);
    expect(match("due:overdue", t("x -> 2026-Q3"))).toBe(true);
    expect(match("due:overdue", t("x -> 2026-11-11"))).toBe(false);
    expect(match("due:overdue", t("x -> 2026-W46"))).toBe(false);
    expect(match("due:overdue", t("x -> 2026-11-10", true))).toBe(false);
  });

  test("a literal period matches when it overlaps the due period", () => {
    expect(match("due:2026-11-20", t("x -> 2026-11-20"))).toBe(true);
    expect(match("due:2026-11-20", t("x -> 2026-W47"))).toBe(true);
    expect(match("due:2026-11-20", t("x -> 2026-11-21"))).toBe(false);
    expect(match("due:2026-W47", t("x -> 2026-11-20"))).toBe(true);
    expect(match("due:2026-Q4", t("x -> 2026-12-24"))).toBe(true);
    expect(match("due:2027-Q1", t("x -> 2026-12-24"))).toBe(false);
  });

  test("commas inside a due term are an OR", () => {
    expect(match("due:today,overdue", t("x -> 2026-11-11"))).toBe(true);
    expect(match("due:today,overdue", t("x -> 2026-11-01"))).toBe(true);
    expect(match("due:today,overdue", t("x -> 2026-11-30"))).toBe(false);
  });

  test("a task with no valid due date matches no due term", () => {
    expect(match("due:today", t("x"))).toBe(false);
    expect(match("due:overdue", t("x -> 2026-02-30"))).toBe(false);
    expect(match("due:week,overdue", t("x"))).toBe(false);
  });

  test("only the last due date of the task counts", () => {
    expect(match("due:today", t("x -> 2026-11-11 -> 2026-12-01"))).toBe(false);
    expect(match("due:today", t("x -> 2026-12-01 -> 2026-11-11"))).toBe(true);
  });

  test("a bad value matches nothing, and an ignored term matches everything", () => {
    expect(match("due:foo", t("a"))).toBe(false);
    expect(match("due:", t("a"))).toBe(true);
  });
});

describe("matchesTask: due shortcuts and operators", () => {
  const at = (text: string, due: string, done = false, today = TODAY) => matchesTask(t(`Pay -> ${due}`, done), "Work", parseFilter(text), today);
  const noDate = t("Pay the rent");

  test("a shortcut matches like the literal it resolves to", () => {
    expect(at("due:+1w", "2026-11-18")).toBe(true);
    expect(at("due:+1w", "2026-11-17")).toBe(false);
    expect(at("due:-tue", "2026-11-10")).toBe(true);
    expect(at("due:W", "2026-11-13")).toBe(true);
    expect(at("due:+1Q", "2027-Q1")).toBe(true);
  });

  test("a shortcut is resolved from the day given at each call", () => {
    expect(at("due:+1w", "2026-11-18", false, "2026-11-11")).toBe(true);
    expect(at("due:+1w", "2026-11-18", false, "2026-11-12")).toBe(false);
    expect(at("due:+1w", "2026-11-19", false, "2026-11-12")).toBe(true);
  });

  test("< matches a due period that ends before the period of X starts", () => {
    expect(at("due:<+1w", "2026-11-17")).toBe(true);
    expect(at("due:<+1w", "2026-W46")).toBe(true);
    expect(at("due:<+1w", "2026-11-18")).toBe(false);
    expect(at("due:<+1w", "2026-W47")).toBe(false);
    expect(at("due:<+1w", "2026-Q4")).toBe(false);
  });

  test("> matches a due period that starts after the period of X ends", () => {
    expect(at("due:>+1w", "2026-11-19")).toBe(true);
    expect(at("due:>+1w", "2026-W48")).toBe(true);
    expect(at("due:>+1w", "2027-Q1")).toBe(true);
    expect(at("due:>+1w", "2026-11-18")).toBe(false);
    expect(at("due:>+1w", "2026-W47")).toBe(false);
  });

  test("whole periods are compared: a period that overlaps X matches neither operator", () => {
    expect(at("due:<2026-W47", "2026-11-18")).toBe(false);
    expect(at("due:>2026-W47", "2026-11-18")).toBe(false);
    expect(at("due:<2026-W47", "2026-11-15")).toBe(true);
    expect(at("due:>2026-W47", "2026-11-23")).toBe(true);
    expect(at("due:<2026-Q4", "2026-W39")).toBe(true);
    expect(at("due:<2026-Q4", "2026-W40")).toBe(false);
  });

  test("an inclusive bound is written with a comma", () => {
    expect(at("due:<2026-W47,2026-W47", "2026-11-18")).toBe(true);
    expect(at("due:<2026-W47,2026-W47", "2026-11-23")).toBe(false);
  });

  test("today and week after an operator are the current day and the current ISO week", () => {
    expect(at("due:<today", "2026-11-10")).toBe(true);
    expect(at("due:<today", "2026-11-11")).toBe(false);
    expect(at("due:<today", "2026-W46")).toBe(false);
    expect(at("due:>today", "2026-11-12")).toBe(true);
    expect(at("due:>today", "2026-W46")).toBe(false);
    expect(at("due:<week", "2026-11-08")).toBe(true);
    expect(at("due:<week", "2026-11-09")).toBe(false);
    expect(at("due:>week", "2026-11-16")).toBe(true);
    expect(at("due:>week", "2026-11-15")).toBe(false);
  });

  test("the operators ignore the checkbox, and is:todo narrows the result", () => {
    expect(at("due:<today", "2026-11-01", true)).toBe(true);
    expect(at("due:>today", "2026-12-01", true)).toBe(true);
    expect(at("due:<today is:todo", "2026-11-01", true)).toBe(false);
    expect(at("due:<today is:todo", "2026-11-01", false)).toBe(true);
  });

  test("a task with no date, or an invalid one, matches no operator", () => {
    expect(matchesTask(noDate, "Work", parseFilter("due:<+1w"), TODAY)).toBe(false);
    expect(matchesTask(noDate, "Work", parseFilter("due:>+1w"), TODAY)).toBe(false);
    expect(at("due:<+1w", "2026-02-30")).toBe(false);
  });

  test("each comma value has its own operator", () => {
    expect(at("due:<-1w,>+1w", "2026-11-01")).toBe(true);
    expect(at("due:<-1w,>+1w", "2026-12-01")).toBe(true);
    expect(at("due:<-1w,>+1w", "2026-11-12")).toBe(false);
  });

  test("a range of two terms is ANDed", () => {
    expect(at("due:>today due:<+1w", "2026-11-14")).toBe(true);
    expect(at("due:>today due:<+1w", "2026-11-11")).toBe(false);
    expect(at("due:>today due:<+1w", "2026-11-18")).toBe(false);
  });
});

describe("visibleRows", () => {
  const rows = (text: string, pins: { list: number; task: number; child?: number }[] = []) => visibleRows(frozen(doc()), text, TODAY, pins);

  test("an empty filter shows every list, empty ones included, and every task", () => {
    const v = rows("");
    expect(v.filtering).toBe(false);
    expect(v.error).toBeNull();
    expect(v.lists).toEqual([
      { list: 0, tasks: [{ task: 0, children: [], hidden: 0 }, { task: 1, children: [0, 1], hidden: 0 }, { task: 2, children: [], hidden: 0 }] },
      { list: 1, tasks: [{ task: 0, children: [], hidden: 0 }, { task: 1, children: [], hidden: 0 }, { task: 2, children: [], hidden: 0 }] },
      { list: 2, tasks: [] },
    ]);
  });

  test("a matching task is shown, the others are not", () => {
    expect(rows("report").lists).toEqual([{ list: 0, tasks: [{ task: 0, children: [], hidden: 0 }] }]);
  });

  test("a matching parent shows its whole subtree", () => {
    expect(rows("sprint").lists).toEqual([{ list: 0, tasks: [{ task: 1, children: [0, 1], hidden: 0 }] }]);
  });

  test("a matching subtask shows its parent, but not its siblings", () => {
    expect(rows("room").lists).toEqual([{ list: 0, tasks: [{ task: 1, children: [0], hidden: 1 }] }]);
  });

  test("showSiblings shows every subtask of a task that has a matching subtask, and changes nothing else", () => {
    const all = (text: string, pins: { list: number; task: number; child?: number }[] = []) => visibleRows(frozen(doc()), text, TODAY, pins, true).lists;
    expect(all("room")).toEqual([{ list: 0, tasks: [{ task: 1, children: [0, 1], hidden: 0 }] }]);
    expect(all("report")).toEqual(rows("report").lists);
    expect(all("")).toEqual(rows("").lists);
    // A pinned subtask alone is not a match, so it does not open the siblings.
    expect(all("report", [{ list: 0, task: 1, child: 1 }])).toEqual(rows("report", [{ list: 0, task: 1, child: 1 }]).lists);
  });

  test("the hidden count is the number of subtasks that are not shown", () => {
    expect(rows("room").lists[0]!.tasks[0]!.hidden).toBe(1);
    expect(rows("sprint").lists[0]!.tasks[0]!.hidden).toBe(0);
  });

  test("is: applies to the box of each task, with no inheritance", () => {
    // The parent "Plan the sprint" is todo, so it matches and shows its subtree, done child included.
    expect(rows("is:todo list:Work").lists).toEqual([{ list: 0, tasks: [{ task: 0, children: [], hidden: 0 }, { task: 1, children: [0, 1], hidden: 0 }] }]);
    // Only the done subtask matches, so only it and its parent as context.
    expect(rows("is:done list:Work").lists).toEqual([{ list: 0, tasks: [{ task: 1, children: [1], hidden: 1 }, { task: 2, children: [], hidden: 0 }] }]);
  });

  test("a list with no visible task is hidden under a filter", () => {
    expect(rows("list:Empty").lists).toEqual([]);
    expect(rows("bike").lists.map((l) => l.list)).toEqual([1]);
  });

  test("list: keeps every task of the list", () => {
    expect(rows('list:"side projects"').lists.map((l) => [l.list, l.tasks.length])).toEqual([[1, 3]]);
  });

  test("the built-in due views", () => {
    const today = rows("due:today,overdue").lists;
    expect(today.map((l) => [l.list, l.tasks.map((x) => x.task)])).toEqual([[0, [0, 1]], [1, [0, 1]]]);
    const week = rows("due:week,overdue").lists;
    expect(week.map((l) => [l.list, l.tasks.map((x) => x.task)])).toEqual([[0, [0, 1]], [1, [0, 1]]]);
  });

  test("a bad value shows nothing and carries the reason", () => {
    const v = rows("due:foo");
    expect(v.lists).toEqual([]);
    expect(v.error).toBe("Unknown due value: foo");
    expect(v.filtering).toBe(true);
  });

  test("a filter whose terms are all ignored shows every task but still hides empty lists", () => {
    const v = rows("due:");
    expect(v.filtering).toBe(true);
    expect(v.lists.map((l) => l.list)).toEqual([0, 1]);
  });

  test("a pinned task stays visible even if it no longer matches", () => {
    const v = rows("report", [{ list: 1, task: 2 }]);
    expect(v.lists).toEqual([{ list: 0, tasks: [{ task: 0, children: [], hidden: 0 }] }, { list: 1, tasks: [{ task: 2, children: [], hidden: 0 }] }]);
  });

  test("a pinned subtask is shown with its parent", () => {
    const v = rows("report", [{ list: 0, task: 1, child: 1 }]);
    expect(v.lists).toEqual([{ list: 0, tasks: [{ task: 0, children: [], hidden: 0 }, { task: 1, children: [1], hidden: 1 }] }]);
  });

  test("a pin that points nowhere is ignored", () => {
    expect(rows("report", [{ list: 9, task: 0 }, { list: 0, task: 9 }, { list: 0, task: 0, child: 5 }]).lists).toEqual([{ list: 0, tasks: [{ task: 0, children: [], hidden: 0 }] }]);
  });

  test("a pin is not needed when there is no filter", () => {
    expect(rows("", [{ list: 0, task: 0 }]).lists[0]!.tasks).toHaveLength(3);
  });

  test("an empty document has no visible list", () => {
    expect(visibleRows({ lists: [], filters: [] }, "x", TODAY, []).lists).toEqual([]);
  });
});

describe("visibleStops and applyVisible", () => {
  test("the stops are the visible headers and rows in document order", () => {
    const v = visibleRows(frozen(doc()), "room", TODAY, []);
    expect(visibleStops(v)).toEqual([
      { kind: "header", list: 0 },
      { kind: "task", path: { list: 0, task: 1 } },
      { kind: "task", path: { list: 0, task: 1, child: 0 } },
    ]);
  });

  test("with no filter the stops are all of them, empty lists included", () => {
    const v = visibleRows(frozen(doc()), "", TODAY, []);
    expect(visibleStops(v)).toHaveLength(3 + 1 + 2 + 1 + 3 + 1);
  });

  test("applyVisible keeps only the visible tasks and subtasks, as a copy", () => {
    const d = frozen(doc());
    const shown = applyVisible(d, visibleRows(d, "room", TODAY, []));
    expect(shown.lists).toEqual([{ title: "Work", tasks: [{ text: "Plan the sprint -> 2026-11-05", done: false, children: [{ text: "Book a room", done: false }] }] }]);
    expect(d.lists).toHaveLength(3);
  });

  test("applyVisible with no filter is the whole document", () => {
    const d = frozen(doc());
    expect(applyVisible(d, visibleRows(d, "", TODAY, [])).lists).toEqual(d.lists);
  });

  test("a parent shown only as context drops no field and loses the hidden children", () => {
    const d = frozen(doc());
    const shown = applyVisible(d, visibleRows(d, "team", TODAY, []));
    expect(shown.lists[0]!.tasks[0]!.children).toEqual([{ text: "Invite the team -> 2026-11-20", done: true }]);
  });
});

describe("pinTask", () => {
  test("adds a pin once", () => {
    expect(pinTask([], { list: 0, task: 1 })).toEqual([{ list: 0, task: 1 }]);
    expect(pinTask([{ list: 0, task: 1 }], { list: 0, task: 1 })).toEqual([{ list: 0, task: 1 }]);
  });

  test("an inserted task shifts the pins at or after it in the same list", () => {
    const pins = [{ list: 0, task: 0 }, { list: 0, task: 2 }, { list: 0, task: 2, child: 1 }, { list: 1, task: 5 }];
    expect(pinTask(pins, { list: 0, task: 1 }, true)).toEqual([
      { list: 0, task: 0 },
      { list: 0, task: 3 },
      { list: 0, task: 3, child: 1 },
      { list: 1, task: 5 },
      { list: 0, task: 1 },
    ]);
  });

  test("an inserted subtask shifts the pins of the later subtasks of the same parent", () => {
    const pins = [{ list: 0, task: 1 }, { list: 0, task: 1, child: 0 }, { list: 0, task: 1, child: 1 }, { list: 0, task: 2, child: 1 }];
    expect(pinTask(pins, { list: 0, task: 1, child: 1 }, true)).toEqual([
      { list: 0, task: 1 },
      { list: 0, task: 1, child: 0 },
      { list: 0, task: 1, child: 2 },
      { list: 0, task: 2, child: 1 },
      { list: 0, task: 1, child: 1 },
    ]);
  });

  test("a pin that is not an insertion shifts nothing", () => {
    expect(pinTask([{ list: 0, task: 1 }], { list: 0, task: 0 })).toEqual([{ list: 0, task: 1 }, { list: 0, task: 0 }]);
  });
});

describe("filterCompletion", () => {
  const titles = ["Work", "Side projects", "Home"];
  const c = (text: string, cursor = text.length, today = TODAY) => filterCompletion(text, cursor, titles, today);

  test("nothing for plain words, other keys and an unfinished key", () => {
    expect(c("")).toBeNull();
    expect(c("buy")).toBeNull();
    expect(c("is:")).toBeNull();
    expect(c("lis")).toBeNull();
  });

  test("list: offers every title, quoted when it needs it", () => {
    expect(c("list:")).toEqual({ from: 5, options: [{ label: "Work", apply: "Work" }, { label: "Side projects", apply: '"Side projects"' }, { label: "Home", apply: "Home" }] });
  });

  test("list: filters by what is typed, ignoring case", () => {
    expect(c("list:ho")?.options.map((o) => o.label)).toEqual(["Home"]);
    expect(c("list:xyz")).toBeNull();
  });

  test("a quote already typed is replaced by the quoted entry", () => {
    expect(c('list:"sid')).toEqual({ from: 5, options: [{ label: "Side projects", apply: '"Side projects"' }] });
  });

  test("after a comma, the next value is completed", () => {
    expect(c("list:Work,")?.from).toBe(10);
    expect(c("list:Work,h")).toEqual({ from: 10, options: [{ label: "Home", apply: "Home" }] });
  });

  test("a comma inside quotes does not start a new value", () => {
    expect(c('list:"a,b')?.from ?? 5).toBe(5);
  });

  test("the term under the cursor is completed, after other terms", () => {
    expect(c("is:todo list:wo")).toEqual({ from: 13, options: [{ label: "Work", apply: "Work" }] });
    expect(c("list:Work is:todo", 9)).toEqual({ from: 5, options: [{ label: "Work", apply: "Work" }] });
  });

  test("a space ends the term unless it is quoted", () => {
    expect(c("list:Work ")).toBeNull();
    expect(c('list:"Side ')?.options.map((o) => o.label)).toEqual(["Side projects"]);
  });

  test("a title with a double quote is not offered", () => {
    expect(filterCompletion("list:", 5, ['a"b', "ok"], TODAY)?.options.map((o) => o.label)).toEqual(["ok"]);
  });

  test("duplicate titles are offered once", () => {
    expect(filterCompletion("list:", 5, ["A", "A"], TODAY)?.options).toHaveLength(1);
  });

  test("due: offers today, week and overdue", () => {
    expect(c("due:")).toEqual({ from: 4, options: [{ label: "today", apply: "today" }, { label: "week", apply: "week" }, { label: "overdue", apply: "overdue" }] });
    expect(c("due:o")?.options.map((o) => o.label)).toEqual(["overdue"]);
    expect(c("due:today,")?.from).toBe(10);
  });

  test("after < or >, today and week are offered, without overdue", () => {
    expect(c("due:<")).toEqual({ from: 5, options: [{ label: "today", apply: "today" }, { label: "week", apply: "week" }] });
    expect(c("due:>w")?.options.map((o) => o.label)).toEqual(["week"]);
    expect(c("due:<o")).toBeNull();
    expect(c("due:<today,>")).toEqual({ from: 12, options: [{ label: "today", apply: "today" }, { label: "week", apply: "week" }] });
  });

  test("a typed shortcut is one entry that shows the date it resolves to, inserted as typed", () => {
    expect(c("due:+1w", 7, TODAY)).toEqual({ from: 4, options: [{ label: "+1w", apply: "+1w", detail: "2026-11-18" }] });
    expect(c("due:<+1w", 8, TODAY)).toEqual({ from: 5, options: [{ label: "+1w", apply: "+1w", detail: "2026-11-18" }] });
    expect(c("due:W", 5, TODAY)?.options).toContainEqual({ label: "W", apply: "W", detail: "2026-W46" });
    expect(c("due:2026-11-20", 14, TODAY)?.options).toEqual([{ label: "2026-11-20", apply: "2026-11-20" }]);
  });

  test("the entries after due: do not include the default set of shortcuts or the operators", () => {
    expect(c("due:", 4, TODAY)?.options.map((o) => o.label)).toEqual(["today", "week", "overdue"]);
  });

  test("a sign and a number, or a sign and a weekday prefix, get the unit and weekday completion", () => {
    expect(c("due:+3", 6, TODAY)).toEqual({
      from: 4,
      options: [
        { label: "+3d", apply: "+3d", detail: "2026-11-14" },
        { label: "+3w", apply: "+3w", detail: "2026-12-02" },
        { label: "+3m", apply: "+3m", detail: "2027-02-11" },
        { label: "+3y", apply: "+3y", detail: "2029-11-11" },
        { label: "+3W", apply: "+3W", detail: "2026-W49" },
        { label: "+3Q", apply: "+3Q", detail: "2027-Q3" },
      ],
    });
    expect(c("due:<-t", 7, TODAY)).toEqual({ from: 5, options: [{ label: "-tue", apply: "-tue", detail: "2026-11-10" }, { label: "-thu", apply: "-thu", detail: "2026-11-05" }] });
    expect(c("due:today,+t", 12, TODAY)?.from).toBe(10);
  });

  test("a huge shift offers nothing and does not throw", () => {
    expect(c("due:+99999999999", 16, TODAY)).toBeNull();
    expect(c("due:<+8000y", 11, TODAY)).toBeNull();
  });

  test("a bare sign, a bad shortcut and an operator typed twice offer nothing", () => {
    expect(c("due:+", 5, TODAY)).toBeNull();
    expect(c("due:+3x", 7, TODAY)).toBeNull();
    expect(c("due:<<", 6, TODAY)).toBeNull();
  });

  test("due: adds an entry for a typed valid day, week or quarter", () => {
    expect(c("due:2026-11-20")).toEqual({ from: 4, options: [{ label: "2026-11-20", apply: "2026-11-20" }] });
    expect(c("due:2026-W47")?.options.map((o) => o.label)).toEqual(["2026-W47"]);
    expect(c("due:2026-Q1")?.options.map((o) => o.label)).toEqual(["2026-Q1"]);
    expect(c("due:2026-02-30")).toBeNull();
    expect(c("due:foo")).toBeNull();
  });
});

describe("filterPills", () => {
  test("a list:, due: or is: term gives a key range and a value range", () => {
    expect(filterPills("list:Work due:today")).toEqual([
      { key: { from: 0, to: 5 }, value: { from: 5, to: 9 } },
      { key: { from: 10, to: 14 }, value: { from: 14, to: 19 } },
    ]);
  });

  test("an is: term gets a pill too", () => {
    expect(filterPills("is:done,todo")).toEqual([{ key: { from: 0, to: 3 }, value: { from: 3, to: 12 } }]);
  });

  test("the value runs over commas and quotes, spaces inside quotes included", () => {
    expect(filterPills('list:"Side projects",Work')).toEqual([{ key: { from: 0, to: 5 }, value: { from: 5, to: 25 } }]);
    expect(filterPills('list:"Side pro')).toEqual([{ key: { from: 0, to: 5 }, value: { from: 5, to: 14 } }]);
  });

  test("a key with no value yet has an empty value range", () => {
    expect(filterPills("due:")).toEqual([{ key: { from: 0, to: 4 }, value: { from: 4, to: 4 } }]);
  });

  test("keys ignore case, and other terms and unknown keys have no pill", () => {
    expect(filterPills("LIST:a")).toHaveLength(1);
    expect(filterPills("foo:bar word")).toEqual([]);
    expect(filterPills('"list:x"')).toEqual([]);
    expect(filterPills("")).toEqual([]);
  });
});

describe("followPins", () => {
  const at = (task: number, child?: number) => ({ list: 0, task, child });
  test("a pin follows its task to the new path", () => {
    const moves = [{ from: at(0), to: at(2) }, { from: at(2), to: at(1) }];
    expect(followPins([at(0), at(2)], moves)).toEqual([at(2), at(1)]);
  });
  test("a pin that no move touches stays", () => {
    expect(followPins([at(3)], [{ from: at(0), to: at(1) }])).toEqual([at(3)]);
  });
  test("the moves apply at once, so two tasks that swap do not collapse", () => {
    const moves = [{ from: at(0), to: at(1) }, { from: at(1), to: at(0) }];
    expect(followPins([at(0), at(1)], moves)).toEqual([at(1), at(0)]);
  });
  test("a subtask pin follows its parent and can change level", () => {
    const moves = [{ from: at(1, 0), to: at(2) }];
    expect(followPins([at(1, 0)], moves)).toEqual([at(2)]);
  });
});

describe("appendTerm (PRD 5.14)", () => {
  test("appending to an empty text gives the term alone, with no leading space", () => {
    expect(appendTerm("", "due:week,overdue")).toBe("due:week,overdue");
  });
  test("appending adds the term after a space", () => {
    expect(appendTerm("list:work", "due:today,overdue")).toBe("list:work due:today,overdue");
  });
  test("a term already in the text leaves it unchanged", () => {
    expect(appendTerm("due:today,overdue list:work", "due:today,overdue")).toBe("due:today,overdue list:work");
    expect(appendTerm("is:done", "is:done")).toBe("is:done");
  });
  test("an is: term replaces the opposite one in place", () => {
    expect(appendTerm("list:work is:done foo", "is:todo")).toBe("list:work is:todo foo");
    expect(appendTerm("is:todo list:work", "is:done")).toBe("is:done list:work");
  });
  test("a longer word that merely contains the term does not count as present", () => {
    expect(appendTerm("xis:done", "is:done")).toBe("xis:done is:done");
  });
});
