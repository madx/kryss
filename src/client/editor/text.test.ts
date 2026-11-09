import { expect, test } from "bun:test";
import { toSingleLine } from "./text";

test("line breaks become one space each", () => {
  expect(toSingleLine("a\nb\r\nc\rd")).toBe("a b c d");
  expect(toSingleLine("plain")).toBe("plain");
});
