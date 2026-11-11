import { describe, expect, test } from "bun:test";
import type { TodoDocument } from "../../shared/types";
import { frozen } from "./helpers.test-util";
import { visibleRows, type VisibleList } from "./filter";
import { countList, countVisible, countVisibleList } from "./stats";

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

describe("countVisible", () => {
  const all = (d: TodoDocument): VisibleList[] => visibleRows(d, "", "2026-11-11", []).lists;

  test("counts parents and subtasks as tasks", () => {
    expect(countVisible(frozen(doc()), all(doc()).slice(0, 1))).toEqual({ done: 2, total: 4 });
  });

  test("sums the visible lists", () => {
    expect(countVisible(frozen(doc()), all(doc()))).toEqual({ done: 3, total: 5 });
  });

  test("an empty list counts 0/0", () => {
    expect(countVisible(frozen(doc()), all(doc()).slice(1, 2))).toEqual({ done: 0, total: 0 });
  });

  test("no visible list counts 0/0", () => {
    expect(countVisible(frozen(doc()), [])).toEqual({ done: 0, total: 0 });
  });

  test("counts only the visible tasks and subtasks of a filtered list", () => {
    const d = frozen(doc());
    // "planks" shows the parent "build shed" as context and only the matching subtask.
    expect(countVisible(d, visibleRows(d, "planks", "2026-11-11", []).lists)).toEqual({ done: 1, total: 2 });
    expect(countVisibleList(d.lists[0]!, visibleRows(d, "planks", "2026-11-11", []).lists[0]!)).toEqual({ done: 1, total: 2 });
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
