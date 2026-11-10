import { beforeEach, describe, expect, test } from "bun:test";
import type { ChangeEvent, TodoDocument } from "../shared/types";
import type { Api, LoadResult, SaveResult } from "./api";
import { addTask } from "./logic";
import { createStore, SELECTION_KEY, type Timers } from "./store";
import { DEBOUNCE_MS, retryDelay } from "./sync";

const doc = (...titles: string[]): TodoDocument => ({ lists: titles.map((title) => ({ title, tasks: [] })) });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Manual clock: timers only fire when `advance` is called. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set(fn, ms) {
      const id = next++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear(h) {
      pending.delete(h as number);
    },
  };
  return {
    timers,
    count: () => pending.size,
    async advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
      await tick();
    },
  };
}

function fakeApi() {
  const calls: { doc: TodoDocument; etag: string }[] = [];
  const api = {
    loadResult: { kind: "ok", doc: doc("A"), etag: '"1"' } as LoadResult,
    saveResults: [] as SaveResult[],
    loads: 0,
    calls,
    async load() {
      api.loads++;
      return api.loadResult;
    },
    async save(d: TodoDocument, etag: string) {
      calls.push({ doc: d, etag });
      return api.saveResults.shift() ?? ({ kind: "ok", doc: d, etag: `"${calls.length + 1}"` } as SaveResult);
    },
  };
  return api satisfies Api;
}

let clock: ReturnType<typeof fakeTimers>;
let api: ReturnType<typeof fakeApi>;
let store: ReturnType<typeof createStore>;
const mem = new Map<string, string>();

beforeEach(async () => {
  clock = fakeTimers();
  api = fakeApi();
  mem.clear();
  store = createStore({ api, timers: clock.timers, storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) } });
  await store.load();
});

const change = (etag: string, d: TodoDocument): ChangeEvent => ({ etag, doc: d });
const edit = (title: string) => store.commit(doc(title));

describe("retryDelay", () => {
  test("doubles and is capped", () => {
    expect([0, 1, 2, 3].map(retryDelay)).toEqual([1000, 2000, 4000, 8000]);
    expect(retryDelay(20)).toBe(30000);
  });
});

describe("load", () => {
  test("stores the document and ETag", () => {
    expect(store.getState()).toMatchObject({ doc: doc("A"), etag: '"1"', status: "saved" });
  });

  test("invalid file", async () => {
    api.loadResult = { kind: "invalid", error: { line: 3, reason: "bad" } };
    await store.load();
    expect(store.getState()).toMatchObject({ doc: null, status: "invalid", invalid: { line: 3, reason: "bad" } });
  });

  test("local edits made while the GET is in flight are kept", async () => {
    let release!: (r: LoadResult) => void;
    api.load = () => new Promise((r) => (release = r));
    const pending = store.load();
    edit("Local");
    release({ kind: "ok", doc: doc("Disk"), etag: '"9"' });
    await pending;
    expect(store.getState()).toMatchObject({ doc: doc("Local"), etag: '"1"', canUndo: true });
    expect(store.hasPendingChanges()).toBe(true);
  });

  test("unreachable server retries with increasing delay", async () => {
    const s = createStore({ api, timers: clock.timers });
    api.loadResult = { kind: "offline" };
    await s.load();
    expect(s.getState().status).toBe("offline");
    await clock.advance(999);
    expect(api.loads).toBe(2);
    await clock.advance(1);
    expect(api.loads).toBe(3);
    await clock.advance(1999);
    expect(api.loads).toBe(3);
    await clock.advance(1);
    expect(api.loads).toBe(4);
  });
});

