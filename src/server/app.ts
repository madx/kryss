import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readFile, rename, writeFile, rm } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import type { ChangeEvent, TodoDocument } from "../shared/types";
import { serialize } from "../shared/serializer";
import type { VaultConfig } from "./config";
import { parse, withFrontmatter } from "./markdown";
import { scanNotes } from "./notes";
import { createVaultFile, resolveKryssFile, scanVault } from "./vault";

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

/** Returns true when `value` is a valid TodoDocument (non-empty single-line texts, 2 levels at most, unique filter names). */
export function isValidDocument(value: unknown): value is TodoDocument {
  if (!isPlainObject(value) || !Array.isArray(value.lists) || !Array.isArray(value.filters)) return false;
  const filtersOk =
    value.filters.every((f) => isPlainObject(f) && isLine(f.name) && isLine(f.text)) &&
    new Set(value.filters.map((f) => f.name)).size === value.filters.length;
  return filtersOk && value.lists.every(
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

type Server = { timeout(req: Request, seconds: number): void };

/** What the server keeps for one file: its write queue, the last ETag it knows, and, while a stream is open, its watcher and clients. */
type Session = {
  file: string;
  queue: Promise<unknown>;
  knownEtag?: string;
  clients: Set<ReadableStreamDefaultController<Uint8Array>>;
  timer?: ReturnType<typeof setTimeout>;
  watcher?: FSWatcher;
};

export type AppOptions = { file: string } | { vault: VaultConfig };

export function createApp(options: AppOptions) {
  const vault = "vault" in options ? options.vault : undefined;
  const encoder = new TextEncoder();
  const sessions = new Map<string, Session>();

  const sessionOf = (file: string): Session => {
    let session = sessions.get(file);
    if (!session) sessions.set(file, (session = { file, queue: Promise.resolve(), clients: new Set() }));
    return session;
  };

  // Serializes the handlers that read then write a file.
  const exclusive = <T>(session: Session, task: () => Promise<T>): Promise<T> => {
    const run = session.queue.then(task, task);
    session.queue = run.catch(() => {});
    return run;
  };

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    Response.json(body, { status, headers });
  const notFound = () => json({ error: "Not found" }, 404);

  /** The real path of the file a request is about: the only file in single-file mode, the `file` parameter in Vault mode (null for a 404). */
  async function targetOf(req: Request): Promise<string | null> {
    if (!vault) return (options as { file: string }).file;
    const rel = new URL(req.url).searchParams.get("file");
    return rel === null ? null : resolveKryssFile(vault.vaultDir, rel);
  }

  const keyOf = (file: string) => (vault ? relative(vault.vaultDir, file).split(sep).join("/") : file);

  async function getTodos(file: string): Promise<Response> {
    const content = await readContent(file);
    const result = parse(content);
    if (!result.ok) return json(result.error, 422);
    return json(result.doc, 200, { ETag: etagOf(content) });
  }

  async function putTodos(req: Request, file: string): Promise<Response> {
    const ifMatch = req.headers.get("If-Match");
    if (ifMatch === null) return json({ error: "If-Match header required" }, 428);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body is not valid JSON" }, 400);
    }
    if (!isValidDocument(body)) return json({ error: "Body is not a valid document" }, 400);
    const session = sessionOf(file);

    return exclusive(session, async () => {
      const current = await readContent(file);
      const existing = parse(current);
      if (!existing.ok) return json(existing.error, 422);
      const currentEtag = etagOf(current);
      if (ifMatch.replace(/^W\//, "") !== currentEtag) return json({ error: "The file changed on disk" }, 409, { ETag: currentEtag });

      const markdown = withFrontmatter(current, serialize(body), body.filters);
      const next = etagOf(markdown);
      // Recorded before the rename so that the watcher ignores this write.
      session.knownEtag = next;
      const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
      try {
        await writeFile(tmp, markdown);
        await rename(tmp, file);
      } catch (error) {
        session.knownEtag = currentEtag;
        await rm(tmp, { force: true });
        throw error;
      }
      // Reparse the canonical text (it trims whitespace) so that the client holds the canonical state.
      const saved = parse(markdown);
      return json(saved.ok ? saved.doc : body, 200, { ETag: next });
    });
  }

  // A client whose connection is gone is dropped, and the file is no longer watched once nobody listens.
  function send(session: Session, text: string) {
    const message = encoder.encode(text);
    for (const c of session.clients) {
      try {
        c.enqueue(message);
      } catch {
        session.clients.delete(c);
      }
    }
    if (session.clients.size === 0) stopWatching(session);
  }

  const broadcast = (session: Session, event: ChangeEvent) => send(session, `event: change\ndata: ${JSON.stringify(event)}\n\n`);

  async function onFileEvent(session: Session) {
    const content = await readContent(session.file);
    const etag = etagOf(content);
    if (etag === session.knownEtag) return;
    session.knownEtag = etag;
    const result = parse(content);
    broadcast(session, result.ok ? { etag, doc: result.doc } : { etag, error: result.error });
  }

  // Watch the directory so that rename-based saves (Vim, Obsidian) are caught.
  // Any event in the directory triggers a check: the ETag comparison discards unrelated ones.
  function startWatching(session: Session) {
    const watcher = watch(dirname(session.file), () => {
      clearTimeout(session.timer);
      session.timer = setTimeout(() => void exclusive(session, () => onFileEvent(session)).catch(() => {}), WATCH_DEBOUNCE_MS);
    });
    // A deleted or unreadable directory must not crash the server: log and carry on.
    watcher.on("error", (error) => console.error("File watcher error:", error));
    session.watcher = watcher;
  }

  function stopWatching(session: Session) {
    clearTimeout(session.timer);
    session.watcher?.close();
    session.watcher = undefined;
  }

  /** Only a file with an open stream is watched. */
  async function events(req: Request, file: string, server?: Server): Promise<Response> {
    server?.timeout(req, 0);
    const session = sessionOf(file);
    // Checked and started without waiting, so that two streams opening together cannot start two watchers.
    if (!session.watcher) startWatching(session);
    session.knownEtag = etagOf(await readContent(file));
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const release = () => {
      session.clients.delete(controller);
      if (session.clients.size === 0) stopWatching(session);
    };
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        session.clients.add(c);
        c.enqueue(encoder.encode(": connected\n\n"));
      },
      cancel: release,
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }

  async function postFile(req: Request): Promise<Response> {
    let name: unknown;
    try {
      name = ((await req.json()) as { name?: unknown } | null)?.name;
    } catch {
      return json({ error: "Body is not valid JSON" }, 400);
    }
    if (typeof name !== "string") return json({ error: "name must be a string" }, 400);
    const result = await createVaultFile(vault!.vaultDir, vault!.newFileDir, name);
    return result.ok ? json({ path: result.path }, 201) : json({ error: result.error }, result.status);
  }

  async function handle(req: Request, server?: Server): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (vault && pathname === "/api/files") {
      // The client builds the `obsidian://` links of wikilinks with the vault name (PRD 5.17).
      if (req.method === "GET") return json(await scanVault(vault.vaultDir), 200, { "X-Vault-Name": encodeURIComponent(basename(vault.vaultDir)) });
      if (req.method === "POST") return postFile(req);
      return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
    }
    if (vault && pathname === "/api/notes" && req.method === "GET") return json(await scanNotes(vault.vaultDir));
    if (pathname === "/api/todos") {
      if (req.method !== "GET" && req.method !== "PUT") return json({ error: "Method not allowed" }, 405, { Allow: "GET, PUT" });
      const file = await targetOf(req);
      if (file === null) return notFound();
      return req.method === "GET" ? getTodos(file) : putTodos(req, file);
    }
    if (pathname === "/api/events" && req.method === "GET") {
      const file = await targetOf(req);
      return file === null ? notFound() : events(req, file, server);
    }
    return notFound();
  }

  return {
    fetch: handle,
    /** The files that have a watcher, that is an open stream (paths relative to the Vault in Vault mode). */
    watchedFiles(): string[] {
      return [...sessions.values()].filter((s) => s.watcher).map((s) => keyOf(s.file));
    },
    stop() {
      for (const session of sessions.values()) {
        stopWatching(session);
        for (const c of session.clients) {
          try {
            c.close();
          } catch {}
        }
        session.clients.clear();
      }
    },
  };
}
