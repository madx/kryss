import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureTodoFile, resolveTodoFile } from "./config";

describe("resolveTodoFile", () => {
  test("defaults to ./todo.md when TODO_FILE is unset", () => {
    expect(resolveTodoFile({})).toBe("./todo.md");
  });

  test("uses TODO_FILE when it is set", () => {
    expect(resolveTodoFile({ TODO_FILE: "/data/my-list.md" })).toBe("/data/my-list.md");
  });

  test("falls back to the default when TODO_FILE is empty", () => {
    expect(resolveTodoFile({ TODO_FILE: "" })).toBe("./todo.md");
  });
});

describe("ensureTodoFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "todoapp-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates an empty file when it is missing", async () => {
    const path = join(dir, "todo.md");
    await ensureTodoFile(path);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("");
  });

  test("leaves an existing file untouched", async () => {
    const path = join(dir, "todo.md");
    writeFileSync(path, "## Groceries\n- [ ] Milk\n");
    await ensureTodoFile(path);
    expect(readFileSync(path, "utf8")).toBe("## Groceries\n- [ ] Milk\n");
  });
});
