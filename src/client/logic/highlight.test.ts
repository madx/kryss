import { describe, expect, test } from "bun:test";
import { highlightClass, highlightColor, highlightEntries, opensHighlightPopup } from "./highlight";

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

describe("opensHighlightPopup", () => {
  test("opens on a typed == at the start or after text", () => {
    expect(opensHighlightPopup("==")).toBe(true);
    expect(opensHighlightPopup("buy ==")).toBe(true);
  });

  test("does not open on a single = or on a longer run", () => {
    expect(opensHighlightPopup("=")).toBe(false);
    expect(opensHighlightPopup("buy =")).toBe(false);
    expect(opensHighlightPopup("===")).toBe(false);
  });

  test("does not open when the typed == closes an open highlight", () => {
    expect(opensHighlightPopup("==🔴text==")).toBe(false);
    expect(opensHighlightPopup("==text==")).toBe(false);
  });

  test("opens again after a complete highlight", () => {
    expect(opensHighlightPopup("==a== and ==")).toBe(true);
  });
});
