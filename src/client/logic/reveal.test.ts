import { describe, expect, test } from "bun:test";
import { revealAfterClick, revealAfterKey, revealOrNull } from "./reveal";
import { sample } from "./helpers.test-util";

describe("revealAfterClick", () => {
  test("a click on a top-level task's text reveals that task's line", () => {
    expect(revealAfterClick(null, { kind: "text", path: { list: 0, task: 1 } })).toEqual({ list: 0, task: 1 });
  });
  test("a click on a subtask's text reveals the line of its parent", () => {
    expect(revealAfterClick(null, { kind: "text", path: { list: 0, task: 1, child: 1 } })).toEqual({ list: 0, task: 1 });
  });
  test("a click on another task moves the reveal to it", () => {
    expect(revealAfterClick({ list: 0, task: 0 }, { kind: "text", path: { list: 0, task: 2 } })).toEqual({ list: 0, task: 2 });
  });
  test("a click on a checkbox changes nothing, whether a line is shown or not", () => {
    expect(revealAfterClick(null, { kind: "checkbox" })).toBeNull();
    expect(revealAfterClick({ list: 0, task: 1 }, { kind: "checkbox" })).toEqual({ list: 0, task: 1 });
  });
  test("a click anywhere else hides the line", () => {
    expect(revealAfterClick({ list: 0, task: 1 }, { kind: "other" })).toBeNull();
  });
});

describe("revealAfterKey", () => {
  test("Escape hides the line", () => {
    expect(revealAfterKey({ list: 0, task: 1 }, "Escape")).toBeNull();
  });
  test("other keys, such as the cursor keys, never show nor hide it", () => {
    expect(revealAfterKey(null, "j")).toBeNull();
    expect(revealAfterKey({ list: 0, task: 1 }, "j")).toEqual({ list: 0, task: 1 });
  });
});

describe("revealOrNull", () => {
  test("keeps a reveal that still points to a top-level task", () => {
    expect(revealOrNull({ list: 0, task: 1 }, sample())).toEqual({ list: 0, task: 1 });
  });
  test("drops a reveal whose task no longer exists", () => {
    expect(revealOrNull({ list: 0, task: 9 }, sample())).toBeNull();
    expect(revealOrNull({ list: 5, task: 0 }, sample())).toBeNull();
  });
  test("null stays null", () => {
    expect(revealOrNull(null, sample())).toBeNull();
  });
});
