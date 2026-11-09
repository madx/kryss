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
  const events: string[] = [];
  const deadline = Date.now() + timeout;
  while (events.length < count && Date.now() < deadline) {
    const r = await Promise.race([reader.read(), sleep(deadline - Date.now()).then(() => null)]);
    if (!r || r.done) break;
    buf += decoder.decode(r.value);
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (block.includes("event: change")) events.push(block.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim());
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
    expect(events).toEqual([etag!]);
  });

  test("catches rename-based saves", async () => {
    start("## L\n");
    const res = await fetch(`${base}/api/events`);
    await sleep(100);
    writeFileSync(join(dir, "swap.tmp"), "## Other\n");
    renameSync(join(dir, "swap.tmp"), file);
    expect((await collectEvents(res, 1)).length).toBe(1);
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
    expect((await collectEvents(res, 2, 800)).length).toBe(1);
  });
});
