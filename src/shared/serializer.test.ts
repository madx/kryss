import { describe, expect, test } from "bun:test";
import { serialize, serializeList, serializeTask } from "./serializer";
import type { TodoDocument } from "./types";

const doc: TodoDocument = {
  lists: [
    { title: "A", tasks: [{ text: "x", done: false, children: [{ text: "y", done: true }] }] },
    { title: "B", tasks: [] },
    { title: "C", tasks: [{ text: "z", done: true }] },
  ],
};

describe("serializeTask", () => {
  test("a task without subtasks is one line", () => {
    expect(serializeTask({ text: "a", done: false })).toBe("- [ ] a");
    expect(serializeTask({ text: "a", done: true })).toBe("- [x] a");
  });

  test("an empty children array is the same as no subtasks", () => {
    expect(serializeTask({ text: "a", done: false, children: [] })).toBe("- [ ] a");
  });

  test("subtasks follow the task, indented by 2 spaces", () => {
    const task = { text: "a", done: false, children: [{ text: "b", done: true }, { text: "c", done: false }] };
    expect(serializeTask(task)).toBe("- [ ] a\n  - [x] b\n  - [ ] c");
  });
});

describe("serializeList", () => {
  test("an empty list is its title line", () => {
    expect(serializeList({ title: "B", tasks: [] })).toBe("## B");
  });

  test("a list is its title line and its tasks, with no trailing newline", () => {
    expect(serializeList(doc.lists[0]!)).toBe("## A\n- [ ] x\n  - [x] y");
  });
});

describe("serialize", () => {
  test("an empty document is an empty string", () => {
    expect(serialize({ lists: [] })).toBe("");
  });

  test("lists are separated by a blank line and the text ends with one newline", () => {
    expect(serialize(doc)).toBe("## A\n- [ ] x\n  - [x] y\n\n## B\n\n## C\n- [x] z\n");
  });

  test("a document is its serialized lists joined by a blank line", () => {
    expect(serialize(doc)).toBe(doc.lists.map(serializeList).join("\n\n") + "\n");
  });

  test("a document of one empty list is its title line and a newline", () => {
    expect(serialize({ lists: [{ title: "B", tasks: [] }] })).toBe("## B\n");
  });
});
