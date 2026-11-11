import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createApp } from "./app";

let vault: string;
let app: ReturnType<typeof createApp> | undefined;
beforeEach(() => {
  vault = realpathSync(mkdtempSync(join(tmpdir(), "kryss-napi-")));
});
afterEach(() => {
  app?.stop();
  app = undefined;
  rmSync(vault, { recursive: true, force: true });
});

describe("GET /api/notes", () => {
  test("returns the note index and the link format", async () => {
    mkdirSync(join(vault, "A"));
    writeFileSync(join(vault, "A", "Note.md"), "---\naliases:\n  - Nick\n---\n");
    app = createApp({ vault: { vaultDir: vault, newFileDir: vault } });
    const res = await app.fetch(new Request("http://x/api/notes"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newLinkFormat: "shortest", notes: [{ name: "Note", path: "A/Note", aliases: ["Nick"] }] });
  });
  test("GET /api/files exposes the vault name, URL-encoded, in a header", async () => {
    app = createApp({ vault: { vaultDir: vault, newFileDir: vault } });
    const res = await app.fetch(new Request("http://x/api/files"));
    expect(decodeURIComponent(res.headers.get("X-Vault-Name")!)).toBe(basename(vault));
  });
  test("does not exist in single-file mode", async () => {
    const file = join(vault, "todo.md");
    writeFileSync(file, "");
    app = createApp({ file });
    expect((await app.fetch(new Request("http://x/api/notes"))).status).toBe(404);
  });
});
