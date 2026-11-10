import { describe, expect, test } from "bun:test";
import type { TodoDocument } from "../../shared/types";
import { frozen } from "./helpers.test-util";
import { countTasks, statusline } from "./stats";

function doc(): TodoDocument {
  return {
    lists: [
      {
        title: "Garden",
        tasks: [
          { text: "water ferns", done: true },
          {
            text: "build shed",
            done: false,
            children: [
              { text: "buy planks", done: true },
              { text: "paint roof", done: false },
            ],
          },
        ],
      },
      { title: "Empty", tasks: [] },
      { title: "Kitchen", tasks: [{ text: "descale kettle", done: true }] },
    ],
  };
}

describe("countTasks", () => {
  test("counts parents and subtasks as tasks", () => {
    expect(countTasks(frozen(doc()), { first: 0, last: 0 }).total).toBe(4);
  });

  test("counts done subtasks and done parents", () => {
    expect(countTasks(frozen(doc()), { first: 0, last: 0 }).done).toBe(2);
  });

  test("a single-list range counts only that list", () => {
    expect(countTasks(frozen(doc()), { first: 2, last: 2 })).toEqual({ done: 1, total: 1 });
  });

  test("the default range is the whole document", () => {
    expect(countTasks(frozen(doc()))).toEqual({ done: 3, total: 5 });
  });

  test("an empty list counts 0/0", () => {
    expect(countTasks(frozen(doc()), { first: 1, last: 1 })).toEqual({ done: 0, total: 0 });
  });

  test("an empty document counts 0/0", () => {
    expect(countTasks(frozen({ lists: [] }))).toEqual({ done: 0, total: 0 });
  });

  test("an out-of-range range is clamped", () => {
    expect(countTasks(frozen(doc()), { first: -3, last: 99 })).toEqual({ done: 3, total: 5 });
  });
});

describe("statusline", () => {
  test("view counts follow the range", () => {
    expect(statusline(frozen(doc()), { first: 2, last: 2 }, null).view).toEqual({ done: 1, total: 1 });
  });

  test("document counts ignore the range", () => {
    expect(statusline(frozen(doc()), { first: 2, last: 2 }, null).document).toEqual({ done: 3, total: 5 });
  });

  test("a null cursor list gives 0", () => {
    expect(statusline(frozen(doc()), { first: 0, last: 2 }, null).list).toBe(0);
  });

  test("cursor list 1 gives 2", () => {
    expect(statusline(frozen(doc()), { first: 0, last: 2 }, 1).list).toBe(2);
  });

  test("lists is the total list count, whatever the range", () => {
    expect(statusline(frozen(doc()), { first: 0, last: 0 }, 0).lists).toBe(3);
  });

  test("an empty document gives zero everywhere", () => {
    expect(statusline(frozen({ lists: [] }), { first: 0, last: -1 }, null)).toEqual({
      view: { done: 0, total: 0 },
      document: { done: 0, total: 0 },
      list: 0,
      lists: 0,
    });
  });
});
