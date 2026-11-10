import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";

let dir: string;
let file: string;
let app: ReturnType<typeof createApp>;
let server: ReturnType<typeof Bun.serve>;
let base: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function start(content?: string) {
  if (content !== undefined) writeFileSync(file, content);
  app = createApp({ file });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  base = `http://127.0.0.1:${server.port}`;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "todoapp-api-"));
  file = join(dir, "todo.md");
});
afterEach(() => {
  server?.stop(true);
  app?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const doc = { lists: [{ title: "L", tasks: [{ text: "a", done: false }] }] };
const put = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/todos`, { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body), headers });

/** Reads SSE events from the stream until `count` events are received or the timeout elapses. */
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

describe("GET /api/todos", () => {
  test("returns the document and a quoted ETag", async () => {
    start("## L\n- [ ] a\n");
    const res = await fetch(`${base}/api/todos`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(doc);
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]+"$/);
  });

  test("ETag changes with the file bytes", async () => {
    start("## L\n");
    const a = (await fetch(`${base}/api/todos`)).headers.get("ETag");
    writeFileSync(file, "## L\n- [ ] a\n");
    const b = (await fetch(`${base}/api/todos`)).headers.get("ETag");
    expect(a).not.toBe(b);
  });

  test("returns 422 with line and reason when the file is invalid", async () => {
    start("oops\n");
    const res = await fetch(`${base}/api/todos`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { line: number; reason: string };
    expect(body.line).toBe(1);
    expect(typeof body.reason).toBe("string");
  });

  test("a missing file is an empty document", async () => {
    start();
    const res = await fetch(`${base}/api/todos`);
    expect(await res.json()).toEqual({ lists: [] });
  });
});

describe("PUT /api/todos", () => {
  test("writes the canonical file and returns the document and the new ETag", async () => {
    start("## Old\n");
    const etag = (await fetch(`${base}/api/todos`)).headers.get("ETag")!;
    const res = await put(doc, { "If-Match": etag });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(doc);
    expect(readFileSync(file, "utf8")).toBe("## L\n- [ ] a\n");
    const next = res.headers.get("ETag")!;
    expect(next).not.toBe(etag);
    expect((await fetch(`${base}/api/todos`)).headers.get("ETag")).toBe(next);
  });

  test("keeps the frontmatter byte for byte", async () => {
    const frontmatter = "---\ntitle:   x \ntags: [a]\n---\n\n";
    start(frontmatter + "## Old\n");
    const res0 = await fetch(`${base}/api/todos`);
    expect(res0.status).toBe(200);
    const res = await put(doc, { "If-Match": res0.headers.get("ETag")! });
    expect(res.status).toBe(200);
    expect(readFileSync(file, "utf8")).toBe(frontmatter + "## L\n- [ ] a\n");
  });

  test("leaves no temporary file behind", async () => {
    start("");
    const etag = (await fetch(`${base}/api/todos`)).headers.get("ETag")!;
    await put(doc, { "If-Match": etag });
    expect(readdirSync(dir)).toEqual(["todo.md"]);
  });

  test("428 without If-Match", async () => {
    start("");
    expect((await put(doc)).status).toBe(428);
  });

  test("400 for an invalid body", async () => {
    start("");
    const etag = (await fetch(`${base}/api/todos`)).headers.get("ETag")!;
    const h = { "If-Match": etag };
    expect((await put("not json", h)).status).toBe(400);
    expect((await put({ lists: "x" }, h)).status).toBe(400);
    expect((await put({ lists: [{ title: "", tasks: [] }] }, h)).status).toBe(400);
    expect((await put({ lists: [{ title: "L", tasks: [{ text: "a\nb", done: false }] }] }, h)).status).toBe(400);
    expect((await put({ lists: [{ title: "L", tasks: [{ text: "a", done: "no" }] }] }, h)).status).toBe(400);
    expect((await put({ lists: [{ title: "L", tasks: [{ text: "a", done: false, children: [{ text: "b", done: false, children: [] }] }] }] }, h)).status).toBe(400);
    expect(readFileSync(file, "utf8")).toBe("");
  });

  test("409 with the current ETag when the file changed", async () => {
    start("## L\n");
    const etag = (await fetch(`${base}/api/todos`)).headers.get("ETag")!;
    writeFileSync(file, "## Changed\n");
    const res = await put(doc, { "If-Match": etag });
    expect(res.status).toBe(409);
    expect(res.headers.get("ETag")).not.toBe(etag);
    expect(readFileSync(file, "utf8")).toBe("## Changed\n");
    const retry = await put(doc, { "If-Match": res.headers.get("ETag")! });
    expect(retry.status).toBe(200);
  });

  test("422 and no write when the file on disk is invalid", async () => {
    start("## L\n");
    const etag = (await fetch(`${base}/api/todos`)).headers.get("ETag")!;
    writeFileSync(file, "free text\n");
    const res = await put(doc, { "If-Match": etag });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { line: number }).line).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("free text\n");
  });
});

describe("GET /api/events", () => {
  test("emits a change event with the new ETag after an external modification", async () => {
    start("## L\n");
    const res = await fetch(`${base}/api/events`);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    await sleep(100);
    writeFileSync(file, "## L\n- [ ] external\n");
    const events = await collectEvents(res, 1);
    const etag = (await fetch(`${base}/api/todos`)).headers.get("ETag");
    expect(events).toEqual([{ etag: etag!, doc: { lists: [{ title: "L", tasks: [{ text: "external", done: false }] }] } }]);
  });

  test("catches rename-based saves", async () => {
    start("## L\n");
    const res = await fetch(`${base}/api/events`);
    await sleep(100);
    writeFileSync(join(dir, "swap.tmp"), "## Other\n");
    renameSync(join(dir, "swap.tmp"), file);
    expect(await collectEvents(res, 1)).toMatchObject([{ doc: { lists: [{ title: "Other" }] } }]);
  });

  test("does not emit for the server's own writes", async () => {
    start("## L\n");
    const res = await fetch(`${base}/api/events`);
    await sleep(100);
    const etag = (await fetch(`${base}/api/todos`)).headers.get("ETag")!;
    expect((await put(doc, { "If-Match": etag })).status).toBe(200);
    expect(await collectEvents(res, 1, 600)).toEqual([]);
  });

  test("emits once per external change even when the file becomes invalid", async () => {
    start("## L\n");
    const res = await fetch(`${base}/api/events`);
    await sleep(100);
    writeFileSync(file, "garbage\n");
    const events = await collectEvents(res, 2, 800);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ error: { line: 1 } });
    expect(events[0]).not.toHaveProperty("doc");
  });
});

describe("file watcher", () => {
  test("a deleted directory does not crash the server", async () => {
    start("## L\n");
    rmSync(dir, { recursive: true, force: true });
    await sleep(200);
    expect((await fetch(`${base}/api/todos`)).status).toBe(200);
  });
});

describe("GET /api/export", () => {
  const exportOf = (query = "") => fetch(`${base}/api/export${query}`);

  test("returns the canonical Markdown of the whole document as text/plain", async () => {
    start("## A\n* [X] one\n\t- [ ] sub\n\n## B\n- [ ] two\n");
    const res = await exportOf();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toStartWith("text/plain");
    expect(await res.text()).toBe("## A\n- [x] one\n  - [ ] sub\n\n## B\n- [ ] two\n");
  });
  test("restricts the export to the list given by its 0-based index", async () => {
    start("## A\n- [ ] one\n\n## B\n- [ ] two\n");
    expect(await (await exportOf("?list=1")).text()).toBe("## B\n- [ ] two\n");
    expect(await (await exportOf("?list=0")).text()).toBe("## A\n- [ ] one\n");
  });
  test("returns an empty body for an empty document", async () => {
    start("");
    const res = await exportOf();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
  test("exports an empty list as its title line", async () => {
    start("## Empty\n\n## B\n- [ ] x\n");
    expect(await (await exportOf("?list=0")).text()).toBe("## Empty\n");
  });
  test("leaves the frontmatter out", async () => {
    start("---\ntitle: x\n---\n## A\n- [ ] one\n");
    expect(await (await exportOf()).text()).toBe("## A\n- [ ] one\n");
  });
  test("answers 400 for a list that is not a non-negative integer", async () => {
    start("## A\n- [ ] one\n");
    for (const bad of ["abc", "-1", "1.5", "", "1e0", " 0"]) {
      expect((await exportOf(`?list=${encodeURIComponent(bad)}`)).status).toBe(400);
    }
  });
  test("answers 404 for a list index out of range", async () => {
    start("## A\n- [ ] one\n");
    expect((await exportOf("?list=1")).status).toBe(404);
  });
  test("answers 404 for any list index on an empty document", async () => {
    start("");
    expect((await exportOf("?list=0")).status).toBe(404);
  });
  test("answers 422 with the line and the reason when the file is invalid", async () => {
    start("## A\nfree text\n");
    const res = await exportOf();
    expect(res.status).toBe(422);
    const body = (await res.json()) as { line: number; reason?: string; message?: string };
    expect(body.line).toBe(2);
  });
  test("has no ETag and does not write to the file", async () => {
    start("## A\n* [ ] one\n");
    const res = await exportOf();
    expect(res.headers.get("ETag")).toBeNull();
    expect(readFileSync(file, "utf8")).toBe("## A\n* [ ] one\n");
  });
  test("only answers GET", async () => {
    start("## A\n- [ ] one\n");
    expect((await fetch(`${base}/api/export`, { method: "POST" })).status).toBe(405);
  });
});
