import { describe, expect, test } from "bun:test";
import { menuKey, menuStart, menuView } from "./menu";

// Items: 0 is "All", i + 1 is list i.
describe("menuStart", () => {
  test("starts on All when the view is All", () => {
    expect(menuStart(null, 3)).toBe(0);
  });
  test("starts on the current list", () => {
    expect(menuStart(1, 3)).toBe(2);
  });
  test("a stale view starts on All", () => {
    expect(menuStart(7, 3)).toBe(0);
  });
});

describe("menuView", () => {
  test("item 0 is All", () => {
    expect(menuView(0)).toBeNull();
  });
  test("item n is list n - 1", () => {
    expect(menuView(3)).toBe(2);
  });
});

describe("menuKey", () => {
  test("ArrowDown highlights the next item", () => {
    expect(menuKey(0, 3, "ArrowDown")).toEqual({ highlight: 1 });
  });
  test("ArrowUp highlights the previous item", () => {
    expect(menuKey(2, 3, "ArrowUp")).toEqual({ highlight: 1 });
  });
  test("the highlight does not wrap at either end", () => {
    expect(menuKey(3, 3, "ArrowDown")).toEqual({ highlight: 3 });
    expect(menuKey(0, 3, "ArrowUp")).toEqual({ highlight: 0 });
  });
  test("Enter picks the highlighted item and closes the menu", () => {
    expect(menuKey(2, 3, "Enter")).toEqual({ pick: 1 });
    expect(menuKey(0, 3, "Enter")).toEqual({ pick: null });
  });
  test("Escape closes the menu without picking", () => {
    expect(menuKey(2, 3, "Escape")).toEqual({ close: true });
  });
  test("other keys are ignored", () => {
    expect(menuKey(2, 3, "x")).toBeNull();
  });
  test("with no list, only All can be highlighted", () => {
    expect(menuKey(0, 0, "ArrowDown")).toEqual({ highlight: 0 });
  });
});
