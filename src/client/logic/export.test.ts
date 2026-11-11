import { describe, expect, test } from "bun:test";
import { exportView } from "./export";
import { visibleRows } from "./filter";
import { sample } from "./helpers.test-util";

const TODAY = "2026-11-11";
const view = (text = "") => {
  const doc = sample();
  return exportView(doc, visibleRows(doc, text, TODAY, []));
};

describe("exportView", () => {
  test("an empty filter exports the whole document", () => {
    expect(view()).toBe("## A\n- [ ] a0\n- [ ] a1\n  - [ ] a1x\n  - [ ] a1y\n- [ ] a2\n\n## Empty\n");
  });

  test("a filter exports only the visible lists and tasks", () => {
    expect(view("a2")).toBe("## A\n- [ ] a2\n");
  });

  test("a matching subtask is exported with its parent and without its siblings", () => {
    expect(view("a1y")).toBe("## A\n- [ ] a1\n  - [ ] a1y\n");
  });

  test("a matching parent is exported with its whole subtree", () => {
    expect(view("a1")).toBe("## A\n- [ ] a1\n  - [ ] a1x\n  - [ ] a1y\n");
  });

  test("a filter that shows nothing exports an empty string", () => {
    expect(view("zzz")).toBe("");
    expect(view("due:foo")).toBe("");
  });

  test("an empty document exports an empty string", () => {
    const doc = { lists: [], filters: [] };
    expect(exportView(doc, visibleRows(doc, "", TODAY, []))).toBe("");
  });
});
