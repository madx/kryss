import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";

let vault: string;
let outside: string;
let app: ReturnType<typeof createApp>;
let server: ReturnType<typeof Bun.serve>;
let base: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ENABLED = "---\nkryss-enabled: true\n---\n";

function put(rel: string, content: string) {
  const path = join(vault, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function start(newFileDir = vault) {
  app = createApp({ vault: { vaultDir: vault, newFileDir } });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  base = `http://127.0.0.1:${server.port}`;
}

beforeEach(() => {
  vault = realpathSync(mkdtempSync(join(tmpdir(), "kryss-vapi-")));
  outside = realpathSync(mkdtempSync(join(tmpdir(), "kryss-vout-")));
});
afterEach(() => {
  server?.stop(true);
  app?.stop();
  rmSync(vault, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const url = (path: string, file?: string) => `${base}${path}${file === undefined ? "" : `?file=${encodeURIComponent(file)}`}`;
const putTodos = (file: string, body: unknown, etag: string) =>
  fetch(url("/api/todos", file), { method: "PUT", body: JSON.stringify(body), headers: { "If-Match": etag } });
const docOf = (title: string) => ({ lists: [{ title, tasks: [{ text: "a", done: false }] }], filters: [] });

async function collectEvents(res: Response, count: number, timeout = 1500) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: unknown[] = [];
  const deadline = Date.now() + timeout;
  while (events.length < count && Date.now() < deadline) {
    const r = await Promise.race([reader.read(), sleep(deadline - Date.now()).then(() => null)]);
    if (!r || r.done) break;
    buf += decoder.decode(r.value);
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (block.includes("event: change")) events.push(JSON.parse(block.split("\n").find((l) => l.startsWith("data:"))!.slice(5)));
    }
  }
  reader.cancel();
  return events;
}

describe("GET /api/files", () => {
  test("returns the sorted relative paths of the Kryss files", async () => {
    put("b.md", ENABLED);
    put("Projects/A.md", ENABLED);
    put("plain.md", "## L\n");
    start();
    const res = await fetch(url("/api/files"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["b.md", "Projects/A.md"]);
  });

  test("scans on each call, so a file marked meanwhile appears at once", async () => {
    start();
    expect(await (await fetch(url("/api/files"))).json()).toEqual([]);
    put("new.md", ENABLED);
    expect(await (await fetch(url("/api/files"))).json()).toEqual(["new.md"]);
  });

  test("answers 405 to other methods than GET and POST", async () => {
    start();
    expect((await fetch(url("/api/files"), { method: "DELETE" })).status).toBe(405);
  });
});

describe("POST /api/files", () => {
  const post = (body: unknown) => fetch(url("/api/files"), { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

  test("creates the file with the exact content and answers 201 with its path", async () => {
    start();
    const res = await post({ name: "  Shopping " });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ path: "Shopping.md" });
    expect(readFileSync(join(vault, "Shopping.md"), "utf8")).toBe("---\nkryss-enabled: true\n---\n");
  });

  test("the new file is listed and opens as an empty document", async () => {
    start();
    await post({ name: "Shopping" });
    expect(await (await fetch(url("/api/files"))).json()).toEqual(["Shopping.md"]);
    const res = await fetch(url("/api/todos", "Shopping.md"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lists: [], filters: [] });
  });

  test("writes in NEW_FILE_DIR", async () => {
    mkdirSync(join(vault, "Inbox"));
    start(join(vault, "Inbox"));
    const res = await post({ name: "Todo" });
    expect(await res.json()).toEqual({ path: "Inbox/Todo.md" });
  });

  test("answers 400 for a refused name, with an error message", async () => {
    start();
    const res = await post({ name: "a/b" });
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as { error: string }).error).toBe("string");
  });

  test("answers 400 for a body that is not JSON or has no string name", async () => {
    start();
    expect((await post("nope")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ name: 3 })).status).toBe(400);
  });

  test("answers 409 for an existing file and keeps it", async () => {
    put("Shopping.md", ENABLED + "## L\n");
    start();
    expect((await post({ name: "Shopping" })).status).toBe(409);
    expect(readFileSync(join(vault, "Shopping.md"), "utf8")).toContain("## L");
  });
});

