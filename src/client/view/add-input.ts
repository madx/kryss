// "Add a task" input: Enter adds, Escape runs `onCancel` when given.
import { el } from "./dom";

/** `key` becomes `data-add`, which the app uses to put the focus back after a re-render. */
export function renderAddInput(key: string, placeholder: string, onAdd: (text: string) => void, onCancel?: () => void): HTMLInputElement {
  const input = el("input", { type: "text", class: "add-input", placeholder, "data-add": key, "aria-label": placeholder });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim() !== "") {
      e.preventDefault();
      onAdd(input.value);
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  });
  return input;
}
