// Cheat sheet: static overlay listing every key of PRD 5.9. Keys are handled by the global key handler.
import { el } from "./dom";

/** A row is its keys and what they do. Keys are drawn as one chip each, split at " / " and ", "; a grammar row is drawn as code. */
type Row = [keys: string, text: string, grammar?: true];
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: "Navigation",
    rows: [
      ["j / k, ↓ / ↑", "next / previous row or list header"],
      ["gg / G", "first / last"],
      ["h / l", "previous / next list header"],
    ],
  },
  {
    title: "Task keys",
    rows: [
      ["x, Space", "toggle done"],
      ["i, Enter, F2", "edit the task"],
      ["dd, Delete", "delete with its subtasks (fills the register)"],
      ["yy", "copy into the register, without deleting"],
      ["cc", "clear the text to retype it (Escape restores it)"],
      ["cL", "clear the name of its list to retype it"],
      ["cd", "change the due date: edit the date with its popup"],
      ["p", "paste the register below, after the subtasks"],
      ["> / <", "indent / outdent, over the visible rows under a filter"],
      ["J / K, Alt+↓ / Alt+↑", "move down / up, over the visible rows under a filter"],
      ["H / L", "move the whole list up / down"],
      ["u / U, Ctrl+Z / Ctrl+Shift+Z", "undo / redo"],
    ],
  },
  {
    title: "List header keys",
    rows: [
      ["i, Enter", "rename the list"],
      ["dd", "delete the list at once (fills the register)"],
      ["yy", "copy the list into the register"],
      ["cc, cL", "clear the name to retype it (cL also works from a task)"],
      ["p", "paste a task first, or a list after this one"],
      ["J / K, Alt+↓ / Alt+↑", "move the list down / up, over the visible lists under a filter"],
      ["H / L", "move the list up / down, from a header or a task"],
      ["+", "new list, from anywhere (clears the filter)"],
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
    title: "Filters and views",
    rows: [
      ["gf", "focus the filter bar (Enter or Escape applies)"],
      ["ga / gt / gw", "all / due today or overdue / due this week or overdue"],
      ["gl", "replace the filter with list:, with a popup of the lists"],
      ["gF", "saved filters (dd deletes one)"],
      ["go", "open another file of the Vault, or create one"],
      ["sh", "tasks with a matching subtask: show all their subtasks / only the matching ones"],
      ["words", "match the task text, ignoring case", true],
      ["list:name due:today|week|overdue|DATE is:done|todo", "terms are ANDed, commas inside a term are OR", true],
      ["list:\"two words\"", "quote a name with spaces", true],
      ["checking", "sets a due date to today, keeping the old one as (was …)", true],
    ],
  },
  {
    title: "Search",
    rows: [
      ["/", "search the visible rows as you type (Enter or Escape keeps it)"],
      ["n / N", "next / previous match, wrapping"],
      ["Escape", "end the search"],
    ],
  },
  {
    title: "Markdown view",
    rows: [
      ["sm", "open / close the Markdown view"],
      ["yy", "copy the Markdown (view open)"],
      ["Escape", "close the view"],
    ],
  },
  {
    title: "Other",
    rows: [
      ["Escape", "commit and leave Insert mode"],
      ["Enter (Insert)", "commit and add a sibling below"],
      ["g?", "open / close this cheat sheet"],
    ],
  },
];

function renderKeys(keys: string, grammar?: true): Node[] {
  if (grammar) return [el("code", {}, keys)];
  return keys.split(/( \/ |, )/).map((part) => (part === " / " || part === ", " ? el("span", { class: "cheatsheet-sep" }, part.trim()) : el("kbd", {}, part)));
}

export function createCheatsheet(): { el: HTMLElement; open(): void; close(): void; isOpen(): boolean } {
  const panel = el("div", { class: "cheatsheet-panel", role: "dialog", "aria-label": "Keyboard shortcuts", "aria-modal": "true" });
  panel.append(el("h2", { class: "cheatsheet-title" }, "Keyboard shortcuts"));
  const columns = el("div", { class: "cheatsheet-groups" });
  for (const group of GROUPS) {
    const dl = el("dl", { class: "cheatsheet-list" });
    for (const [keys, text, grammar] of group.rows) dl.append(el("dt", {}, ...renderKeys(keys, grammar)), el("dd", {}, text));
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
