import { describe, expect, test } from "bun:test";
import { copyList, copyTask, registerText } from "./register";
import { frozen, sample } from "./helpers.test-util";

describe("copyTask", () => {
  test("copies a task with its subtree", () => {
    expect(copyTask(frozen(sample()), { list: 0, task: 1 })).toEqual({ kind: "task", task: sample().lists[0]!.tasks[1]! });
  });
  test("copies a subtask", () => {
    expect(copyTask(sample(), { list: 0, task: 1, child: 1 })).toEqual({ kind: "task", task: { text: "a1y", done: false } });
  });
  test("the copy does not follow later changes of the document", () => {
    const d = sample();
    const reg = copyTask(d, { list: 0, task: 1 })!;
    d.lists[0]!.tasks[1]!.text = "changed";
    d.lists[0]!.tasks[1]!.children![0]!.done = true;
    expect(reg).toEqual({ kind: "task", task: sample().lists[0]!.tasks[1]! });
  });
  test("an unknown path gives null", () => {
    expect(copyTask(sample(), { list: 3, task: 0 })).toBeNull();
  });
});

describe("copyList", () => {
  test("copies a list with its tasks, independently of the document", () => {
    const d = sample();
    const reg = copyList(d, 0)!;
    d.lists[0]!.tasks.pop();
    expect(reg).toEqual({ kind: "list", list: sample().lists[0]! });
  });
  test("an unknown list gives null", () => {
    expect(copyList(sample(), 9)).toBeNull();
  });
});

describe("registerText", () => {
  test("a task is its line followed by its indented subtasks, with no trailing newline", () => {
    expect(registerText({ kind: "task", task: { text: "a", done: true, children: [{ text: "b", done: false }] } })).toBe("- [x] a\n  - [ ] b");
  });
  test("a list is its title line and its tasks, with no trailing newline", () => {
    expect(registerText({ kind: "list", list: sample().lists[0]! })).toBe("## A\n- [ ] a0\n- [ ] a1\n  - [ ] a1x\n  - [ ] a1y\n- [ ] a2");
  });
  test("an empty list is its title line", () => {
    expect(registerText({ kind: "list", list: { title: "Empty", tasks: [] } })).toBe("## Empty");
  });
});
