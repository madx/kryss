import { expect, test } from "bun:test";
import { zoneFromPointer } from "./dnd-zone";

test("thirds when a child drop is allowed", () => {
  expect(zoneFromPointer(105, 100, 30, true)).toBe("before");
  expect(zoneFromPointer(115, 100, 30, true)).toBe("child");
  expect(zoneFromPointer(125, 100, 30, true)).toBe("after");
});

test("halves when a child drop is not allowed", () => {
  expect(zoneFromPointer(110, 100, 30, false)).toBe("before");
  expect(zoneFromPointer(120, 100, 30, false)).toBe("after");
});

test("pointer outside the row or zero height", () => {
  expect(zoneFromPointer(0, 100, 30, true)).toBe("before");
  expect(zoneFromPointer(500, 100, 30, true)).toBe("after");
  expect(zoneFromPointer(5, 0, 0, false)).toBe("after");
});
