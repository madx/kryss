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
  target: "task", pending: "", overlay: "none", markdownView: false, ...o,
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
  test("plain keys are swallowed so that nothing behind the overlay reacts, browser shortcuts are not", () => {
    expect(resolveKey(k(" ", cheat)).preventDefault).toBe(true);
    expect(resolveKey(k("Tab", cheat)).preventDefault).toBe(true);
    expect(resolveKey(k("r", { ...cheat, ctrlKey: true })).preventDefault).toBe(false);
  });
  test("a pending prefix is dropped", () => {
    expect(resolveKey(k("d", { ...cheat, pending: "d" })).action).toBeNull();
    expect(resolveKey(k("d", { ...cheat, pending: "d" })).pending).toBe("");
  });
  test("it takes precedence over the target kind", () => {
    expect(act("?", { ...cheat, target: "control", shiftKey: true })).toEqual({ type: "toggle-help" });
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
  test("gm toggles the view, whether it is open or not", () => {
    expect(resolveKey(k("g")).pending).toBe("g");
    expect(act("m", { pending: "g" })).toEqual({ type: "toggle-markdown" });
    expect(act("m", { pending: "g", ...open })).toEqual({ type: "toggle-markdown" });
  });
  test("gm works on a header and with no focus", () => {
    expect(act("m", { pending: "g", ...onHeader })).toEqual({ type: "toggle-markdown" });
    expect(act("m", { pending: "g", target: "none" })).toEqual({ type: "toggle-markdown" });
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
    for (const key of ["j", "k", "x", " ", "i", "Enter", "F2", "Delete", ">", "<", "J", "K", "o", "O", "a", "I", "A", "u", "U", "N", "h", "l", "G", "ArrowDown", "p"]) {
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
  test("H, L and ? keep working while the view is open", () => {
    expect(act("H", { shiftKey: true, ...open })).toEqual({ type: "view", dir: "prev" });
    expect(act("L", { shiftKey: true, ...open })).toEqual({ type: "view", dir: "next" });
    expect(act("?", open)).toEqual({ type: "toggle-help" });
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
    for (const key of ["j", "o", "d", "y", "p"]) {
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
    expect(resolveKey(k("p"))).toEqual({ action: { type: "paste" }, pending: "", preventDefault: true });
    expect(act("p", onHeader)).toEqual({ type: "paste" });
  });
  test("these keys do nothing in a field, in a control, in an overlay or with a modifier", () => {
    for (const o of [{ target: "field" }, { target: "control" }, { overlay: "cheatsheet" }, { ctrlKey: true }, { altKey: true }] as const) {
      expect(act("p", o)).toBeNull();
      expect(act("c", { pending: "c", ...o })).toBeNull();
      // Ctrl+Y redoes, so it is left out of the yank check.
      if (!("ctrlKey" in o && o.ctrlKey)) expect(act("y", { pending: "y", ...o })).toBeNull();
    }
  });
  test("with no focused element the keys still resolve, so that the caller can ignore them", () => {
    expect(act("p", { target: "none" })).toEqual({ type: "paste" });
  });
});

describe("resolveKey: sd (due date)", () => {
  test("s sets the pending prefix without an action", () => {
    expect(resolveKey(k("s"))).toEqual({ action: null, pending: "s", preventDefault: true });
  });
  test("s then d on a task sets the due date and clears the prefix", () => {
    expect(resolveKey(k("d", { pending: "s" }))).toEqual({ action: { type: "set-due" }, pending: "", preventDefault: true });
  });
  test("s then another key does nothing and clears the prefix", () => {
    expect(resolveKey(k("x", { pending: "s" }))).toEqual({ action: null, pending: "", preventDefault: false });
  });
  test("sd has no effect on a header", () => {
    expect(act("d", { pending: "s", ...onHeader })).toBeNull();
  });
  test("sd is ignored in the Markdown view and in a text field", () => {
    expect(act("d", { pending: "s", markdownView: true })).toBeNull();
    expect(act("s", { markdownView: true })).toBeNull();
    expect(act("s", { target: "field" })).toBeNull();
  });
  test("sd is ignored while the cheat sheet is open", () => {
    expect(act("d", { pending: "s", overlay: "cheatsheet" })).toBeNull();
  });
});
