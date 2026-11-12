import { describe, expect, test } from "bun:test";
import { dayPeriod, dueEntries, duePeriod, dueState, resolveShortcut, resolveTrailing } from "./due";

const TODAY = "2026-11-11"; // a Wednesday
const r = (word: string, today = TODAY) => resolveShortcut(word, today);

describe("duePeriod: validation", () => {
  test("accepts a day, an ISO week and a quarter", () => {
    expect(duePeriod("2026-11-22")).not.toBeNull();
    expect(duePeriod("2026-W47")).not.toBeNull();
    expect(duePeriod("2026-Q4")).not.toBeNull();
  });
  test("rejects impossible days", () => {
    expect(duePeriod("2026-02-30")).toBeNull();
    expect(duePeriod("2026-13-01")).toBeNull();
    expect(duePeriod("2026-00-10")).toBeNull();
    expect(duePeriod("2026-04-31")).toBeNull();
  });
  test("leap years", () => {
    expect(duePeriod("2024-02-29")).not.toBeNull();
    expect(duePeriod("2026-02-29")).toBeNull();
    expect(duePeriod("2100-02-29")).toBeNull();
    expect(duePeriod("2000-02-29")).not.toBeNull();
  });
  test("week 53 exists only in years that have it", () => {
    expect(duePeriod("2026-W53")).not.toBeNull();
    expect(duePeriod("2025-W53")).toBeNull();
    expect(duePeriod("2026-W54")).toBeNull();
    expect(duePeriod("2026-W00")).toBeNull();
  });
  test("quarters go from 1 to 4", () => {
    expect(duePeriod("2026-Q1")).not.toBeNull();
    expect(duePeriod("2026-Q5")).toBeNull();
    expect(duePeriod("2026-Q0")).toBeNull();
  });
  test("numbers must be zero padded and forms must be exact", () => {
    expect(duePeriod("2026-1-5")).toBeNull();
    expect(duePeriod("2026-W5")).toBeNull();
    expect(duePeriod("26-11-22")).toBeNull();
    expect(duePeriod("2026-11-22x")).toBeNull();
    expect(duePeriod("2026-w47")).toBeNull();
    expect(duePeriod("")).toBeNull();
  });
});

