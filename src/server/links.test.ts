import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";

let vault: string;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  vault = realpathSync(mkdtempSync(join(tmpdir(), "kryss-links-")));
  app = createApp({ vault: { vaultDir: vault, newFileDir: vault } });
});
afterEach(() => {
  app.stop();
  rmSync(vault, { recursive: true, force: true });
});

type Config = { links: unknown[]; problems: string[] };
const get = (path: string) => app.fetch(new Request(`http://localhost${path}`));
const config = async () => (await get("/api/config")).json() as Promise<Config>;
const writeRules = (content: string) => writeFileSync(join(vault, ".kryss.json"), content);

describe("GET /api/config", () => {
  test("a missing file means no rules", async () => {
    const res = await get("/api/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ links: [], problems: [] });
  });

  test("returns the valid rules, read at each call", async () => {
    writeRules(JSON.stringify({ links: [{ match: "^a", label: "$1", icon: "jira" }] }));
    expect((await config()).links).toEqual([{ match: "^a", label: "$1", icon: "jira" }]);
    writeRules(JSON.stringify({ links: [{ match: "^b", label: "x" }] }));
    expect((await config()).links).toEqual([{ match: "^b", label: "x" }]);
  });

  test("skips and reports invalid rules, keeping the order of the others", async () => {
    writeRules(
      JSON.stringify({
        links: [{ match: "(", label: "x" }, { label: "x" }, { match: "a" }, 3, { match: "^ok", label: "ok", icon: 5 }, { match: "^ok2", label: "ok2" }],
      }),
    );
    const body = await config();
    expect(body.links).toEqual([{ match: "^ok", label: "ok" }, { match: "^ok2", label: "ok2" }]);
    expect(body.problems).toHaveLength(4);
  });

  test("a malformed file means no rules and is reported", async () => {
    writeRules("{ not json");
    const body = await config();
    expect(body.links).toEqual([]);
    expect(body.problems).toHaveLength(1);
  });

  test("a file without a links array means no rules and is reported", async () => {
    writeRules(JSON.stringify({ links: "nope" }));
    const body = await config();
    expect(body.links).toEqual([]);
    expect(body.problems).toHaveLength(1);
  });

  test("does not exist in single-file mode", async () => {
    const single = createApp({ file: join(vault, "todo.md") });
    expect((await single.fetch(new Request("http://localhost/api/config"))).status).toBe(404);
    expect((await single.fetch(new Request("http://localhost/api/icons/link"))).status).toBe(404);
    single.stop();
  });
});

describe("GET /api/icons/<name>", () => {
  test("returns the SVG of a Lucide icon", async () => {
    const res = await get("/api/icons/link");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    const svg = await res.text();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
    expect(svg).toContain('stroke="black"');
  });

  test("an unknown name is a 404", async () => {
    expect((await get("/api/icons/no-such-icon-at-all")).status).toBe(404);
  });

  test("names outside [a-z0-9-]+ are a 404", async () => {
    for (const name of ["..%2Fpackage", "..", "Link", "a_b", "a.b", "link%2F..%2Flink", "", "a%00b", "%2e%2e%2fpackage"]) {
      expect((await get(`/api/icons/${name}`)).status).toBe(404);
    }
  });
});
