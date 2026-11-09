import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readFile, rename, writeFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ChangeEvent, TodoDocument } from "../shared/types";
import { parse, serialize } from "./markdown";

const WATCH_DEBOUNCE_MS = 50;

const etagOf = (content: string) => `"${createHash("sha256").update(content).digest("hex").slice(0, 32)}"`;

async function readContent(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

const isLine = (s: unknown): s is string => typeof s === "string" && s.trim() !== "" && !/[\r\n]/.test(s);
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Returns true when `value` is a valid TodoDocument (non-empty single-line texts, 2 levels at most). */
export function isValidDocument(value: unknown): value is TodoDocument {
  if (!isPlainObject(value) || !Array.isArray(value.lists)) return false;
  return value.lists.every(
    (list) =>
      isPlainObject(list) &&
      isLine(list.title) &&
      Array.isArray(list.tasks) &&
      list.tasks.every(
        (task) =>
          isPlainObject(task) &&
          isLine(task.text) &&
          typeof task.done === "boolean" &&
          (task.children === undefined ||
            (Array.isArray(task.children) &&
              task.children.every((c) => isPlainObject(c) && isLine(c.text) && typeof c.done === "boolean" && c.children === undefined))),
      ),
  );
}

export function createApp({ file }: { file: string }) {
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let knownEtag: string | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;

  // Serializes the handlers that read then write the file.
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    Response.json(body, { status, headers });

  async function getTodos(): Promise<Response> {
    const content = await readContent(file);
    const result = parse(content);
    if (!result.ok) return json(result.error, 422);
    return json(result.doc, 200, { ETag: etagOf(content) });
  }

  async function putTodos(req: Request): Promise<Response> {
    const ifMatch = req.headers.get("If-Match");
    if (ifMatch === null) return json({ error: "If-Match header required" }, 428);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body is not valid JSON" }, 400);
    }
    if (!isValidDocument(body)) return json({ error: "Body is not a valid document" }, 400);

    return exclusive(async () => {
      const current = await readContent(file);
      const existing = parse(current);
      if (!existing.ok) return json(existing.error, 422);
      const currentEtag = etagOf(current);
      if (ifMatch.replace(/^W\//, "") !== currentEtag) return json({ error: "The file changed on disk" }, 409, { ETag: currentEtag });

      const markdown = serialize(body);
      const next = etagOf(markdown);
      // Recorded before the rename so that the watcher ignores this write.
      knownEtag = next;
      const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
      try {
        await writeFile(tmp, markdown);
        await rename(tmp, file);
      } catch (error) {
        knownEtag = currentEtag;
        await rm(tmp, { force: true });
        throw error;
      }
      // Reparse the canonical text (it trims whitespace) so that the client holds the canonical state.
      const saved = parse(markdown);
      return json(saved.ok ? saved.doc : body, 200, { ETag: next });
    });
  }

  function events(req: Request, server?: { timeout(req: Request, seconds: number): void }): Response {
    server?.timeout(req, 0);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        clients.add(c);
        c.enqueue(encoder.encode(": connected\n\n"));
      },
      cancel() {
        clients.delete(controller);
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }

  function broadcast(event: ChangeEvent) {
    const message = encoder.encode(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
    for (const c of clients) {
      try {
        c.enqueue(message);
      } catch {
        clients.delete(c);
      }
    }
  }

  async function onFileEvent() {
    const content = await readContent(file);
    const etag = etagOf(content);
    if (etag === knownEtag) return;
    knownEtag = etag;
    const result = parse(content);
    broadcast(result.ok ? { etag, doc: result.doc } : { etag, error: result.error });
  }

  // Watch the directory so that rename-based saves (Vim, Obsidian) are caught.
  readContent(file).then((content) => {
    knownEtag ??= etagOf(content);
  });
  // Any event in the directory triggers a check: the ETag comparison discards unrelated ones.
  watcher = watch(dirname(file), () => {
    clearTimeout(timer);
    timer = setTimeout(() => void exclusive(onFileEvent).catch(() => {}), WATCH_DEBOUNCE_MS);
  });
  // A deleted or unreadable directory must not crash the server: log and carry on.
  watcher.on("error", (error) => console.error("File watcher error:", error));

  return {
    fetch(req: Request, server?: { timeout(req: Request, seconds: number): void }): Response | Promise<Response> {
      const { pathname } = new URL(req.url);
      if (pathname === "/api/todos") {
        if (req.method === "GET") return getTodos();
        if (req.method === "PUT") return putTodos(req);
        return json({ error: "Method not allowed" }, 405, { Allow: "GET, PUT" });
      }
      if (pathname === "/api/events" && req.method === "GET") return events(req, server);
      return json({ error: "Not found" }, 404);
    },
    stop() {
      clearTimeout(timer);
      watcher?.close();
      for (const c of clients) {
        try {
          c.close();
        } catch {}
      }
      clients.clear();
    },
  };
}
