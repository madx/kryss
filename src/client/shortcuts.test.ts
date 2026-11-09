import { describe, expect, test } from "bun:test";
import { undoActionFor } from "./shortcuts";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods,
});

describe("undoActionFor", () => {
  test("Ctrl+Z is undo", () => {
    expect(undoActionFor(key("z", { ctrlKey: true }))).toBe("undo");
  });
  test("Ctrl+Shift+Z is redo, even with an uppercase key", () => {
    expect(undoActionFor(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
  });
  test("Cmd+Z works for macOS", () => {
    expect(undoActionFor(key("z", { metaKey: true }))).toBe("undo");
  });
  test("Ctrl+Y is redo", () => {
    expect(undoActionFor(key("y", { ctrlKey: true }))).toBe("redo");
  });
  test("a plain Z or Ctrl+Alt+Z is ignored", () => {
    expect(undoActionFor(key("z"))).toBeNull();
    expect(undoActionFor(key("z", { ctrlKey: true, altKey: true }))).toBeNull();
  });
});
