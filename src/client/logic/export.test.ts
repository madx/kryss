import { describe, expect, test } from "bun:test";
import { exportView } from "./export";
import { sample } from "./helpers.test-util";

describe("exportView", () => {
  test("the All view exports the whole document", () => {
    expect(exportView(sample(), null)).toBe(
      "## A\n- [ ] a0\n- [ ] a1\n  - [ ] a1x\n  - [ ] a1y\n- [ ] a2\n\n## Empty\n",
    );
  });

  test("a single-list view exports only that list", () => {
    expect(exportView(sample(), 0)).toBe("## A\n- [ ] a0\n- [ ] a1\n  - [ ] a1x\n  - [ ] a1y\n- [ ] a2\n");
  });

  test("an empty list exports its title line", () => {
    expect(exportView(sample(), 1)).toBe("## Empty\n");
  });

  test("an empty document exports an empty string", () => {
    expect(exportView({ lists: [], filters: [] }, null)).toBe("");
  });

  test("a stale list index exports the whole document", () => {
    expect(exportView(sample(), 5)).toBe(exportView(sample(), null));
  });
});