describe("autosave", () => {
  test("debounces and sends one PUT", async () => {
    edit("B");
    expect(store.getState().status).toBe("unsaved");
    await clock.advance(DEBOUNCE_MS - 1);
    edit("C");
    await clock.advance(DEBOUNCE_MS - 1);
    expect(api.calls).toHaveLength(0);
    await clock.advance(1);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toEqual({ doc: doc("C"), etag: '"1"' });
    expect(store.getState()).toMatchObject({ status: "saved", etag: '"2"' });
    expect(store.hasPendingChanges()).toBe(false);
  });

  test("changes made during a PUT go out in the next one, with the new ETag", async () => {
    let release!: (r: SaveResult) => void;
    api.save = (d, etag) => {
      api.calls.push({ doc: d, etag });
      return new Promise((r) => (release = r));
    };
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    expect(store.getState().status).toBe("saving");
    edit("C");
    await clock.advance(DEBOUNCE_MS);
    expect(api.calls).toHaveLength(1); // still one in flight
    release({ kind: "ok", doc: doc("B"), etag: '"2"' });
    await tick();
    expect(store.hasPendingChanges()).toBe(true);
    api.save = async (d, etag) => {
      api.calls.push({ doc: d, etag });
      return { kind: "ok", doc: d, etag: '"3"' };
    };
    await clock.advance(0);
    expect(api.calls[1]).toEqual({ doc: doc("C"), etag: '"2"' });
    expect(store.getState()).toMatchObject({ status: "saved", doc: doc("C") });
  });

  test("adopts the canonical document returned by the server", async () => {
    api.saveResults.push({ kind: "ok", doc: doc("B trimmed"), etag: '"2"' });
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    expect(store.getState().doc).toEqual(doc("B trimmed"));
  });

  test("server unreachable: unsaved, retries with increasing delay, then saves", async () => {
    api.saveResults.push({ kind: "offline" }, { kind: "offline" });
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    expect(store.getState().status).toBe("offline");
    expect(store.hasPendingChanges()).toBe(true);
    await clock.advance(1000);
    expect(api.calls).toHaveLength(2);
    await clock.advance(1999);
    expect(api.calls).toHaveLength(2);
    await clock.advance(1);
    expect(api.calls).toHaveLength(3);
    expect(store.getState().status).toBe("saved");
  });

  test("400 and 428 are shown as an error and not retried, the next edit tries again", async () => {
    api.saveResults.push({ kind: "rejected", status: 400 });
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    expect(store.getState().status).toBe("error");
    expect(store.hasPendingChanges()).toBe(true);
    await clock.advance(60000);
    expect(api.calls).toHaveLength(1);
    edit("C");
    await clock.advance(DEBOUNCE_MS);
    expect(api.calls).toHaveLength(2);
    expect(store.getState().status).toBe("saved");
  });

  test("a no-op commit changes nothing", () => {
    store.commit(store.getState().doc!);
    expect(store.hasPendingChanges()).toBe(false);
  });
});

describe("conflicts", () => {
  test("409 shows the conflict, keep my version re-sends with the disk ETag", async () => {
    api.saveResults.push({ kind: "conflict", etag: '"disk"' });
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    expect(store.getState().status).toBe("conflict");
    edit("C"); // further edits do not schedule a save
    await clock.advance(5000);
    expect(api.calls).toHaveLength(1);
    store.keepMine();
    await tick();
    expect(api.calls[1]).toEqual({ doc: doc("C"), etag: '"disk"' });
    expect(store.getState().status).toBe("saved");
  });

  test("take the disk version discards local changes and clears the history", async () => {
    api.saveResults.push({ kind: "conflict", etag: '"disk"' });
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    api.loadResult = { kind: "ok", doc: doc("Disk"), etag: '"disk"' };
    store.takeDisk();
    await tick();
    expect(store.getState()).toMatchObject({ doc: doc("Disk"), etag: '"disk"', status: "saved", canUndo: false });
    expect(store.hasPendingChanges()).toBe(false);
  });

  test("external change with pending changes is a conflict", async () => {
    edit("B");
    store.onExternalChange(change('"other"', doc("Ext")));
    expect(store.getState().status).toBe("conflict");
    await clock.advance(5000);
    expect(api.calls).toHaveLength(0);
    store.keepMine();
    await tick();
    expect(api.calls[0]!.etag).toBe('"other"');
  });

  test("external change without pending changes is applied without a GET and clears the history", async () => {
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    expect(store.getState().canUndo).toBe(true);
    store.onExternalChange(change('"ext"', doc("Ext")));
    expect(store.getState()).toMatchObject({ doc: doc("Ext"), etag: '"ext"', canUndo: false, status: "saved" });
    expect(api.loads).toBe(1);
  });

  test("an invalid external change shows the error without a GET", () => {
    store.onExternalChange({ etag: '"bad"', error: { line: 4, reason: "oops" } });
    expect(store.getState()).toMatchObject({ doc: null, status: "invalid", invalid: { line: 4, reason: "oops" } });
    expect(api.loads).toBe(1);
  });

  test("an event received during a PUT is handled once the PUT returns", async () => {
    let release!: (r: SaveResult) => void;
    api.save = (d, etag) => {
      api.calls.push({ doc: d, etag });
      return new Promise((r) => (release = r));
    };
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    store.onExternalChange(change('"ext"', doc("Ext")));
    expect(store.getState().doc).toEqual(doc("B"));
    release({ kind: "ok", doc: doc("B"), etag: '"2"' });
    await tick();
    expect(store.getState()).toMatchObject({ doc: doc("Ext"), etag: '"ext"', status: "saved" });
  });

  test("the event of our own write is ignored", async () => {
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    store.onExternalChange(change('"2"', doc("B")));
    expect(store.getState().canUndo).toBe(true);
  });

  test("an event carrying the known ETag is ignored", () => {
    store.onExternalChange(change('"1"', doc("Other")));
    expect(store.getState().doc).toEqual(doc("A"));
    expect(api.loads).toBe(1);
  });

  test("422 on PUT keeps the local document and shows the error", async () => {
    api.saveResults.push({ kind: "invalid", error: { line: 2, reason: "bad" } });
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    expect(store.getState()).toMatchObject({ status: "invalid", doc: doc("B"), invalid: { line: 2, reason: "bad" } });
    expect(store.hasPendingChanges()).toBe(true);
  });
});

