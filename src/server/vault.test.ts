import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createVaultFile, resolveKryssFile, scanVault, validateFileName } from "./vault";

let vault: string;
let outside: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kryss-vault-"));
  outside = mkdtempSync(join(tmpdir(), "kryss-outside-"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const ENABLED = "---\nkryss-enabled: true\n---\n";
const put = (rel: string, content: string) => {
  const path = join(vault, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
};

describe("scanVault", () => {
  test("lists the files whose frontmatter has kryss-enabled: true, at any depth", async () => {
    put("Top.md", ENABLED);
    put("Projects/Work.md", ENABLED + "## L\n");
    put("Projects/Deep/Er.md", ENABLED);
    expect(await scanVault(vault)).toEqual(["Projects/Deep/Er.md", "Projects/Work.md", "Top.md"]);
  });

  test("ignores a file without the key, with false, or without frontmatter", async () => {
    put("a.md", "---\ntitle: x\n---\n");
    put("b.md", "---\nkryss-enabled: false\n---\n");
    put("c.md", "## L\n- [ ] a\n");
    put("d.md", "---\nkryss-enabled: truer\n---\n");
    expect(await scanVault(vault)).toEqual([]);
  });

  test("accepts the key among other frontmatter lines and CRLF line endings", async () => {
    put("a.md", "---\ntitle: x\nkryss-enabled: true\ntags: [a]\n---\n");
    put("b.md", "---\r\nkryss-enabled: true\r\n---\r\n");
    expect(await scanVault(vault)).toEqual(["a.md", "b.md"]);
  });

  test("ignores a file whose frontmatter is not closed", async () => {
    put("a.md", "---\nkryss-enabled: true\n## L\n- [ ] a\n");
    expect(await scanVault(vault)).toEqual([]);
  });

  test("ignores a key that sits after the frontmatter", async () => {
    put("a.md", "---\ntitle: x\n---\nkryss-enabled: true\n");
    expect(await scanVault(vault)).toEqual([]);
  });

  test("skips the folders whose name starts with a dot", async () => {
    put(".obsidian/x.md", ENABLED);
    put(".trash/y.md", ENABLED);
    put("Notes/.hidden/z.md", ENABLED);
    put("ok.md", ENABLED);
    expect(await scanVault(vault)).toEqual(["ok.md"]);
  });

  test("ignores files that are not Markdown", async () => {
    put("a.txt", ENABLED);
    put("b.md.bak", ENABLED);
    expect(await scanVault(vault)).toEqual([]);
  });

  test("sorts alphabetically ignoring case", async () => {
    put("banana.md", ENABLED);
    put("Apple.md", ENABLED);
    put("cherry.md", ENABLED);
    expect(await scanVault(vault)).toEqual(["Apple.md", "banana.md", "cherry.md"]);
  });

  test("reads only the frontmatter, so a huge body does not matter", async () => {
    put("big.md", ENABLED + "x".repeat(5_000_000));
    expect(await scanVault(vault)).toEqual(["big.md"]);
  });

  test("returns an empty list for an empty Vault", async () => {
    expect(await scanVault(vault)).toEqual([]);
  });
});

describe("validateFileName", () => {
  test("trims the name and adds .md", () => {
    expect(validateFileName("  Shopping  ")).toEqual({ ok: true, fileName: "Shopping.md" });
  });

  test("does not add .md twice", () => {
    expect(validateFileName("Shopping.md")).toEqual({ ok: true, fileName: "Shopping.md" });
  });

  test("accepts spaces, accents and inner dots", () => {
    expect(validateFileName("Été 2026 v1.2")).toEqual({ ok: true, fileName: "Été 2026 v1.2.md" });
  });

  test("refuses an empty name", () => {
    expect(validateFileName("   ").ok).toBe(false);
    expect(validateFileName("").ok).toBe(false);
  });

  test("refuses a name that is only the extension", () => {
    expect(validateFileName(".md").ok).toBe(false);
  });

  test("refuses a name that starts with a dot", () => {
    expect(validateFileName(".hidden").ok).toBe(false);
  });

  for (const ch of ["*", '"', "\\", "/", "<", ">", ":", "|", "?", "#", "^", "[", "]"]) {
    test(`refuses a name containing ${ch}`, () => {
      expect(validateFileName(`a${ch}b`).ok).toBe(false);
    });
  }

  test("gives a reason for a refusal", () => {
    const result = validateFileName("a/b");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});

describe("createVaultFile", () => {
  test("writes exactly the frontmatter with kryss-enabled: true and returns the relative path", async () => {
    const result = await createVaultFile(vault, vault, "Shopping");
    expect(result).toEqual({ ok: true, path: "Shopping.md" });
    expect(readFileSync(join(vault, "Shopping.md"), "utf8")).toBe("---\nkryss-enabled: true\n---\n");
  });

  test("the new file is listed by the scan", async () => {
    await createVaultFile(vault, vault, "Shopping");
    expect(await scanVault(vault)).toEqual(["Shopping.md"]);
  });

  test("writes in the new file folder and returns its path relative to the Vault", async () => {
    mkdirSync(join(vault, "Inbox"));
    const result = await createVaultFile(vault, join(vault, "Inbox"), "Todo");
    expect(result).toEqual({ ok: true, path: "Inbox/Todo.md" });
    expect(existsSync(join(vault, "Inbox", "Todo.md"))).toBe(true);
  });

  test("refuses an existing file and never overwrites it", async () => {
    put("Shopping.md", "---\nkryss-enabled: true\n---\n## Mine\n- [ ] keep\n");
    const result = await createVaultFile(vault, vault, "Shopping");
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(readFileSync(join(vault, "Shopping.md"), "utf8")).toContain("keep");
  });

  test("refuses an existing file whatever the case of the extension", async () => {
    put("Shopping.md", "x");
    expect(await createVaultFile(vault, vault, "Shopping.md")).toMatchObject({ ok: false, status: 409 });
  });

  test("refuses an invalid name with a 400", async () => {
    expect(await createVaultFile(vault, vault, "a/b")).toMatchObject({ ok: false, status: 400 });
    expect(await createVaultFile(vault, vault, "")).toMatchObject({ ok: false, status: 400 });
  });
});

describe("resolveKryssFile", () => {
  test("returns the real path of a listed file", async () => {
    put("Projects/Work.md", ENABLED);
    expect(await resolveKryssFile(vault, "Projects/Work.md")).toBe(join(realpathSync(vault), "Projects", "Work.md"));
  });

  test("answers null for a file that is not a Kryss file", async () => {
    put("plain.md", "## L\n");
    expect(await resolveKryssFile(vault, "plain.md")).toBeNull();
  });

  test("answers null for a missing file", async () => {
    expect(await resolveKryssFile(vault, "nope.md")).toBeNull();
  });

  test("refuses a path with .. that leaves the Vault", async () => {
    writeFileSync(join(outside, "x.md"), ENABLED);
    expect(await resolveKryssFile(vault, relative(vault, join(outside, "x.md")))).toBeNull();
  });

  test("refuses an absolute path", async () => {
    writeFileSync(join(outside, "x.md"), ENABLED);
    expect(await resolveKryssFile(vault, join(outside, "x.md"))).toBeNull();
  });

  test("refuses a symbolic link that points outside the Vault", async () => {
    writeFileSync(join(outside, "x.md"), ENABLED);
    symlinkSync(join(outside, "x.md"), join(vault, "link.md"));
    expect(await resolveKryssFile(vault, "link.md")).toBeNull();
  });

  test("refuses a folder symbolic link that points outside the Vault", async () => {
    writeFileSync(join(outside, "x.md"), ENABLED);
    symlinkSync(outside, join(vault, "dir"));
    expect(await resolveKryssFile(vault, "dir/x.md")).toBeNull();
  });

  test("accepts a symbolic link whose target stays inside the Vault", async () => {
    put("real.md", ENABLED);
    symlinkSync(join(vault, "real.md"), join(vault, "alias.md"));
    expect(await resolveKryssFile(vault, "alias.md")).not.toBeNull();
  });

  test("refuses a file in a dot folder and a non-Markdown file", async () => {
    put(".obsidian/x.md", ENABLED);
    put("a.txt", ENABLED);
    expect(await resolveKryssFile(vault, ".obsidian/x.md")).toBeNull();
    expect(await resolveKryssFile(vault, "a.txt")).toBeNull();
  });

  test("refuses an empty path and a NUL byte", async () => {
    expect(await resolveKryssFile(vault, "")).toBeNull();
    expect(await resolveKryssFile(vault, "a\0.md")).toBeNull();
  });
});
