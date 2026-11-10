// Inline list name input: Enter, Escape and a blur commit a non-empty name and cancel an empty one, like the task editor. Used to create and rename lists.
import { el } from "./dom";

export type NameInputActions = { submit(name: string): void; cancel(): void; input(draft: string): void };

export function renderNameInput(initial: string, label: string, actions: NameInputActions): HTMLInputElement {
  const input = el("input", { type: "text", class: "name-input", "data-name-input": "", placeholder: label, "aria-label": label });
  input.value = initial;
  let finished = false; // removing the focused input fires a blur, which must not finish twice
  const finish = (run: () => void) => {
    if (finished) return;
    finished = true;
    run();
  };
  input.addEventListener("input", () => actions.input(input.value));
  const commit = () => finish(input.value.trim() !== "" ? () => actions.submit(input.value) : actions.cancel);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.key === "Enter" && input.value.trim() !== "")) {
      e.preventDefault();
      commit();
    }
  });
  input.addEventListener("blur", commit);
  return input;
}
