import { describe, expect, test } from "bun:test";
import { highlightClass, highlightColor, highlightEntries } from "./highlight";

describe("highlightColor", () => {
  test("each of the six circles is a color", () => {
    expect(highlightColor("🔴")).toBe("red");
    expect(highlightColor("🟠")).toBe("orange");
    expect(highlightColor("🟡")).toBe("yellow");
    expect(highlightColor("🟢")).toBe("green");
    expect(highlightColor("🔵")).toBe("blue");
    expect(highlightColor("🟣")).toBe("purple");
  });

  test("any other text is not a color", () => {
    expect(highlightColor("🍎")).toBeNull();
    expect(highlightColor("⚫")).toBeNull();
    expect(highlightColor("a")).toBeNull();
    expect(highlightColor("")).toBeNull();
  });
});

describe("highlightClass", () => {
  test("the default has one class and a color adds its own", () => {
    expect(highlightClass()).toBe("hl");
    expect(highlightClass("red")).toBe("hl hl-red");
  });
});

describe("highlightEntries", () => {
  test("seven entries in order, titled with the circle and the color name", () => {
    expect(highlightEntries().map((e) => e.label)).toEqual([
      "Default", "🔴 Red", "🟠 Orange", "🟡 Yellow", "🟢 Green", "🔵 Blue", "🟣 Purple",
    ]);
  });

  test("each entry inserts both markers with the cursor before the closing one", () => {
    const [plain, red] = highlightEntries();
    expect(plain).toMatchObject({ insert: "====", cursor: 2 });
    expect(red).toMatchObject({ insert: "==🔴==", cursor: 4 });
  });
});
