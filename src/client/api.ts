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

export type ExportResult =
  | { kind: "ok"; text: string }
  | { kind: "invalid"; error: ParseError }
  | { kind: "offline" };

/** Fetches the canonical Markdown of the current view (`list` is the selected list index, null for all lists). Never throws. */
export async function fetchExport(list: number | null): Promise<ExportResult> {
  try {
    const res = await fetch(list === null ? "/api/export" : `/api/export?list=${list}`, { cache: "no-store" });
    if (res.status === 200) return { kind: "ok", text: await res.text() };
    if (res.status === 422) return { kind: "invalid", error: await res.json() };
  } catch {}
  return { kind: "offline" };
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
export function subscribeEvents(onChange: (event: ChangeEvent) => void, onReconnect: () => void): () => void {
  const source = new EventSource("/api/events");
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
