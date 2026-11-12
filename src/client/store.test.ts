import { beforeEach, describe, expect, test } from "bun:test";
import type { ChangeEvent, TodoDocument } from "../shared/types";
import type { Api, LoadResult, SaveResult } from "./api";
import { addTask, moveDown, moveList } from "./logic";
import { appendTerm, visibleRows } from "./logic/filter";
import { createStore, FILTER_KEY, OLD_SELECTION_KEY, SIBLINGS_KEY, type Timers } from "./store";
import { DEBOUNCE_MS, retryDelay } from "./sync";

const doc = (...titles: string[]): TodoDocument => ({ lists: titles.map((title) => ({ title, tasks: [] })), filters: [] });
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
const storageOf = () => ({ getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });

beforeEach(async () => {
  clock = fakeTimers();
  api = fakeApi();
  mem.clear();
  store = createStore({ api, timers: clock.timers, storage: storageOf() });
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

  test("undo and redo switch back to the filter text the change was made under", () => {
    store.replace(doc("A", "B", "C"), '"x"');
    store.setFilter("is:todo");
    store.commit(doc("D", "B", "C"));
    store.setFilter("due:today");
    store.undo();
    expect(store.getState().filter).toBe("is:todo");
    expect(mem.get(FILTER_KEY)).toBe("is:todo");
    store.setFilter("");
    store.redo();
    expect(store.getState().filter).toBe("is:todo");
  });

  test("a change made with no filter brings undo back to an empty filter", () => {
    store.replace(doc("A", "B"), '"x"');
    store.commit(doc("X", "B"));
    store.setFilter("list:A");
    store.undo();
    expect(store.getState().filter).toBe("");
  });

  test("undo never touches the saved filters", () => {
    store.replace(doc("A"), '"x"');
    store.commit(doc("B"));
    store.commitFilters([{ name: "N", text: "is:todo" }]);
    store.undo();
    expect(store.getState().doc).toEqual({ ...doc("A"), filters: [{ name: "N", text: "is:todo" }] });
    store.redo();
    expect(store.getState().doc).toEqual({ ...doc("B"), filters: [{ name: "N", text: "is:todo" }] });
  });

  test("replace clears the history", () => {
    edit("B");
    store.replace(doc("Z"), '"z"');
    expect(store.getState().canUndo).toBe(false);
  });
});

describe("show siblings", () => {
  test("is off by default, toggles without touching the document or the history, and is stored", () => {
    expect(store.getState().showSiblings).toBe(false);
    store.toggleSiblings();
    expect(store.getState().showSiblings).toBe(true);
    expect(mem.get(SIBLINGS_KEY)).toBe("true");
    expect(store.getState().canUndo).toBe(false);
    expect(store.hasPendingChanges()).toBe(false);
    expect(createStore({ api, timers: clock.timers, storage: storageOf() }).getState().showSiblings).toBe(true);
    store.toggleSiblings();
    expect(store.getState().showSiblings).toBe(false);
  });
});

describe("filter text", () => {
  test("is stored in localStorage and restored on load", () => {
    store.setFilter("due:today");
    expect(store.getState().filter).toBe("due:today");
    expect(mem.get(FILTER_KEY)).toBe("due:today");
    const s = createStore({ api, timers: clock.timers, storage: storageOf() });
    expect(s.getState().filter).toBe("due:today");
  });

  test("starts empty with nothing stored, and the filter is not part of the document", async () => {
    expect(store.getState().filter).toBe("");
    store.setFilter("x");
    await clock.advance(DEBOUNCE_MS);
    expect(api.calls).toHaveLength(0);
  });

  test("applying the same text drops the pins and notifies, and does nothing without pins", () => {
    store.setFilter("x");
    let notified = 0;
    store.subscribe(() => notified++);
    store.setFilter("x");
    expect(notified).toBe(0);
  });

  test("setting a filter is not a change of the document: no history, no save", async () => {
    store.setFilter("x");
    expect(store.getState().canUndo).toBe(false);
    expect(store.hasPendingChanges()).toBe(false);
  });

  test("the old selector index key is dropped", () => {
    mem.set(OLD_SELECTION_KEY, "2");
    createStore({ api, timers: clock.timers, storage: storageOf() });
    expect(mem.has(OLD_SELECTION_KEY)).toBe(false);
  });

  test("a storage that throws leaves an empty filter", () => {
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    const s = createStore({ api, timers: clock.timers, storage: broken });
    expect(s.getState().filter).toBe("");
    s.setFilter("x");
    expect(s.getState().filter).toBe("x");
  });

  test("notifies a content change so that the lists are rendered again", () => {
    const kinds: string[] = [];
    store.subscribe((_s, kind) => kinds.push(kind));
    store.setFilter("x");
    expect(kinds).toEqual(["content"]);
    store.setFilter("x");
    expect(kinds).toEqual(["content"]);
  });
});