describe("duePeriod: periods", () => {
  test("a day covers itself", () => {
    expect(duePeriod("2026-11-22")).toEqual({ start: "2026-11-22", end: "2026-11-22" });
  });
  test("a week covers Monday to Sunday", () => {
    expect(duePeriod("2026-W47")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
  });
  test("a week can start in the previous year or end in the next one", () => {
    expect(duePeriod("2026-W01")).toEqual({ start: "2025-12-29", end: "2026-01-04" });
    expect(duePeriod("2026-W53")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(duePeriod("2027-W01")).toEqual({ start: "2027-01-04", end: "2027-01-10" });
  });
  test("a quarter covers its three months", () => {
    expect(duePeriod("2026-Q1")).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(duePeriod("2026-Q2")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(duePeriod("2026-Q4")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(duePeriod("2024-Q1")).toEqual({ start: "2024-01-01", end: "2024-03-31" });
  });
  test("dayPeriod is a one-day horizon", () => {
    expect(dayPeriod(TODAY)).toEqual({ start: TODAY, end: TODAY });
  });
});

describe("dueState against a horizon", () => {
  const today = dayPeriod(TODAY);
  test("a day is due now on that day, overdue the day after, later the day before", () => {
    expect(dueState("2026-11-11", today)).toBe("now");
    expect(dueState("2026-11-11", dayPeriod("2026-11-12"))).toBe("overdue");
    expect(dueState("2026-11-11", dayPeriod("2026-11-10"))).toBe("later");
  });
  test("a week is due now all week and overdue from the next Monday", () => {
    expect(dueState("2026-W46", dayPeriod("2026-11-09"))).toBe("now");
    expect(dueState("2026-W46", dayPeriod("2026-11-15"))).toBe("now");
    expect(dueState("2026-W46", dayPeriod("2026-11-16"))).toBe("overdue");
    expect(dueState("2026-W46", dayPeriod("2026-11-08"))).toBe("later");
  });
  test("a quarter is due now for the whole quarter", () => {
    expect(dueState("2026-Q4", dayPeriod("2026-10-01"))).toBe("now");
    expect(dueState("2026-Q4", dayPeriod("2026-12-31"))).toBe("now");
    expect(dueState("2026-Q4", dayPeriod("2027-01-01"))).toBe("overdue");
    expect(dueState("2027-Q1", today)).toBe("later");
    expect(dueState("2026-Q3", today)).toBe("overdue");
  });
  test("the horizon can be a longer period: any overlap is due now", () => {
    const week = { start: "2026-11-09", end: "2026-11-15" };
    expect(dueState("2026-11-15", week)).toBe("now");
    expect(dueState("2026-Q4", week)).toBe("now");
    expect(dueState("2026-11-16", week)).toBe("later");
    expect(dueState("2026-11-08", week)).toBe("overdue");
  });
  test("a day after today but within the current ISO week is due this week", () => {
    expect(dueState("2026-11-13", today)).toBe("week");
    expect(dueState("2026-11-15", today)).toBe("week");
  });
  test("a day in the next week, a later week and a later quarter are later", () => {
    expect(dueState("2026-11-16", today)).toBe("later");
    expect(dueState("2026-W47", today)).toBe("later");
    expect(dueState("2027-Q1", today)).toBe("later");
  });
  test("the current week and quarter stay due now, and today stays due now", () => {
    expect(dueState("2026-W46", today)).toBe("now");
    expect(dueState("2026-Q4", today)).toBe("now");
    expect(dueState(TODAY, today)).toBe("now");
  });
  test("an invalid date has no state", () => {
    expect(dueState("2026-02-30", today)).toBeNull();
  });
});

describe("resolveShortcut: days", () => {
  test("today and tomorrow", () => {
    expect(r("today")).toBe("2026-11-11");
    expect(r("tomorrow")).toBe("2026-11-12");
  });
  test("day shifts", () => {
    expect(r("+1d")).toBe("2026-11-12");
    expect(r("-1d")).toBe("2026-11-10");
    expect(r("+30d")).toBe("2026-12-11");
  });
  test("week shifts are 7 days", () => {
    expect(r("+1w")).toBe("2026-11-18");
    expect(r("-1w")).toBe("2026-11-04");
    expect(r("+2w")).toBe("2026-11-25");
  });
  test("month and year shifts", () => {
    expect(r("+1m")).toBe("2026-12-11");
    expect(r("-2m")).toBe("2026-09-11");
    expect(r("+1y")).toBe("2027-11-11");
    expect(r("-1y")).toBe("2025-11-11");
  });
  test("month and year shifts clamp to the end of the target month", () => {
    expect(r("+1m", "2026-01-31")).toBe("2026-02-28");
    expect(r("+1m", "2024-01-31")).toBe("2024-02-29");
    expect(r("-1m", "2026-03-31")).toBe("2026-02-28");
    expect(r("+1y", "2024-02-29")).toBe("2025-02-28");
    expect(r("+1m", "2026-12-31")).toBe("2027-01-31");
    expect(r("+13m", "2026-12-31")).toBe("2028-01-31");
  });
  test("shifts cross year boundaries", () => {
    expect(r("+1d", "2026-12-31")).toBe("2027-01-01");
    expect(r("-1d", "2027-01-01")).toBe("2026-12-31");
  });
});

describe("resolveShortcut: weekdays", () => {
  test("+day is the first such day strictly after today", () => {
    expect(r("+mon")).toBe("2026-11-16");
    expect(r("+thu")).toBe("2026-11-12");
    expect(r("+sun")).toBe("2026-11-15");
  });
  test("today's own weekday gives next week, not today", () => {
    expect(r("+wed")).toBe("2026-11-18");
    expect(r("-wed")).toBe("2026-11-04");
  });
  test("-day is the last such day strictly before today", () => {
    expect(r("-tue")).toBe("2026-11-10");
    expect(r("-mon")).toBe("2026-11-09");
    expect(r("-thu")).toBe("2026-11-05");
  });
  test("every weekday name is known", () => {
    for (const d of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) expect(r("+" + d)).not.toBeNull();
    expect(r("+fri")).toBe("2026-11-13");
    expect(r("+sat")).toBe("2026-11-14");
  });
});

describe("resolveShortcut: weeks and quarters", () => {
  test("bare W and Q are the current week and quarter", () => {
    expect(r("W")).toBe("2026-W46");
    expect(r("Q")).toBe("2026-Q4");
  });
  test("week and quarter shifts", () => {
    expect(r("+1W")).toBe("2026-W47");
    expect(r("-1W")).toBe("2026-W45");
    expect(r("+1Q")).toBe("2027-Q1");
    expect(r("-1Q")).toBe("2026-Q3");
  });
  test("week shifts cross years, honoring week 53", () => {
    expect(r("+7W")).toBe("2026-W53");
    expect(r("+8W")).toBe("2027-W01");
    expect(r("-46W")).toBe("2025-W52");
  });
  test("the current week near New Year belongs to the ISO year", () => {
    expect(r("W", "2026-12-31")).toBe("2026-W53");
    expect(r("W", "2027-01-01")).toBe("2026-W53");
    expect(r("W", "2024-12-30")).toBe("2025-W01");
  });
  test("quarter shifts cross years", () => {
    expect(r("-4Q")).toBe("2025-Q4");
    expect(r("+5Q")).toBe("2028-Q1");
    expect(r("Q", "2026-01-01")).toBe("2026-Q1");
  });
});

describe("resolveShortcut: literals and unknown words", () => {
  test("a valid literal is accepted as is", () => {
    expect(r("2026-12-24")).toBe("2026-12-24");
    expect(r("2026-W52")).toBe("2026-W52");
    expect(r("2027-Q2")).toBe("2027-Q2");
  });
  test("an invalid literal is refused", () => {
    expect(r("2026-02-30")).toBeNull();
    expect(r("2026-W54")).toBeNull();
  });
  test("there is no yesterday and no malformed shift", () => {
    for (const w of ["yesterday", "", "+0d", "-0w", "+d", "+", "1d", "+1x", "+1.5d", "+-1d", "+1", "+xyz", "foo", "+1 d"]) {
      expect(r(w)).toBeNull();
    }
  });
});

describe("dueEntries", () => {
  const labels = (word: string) => dueEntries(word, TODAY).map((e) => e.label);
  test("a bare arrow lists the default set with resolved dates", () => {
    expect(labels("")).toEqual(["today", "tomorrow", "+1d", "+1w", "+1m", "+1y", "+mon", "W", "Q", "+1W", "+1Q"]);
    expect(dueEntries("", TODAY)[1]).toEqual({ label: "tomorrow", date: "2026-11-12" });
    expect(dueEntries("", TODAY)[10]).toEqual({ label: "+1Q", date: "2027-Q1" });
  });
  test("typing filters the default set by prefix", () => {
    expect(labels("to")).toEqual(["today", "tomorrow"]);
    expect(labels("+1")).toEqual(["+1d", "+1w", "+1m", "+1y", "+1W", "+1Q"]);
  });
  test("a valid shortcut outside the set is one dynamic entry", () => {
    expect(dueEntries("+3d", TODAY)).toEqual([{ label: "+3d", date: "2026-11-14" }]);
    expect(dueEntries("-2m", TODAY)).toEqual([{ label: "-2m", date: "2026-09-11" }]);
    expect(dueEntries("+fri", TODAY)).toEqual([{ label: "+fri", date: "2026-11-13" }]);
    expect(dueEntries("2026-W52", TODAY)).toEqual([{ label: "2026-W52", date: "2026-W52" }]);
  });
  test("a word that is already in the set is not duplicated", () => {
    expect(dueEntries("+1w", TODAY)).toEqual([{ label: "+1w", date: "2026-11-18" }]);
    expect(dueEntries("today", TODAY)).toEqual([{ label: "today", date: "2026-11-11" }]);
  });
  test("an unknown word shows nothing", () => {
    expect(labels("foo")).toEqual([]);
    expect(labels("yesterday")).toEqual([]);
    expect(labels("2026-02-30")).toEqual([]);
  });
});

describe("resolveTrailing", () => {
  test("replaces a trailing valid shortcut with `-> DATE`", () => {
    expect(resolveTrailing("Pay rent ->tomorrow", TODAY)).toBe("Pay rent -> 2026-11-12");
    expect(resolveTrailing("->+1w", TODAY)).toBe("-> 2026-11-18");
    expect(resolveTrailing("a ->2026-W52", TODAY)).toBe("a -> 2026-W52");
  });
  test("null for an unknown word, a bare arrow, a spaced arrow or no arrow", () => {
    expect(resolveTrailing("a ->foo", TODAY)).toBeNull();
    expect(resolveTrailing("a ->", TODAY)).toBeNull();
    expect(resolveTrailing("a -> 2026-11-22", TODAY)).toBeNull();
    expect(resolveTrailing("a->today", TODAY)).toBeNull();
    expect(resolveTrailing("plain", TODAY)).toBeNull();
  });
});