describe("history", () => {
  test("undo and redo are normal changes that get saved", async () => {
    edit("B");
    await clock.advance(DEBOUNCE_MS);
    expect(store.undo()).toBe(true);
    expect(store.getState().doc).toEqual(doc("A"));
    await clock.advance(DEBOUNCE_MS);
    expect(api.calls[1]!.doc).toEqual(doc("A"));
    expect(store.redo()).toBe(true);
    expect(store.getState().doc).toEqual(doc("B"));
    expect(store.undo() && store.undo()).toBe(false);
  });

  test("undo and redo switch back to the view the change was made in", () => {
    store.replace(doc("A", "B", "C"), '"x"');
    store.select(2);
    store.commit(doc("D", "B", "C"));
    store.select(null);
    store.undo();
    expect(store.getState().selected).toBe(2);
    expect(mem.get(SELECTION_KEY)).toBe("2");
    store.select(0);
    store.redo();
    expect(store.getState().selected).toBe(2);
  });

  test("a change made in the All view brings undo back to All", () => {
    store.replace(doc("A", "B"), '"x"');
    store.commit(doc("X", "B"));
    store.select(1);
    store.undo();
    expect(store.getState().selected).toBeNull();
  });

  test("replace clears the history", () => {
    edit("B");
    store.replace(doc("Z"), '"z"');
    expect(store.getState().canUndo).toBe(false);
  });
});

describe("selection", () => {
  test("is persisted by index and falls back to All when the index no longer exists", () => {
    store.replace(doc("A", "B"), '"x"');
    store.select(1);
    expect(mem.get(SELECTION_KEY)).toBe("1");
    expect(store.getState().selected).toBe(1);
    store.commit(doc("A"));
    expect(store.getState().selected).toBeNull();
    expect(mem.get(SELECTION_KEY)).toBe("all");
    store.commit(doc("A", "B")); // a list appearing at the old index is not selected again
    expect(store.getState().selected).toBeNull();
    store.select(null);
    expect(mem.get(SELECTION_KEY)).toBe("all");
  });

  test("is restored from storage, ignoring garbage", () => {
    mem.set(SELECTION_KEY, "1");
    const s = createStore({ api, timers: clock.timers, storage: { getItem: (k) => mem.get(k) ?? null, setItem: () => {} } });
    s.replace(doc("A", "B"), '"x"');
    expect(s.getState().selected).toBe(1);
    mem.set(SELECTION_KEY, "banana");
    const t = createStore({ api, timers: clock.timers, storage: { getItem: (k) => mem.get(k) ?? null, setItem: () => {} } });
    t.replace(doc("A", "B"), '"x"');
    expect(t.getState().selected).toBeNull();
  });

  test("commit works with logic operations", () => {
    store.commit(addTask(store.getState().doc!, 0, "Task")!.doc);
    expect(store.getState().doc!.lists[0]!.tasks).toHaveLength(1);
  });
});

describe("flush", () => {
  test("resolves true at once when nothing is pending, without a PUT", async () => {
    expect(await store.flush()).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  test("saves the pending changes now, without waiting for the debounce", async () => {
    edit("B");
    expect(await store.flush()).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(store.getState().status).toBe("saved");
    expect(store.hasPendingChanges()).toBe(false);
  });

  test("waits for the PUT in flight and sends the changes made meanwhile", async () => {
    edit("B");
    await clock.advance(DEBOUNCE_MS); // PUT in flight (the fake answers on the next tick)
    edit("C");
    expect(await store.flush()).toBe(true);
    expect(api.calls.map((c) => c.doc.lists[0]!.title)).toEqual(["B", "C"]);
    expect(store.hasPendingChanges()).toBe(false);
  });

  test("resolves false on a 409 and keeps the changes", async () => {
    api.saveResults.push({ kind: "conflict", etag: '"disk"' });
    edit("B");
    expect(await store.flush()).toBe(false);
    expect(store.getState().status).toBe("conflict");
    expect(store.hasPendingChanges()).toBe(true);
  });

  test("resolves false when the server is unreachable", async () => {
    api.saveResults.push({ kind: "offline" });
    edit("B");
    expect(await store.flush()).toBe(false);
    expect(store.hasPendingChanges()).toBe(true);
  });

  test("resolves false on a 422", async () => {
    api.saveResults.push({ kind: "invalid", error: { line: 1, reason: "bad" } });
    edit("B");
    expect(await store.flush()).toBe(false);
  });

  test("resolves true when the file is invalid and nothing local is pending", async () => {
    api.loadResult = { kind: "invalid", error: { line: 1, reason: "bad" } };
    await store.load();
    expect(await store.flush()).toBe(true);
  });
});