describe("pinned rows", () => {
  const path = (task: number, child?: number) => ({ list: 0, task, child });
  const strip = (pins: { list: number; task: number; child?: number }[]) => pins.map((p) => (p.child === undefined ? { list: p.list, task: p.task } : p));

  test("a commit with a pin keeps that task visible", () => {
    store.setFilter("x");
    store.commit(doc("B"), { pin: path(1) });
    expect(strip(store.getState().pins)).toEqual([{ list: 0, task: 1 }]);
  });

  test("applying the same filter text drops the pins", () => {
    store.setFilter("x");
    store.commit(doc("B"), { pin: path(1) });
    expect(store.getState().pins).toHaveLength(1);
    store.setFilter("x");
    expect(store.getState().pins).toEqual([]);
    expect(store.getState().filter).toBe("x");
  });

  test("appending a term to the filter text drops the pins", () => {
    store.setFilter("x");
    store.commit(doc("B"), { pin: path(1) });
    store.setFilter(appendTerm(store.getState().filter, "is:todo"));
    expect(store.getState().filter).toBe("x is:todo");
    expect(store.getState().pins).toEqual([]);
  });

  test("pinChildren also pins the subtasks of the pinned parent", () => {
    store.setFilter("x");
    const withChildren: TodoDocument = { filters: [], lists: [{ title: "A", tasks: [{ text: "p", done: true, children: [{ text: "a", done: true }, { text: "b", done: true }] }] }] };
    store.commit(withChildren, { pin: path(0), pinChildren: true });
    expect(strip(store.getState().pins)).toEqual([{ list: 0, task: 0 }, path(0, 0), path(0, 1)]);
  });

  test("a move pins the moved task and the other pins follow their tasks", () => {
    store.setFilter("x");
    store.commit(doc("B"), { pin: path(1) });
    store.commit(doc("C"), { pin: path(0), moves: [{ from: path(2), to: path(0) }, { from: path(0), to: path(1) }, { from: path(1), to: path(2) }] });
    expect(strip(store.getState().pins)).toEqual([{ list: 0, task: 2 }, { list: 0, task: 0 }]);
  });

  test("pins follow their tasks through a real move, and undo restores the filter text", () => {
    const base: TodoDocument = { filters: [], lists: [{ title: "A", tasks: ["x0", "h1", "x2", "h3"].map((text) => ({ text, done: false })) }] };
    store.replace(base, "e1");
    store.setFilter("x");
    store.commit(structuredClone(base), { pin: { list: 0, task: 3 }, moves: [] }); // h3 is pinned
    const r = moveDown(base, { list: 0, task: 0 }, visibleRows(base, "x", "2026-11-11", store.getState().pins))!;
    store.commit(r.doc, { pin: r.path, moves: r.moves });
    const shown = visibleRows(r.doc, "x", "2026-11-11", store.getState().pins);
    expect(shown.lists[0]!.tasks.map((v) => r.doc.lists[0]!.tasks[v.task]!.text)).toEqual(["x2", "x0", "h3"]);
    store.setFilter("y");
    store.undo();
    expect(store.getState().filter).toBe("x");
  });

  test("a list move keeps the pins on their tasks", () => {
    const base: TodoDocument = { filters: [], lists: [{ title: "A", tasks: [{ text: "h1", done: false }] }, { title: "B", tasks: [{ text: "x3", done: false }] }] };
    store.replace(base, "e1");
    store.setFilter("x");
    store.commit(structuredClone(base), { pin: { list: 0, task: 0 }, moves: [] });
    const r = moveList(base, 0, 1, "after")!;
    store.commit(r.doc, { moves: r.moves });
    expect(store.getState().pins).toEqual([{ list: 1, task: 0 }]);
  });

  test("an insertion shifts the earlier pins", () => {
    store.setFilter("x");
    store.commit(doc("B"), { pin: path(1) });
    store.commit(doc("C"), { pin: path(0), inserted: true });
    expect(strip(store.getState().pins)).toEqual([{ list: 0, task: 2 }, { list: 0, task: 0 }]);
  });

  test("a change of the filter text clears them", () => {
    store.setFilter("x");
    store.commit(doc("B"), { pin: path(1) });
    store.setFilter("y");
    expect(store.getState().pins).toEqual([]);
  });

  test("a delete, an undo and an external change clear them", () => {
    store.setFilter("x");
    store.commit(doc("B"), { pin: path(1) });
    store.commit(doc("C"), { clearPins: true });
    expect(store.getState().pins).toEqual([]);
    for (const clear of [() => store.undo(), () => store.replace(doc("Z"), '"z"')]) {
      store.commit(doc("D"), { pin: path(1) });
      clear();
      expect(store.getState().pins).toEqual([]);
    }
  });

  test("another commit leaves them", () => {
    store.setFilter("x");
    store.commit(doc("B"), { pin: path(1) });
    store.commit(doc("C"));
    expect(store.getState().pins).toHaveLength(1);
  });
});

