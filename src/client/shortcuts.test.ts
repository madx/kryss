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
  target: "task", pending: "", overlay: "none", markdownView: false, search: false, links: 0, ...o,
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
  test("H and L move the whole list up and down, from a task or a header", () => {
    for (const o of [{}, onHeader]) {
      expect(act("H", { ...o, shiftKey: true })).toEqual({ type: "move-list", dir: "up" });
      expect(act("L", { ...o, shiftKey: true })).toEqual({ type: "move-list", dir: "down" });
    }
  });
  test("H and L do nothing in Insert mode or in the Markdown view", () => {
    for (const o of [{ target: "field" }, { markdownView: true }] as const) {
      expect(act("H", { ...o, shiftKey: true })).toBeNull();
      expect(act("L", { ...o, shiftKey: true })).toBeNull();
    }
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
  test("e and Enter edit the task", () => {
    for (const key of ["e", "Enter"]) expect(act(key)).toEqual({ type: "edit" });
  });
  test("E edits the task with the caret at the start", () => {
    expect(act("E", { shiftKey: true })).toEqual({ type: "edit-start" });
  });
  test("i, I and F2 do nothing on a task", () => {
    expect(act("i")).toBeNull();
    expect(act("I", { shiftKey: true })).toBeNull();
    expect(act("F2")).toBeNull();
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
    ["o", "below"], ["O", "above"], ["a", "last-child"], ["A", "first-child"],
  ];
  for (const [key, at] of cases) {
    test(`${key} adds at ${at}`, () => {
      expect(act(key, { shiftKey: key === key.toUpperCase() })).toEqual({ type: "add", at });
    });
  }
});

describe("resolveKey: keys on a list header", () => {
  test("o and A add at the start of the list", () => {
    for (const key of ["o", "A"]) expect(act(key, { shiftKey: key === "A", ...onHeader })).toEqual({ type: "add", at: "list-start" });
  });
  test("a adds at the end of the list", () => {
    expect(act("a", onHeader)).toEqual({ type: "add", at: "list-end" });
  });
  test("O adds at the end of the previous visible list", () => {
    expect(act("O", { shiftKey: true, ...onHeader })).toEqual({ type: "add", at: "prev-list-end" });
  });
  test("e and Enter rename the list", () => {
    expect(act("e", onHeader)).toEqual({ type: "edit" });
    expect(act("Enter", onHeader)).toEqual({ type: "edit" });
  });
  test("E renames the list with the caret at the start", () => {
    expect(act("E", { shiftKey: true, ...onHeader })).toEqual({ type: "edit-start" });
  });
  test("i, I and F2 do nothing on a header", () => {
    expect(act("i", onHeader)).toBeNull();
    expect(act("I", { shiftKey: true, ...onHeader })).toBeNull();
    expect(act("F2", onHeader)).toBeNull();
  });
  test("x, Space, > and < do nothing", () => {
    for (const key of ["x", " ", ">", "<"]) expect(act(key, onHeader)).toBeNull();
  });
  test("J and K move the list down and up", () => {
    expect(act("J", { ...onHeader, shiftKey: true })).toEqual({ type: "move", dir: "down" });
    expect(act("K", { ...onHeader, shiftKey: true })).toEqual({ type: "move", dir: "up" });
  });
  test("Alt+ArrowDown and Alt+ArrowUp move the list and prevent the default", () => {
    expect(act("ArrowDown", { ...onHeader, altKey: true })).toEqual({ type: "move", dir: "down" });
    expect(act("ArrowUp", { ...onHeader, altKey: true })).toEqual({ type: "move", dir: "up" });
    expect(resolveKey(k("ArrowDown", { ...onHeader, altKey: true })).preventDefault).toBe(true);
  });
  test("the list move keys do nothing in Insert mode, on a control or in the Markdown view", () => {
    for (const o of [{ target: "field" }, { target: "control" }, { markdownView: true }] as const) {
      expect(act("J", { ...onHeader, ...o, shiftKey: true })).toBeNull();
      expect(act("ArrowDown", { ...onHeader, ...o, altKey: true })).toBeNull();
    }
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

describe("resolveKey: +, help and target none", () => {
  test("+ creates a list from a task, a header and no target", () => {
    for (const target of ["task", "header", "none"] as const) {
      expect(act("+", { target, shiftKey: true })).toEqual({ type: "new-list" });
    }
  });
  test("g? toggles the cheat sheet, and a bare ? does nothing", () => {
    expect(act("?", { pending: "g", shiftKey: true })).toEqual({ type: "toggle-help" });
    expect(act("?", { shiftKey: true })).toBeNull();
  });
  test("pressing Shift between g and ? keeps the prefix, in every context", () => {
    for (const o of [{}, { overlay: "cheatsheet" }, { markdownView: true }] as const) {
      expect(resolveKey(k("Shift", { pending: "g", shiftKey: true, ...o }))).toEqual({ action: null, pending: "g", preventDefault: false });
    }
  });
  test("Normal keys work with no focused target", () => {
    expect(act("j", { target: "none" })).toEqual({ type: "cursor", to: "next" });
    expect(act("x", { target: "none" })).toEqual({ type: "toggle" });
  });
});

describe("resolveKey: target field (Insert mode)", () => {
  const field = { target: "field" } as const;
  test("plain keys resolve to nothing and are not prevented", () => {
    for (const key of ["j", "x", "d", "g", "N", "+", "/", "?", " ", "Enter", "Delete", "Escape", "ArrowDown"]) {
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
    for (const key of ["j", "x", "Enter", " ", "d", "N", "+", "?", "ArrowDown", "Delete"]) {
      expect(resolveKey(k(key, control))).toEqual({ action: null, pending: "", preventDefault: false });
    }
  });
  test("undo and redo still work after a click on a button", () => {
    expect(act("z", { ...control, ctrlKey: true })).toEqual({ type: "undo" });
    expect(act("Z", { ...control, ctrlKey: true, shiftKey: true })).toEqual({ type: "redo" });
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
    for (const key of ["j", "x", "o", "e", "d", "g", "u", "h"]) {
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
  test("g? and Escape close it, and a bare ? does not", () => {
    expect(act("?", { ...cheat, pending: "g", shiftKey: true })).toEqual({ type: "toggle-help" });
    expect(act("?", { ...cheat, shiftKey: true })).toBeNull();
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
  test("plain keys are swallowed so that nothing behind the overlay reacts, browser shortcuts are not", () => {
    expect(resolveKey(k(" ", cheat)).preventDefault).toBe(true);
    expect(resolveKey(k("Tab", cheat)).preventDefault).toBe(true);
    expect(resolveKey(k("r", { ...cheat, ctrlKey: true })).preventDefault).toBe(false);
  });
  test("g still starts the g? prefix behind the overlay, and any other key drops it", () => {
    expect(resolveKey(k("g", cheat))).toEqual({ action: null, pending: "g", preventDefault: true });
    expect(resolveKey(k("a", { ...cheat, pending: "g" }))).toEqual({ action: null, pending: "", preventDefault: true });
  });
  test("a pending prefix is dropped", () => {
    expect(resolveKey(k("d", { ...cheat, pending: "d" })).action).toBeNull();
    expect(resolveKey(k("d", { ...cheat, pending: "d" })).pending).toBe("");
  });
  test("it takes precedence over the target kind", () => {
    expect(act("?", { ...cheat, pending: "g", target: "control", shiftKey: true })).toEqual({ type: "toggle-help" });
  });
});

describe("resolveKey: result shape", () => {
  test("every resolved action is a known Action type", () => {
    const a: Action | null = act("x");
    expect(a?.type).toBe("toggle");
  });
});

describe("resolveKey: Markdown view (PRD 5.11)", () => {
  const open = { markdownView: true } as const;
  test("sm toggles the view, whether it is open or not", () => {
    expect(resolveKey(k("s")).pending).toBe("s");
    expect(resolveKey(k("s", open)).pending).toBe("s");
    expect(act("m", { pending: "s" })).toEqual({ type: "toggle-markdown" });
    expect(act("m", { pending: "s", ...open })).toEqual({ type: "toggle-markdown" });
  });
  test("sm works on a header and with no focus", () => {
    expect(act("m", { pending: "s", ...onHeader })).toEqual({ type: "toggle-markdown" });
    expect(act("m", { pending: "s", target: "none" })).toEqual({ type: "toggle-markdown" });
  });
  test("gm does nothing any more", () => {
    expect(act("m", { pending: "g" })).toBeNull();
    expect(act("m", { pending: "g", ...open })).toBeNull();
  });
  test("a lone m does nothing", () => {
    expect(act("m")).toBeNull();
  });
  test("yy copies the view when it is open", () => {
    expect(resolveKey(k("y", open))).toEqual({ action: null, pending: "y", preventDefault: true });
    expect(resolveKey(k("y", { pending: "y", ...open }))).toEqual({
      action: { type: "copy-markdown" }, pending: "", preventDefault: true,
    });
  });
  test("y then another key cancels the prefix without an action", () => {
    const r = resolveKey(k("j", { pending: "y", ...open }));
    expect(r.action).toBeNull();
    expect(r.pending).toBe("");
  });
  test("task keys are ignored while the view is open", () => {
    for (const key of ["j", "k", "x", " ", "e", "E", "i", "Enter", "F2", "Delete", ">", "<", "J", "K", "o", "O", "a", "I", "A", "u", "U", "N", "+", "n", "h", "l", "H", "L", "G", "ArrowDown", "p"]) {
      expect(act(key, open)).toBeNull();
    }
  });
  test("c is not a prefix while the view is open, so cc does nothing", () => {
    expect(resolveKey(k("c", open))).toEqual({ action: null, pending: "", preventDefault: false });
    expect(act("c", { pending: "c", ...open })).toBeNull();
  });
  test("dd and gg are ignored while the view is open", () => {
    expect(act("d", open)).toBeNull();
    expect(resolveKey(k("d", open)).pending).toBe("");
    expect(act("g", { pending: "g", ...open })).toBeNull();
  });
  test("Alt+arrows and Ctrl+Z are ignored while the view is open", () => {
    expect(act("ArrowDown", { altKey: true, ...open })).toBeNull();
    expect(act("z", { ctrlKey: true, ...open })).toBeNull();
  });
  test("g? and sh keep working while the view is open, and H and L do nothing", () => {
    expect(act("H", { shiftKey: true, ...open })).toBeNull();
    expect(act("L", { shiftKey: true, ...open })).toBeNull();
    expect(act("?", { pending: "g", ...open })).toEqual({ type: "toggle-help" });
    expect(act("h", { pending: "s", ...open })).toEqual({ type: "toggle-siblings" });
    expect(act("h", { pending: "g", ...open })).toBeNull();
  });
  test("Escape closes the view, also from a focused button", () => {
    expect(act("Escape", open)).toEqual({ type: "toggle-markdown" });
    expect(act("Escape", { target: "control", ...open })).toEqual({ type: "toggle-markdown" });
  });
  test("Escape does nothing in Normal mode when the view is closed", () => {
    expect(act("Escape")).toBeNull();
  });
  test("the cheat sheet overlay still takes precedence over the view", () => {
    expect(act("Escape", { overlay: "cheatsheet", ...open })).toEqual({ type: "toggle-help" });
  });
});

describe("resolveKey: register keys (PRD 5.12)", () => {
  test("the first c sets the pending prefix without an action", () => {
    expect(resolveKey(k("c"))).toEqual({ action: null, pending: "c", preventDefault: true });
    expect(resolveKey(k("c", onHeader))).toEqual({ action: null, pending: "c", preventDefault: true });
  });
  test("c then c changes the task or the list", () => {
    expect(resolveKey(k("c", { pending: "c" }))).toEqual({ action: { type: "change" }, pending: "", preventDefault: true });
    expect(act("c", { pending: "c", ...onHeader })).toEqual({ type: "change" });
  });
  test("c then another key cancels the prefix without an action", () => {
    for (const key of ["j", "o", "x", "y", "p"]) {
      const r = resolveKey(k(key, { pending: "c" }));
      expect(r.action).toBeNull();
      expect(r.pending).toBe("");
    }
  });
  test("another prefix followed by c cancels", () => {
    for (const pending of ["g", "d", "y"] as const) expect(act("c", { pending })).toBeNull();
  });
  test("the first y sets the pending prefix, with the view open or not", () => {
    expect(resolveKey(k("y"))).toEqual({ action: null, pending: "y", preventDefault: true });
    expect(resolveKey(k("y", onHeader)).pending).toBe("y");
  });
  test("y then y yanks the task or the list", () => {
    expect(resolveKey(k("y", { pending: "y" }))).toEqual({ action: { type: "yank" }, pending: "", preventDefault: true });
    expect(act("y", { pending: "y", ...onHeader })).toEqual({ type: "yank" });
  });
  test("y then another key cancels the prefix without an action", () => {
    const r = resolveKey(k("j", { pending: "y" }));
    expect(r.action).toBeNull();
    expect(r.pending).toBe("");
  });
  test("p pastes, on a task and on a header", () => {
    expect(resolveKey(k("p"))).toEqual({ action: { type: "paste", at: "after" }, pending: "", preventDefault: true });
    expect(act("p", onHeader)).toEqual({ type: "paste", at: "after" });
  });
  test("P pastes before, on a task, on a header and with no target", () => {
    expect(resolveKey(k("P", { shiftKey: true }))).toEqual({ action: { type: "paste", at: "before" }, pending: "", preventDefault: true });
    expect(act("P", { shiftKey: true, ...onHeader })).toEqual({ type: "paste", at: "before" });
    expect(act("P", { shiftKey: true, target: "none" })).toEqual({ type: "paste", at: "before" });
  });
  test("P does nothing while the Markdown view is open", () => {
    expect(act("P", { shiftKey: true, markdownView: true })).toBeNull();
  });
  test("P after a pending prefix cancels it without an action", () => {
    for (const pending of ["c", "d", "y"] as const) expect(resolveKey(k("P", { shiftKey: true, pending })).action).toBeNull();
  });
  test("these keys do nothing in a field, in a control, in an overlay or with a modifier", () => {
    for (const o of [{ target: "field" }, { target: "control" }, { overlay: "cheatsheet" }, { ctrlKey: true }, { altKey: true }] as const) {
      expect(act("p", o)).toBeNull();
      expect(act("P", { shiftKey: true, ...o })).toBeNull();
      expect(act("c", { pending: "c", ...o })).toBeNull();
      // Ctrl+Y redoes, so it is left out of the yank check.
      if (!("ctrlKey" in o && o.ctrlKey)) expect(act("y", { pending: "y", ...o })).toBeNull();
    }
  });
  test("with no focused element the keys still resolve, so that the caller can ignore them", () => {
    expect(act("p", { target: "none" })).toEqual({ type: "paste", at: "after" });
  });
});

describe("resolveKey: cd (due date) and cL (list name)", () => {
  test("s and c set the pending prefix without an action", () => {
    expect(resolveKey(k("s"))).toEqual({ action: null, pending: "s", preventDefault: true });
    expect(resolveKey(k("c"))).toEqual({ action: null, pending: "c", preventDefault: true });
  });
  test("c then d on a task sets the due date and clears the prefix", () => {
    expect(resolveKey(k("d", { pending: "c" }))).toEqual({ action: { type: "set-due" }, pending: "", preventDefault: true });
  });
  test("s then d does nothing any more", () => {
    expect(resolveKey(k("d", { pending: "s" }))).toEqual({ action: null, pending: "", preventDefault: false });
  });
  test("s then another key does nothing and clears the prefix", () => {
    expect(resolveKey(k("x", { pending: "s" }))).toEqual({ action: null, pending: "", preventDefault: false });
  });
  test("cd has no effect on a header", () => {
    expect(act("d", { pending: "c", ...onHeader })).toBeNull();
  });
  test("cd and cL are ignored in the Markdown view, in a text field and behind the cheat sheet", () => {
    for (const o of [{ markdownView: true }, { target: "field" }, { overlay: "cheatsheet" }] as const) {
      expect(act("d", { pending: "c", ...o })).toBeNull();
      expect(act("L", { pending: "c", ...o })).toBeNull();
    }
  });
  test("cL changes the name of the list, from a task and from a header", () => {
    expect(resolveKey(k("L", { pending: "c" }))).toEqual({ action: { type: "change-list" }, pending: "", preventDefault: true });
    expect(act("L", { pending: "c", ...onHeader })).toEqual({ type: "change-list" });
  });
  test("cl on a task opens the list picker and clears the prefix", () => {
    expect(resolveKey(k("l", { pending: "c" }))).toEqual({ action: { type: "move-to-list" }, pending: "", preventDefault: true });
  });
  test("cl has no effect on a header", () => {
    expect(act("l", { pending: "c", ...onHeader })).toBeNull();
  });
  test("cl is ignored in the Markdown view, in a text field and behind the cheat sheet", () => {
    for (const o of [{ markdownView: true }, { target: "field" }, { overlay: "cheatsheet" }] as const) {
      expect(act("l", { pending: "c", ...o })).toBeNull();
    }
  });
  test("c then another key cancels the prefix", () => {
    expect(resolveKey(k("x", { pending: "c" }))).toEqual({ action: null, pending: "", preventDefault: false });
  });
});

describe("resolveKey: filters and views (PRD 5.14)", () => {
  const set = (text: string) => ({ type: "set-filter", text }) as const;
  const keys = [
    ["a", set("")],
    ["t", set("due:today,overdue")],
    ["w", set("due:week,overdue")],
    ["u", set("due:upcoming,overdue")],
    ["l", { type: "filter-list" }],
    ["x", set("is:done")],
    ["X", set("is:todo")],
    ["f", { type: "focus-filter" }],
    ["F", { type: "clear-focus-filter" }],
    ["s", { type: "filter-picker" }],
  ] as const;
  const press = (second: string, o: Partial<KeyInput> = {}) =>
    resolveKey(k(second, { pending: "f", shiftKey: second !== second.toLowerCase(), ...o }));

  test("f sets the prefix, and does not start anything alone", () => {
    expect(resolveKey(k("f"))).toEqual({ action: null, pending: "f", preventDefault: true });
    expect(resolveKey(k("f", onHeader)).pending).toBe("f");
  });

  test("the second key resolves the filter keys of the table", () => {
    for (const [second, action] of keys) {
      expect(press(second)).toEqual({ action, pending: "", preventDefault: true });
    }
  });

  test("the filter keys work on a header, with nothing focused and with the Markdown view open", () => {
    for (const [second, action] of keys) {
      expect(press(second, onHeader).action).toEqual(action);
      expect(press(second, { target: "none" }).action).toEqual(action);
      expect(press(second, { markdownView: true }).action).toEqual(action);
    }
  });

  test("the prefix is kept in the Markdown view", () => {
    expect(resolveKey(k("f", { markdownView: true })).pending).toBe("f");
  });

  test("F is not a prefix any more, and the other second keys of f are unassigned", () => {
    expect(resolveKey(k("F", { shiftKey: true }))).toEqual({ action: null, pending: "", preventDefault: false });
    expect(act("z", { pending: "f" })).toBeNull();
  });

  test("fF resolves to one clear-and-focus action, whatever the text, and ff stays a plain focus", () => {
    expect(press("F")).toEqual({ action: { type: "clear-focus-filter" }, pending: "", preventDefault: true });
    expect(act("f", { pending: "f" })).toEqual({ type: "focus-filter" }); // ff stays distinct
  });

  test("ga, gt, gw, gl, gf and gF do nothing any more", () => {
    for (const second of ["a", "t", "w", "l", "f", "F"]) expect(act(second, { pending: "g" })).toBeNull();
  });

  test("go opens the file picker, on a task, on a header, with nothing focused and in the Markdown view", () => {
    const expected = { action: { type: "file-picker" as const }, pending: "" as const, preventDefault: true };
    expect(resolveKey(k("o", { pending: "g" }))).toEqual(expected);
    expect(resolveKey(k("o", { pending: "g", ...onHeader }))).toEqual(expected);
    expect(resolveKey(k("o", { pending: "g", target: "none" }))).toEqual(expected);
    expect(resolveKey(k("o", { pending: "g", markdownView: true }))).toEqual(expected);
  });

  test("o alone still adds a task", () => {
    expect(act("o")).toEqual({ type: "add", at: "below" });
  });

  test("gh does nothing any more, and sh toggles the siblings", () => {
    expect(act("h", { pending: "g" })).toBeNull();
    expect(act("h", { pending: "s" })).toEqual({ type: "toggle-siblings" });
    expect(act("h", { pending: "s", ...onHeader })).toEqual({ type: "toggle-siblings" });
  });

  test("gg and sm still work", () => {
    expect(act("g", { pending: "g" })).toEqual({ type: "cursor", to: "first" });
    expect(act("m", { pending: "s" })).toEqual({ type: "toggle-markdown" });
  });

  test("the filter keys do nothing in a text field or behind the cheat sheet", () => {
    expect(act("t", { pending: "f", target: "field" })).toBeNull();
    expect(act("t", { pending: "f", overlay: "cheatsheet" })).toBeNull();
    expect(resolveKey(k("f", { overlay: "cheatsheet" }))).toEqual({ action: null, pending: "", preventDefault: true });
  });

  test("a prefix other than g does not start a view", () => {
    expect(act("a", { pending: "d" })).toBeNull();
    expect(act("w", { pending: "y" })).toBeNull();
  });

  test("moves, indent and outdent resolve as usual while a filter is active, for tasks and headers", () => {
    const move = (dir: "up" | "down") => ({ type: "move", dir }) as const;
    expect(act("J", { shiftKey: true })).toEqual(move("down"));
    expect(act("K", { shiftKey: true })).toEqual(move("up"));
    expect(act("ArrowDown", { altKey: true })).toEqual(move("down"));
    expect(act("ArrowUp", { altKey: true })).toEqual(move("up"));
    expect(act(">", { shiftKey: true })).toEqual({ type: "indent" });
    expect(act("<", { shiftKey: true })).toEqual({ type: "outdent" });
    expect(act("J", { shiftKey: true, ...onHeader })).toEqual(move("down"));
    expect(act("ArrowUp", { altKey: true, ...onHeader })).toEqual(move("up"));
  });

  test("the other task keys work as usual under a filter", () => {
    const f = {};
    expect(act("x", f)).toEqual({ type: "toggle" });
    expect(act("e", f)).toEqual({ type: "edit" });
    expect(act("E", { shiftKey: true, ...f })).toEqual({ type: "edit-start" });
    expect(act("i", f)).toBeNull();
    expect(act("p", f)).toEqual({ type: "paste", at: "after" });
    expect(act("P", { shiftKey: true, ...f })).toEqual({ type: "paste", at: "before" });
    expect(act("o", f)).toEqual({ type: "add", at: "below" });
    expect(act("d", { pending: "d", ...f })).toEqual({ type: "delete" });
    expect(act("d", { pending: "c", ...f })).toEqual({ type: "set-due" });
    expect(act("+", { shiftKey: true })).toEqual({ type: "new-list" });
  });

  test("the moves still work with no filter", () => {
    expect(act("J", { shiftKey: true })).toEqual({ type: "move", dir: "down" });
    expect(act("ArrowUp", { altKey: true })).toEqual({ type: "move", dir: "up" });
  });
});

describe("resolveKey: incremental search (PRD 5.15)", () => {
  const active = { search: true } as const;
  test("/ starts a search on a task, on a header and with nothing focused, active or not", () => {
    expect(resolveKey(k("/"))).toEqual({ action: { type: "search-start" }, pending: "", preventDefault: true });
    for (const o of [onHeader, { target: "none" }, active, { ...active, ...onHeader }] as const) {
      expect(act("/", o)).toEqual({ type: "search-start" });
    }
  });
  test("/ is typed as is in a text field and ignored on a control", () => {
    expect(resolveKey(k("/", { target: "field" }))).toEqual({ action: null, pending: "", preventDefault: false });
    expect(act("/", { target: "control" })).toBeNull();
  });
  test("/ is ignored in the Markdown view", () => {
    expect(act("/", { markdownView: true })).toBeNull();
    expect(act("/", { markdownView: true, ...active })).toBeNull();
  });
  test("n and N jump to the next and previous match while a search is active", () => {
    for (const o of [active, { ...active, ...onHeader }] as const) {
      expect(act("n", o)).toEqual({ type: "search-next" });
      expect(act("N", { ...o, shiftKey: true })).toEqual({ type: "search-prev" });
    }
    expect(resolveKey(k("n", active)).preventDefault).toBe(true);
  });
  test("n and N do nothing with no active search", () => {
    expect(resolveKey(k("n"))).toEqual({ action: null, pending: "", preventDefault: false });
    expect(act("N", { shiftKey: true })).toBeNull();
    expect(act("N", { shiftKey: true, ...onHeader })).toBeNull();
  });
  test("n and N do nothing in the Markdown view, in a field and behind the cheat sheet", () => {
    for (const o of [{ markdownView: true }, { target: "field" }, { overlay: "cheatsheet" }] as const) {
      expect(act("n", { ...o, ...active })).toBeNull();
      expect(act("N", { ...o, ...active, shiftKey: true })).toBeNull();
    }
  });
  test("Escape ends the active search in Normal mode, and does nothing with none", () => {
    expect(resolveKey(k("Escape", active))).toEqual({ action: { type: "search-end" }, pending: "", preventDefault: true });
    expect(act("Escape", { ...active, ...onHeader })).toEqual({ type: "search-end" });
    expect(resolveKey(k("Escape"))).toEqual({ action: null, pending: "", preventDefault: false });
  });
  test("Escape on a focused control still puts the focus back on the cursor", () => {
    expect(act("Escape", { target: "control", ...active })).toEqual({ type: "focus-cursor" });
  });
  test("Escape closes the Markdown view, whether a search is active or not", () => {
    expect(act("Escape", { markdownView: true, ...active })).toEqual({ type: "toggle-markdown" });
  });
  test("Escape cancels a pending prefix without ending the search", () => {
    expect(act("Escape", { pending: "g", ...active })).toBeNull();
  });
  test("Backspace does nothing in Normal mode, with or without a search", () => {
    expect(act("Backspace")).toBeNull();
    expect(act("Backspace", active)).toBeNull();
  });
  test("the other keys are unchanged while a search is active", () => {
    expect(act("j", active)).toEqual({ type: "cursor", to: "next" });
    expect(act("+", { ...active, shiftKey: true })).toEqual({ type: "new-list" });
  });
});

describe("resolveKey: gx opens a link (PRD 5.20)", () => {
  test("gx on a task with one link opens it and clears the prefix", () => {
    expect(resolveKey(k("x", { pending: "g", links: 1 }))).toEqual({ action: { type: "open-link" }, pending: "", preventDefault: true });
  });
  test("gx on a task with several links opens the link picker", () => {
    expect(act("x", { pending: "g", links: 3 })).toEqual({ type: "link-picker" });
  });
  test("gx on a task with no link does nothing and clears the prefix", () => {
    expect(resolveKey(k("x", { pending: "g", links: 0 })).action).toBeNull();
    expect(resolveKey(k("x", { pending: "g", links: 0 })).pending).toBe("");
  });
  test("gx on a header does nothing", () => {
    expect(act("x", { pending: "g", links: 2, ...onHeader })).toBeNull();
  });
  test("gx with no cursor does nothing", () => {
    expect(act("x", { pending: "g", links: 0, target: "none" })).toBeNull();
  });
  test("gx is ignored in the Markdown view, in a text field and behind the cheat sheet", () => {
    for (const o of [{ markdownView: true }, { target: "field" }, { overlay: "cheatsheet" }] as const) {
      expect(act("x", { pending: "g", links: 2, ...o })).toBeNull();
    }
  });
  test("g starts the prefix, and x alone still toggles the task", () => {
    expect(resolveKey(k("g")).pending).toBe("g");
    expect(act("x")).toEqual({ type: "toggle" });
  });
  test("gx works while a search is active", () => {
    expect(act("x", { pending: "g", links: 1, search: true })).toEqual({ type: "open-link" });
  });
});

describe("resolveKey: gX copies a link (PRD 5.20)", () => {
  test("gX on a task with one link copies it and clears the prefix", () => {
    expect(resolveKey(k("X", { pending: "g", links: 1 }))).toEqual({ action: { type: "copy-link" }, pending: "", preventDefault: true });
  });
  test("gX on a task with several links opens the picker in copy mode", () => {
    expect(act("X", { pending: "g", links: 3 })).toEqual({ type: "copy-link-picker" });
  });
  test("gX on a task with no link does nothing and clears the prefix", () => {
    const res = resolveKey(k("X", { pending: "g", links: 0 }));
    expect(res.action).toBeNull();
    expect(res.pending).toBe("");
  });
  test("gX on a header or with no cursor does nothing", () => {
    expect(act("X", { pending: "g", links: 2, ...onHeader })).toBeNull();
    expect(act("X", { pending: "g", links: 2, target: "none" })).toBeNull();
  });
  test("gX is ignored in the Markdown view, in a text field and behind the cheat sheet", () => {
    for (const o of [{ markdownView: true }, { target: "field" }, { overlay: "cheatsheet" }] as const) {
      expect(act("X", { pending: "g", links: 2, ...o })).toBeNull();
    }
  });
  test("gX works while a search is active", () => {
    expect(act("X", { pending: "g", links: 1, search: true })).toEqual({ type: "copy-link" });
  });
  test("X alone is not a link key", () => {
    expect(act("X", { links: 2 })).toBeNull();
  });
});

describe("resolveKey: the S prefix sorts by due date (PRD 5.21)", () => {
  test("the first S sets the pending prefix without an action", () => {
    expect(resolveKey(k("S"))).toEqual({ action: null, pending: "S", preventDefault: true });
    expect(resolveKey(k("S", onHeader)).pending).toBe("S");
  });
  test("Sl, SL and SA give the three sort actions on a task and on a header", () => {
    for (const o of [{}, onHeader]) {
      expect(resolveKey(k("l", { pending: "S", ...o }))).toEqual({ action: { type: "sort-list" }, pending: "", preventDefault: true });
      expect(act("L", { pending: "S", ...o })).toEqual({ type: "sort-lists" });
      expect(act("A", { pending: "S", ...o })).toEqual({ type: "sort-all" });
    }
  });
  test("with no cursor Sl still resolves, the view decides there is nothing to do", () => {
    expect(act("l", { pending: "S", target: "none" })).toEqual({ type: "sort-list" });
  });
  test("another key after S drops the prefix with no action", () => {
    const r = resolveKey(k("j", { pending: "S" }));
    expect(r.action).toBeNull();
    expect(r.pending).toBe("");
  });
  test("the three keys do nothing in the Markdown view, with no message", () => {
    for (const key of ["l", "L", "A"]) expect(act(key, { pending: "S", markdownView: true })).toBeNull();
  });
  test("S does not start a prefix in the Markdown view", () => {
    expect(resolveKey(k("S", { markdownView: true })).pending).toBe("");
  });
  test("the sort keys are ignored in a text field and behind the cheat sheet", () => {
    expect(act("l", { pending: "S", target: "field" })).toBeNull();
    expect(act("l", { pending: "S", overlay: "cheatsheet" })).toBeNull();
  });
  test("l, L and A alone keep their meaning", () => {
    expect(act("l")).toEqual({ type: "cursor", to: "next-header" });
    expect(act("L")).toEqual({ type: "move-list", dir: "down" });
    expect(act("A", { shiftKey: true })).toEqual({ type: "add", at: "first-child" });
  });
});