describe("the file parameter", () => {
  test("GET reads the file named by file, and each file has its own ETag", async () => {
    put("a.md", ENABLED + "## A\n");
    put("Dir/b.md", ENABLED + "## B\n");
    start();
    const a = await fetch(url("/api/todos", "a.md"));
    const b = await fetch(url("/api/todos", "Dir/b.md"));
    expect(((await a.json()) as { lists: { title: string }[] }).lists[0]!.title).toBe("A");
    expect(((await b.json()) as { lists: { title: string }[] }).lists[0]!.title).toBe("B");
    expect(a.headers.get("ETag")).not.toBe(b.headers.get("ETag"));
  });

  test("PUT writes the named file only and keeps its frontmatter", async () => {
    put("a.md", ENABLED + "## A\n");
    put("b.md", ENABLED + "## B\n");
    start();
    const etag = (await fetch(url("/api/todos", "a.md"))).headers.get("ETag")!;
    const res = await putTodos("a.md", docOf("A2"), etag);
    expect(res.status).toBe(200);
    expect(readFileSync(join(vault, "a.md"), "utf8")).toBe(ENABLED + "## A2\n- [ ] a\n");
    expect(readFileSync(join(vault, "b.md"), "utf8")).toBe(ENABLED + "## B\n");
  });

  test("a 409 on one file does not affect another", async () => {
    put("a.md", ENABLED + "## A\n");
    put("b.md", ENABLED + "## B\n");
    start();
    const etagA = (await fetch(url("/api/todos", "a.md"))).headers.get("ETag")!;
    const etagB = (await fetch(url("/api/todos", "b.md"))).headers.get("ETag")!;
    writeFileSync(join(vault, "a.md"), ENABLED + "## A changed\n");
    expect((await putTodos("a.md", docOf("A2"), etagA)).status).toBe(409);
    expect((await putTodos("b.md", docOf("B2"), etagB)).status).toBe(200);
  });

  test("an invalid file answers 422 for that file only", async () => {
    put("a.md", ENABLED + "oops\n");
    put("b.md", ENABLED + "## B\n");
    start();
    expect((await fetch(url("/api/todos", "a.md"))).status).toBe(422);
    expect((await fetch(url("/api/todos", "b.md"))).status).toBe(200);
  });

  test("answers 404 when file is missing from the query in Vault mode", async () => {
    start();
    expect((await fetch(url("/api/todos"))).status).toBe(404);
    expect((await fetch(url("/api/events"))).status).toBe(404);
  });

  test("answers 404 for a file that is not a Kryss file or does not exist", async () => {
    put("plain.md", "## L\n");
    start();
    expect((await fetch(url("/api/todos", "plain.md"))).status).toBe(404);
    expect((await fetch(url("/api/todos", "nope.md"))).status).toBe(404);
    expect((await putTodos("plain.md", docOf("x"), '"x"')).status).toBe(404);
    expect(readFileSync(join(vault, "plain.md"), "utf8")).toBe("## L\n");
  });

  test("answers 404 for paths outside the Vault, on GET, PUT and events", async () => {
    writeFileSync(join(outside, "x.md"), ENABLED + "## X\n");
    start();
    const escapes = ["../" + outside.split("/").pop() + "/x.md", join(outside, "x.md"), "..%2F..%2Fetc%2Fpasswd"];
    for (const file of escapes) {
      expect((await fetch(url("/api/todos", file))).status).toBe(404);
      expect((await putTodos(file, docOf("x"), '"x"')).status).toBe(404);
      expect((await fetch(url("/api/events", file))).status).toBe(404);
    }
    expect(readFileSync(join(outside, "x.md"), "utf8")).toBe(ENABLED + "## X\n");
  });

  test("answers 404 through a symbolic link to a file outside the Vault, and never writes through it", async () => {
    writeFileSync(join(outside, "x.md"), ENABLED + "## X\n");
    symlinkSync(join(outside, "x.md"), join(vault, "link.md"));
    start();
    expect((await fetch(url("/api/todos", "link.md"))).status).toBe(404);
    expect((await putTodos("link.md", docOf("x"), '"x"')).status).toBe(404);
    expect(readFileSync(join(outside, "x.md"), "utf8")).toBe(ENABLED + "## X\n");
  });

  test("answers 404 through a folder symbolic link that leaves the Vault", async () => {
    writeFileSync(join(outside, "x.md"), ENABLED);
    symlinkSync(outside, join(vault, "dir"));
    start();
    expect((await fetch(url("/api/todos", "dir/x.md"))).status).toBe(404);
  });
});

