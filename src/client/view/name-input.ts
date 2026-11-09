// Inline list name input: Enter submits, Escape or a blur cancels. Used to create and rename lists.
import { el } from "./dom";

export type NameInputActions = { submit(name: string): void; cancel(): void; input(draft: string): void };

export function renderNameInput(initial: string, label: string, actions: NameInputActions): HTMLInputElement {
  const input = el("input", { type: "text", class: "name-input", "data-name-input": "", placeholder: label, "aria-label": label });
  input.value = initial;
  let finished = false; // removing the focused input fires a blur, which must not cancel twice
  const finish = (run: () => void) => {
    if (finished) return;
    finished = true;
    run();
  };
  input.addEventListener("input", () => actions.input(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim() !== "") {
      e.preventDefault();
      finish(() => actions.submit(input.value));
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(actions.cancel);
    }
  });
  input.addEventListener("blur", () => finish(actions.cancel));
  return input;
}
