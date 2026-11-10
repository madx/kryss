// Cheat sheet: static overlay listing every key of PRD 5.9. Keys are handled by the global key handler.
import { el } from "./dom";

type Group = { title: string; rows: [string, string][] };

const GROUPS: Group[] = [
  {
    title: "Navigation",
    rows: [
      ["j / k, ↓ / ↑", "next / previous row or list header"],
      ["gg / G", "first / last"],
      ["h / l", "previous / next list header (All view)"],
      ["H / L", "previous / next view"],
    ],
  },
  {
    title: "Task keys",
    rows: [
      ["x, Space", "toggle done"],
      ["i, Enter, F2", "edit the task"],
      ["dd, Delete", "delete with its subtasks"],
      ["> / <", "indent / outdent"],
      ["J / K, Alt+↓ / Alt+↑", "move down / up"],
      ["u / U, Ctrl+Z / Ctrl+Shift+Z", "undo / redo"],
    ],
  },
  {
    title: "List header keys",
    rows: [
      ["i, Enter", "rename the list"],
      ["dd", "delete the list (y / Enter confirm, n / Escape cancel)"],
      ["N", "new list, from anywhere"],
    ],
  },
  {
    title: "Add",
    rows: [
      ["o / O", "sibling below / above"],
      ["a", "last subtask (sibling below on a subtask)"],
      ["I / A", "first / last subtask (of the parent on a subtask)"],
      ["o, a, I (header)", "first task of the list"],
      ["A (header)", "last task of the list"],
    ],
  },
  {
    title: "Other",
    rows: [
      ["Escape", "commit and leave Insert mode"],
      ["Enter (Insert)", "commit and add a sibling below"],
      ["?", "open / close this cheat sheet"],
    ],
  },
];

export function createCheatsheet(): { el: HTMLElement; open(): void; close(): void; isOpen(): boolean } {
  const panel = el("div", { class: "cheatsheet-panel", role: "dialog", "aria-label": "Keyboard shortcuts", "aria-modal": "true" });
  panel.append(el("h2", { class: "cheatsheet-title" }, "Keyboard shortcuts"));
  const columns = el("div", { class: "cheatsheet-groups" });
  for (const group of GROUPS) {
    const dl = el("dl", { class: "cheatsheet-list" });
    for (const [keys, text] of group.rows) dl.append(el("dt", {}, el("kbd", {}, keys)), el("dd", {}, text));
    columns.append(el("section", { class: "cheatsheet-group" }, el("h3", {}, group.title), dl));
  }
  panel.append(columns);

  const backdrop = el("div", { class: "cheatsheet-backdrop", hidden: true }, panel);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.hidden = true;
  });
  return {
    el: backdrop,
    open: () => { backdrop.hidden = false; },
    close: () => { backdrop.hidden = true; },
    isOpen: () => !backdrop.hidden,
  };
}