describe("GET /api/events with a file", () => {
  test("emits an external change of the open file only", async () => {
    put("a.md", ENABLED + "## A\n");
    put("b.md", ENABLED + "## B\n");
    start();
    const res = await fetch(url("/api/events", "a.md"));
    await sleep(100);
    writeFileSync(join(vault, "b.md"), ENABLED + "## B changed\n");
    await sleep(200);
    writeFileSync(join(vault, "a.md"), ENABLED + "## A changed\n");
    const events = (await collectEvents(res, 2, 800)) as { doc: { lists: { title: string }[] } }[];
    expect(events).toHaveLength(1);
    expect(events[0]!.doc.lists[0]!.title).toBe("A changed");
  });

  test("two streams on two files each get their own events", async () => {
    put("a.md", ENABLED + "## A\n");
    put("b.md", ENABLED + "## B\n");
    start();
    const resA = await fetch(url("/api/events", "a.md"));
    const resB = await fetch(url("/api/events", "b.md"));
    await sleep(100);
    writeFileSync(join(vault, "a.md"), ENABLED + "## A2\n");
    writeFileSync(join(vault, "b.md"), ENABLED + "## B2\n");
    const [ea, eb] = (await Promise.all([collectEvents(resA, 1), collectEvents(resB, 1)])) as { doc: { lists: { title: string }[] } }[][];
    expect(ea!.map((e) => e.doc.lists[0]!.title)).toEqual(["A2"]);
    expect(eb!.map((e) => e.doc.lists[0]!.title)).toEqual(["B2"]);
  });

  test("two streams opening together share one watcher, released with the last stream", async () => {
    put("a.md", ENABLED + "## A\n");
    start();
    const one = new AbortController();
    const two = new AbortController();
    await Promise.all([fetch(url("/api/events", "a.md"), { signal: one.signal }), fetch(url("/api/events", "a.md"), { signal: two.signal })]);
    expect(app.watchedFiles()).toEqual(["a.md"]);
    one.abort();
    await sleep(100);
    expect(app.watchedFiles()).toEqual(["a.md"]);
    two.abort();
    await sleep(100);
    expect(app.watchedFiles()).toEqual([]);
  });

  test("a write by the server itself emits nothing", async () => {
    put("a.md", ENABLED + "## A\n");
    start();
    const etag = (await fetch(url("/api/todos", "a.md"))).headers.get("ETag")!;
    const res = await fetch(url("/api/events", "a.md"));
    await sleep(100);
    await putTodos("a.md", docOf("A2"), etag);
    expect(await collectEvents(res, 1, 500)).toEqual([]);
  });

  test("an external change that makes the file invalid carries the error", async () => {
    put("a.md", ENABLED + "## A\n");
    start();
    const res = await fetch(url("/api/events", "a.md"));
    await sleep(100);
    writeFileSync(join(vault, "a.md"), ENABLED + "oops\n");
    expect(await collectEvents(res, 1)).toMatchObject([{ error: { line: 4 } }]);
  });

  test("watches a file only while it has an open stream", async () => {
    put("a.md", ENABLED + "## A\n");
    start();
    expect(app.watchedFiles()).toEqual([]);
    const abort = new AbortController();
    await fetch(url("/api/events", "a.md"), { signal: abort.signal });
    await sleep(100);
    expect(app.watchedFiles()).toEqual(["a.md"]);
    abort.abort();
    await sleep(100);
    expect(app.watchedFiles()).toEqual([]);
  });
});

describe("single-file mode", () => {
  test("ignores the file parameter and has no Vault routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kryss-single-"));
    const file = join(dir, "todo.md");
    writeFileSync(file, "## Solo\n");
    const single = createApp({ file });
    const srv = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: single.fetch });
    try {
      const b = `http://127.0.0.1:${srv.port}`;
      const res = await fetch(`${b}/api/todos?file=${encodeURIComponent("../../etc/passwd")}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { lists: { title: string }[] }).lists[0]!.title).toBe("Solo");
      for (const route of ["/api/files", "/api/notes", "/api/config", "/api/icons/x"]) {
        expect((await fetch(`${b}${route}`)).status).toBe(404);
      }
      expect((await fetch(`${b}/api/files`, { method: "POST", body: '{"name":"x"}' })).status).toBe(404);
    } finally {
      srv.stop(true);
      single.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