describe("saved filters", () => {
  test("commitFilters replaces them, saves, and leaves the history alone", async () => {
    store.commitFilters([{ name: "N", text: "is:todo" }]);
    expect(store.getState().doc!.filters).toEqual([{ name: "N", text: "is:todo" }]);
    expect(store.getState().canUndo).toBe(false);
    expect(store.hasPendingChanges()).toBe(true);
    await clock.advance(DEBOUNCE_MS);
    expect(api.calls[0]!.doc.filters).toEqual([{ name: "N", text: "is:todo" }]);
  });

  test("a conflict while saving them shows the conflict state as for any change", async () => {
    api.saveResults.push({ kind: "conflict", etag: '"9"' });
    store.commitFilters([{ name: "N", text: "x" }]);
    await clock.advance(DEBOUNCE_MS);
    expect(store.getState().status).toBe("conflict");
  });

  test("commitFilters without a document does nothing", () => {
    const s = createStore({ api, timers: clock.timers });
    s.commitFilters([{ name: "N", text: "x" }]);
    expect(s.getState().doc).toBeNull();
  });
});

describe("commit works with logic operations", () => {
  test("commit works with logic operations", () => {
    store.commit(addTask(store.getState().doc!, 0, "Task")!.doc);
    expect(store.getState().doc!.lists[0]!.tasks).toHaveLength(1);
  });
});

describe("per-file storage (PRD 5.16)", () => {
  test("the filter text is stored and read under the key of the open file", () => {
    mem.clear();
    const a = createStore({ api, timers: clock.timers, storage: storageOf(), file: "a.md" });
    a.replace(doc("A"), '"x"');
    a.setFilter("is:todo");
    expect(mem.get(FILTER_KEY)).toBeUndefined();
    const b = createStore({ api, timers: clock.timers, storage: storageOf(), file: "b.md" });
    expect(b.getState().filter).toBe("");
    expect(createStore({ api, timers: clock.timers, storage: storageOf(), file: "a.md" }).getState().filter).toBe("is:todo");
  });

  test("without a file the plain key is used", () => {
    mem.clear();
    store.replace(doc("A"), '"x"');
    store.setFilter("is:done");
    expect(mem.get(FILTER_KEY)).toBe("is:done");
  });

  test("flush saves the pending changes and resolves", async () => {
    store.replace(doc("A"), '"x"');
    store.commit(doc("B"));
    await store.flush();
    expect(store.getState().status).toBe("saved");
    expect(store.hasPendingChanges()).toBe(false);
  });
});
