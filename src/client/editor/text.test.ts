import { expect, test } from "bun:test";
import { settleDecision, toSingleLine } from "./text";

test("line breaks become one space each", () => {
  expect(toSingleLine("a\nb\r\nc\rd")).toBe("a b c d");
  expect(toSingleLine("plain")).toBe("plain");
});

test("an open editor is committed when its task is unchanged underneath, discarded otherwise", () => {
  expect(settleDecision("a", "a")).toBe("commit");
  expect(settleDecision("a", "b")).toBe("discard");
  expect(settleDecision("a", undefined)).toBe("discard");
});
