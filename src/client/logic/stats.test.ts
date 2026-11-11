import { describe, expect, test } from "bun:test";
import type { TodoDocument } from "../../shared/types";
import { frozen } from "./helpers.test-util";
import { countList, countTasks } from "./stats";

function doc(): TodoDocument {
  return {
    filters: [],
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
    expect(countTasks(frozen({ lists: [], filters: [] }))).toEqual({ done: 0, total: 0 });
  });

  test("an out-of-range range is clamped", () => {
    expect(countTasks(frozen(doc()), { first: -3, last: 99 })).toEqual({ done: 3, total: 5 });
  });
});

describe("countList", () => {
  test("counts the tasks and subtasks of one list", () => {
    expect(countList(frozen(doc()).lists[0]!)).toEqual({ done: 2, total: 4 });
  });

  test("an empty list counts 0/0", () => {
    expect(countList(frozen(doc()).lists[1]!)).toEqual({ done: 0, total: 0 });
  });
});
