import { describe, expect, test } from "bun:test";
import { resolveKey, undoActionFor, type Action, type AddAt, type KeyInput } from "./shortcuts";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods,
});

describe("undoActionFor", () => {
  test("Ctrl+Z is undo", () => {
    expect(undoActionFor(key("z", { ctrlKey: true }))).toBe("undo");
  });
  test("Ctrl+Shift+Z is redo, even with an uppercase key", () => {
    expect(undoActionFor(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
  });
  test("Cmd+Z works for macOS", () => {
    expect(undoActionFor(key("z", { metaKey: true }))).toBe("undo");
  });
  test("Ctrl+Y is redo", () => {
    expect(undoActionFor(key("y", { ctrlKey: true }))).toBe("redo");
  });
  test("a plain Z or Ctrl+Alt+Z is ignored", () => {
    expect(undoActionFor(key("z"))).toBeNull();
    expect(undoActionFor(key("z", { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

// --- resolveKey (PRD 5.9) ---

const k = (key: string, o: Partial<KeyInput> = {}): KeyInput => ({
  key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
  target: "task", pending: "", overlay: "none", ...o,
});
const act = (key: string, o: Partial<KeyInput> = {}) => resolveKey(k(key, o)).action;
const onHeader = { target: "header" } as const;

describe("resolveKey: cursor navigation", () => {
  test("j and ArrowDown move to the next stop", () => {
    expect(act("j")).toEqual({ type: "cursor", to: "next" });
    expect(act("ArrowDown")).toEqual({ type: "cursor", to: "next" });
  });
  test("k and ArrowUp move to the previous stop", () => {
    expect(act("k")).toEqual({ type: "cursor", to: "prev" });
    expect(act("ArrowUp")).toEqual({ type: "cursor", to: "prev" });
  });
  test("G jumps to the last stop", () => {
    expect(act("G", { shiftKey: true })).toEqual({ type: "cursor", to: "last" });
  });
  test("navigation also works on a header", () => {
    expect(act("j", onHeader)).toEqual({ type: "cursor", to: "next" });
    expect(act("k", onHeader)).toEqual({ type: "cursor", to: "prev" });
  });
  test("h and l jump to the previous and next header", () => {
    expect(act("h")).toEqual({ type: "cursor", to: "prev-header" });
    expect(act("l")).toEqual({ type: "cursor", to: "next-header" });
  });
  test("H and L select the previous and next view", () => {
    expect(act("H", { shiftKey: true })).toEqual({ type: "view", dir: "prev" });
    expect(act("L", { shiftKey: true })).toEqual({ type: "view", dir: "next" });
  });
  test("navigation arrows prevent the default scroll", () => {
    expect(resolveKey(k("ArrowDown")).preventDefault).toBe(true);
    expect(resolveKey(k("ArrowUp")).preventDefault).toBe(true);
  });
});

describe("resolveKey: gg sequence", () => {
  test("the first g sets the pending prefix without an action", () => {
    expect(resolveKey(k("g"))).toEqual({ action: null, pending: "g", preventDefault: true });
  });
  test("g then g jumps to the first stop and clears the prefix", () => {
    expect(resolveKey(k("g", { pending: "g" }))).toEqual({
      action: { type: "cursor", to: "first" }, pending: "", preventDefault: true,
    });
  });
  test("g on a header also sets the prefix", () => {
    expect(resolveKey(k("g", onHeader)).pending).toBe("g");
  });
  test("g then j cancels the prefix and does not move the cursor", () => {
    const r = resolveKey(k("j", { pending: "g" }));
    expect(r.action).toBeNull();
    expect(r.pending).toBe("");
  });
  test("g then x cancels the prefix and does not toggle", () => {
    const r = resolveKey(k("x", { pending: "g" }));
    expect(r.action).toBeNull();
    expect(r.pending).toBe("");
  });
  test("d then g cancels the delete prefix and does not start a gg", () => {
    const r = resolveKey(k("g", { pending: "d" }));
    expect(r.action).toBeNull();
    expect(r.pending).toBe("");
  });
});

describe("resolveKey: dd sequence and Delete", () => {
  test("the first d sets the pending prefix without an action", () => {
    expect(resolveKey(k("d"))).toEqual({ action: null, pending: "d", preventDefault: true });
  });
  test("d then d deletes the task and clears the prefix", () => {
    expect(resolveKey(k("d", { pending: "d" }))).toEqual({
      action: { type: "delete" }, pending: "", preventDefault: true,
    });
  });
  test("d then d deletes a list on a header", () => {
    expect(act("d", { ...onHeader, pending: "d" })).toEqual({ type: "delete" });
  });
  test("d on a header sets the prefix", () => {
    expect(resolveKey(k("d", onHeader)).pending).toBe("d");
  });
  test("d then j cancels the prefix and does not move", () => {
    const r = resolveKey(k("j", { pending: "d" }));
    expect(r.action).toBeNull();
    expect(r.pending).toBe("");
  });
  test("d then o cancels the prefix and does not add a task", () => {
    const r = resolveKey(k("o", { pending: "d" }));
    expect(r.action).toBeNull();
    expect(r.pending).toBe("");
  });
  test("Delete deletes at once and prevents the default", () => {
    expect(resolveKey(k("Delete"))).toEqual({ action: { type: "delete" }, pending: "", preventDefault: true });
  });
  test("Delete on a header deletes the list", () => {
    expect(act("Delete", onHeader)).toEqual({ type: "delete" });
  });
});

describe("resolveKey: keys on a task", () => {
  test("x and Space toggle the check state", () => {
    expect(act("x")).toEqual({ type: "toggle" });
    expect(act(" ")).toEqual({ type: "toggle" });
  });
  test("Space prevents the default page scroll", () => {
    expect(resolveKey(k(" ")).preventDefault).toBe(true);
  });
  test("i, Enter and F2 edit the task", () => {
    for (const key of ["i", "Enter", "F2"]) expect(act(key)).toEqual({ type: "edit" });
  });
  test("> indents and < outdents", () => {
    expect(act(">", { shiftKey: true })).toEqual({ type: "indent" });
    expect(act("<", { shiftKey: true })).toEqual({ type: "outdent" });
  });
  test("J and K move the task down and up", () => {
    expect(act("J", { shiftKey: true })).toEqual({ type: "move", dir: "down" });
    expect(act("K", { shiftKey: true })).toEqual({ type: "move", dir: "up" });
  });
  test("Alt+ArrowDown and Alt+ArrowUp move the task", () => {
    expect(act("ArrowDown", { altKey: true })).toEqual({ type: "move", dir: "down" });
    expect(act("ArrowUp", { altKey: true })).toEqual({ type: "move", dir: "up" });
  });
  test("Alt+Arrow does not move the cursor", () => {
    expect(act("ArrowDown", { altKey: true })).not.toEqual({ type: "cursor", to: "next" });
  });
  test("Alt+Arrow prevents the default", () => {
    expect(resolveKey(k("ArrowDown", { altKey: true })).preventDefault).toBe(true);
  });
  test("an action key prevents the default and leaves no prefix", () => {
    expect(resolveKey(k("x"))).toEqual({ action: { type: "toggle" }, pending: "", preventDefault: true });
  });
});

describe("resolveKey: positional add on a task", () => {
  const cases: [string, AddAt][] = [
    ["o", "below"], ["O", "above"], ["a", "child-end-or-below"], ["I", "first-child"], ["A", "last-child"],
  ];
  for (const [key, at] of cases) {
    test(`${key} adds at ${at}`, () => {
      expect(act(key, { shiftKey: key === key.toUpperCase() })).toEqual({ type: "add", at });
    });
  }
});

describe("resolveKey: keys on a list header", () => {
  test("o, a and I add at the start of the list", () => {
    for (const key of ["o", "a", "I"]) expect(act(key, onHeader)).toEqual({ type: "add", at: "list-start" });
  });
  test("A adds at the end of the list", () => {
    expect(act("A", onHeader)).toEqual({ type: "add", at: "list-end" });
  });
  test("O does nothing on a header", () => {
    expect(act("O", onHeader)).toBeNull();
  });
  test("i and Enter rename the list", () => {
    expect(act("i", onHeader)).toEqual({ type: "edit" });
    expect(act("Enter", onHeader)).toEqual({ type: "edit" });
  });
  test("x, Space, > and < do nothing", () => {
    for (const key of ["x", " ", ">", "<"]) expect(act(key, onHeader)).toBeNull();
  });
  test("J and K do nothing, since lists are not reorderable", () => {
    expect(act("J", onHeader)).toBeNull();
    expect(act("K", onHeader)).toBeNull();
  });
  test("Alt+Arrow does not move a header", () => {
    expect(act("ArrowDown", { ...onHeader, altKey: true })).toBeNull();
    expect(act("ArrowUp", { ...onHeader, altKey: true })).toBeNull();
  });
});

describe("resolveKey: undo and redo", () => {
  test("u and U undo and redo", () => {
    expect(act("u")).toEqual({ type: "undo" });
    expect(act("U", { shiftKey: true })).toEqual({ type: "redo" });
  });
  test("u and U also work on a header", () => {
    expect(act("u", onHeader)).toEqual({ type: "undo" });
    expect(act("U", { ...onHeader, shiftKey: true })).toEqual({ type: "redo" });
  });
  test("Ctrl+Z and Cmd+Z undo", () => {
    expect(act("z", { ctrlKey: true })).toEqual({ type: "undo" });
    expect(act("z", { metaKey: true })).toEqual({ type: "undo" });
  });
  test("Ctrl+Shift+Z and Ctrl+Y redo", () => {
    expect(act("Z", { ctrlKey: true, shiftKey: true })).toEqual({ type: "redo" });
    expect(act("y", { ctrlKey: true })).toEqual({ type: "redo" });
  });
  test("Ctrl+Z works with no focused target", () => {
    expect(act("z", { ctrlKey: true, target: "none" })).toEqual({ type: "undo" });
  });
  test("Ctrl+Z does nothing in a field, which keeps its own undo", () => {
    const r = resolveKey(k("z", { ctrlKey: true, target: "field" }));
    expect(r).toEqual({ action: null, pending: "", preventDefault: false });
  });
  test("Ctrl+Z prevents the default", () => {
    expect(resolveKey(k("z", { ctrlKey: true })).preventDefault).toBe(true);
  });
});

describe("resolveKey: N, help and target none", () => {
  test("N creates a list from a task, a header and no target", () => {
    for (const target of ["task", "header", "none"] as const) {
      expect(act("N", { target, shiftKey: true })).toEqual({ type: "new-list" });
    }
  });
  test("? toggles the cheat sheet", () => {
    expect(act("?", { shiftKey: true })).toEqual({ type: "toggle-help" });
  });
  test("Normal keys work with no focused target", () => {
    expect(act("j", { target: "none" })).toEqual({ type: "cursor", to: "next" });
    expect(act("x", { target: "none" })).toEqual({ type: "toggle" });
  });
});

describe("resolveKey: target field (Insert mode)", () => {
  const field = { target: "field" } as const;
  test("plain keys resolve to nothing and are not prevented", () => {
    for (const key of ["j", "x", "d", "g", "N", "?", " ", "Enter", "Delete", "Escape", "ArrowDown"]) {
      expect(resolveKey(k(key, field))).toEqual({ action: null, pending: "", preventDefault: false });
    }
  });
  test("a stale pending prefix is dropped", () => {
    expect(resolveKey(k("d", { ...field, pending: "d" }))).toEqual({ action: null, pending: "", preventDefault: false });
  });
  test("Alt+Arrow does not move the task while typing", () => {
    expect(act("ArrowDown", { ...field, altKey: true })).toBeNull();
  });
});

describe("resolveKey: target control", () => {
  const control = { target: "control" } as const;
  test("Escape puts the focus back on the cursor", () => {
    expect(resolveKey(k("Escape", control))).toEqual({
      action: { type: "focus-cursor" }, pending: "", preventDefault: true,
    });
  });
  test("other keys keep their native behavior", () => {
    for (const key of ["j", "x", "Enter", " ", "d", "N", "?", "ArrowDown", "Delete"]) {
      expect(resolveKey(k(key, control))).toEqual({ action: null, pending: "", preventDefault: false });
    }
  });
  test("Ctrl+Z does nothing on a control", () => {
    expect(act("z", { ...control, ctrlKey: true })).toBeNull();
  });
});

describe("resolveKey: keys ignored in Normal mode", () => {
  test("Tab, Shift+Tab, Backspace and Escape resolve to nothing without preventDefault", () => {
    for (const target of ["task", "header", "none"] as const) {
      for (const o of [{ key: "Tab" }, { key: "Tab", shiftKey: true }, { key: "Backspace" }, { key: "Escape" }]) {
        expect(resolveKey(k(o.key, { target, shiftKey: o.shiftKey }))).toEqual({
          action: null, pending: "", preventDefault: false,
        });
      }
    }
  });
  test("an unknown key resolves to nothing without preventDefault", () => {
    expect(resolveKey(k("q"))).toEqual({ action: null, pending: "", preventDefault: false });
  });
  test("Escape cancels a pending prefix without an action", () => {
    const r = resolveKey(k("Escape", { pending: "g" }));
    expect(r.action).toBeNull();
    expect(r.pending).toBe("");
  });
});

describe("resolveKey: modifiers", () => {
  test("Ctrl, Meta and Alt combos on plain keys resolve to nothing", () => {
    for (const key of ["j", "x", "o", "i", "d", "g", "u", "h"]) {
      expect(act(key, { ctrlKey: true })).toBeNull();
      expect(act(key, { metaKey: true })).toBeNull();
      expect(act(key, { altKey: true })).toBeNull();
    }
  });
  test("a modified key does not set a prefix", () => {
    expect(resolveKey(k("d", { ctrlKey: true })).pending).toBe("");
    expect(resolveKey(k("g", { metaKey: true })).pending).toBe("");
  });
  test("Ctrl+Alt+Z is not an undo", () => {
    expect(act("z", { ctrlKey: true, altKey: true })).toBeNull();
  });
  test("Ctrl+ArrowDown is not a cursor move", () => {
    expect(act("ArrowDown", { ctrlKey: true })).toBeNull();
  });
});

describe("resolveKey: cheat sheet overlay", () => {
  const cheat = { overlay: "cheatsheet" } as const;
  test("? and Escape close it", () => {
    expect(act("?", { ...cheat, shiftKey: true })).toEqual({ type: "toggle-help" });
    expect(act("Escape", cheat)).toEqual({ type: "toggle-help" });
  });
  test("closing prevents the default", () => {
    expect(resolveKey(k("Escape", cheat)).preventDefault).toBe(true);
  });
  test("every other key resolves to nothing", () => {
    for (const key of ["j", "x", "d", "g", "o", "N", "Enter", " ", "Delete", "ArrowDown", "Tab", "y", "n"]) {
      expect(act(key, cheat)).toBeNull();
    }
  });
  test("undo is blocked while the overlay is open", () => {
    expect(act("z", { ...cheat, ctrlKey: true })).toBeNull();
  });
  test("a pending prefix is dropped", () => {
    expect(resolveKey(k("d", { ...cheat, pending: "d" })).action).toBeNull();
    expect(resolveKey(k("d", { ...cheat, pending: "d" })).pending).toBe("");
  });
  test("it takes precedence over the target kind", () => {
    expect(act("?", { ...cheat, target: "control", shiftKey: true })).toEqual({ type: "toggle-help" });
  });
});

describe("resolveKey: confirm-delete overlay", () => {
  const confirm = { overlay: "confirm-delete", ...onHeader } as const;
  test("y and Enter confirm", () => {
    expect(act("y", confirm)).toEqual({ type: "confirm" });
    expect(act("Enter", confirm)).toEqual({ type: "confirm" });
  });
  test("n and Escape cancel", () => {
    expect(act("n", confirm)).toEqual({ type: "cancel" });
    expect(act("Escape", confirm)).toEqual({ type: "cancel" });
  });
  test("answers prevent the default and leave no prefix", () => {
    expect(resolveKey(k("y", confirm))).toEqual({ action: { type: "confirm" }, pending: "", preventDefault: true });
  });
  test("every other key resolves to nothing", () => {
    for (const key of ["j", "x", "d", "g", "o", "N", "?", " ", "Delete", "ArrowDown", "Tab"]) {
      expect(act(key, confirm)).toBeNull();
    }
  });
  test("a second d does not confirm the deletion", () => {
    expect(act("d", { ...confirm, pending: "d" })).toBeNull();
  });
  test("undo is blocked while the prompt is open", () => {
    expect(act("z", { ...confirm, ctrlKey: true })).toBeNull();
  });
});

describe("resolveKey: result shape", () => {
  test("every resolved action is a known Action type", () => {
    const a: Action | null = act("x");
    expect(a?.type).toBe("toggle");
  });
});
