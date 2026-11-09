// Thin fetch / EventSource wrapper around the server API. It never throws: failures become result values.
import type { ParseError, TodoDocument } from "../shared/types";

export type LoadResult =
  | { kind: "ok"; doc: TodoDocument; etag: string }
  | { kind: "invalid"; error: ParseError }
  | { kind: "offline" };

export type SaveResult =
  | { kind: "ok"; doc: TodoDocument; etag: string }
  /** `etag` is the current ETag of the file on disk. */
  | { kind: "conflict"; etag: string }
  | { kind: "invalid"; error: ParseError }
  /** Network failure or any unexpected status: the changes stay pending and the save is retried. */
  | { kind: "offline" };

export interface Api {
  load(): Promise<LoadResult>;
  save(doc: TodoDocument, etag: string): Promise<SaveResult>;
}

export function createApi(): Api {
  return {
    async load() {
      try {
        const res = await fetch("/api/todos", { cache: "no-store" });
        if (res.status === 200) return { kind: "ok", doc: await res.json(), etag: res.headers.get("ETag") ?? "" };
        if (res.status === 422) return { kind: "invalid", error: await res.json() };
      } catch {}
      return { kind: "offline" };
    },
    async save(doc, etag) {
      try {
        const res = await fetch("/api/todos", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "If-Match": etag },
          body: JSON.stringify(doc),
        });
        if (res.status === 200) return { kind: "ok", doc: await res.json(), etag: res.headers.get("ETag") ?? "" };
        if (res.status === 409) return { kind: "conflict", etag: res.headers.get("ETag") ?? "" };
        if (res.status === 422) return { kind: "invalid", error: await res.json() };
      } catch {}
      return { kind: "offline" };
    },
  };
}

/**
 * Subscribes to the SSE `change` event (its data is the new ETag).
 * `onReconnect` fires when the stream opens again after a loss, since events may have been missed.
 * Returns a function that closes the stream.
 */
export function subscribeEvents(onChange: (etag: string) => void, onReconnect: () => void): () => void {
  const source = new EventSource("/api/events");
  let opened = false;
  source.addEventListener("change", (e) => onChange((e as MessageEvent<string>).data));
  source.onopen = () => {
    if (opened) onReconnect();
    opened = true;
  };
  return () => source.close();
}
