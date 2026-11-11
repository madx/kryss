// The search input above the footer (PRD 5.15), shown while typing. The `/query  3/12` text lives in the footer statusline.
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
  const root = el("div", { class: "search-bar", hidden: true }, input);

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
  input.addEventListener("blur", () => {
    if (!document.hasFocus()) return; // the window lost the focus (alt-tab): the input stays open
    leave(() => (input.value === "" ? actions.end(false) : actions.close(false)));
  });

  return {
    el: root,
    isFocused: () => document.activeElement === input,
    /** Shows an empty input with the focus. */
    open() {
      finished = false;
      input.value = "";
      root.hidden = false;
      input.hidden = false;
      input.focus();
    },
    /** Hides the input (the search may stay active). The caller moves the focus. */
    hide() {
      finished = true;
      root.hidden = true;
      input.hidden = true;
      input.value = "";
    },
  };
}
