// The search bar above the footer (PRD 5.15): a plain input while typing, then a muted `/query  3/12` line while the search stays active.
import { el } from "./dom";

export type SearchBarActions = {
  /** The query changed while typing. */
  input(query: string): void;
  /** Enter or Escape on a non-empty query: the input closes and the search stays active. `refocus` is false for a blur, which leaves the focus where the user put it. */
  close(refocus: boolean): void;
  /** Enter, Escape or Backspace on an empty query: the search ends. */
  end(refocus: boolean): void;
};

export function createSearchBar(actions: SearchBarActions) {
  const input = el("input", { type: "text", class: "search-input", "aria-label": "Search", hidden: true, autocomplete: "off", spellcheck: "false" });
  const line = el("div", { class: "search-line", role: "status", hidden: true });
  const root = el("div", { class: "search-bar", hidden: true }, input, line);

  let finished = false; // hiding the focused input fires a blur, which must not close twice
  const leave = (run: () => void) => {
    if (finished) return;
    finished = true;
    run();
  };
  input.addEventListener("input", () => actions.input(input.value));
  input.addEventListener("keydown", (e) => {
    const empty = input.value === "";
    if (e.key === "Enter" || e.key === "Escape" || (e.key === "Backspace" && empty)) {
      e.preventDefault();
      leave(() => (empty ? actions.end(true) : actions.close(true)));
    }
  });
  input.addEventListener("blur", () => leave(() => (input.value === "" ? actions.end(false) : actions.close(false))));

  return {
    el: root,
    isFocused: () => document.activeElement === input,
    /** Shows an empty input with the focus. */
    open() {
      finished = false;
      input.value = "";
      root.hidden = false;
      input.hidden = false;
      line.hidden = true;
      input.focus();
    },
    /** Replaces the input by the muted line. The caller moves the focus. */
    showLine(text: string) {
      finished = true;
      root.hidden = false;
      input.hidden = true;
      line.hidden = false;
      line.textContent = text;
    },
    /** Updates the line while the input is open, or the muted line while it is closed (the input shows the query by itself). */
    setLine(text: string) {
      line.textContent = text;
    },
    hide() {
      finished = true;
      root.hidden = true;
      input.hidden = true;
      line.hidden = true;
      input.value = "";
    },
  };
}
