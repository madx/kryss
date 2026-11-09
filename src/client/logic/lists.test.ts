import { describe, expect, test } from "bun:test";
import { addList, deleteList, renameList } from "./index";
import { frozen, sample } from "./helpers.test-util";

describe("lists", () => {
  test("addList appends an empty list", () => {
    const d = addList(frozen(sample()), " New ");
    expect(d.lists).toHaveLength(3);
    expect(d.lists[2]).toEqual({ title: "New", tasks: [] });
  });
  test("addList works on an empty document and refuses an empty title", () => {
    expect(addList({ lists: [] }, "A").lists).toHaveLength(1);
    const s = frozen(sample());
    expect(addList(s, " ")).toBe(s);
  });
  test("renameList", () => {
    const s = frozen(sample());
    expect(renameList(s, 1, "Done").lists[1]!.title).toBe("Done");
    expect(renameList(s, 1, "")).toBe(s);
    expect(renameList(s, 7, "x")).toBe(s);
  });
  test("deleteList", () => {
    const s = frozen(sample());
    expect(deleteList(s, 0).lists.map((l) => l.title)).toEqual(["Empty"]);
    expect(deleteList(s, 7)).toBe(s);
  });
});
