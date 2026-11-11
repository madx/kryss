// Thin fetch / EventSource wrapper around the server API. It never throws: failures become result values.
import type { ChangeEvent, ParseError, TodoDocument } from "../shared/types";

export type LoadResult =
  | { kind: "ok"; doc: TodoDocument; etag: string }
  | { kind: "invalid"; error: ParseError }
  | { kind: "offline" };

export type SaveResult =
  | { kind: "ok"; doc: TodoDocument; etag: string }
  /** `etag` is the current ETag of the file on disk. */
  | { kind: "conflict"; etag: string }
  | { kind: "invalid"; error: ParseError }
  /** The server refused the request itself (`400`, `428`): retrying the same request cannot succeed. */
  | { kind: "rejected"; status: number }
  /** Network failure or any other unexpected status: the changes stay pending and the save is retried. */
  | { kind: "offline" };

export interface Api {
  load(): Promise<LoadResult>;
  save(doc: TodoDocument, etag: string): Promise<SaveResult>;
}

/** The URL of an endpoint that takes the open file (`file`) in Vault mode. */
const withFile = (path: string, file: string | null) => (file === null ? path : `${path}?file=${encodeURIComponent(file)}`);

export type FilesResult = { kind: "single" } | { kind: "vault"; files: string[] } | { kind: "offline" };
export type CreateFileResult = { kind: "ok"; path: string } | { kind: "refused"; error: string } | { kind: "offline" };

/** The Kryss files of the Vault, or `single` when the server runs on one file and has no such route. */
export async function listFiles(): Promise<FilesResult> {
  try {
    const res = await fetch("/api/files", { cache: "no-store" });
    if (res.status === 200) return { kind: "vault", files: await res.json() };
    if (res.status === 404) return { kind: "single" };
  } catch {}
  return { kind: "offline" };
}

export async function createFile(name: string): Promise<CreateFileResult> {
  try {
    const res = await fetch("/api/files", { method: "POST", body: JSON.stringify({ name }) });
    if (res.status === 201) return { kind: "ok", path: ((await res.json()) as { path: string }).path };
    if (res.status === 400 || res.status === 409) return { kind: "refused", error: ((await res.json()) as { error: string }).error };
  } catch {}
  return { kind: "offline" };
}

/** `file` is the open file of a Vault, or null in single-file mode. */
export function createApi(file: string | null = null): Api {
  return {
    async load() {
      try {
        const res = await fetch(withFile("/api/todos", file), { cache: "no-store" });
        if (res.status === 200) return { kind: "ok", doc: await res.json(), etag: res.headers.get("ETag") ?? "" };
        if (res.status === 422) return { kind: "invalid", error: await res.json() };
      } catch {}
      return { kind: "offline" };
    },
    async save(doc, etag) {
      try {
        const res = await fetch(withFile("/api/todos", file), {
          method: "PUT",
          headers: { "Content-Type": "application/json", "If-Match": etag },
          body: JSON.stringify(doc),
        });
        if (res.status === 200) return { kind: "ok", doc: await res.json(), etag: res.headers.get("ETag") ?? "" };
        if (res.status === 409) return { kind: "conflict", etag: res.headers.get("ETag") ?? "" };
        if (res.status === 422) return { kind: "invalid", error: await res.json() };
        if (res.status === 400 || res.status === 428) return { kind: "rejected", status: res.status };
      } catch {}
      return { kind: "offline" };
    },
  };
}

/**
 * Subscribes to the SSE `change` event (its data is a JSON `ChangeEvent`: the new ETag and the document or the parse error).
 * `onReconnect` fires when the stream opens again after a loss, since events may have been missed.
 * An event that cannot be parsed is handled like a missed one.
 * Returns a function that closes the stream.
 */
export function subscribeEvents(onChange: (event: ChangeEvent) => void, onReconnect: () => void, file: string | null = null): () => void {
  const source = new EventSource(withFile("/api/events", file));
  let opened = false;
  source.addEventListener("change", (e) => {
    let event: ChangeEvent;
    try {
      event = JSON.parse((e as MessageEvent<string>).data);
    } catch {
      return onReconnect();
    }
    onChange(event);
  });
  source.onopen = () => {
    if (opened) onReconnect();
    opened = true;
  };
  return () => source.close();
}
