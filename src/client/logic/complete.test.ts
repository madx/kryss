import { describe, expect, test } from "bun:test";
import { completeDue } from "./complete";

const TODAY = "2026-11-11";
const c = (text: string) => completeDue(text, TODAY);

describe("completeDue", () => {
  test("a day before today becomes today and keeps the old date as plain text", () => {
    expect(c("Renew passport -> 2026-10-30")).toBe("Renew passport -> 2026-11-11 (was 2026-10-30)");
  });

  test("a week becomes today and keeps the week", () => {
    expect(c("Report -> 2026-W46")).toBe("Report -> 2026-11-11 (was 2026-W46)");
    expect(c("Report -> 2026-W40")).toBe("Report -> 2026-11-11 (was 2026-W40)");
  });

  test("a quarter becomes today, the current one included", () => {
    expect(c("Plan -> 2026-Q4")).toBe("Plan -> 2026-11-11 (was 2026-Q4)");
    expect(c("Plan -> 2027-Q1")).toBe("Plan -> 2026-11-11 (was 2027-Q1)");
  });

  test("today and a later day stay as they are", () => {
    expect(c("a -> 2026-11-11")).toBe("a -> 2026-11-11");
    expect(c("a -> 2026-11-12")).toBe("a -> 2026-11-12");
    expect(c("a -> 2030-01-01")).toBe("a -> 2030-01-01");
  });

  test("a task with no due date, or an invalid one, gets none", () => {
    expect(c("a")).toBe("a");
    expect(c("a -> 2026-02-30")).toBe("a -> 2026-02-30");
    expect(c("a -> soon")).toBe("a -> soon");
  });

  test("the text that followed the date moves after the suffix", () => {
    expect(c("a -> 2026-10-30 and more")).toBe("a -> 2026-11-11 (was 2026-10-30) and more");
  });

  test("text before the date is untouched", () => {
    expect(c("**a** [b](https://x.y) -> 2026-10-30")).toBe("**a** [b](https://x.y) -> 2026-11-11 (was 2026-10-30)");
  });

  test("an existing (was …) is kept as it is, so the oldest date survives", () => {
    expect(c("a -> 2026-11-05 (was 2026-10-30)")).toBe("a -> 2026-11-11 (was 2026-10-30)");
    expect(c("a -> 2026-W45 (was 2026-10-01) tail")).toBe("a -> 2026-11-11 (was 2026-10-01) tail");
  });

  test("only the last due date is rewritten", () => {
    expect(c("a -> 2026-10-01 b -> 2026-10-30")).toBe("a -> 2026-10-01 b -> 2026-11-11 (was 2026-10-30)");
  });

  test("a date inside code stays literal", () => {
    expect(c("a `-> 2026-10-30`")).toBe("a `-> 2026-10-30`");
  });

  test("rewriting twice changes nothing more", () => {
    expect(c(c("a -> 2026-10-30"))).toBe("a -> 2026-11-11 (was 2026-10-30)");
  });
});
