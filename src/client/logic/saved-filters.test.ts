import { describe, expect, test } from "bun:test";
import { deleteFilter, pickerEntries, pickerKey, saveFilter } from "./saved-filters";

const A = { name: "A", text: "list:Work" };
const B = { name: "B", text: "is:todo" };

describe("pickerEntries", () => {
  test("the save entry comes first, then the saved filters in file order", () => {
    expect(pickerEntries([A, B], "x")).toEqual([{ kind: "save" }, { kind: "saved", index: 0 }, { kind: "saved", index: 1 }]);
  });

  test("the save entry is left out when the filter text is empty", () => {
    expect(pickerEntries([A], "")).toEqual([{ kind: "saved", index: 0 }]);
    expect(pickerEntries([A], "   ")).toEqual([{ kind: "saved", index: 0 }]);
  });

  test("nothing to show with no saved filter and no text", () => {
    expect(pickerEntries([], "")).toEqual([]);
  });
});

describe("saveFilter", () => {
  test("appends a new name", () => {
    expect(saveFilter([A], "B", "is:todo")).toEqual([A, B]);
  });

  test("an existing name is overwritten in place", () => {
    expect(saveFilter([A, B], "A", "new")).toEqual([{ name: "A", text: "new" }, B]);
  });

  test("the name and the text are trimmed, and an empty name or text saves nothing", () => {
    expect(saveFilter([], "  A  ", " x ")).toEqual([{ name: "A", text: "x" }]);
    expect(saveFilter([A], "  ", "x")).toBeNull();
    expect(saveFilter([A], "B", " ")).toBeNull();
  });

  test("does not mutate its input", () => {
    const saved = Object.freeze([Object.freeze({ ...A })]) as unknown as { name: string; text: string }[];
    expect(saveFilter(saved, "A", "y")).toEqual([{ name: "A", text: "y" }]);
    expect(saved[0]!.text).toBe("list:Work");
  });
});

describe("deleteFilter", () => {
  test("removes one filter and keeps the order of the others", () => {
    expect(deleteFilter([A, B], 0)).toEqual([B]);
    expect(deleteFilter([A, B], 1)).toEqual([A]);
  });

  test("an unknown index returns the same list", () => {
    const saved = [A];
    expect(deleteFilter(saved, 3)).toBe(saved);
  });
});

describe("pickerKey", () => {
  test("arrows and j / k move the highlight without wrapping", () => {
    expect(pickerKey(0, 3, "ArrowDown", false)).toEqual({ highlight: 1 });
    expect(pickerKey(2, 3, "ArrowDown", false)).toEqual({ highlight: 2 });
    expect(pickerKey(1, 3, "j", false)).toEqual({ highlight: 2 });
    expect(pickerKey(0, 3, "ArrowUp", false)).toEqual({ highlight: 0 });
    expect(pickerKey(2, 3, "k", false)).toEqual({ highlight: 1 });
  });

  test("Enter picks the highlighted entry", () => {
    expect(pickerKey(1, 3, "Enter", false)).toEqual({ pick: 1 });
  });

  test("Escape closes", () => {
    expect(pickerKey(1, 3, "Escape", false)).toEqual({ close: true });
  });

  test("d starts a delete, and a second d deletes the highlighted entry", () => {
    expect(pickerKey(1, 3, "d", false)).toEqual({ pending: true });
    expect(pickerKey(1, 3, "d", true)).toEqual({ remove: 1 });
  });

  test("another key cancels the delete prefix", () => {
    expect(pickerKey(1, 3, "j", true)).toEqual({ highlight: 2, cancel: true });
    expect(pickerKey(1, 3, "x", true)).toEqual({ cancel: true });
  });

  test("an unknown key is ignored", () => {
    expect(pickerKey(1, 3, "x", false)).toBeNull();
  });

  test("an empty list has nothing to pick, move or delete, but Escape still closes", () => {
    expect(pickerKey(0, 0, "Enter", false)).toBeNull();
    expect(pickerKey(0, 0, "ArrowDown", false)).toBeNull();
    expect(pickerKey(0, 0, "d", false)).toBeNull();
    expect(pickerKey(0, 0, "Escape", false)).toEqual({ close: true });
  });
});
