import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureTodoFile, resolveHost, resolveTodoFile, resolveVault } from "./config";

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

describe("resolveHost", () => {
  test("defaults to 127.0.0.1 when HOST is unset", () => {
    expect(resolveHost({})).toBe("127.0.0.1");
  });

  test("uses HOST when it is set", () => {
    expect(resolveHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  test("falls back to the default when HOST is empty", () => {
    expect(resolveHost({ HOST: "" })).toBe("127.0.0.1");
  });
});

describe("ensureTodoFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kryss-"));
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

describe("resolveVault", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kryss-cfg-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("is undefined in single-file mode, whatever NEW_FILE_DIR says", async () => {
    expect(await resolveVault({})).toBeUndefined();
    expect(await resolveVault({ VAULT_DIR: "", NEW_FILE_DIR: root })).toBeUndefined();
  });

  test("NEW_FILE_DIR defaults to VAULT_DIR", async () => {
    const real = realpathSync(root);
    expect(await resolveVault({ VAULT_DIR: root })).toEqual({ vaultDir: real, newFileDir: real });
  });

  test("accepts a NEW_FILE_DIR inside the Vault", async () => {
    mkdirSync(join(root, "Inbox"));
    const real = realpathSync(root);
    expect(await resolveVault({ VAULT_DIR: root, NEW_FILE_DIR: join(root, "Inbox") })).toEqual({ vaultDir: real, newFileDir: join(real, "Inbox") });
  });

  test("refuses a NEW_FILE_DIR outside the Vault", async () => {
    const other = mkdtempSync(join(tmpdir(), "kryss-cfg-other-"));
    try {
      await expect(resolveVault({ VAULT_DIR: root, NEW_FILE_DIR: other })).rejects.toThrow(/NEW_FILE_DIR/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("refuses a NEW_FILE_DIR that reaches outside through a symbolic link", async () => {
    const other = mkdtempSync(join(tmpdir(), "kryss-cfg-other-"));
    try {
      symlinkSync(other, join(root, "out"));
      await expect(resolveVault({ VAULT_DIR: root, NEW_FILE_DIR: join(root, "out") })).rejects.toThrow(/NEW_FILE_DIR/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("refuses a NEW_FILE_DIR in a dot folder, whose files the scan would skip", async () => {
    mkdirSync(join(root, ".drafts"));
    await expect(resolveVault({ VAULT_DIR: root, NEW_FILE_DIR: join(root, ".drafts") })).rejects.toThrow(/dot/);
  });

  test("accepts a NEW_FILE_DIR whose name merely starts with two dots", async () => {
    mkdirSync(join(root, "..notes"));
    // Two leading dots is still a dot folder for the scan, so it is refused for that reason and not as being outside.
    await expect(resolveVault({ VAULT_DIR: root, NEW_FILE_DIR: join(root, "..notes") })).rejects.toThrow(/dot/);
  });

  test("refuses a VAULT_DIR that does not exist", async () => {
    await expect(resolveVault({ VAULT_DIR: join(root, "missing") })).rejects.toThrow(/VAULT_DIR/);
  });
});
