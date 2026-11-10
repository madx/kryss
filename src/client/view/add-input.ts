// Quiet add line (plus icon and input): Enter adds, Escape runs `onCancel` when given.
import { el } from "./dom";
import { plusIcon } from "./icons";

/**
 * `key` becomes `data-add`, which the app uses to put the focus back after a re-render.
 * Half-typed text is kept in `drafts` under `key`, so it survives a re-render.
 * Returns the `.add-line` wrapper, the input is inside it.
 */
export function renderAddInput(
  key: string,
  placeholder: string,
  drafts: Map<string, string>,
  onAdd: (text: string) => void,
  onCancel?: () => void,
): HTMLElement {
  const input = el("input", { type: "text", class: "add-input", placeholder, "data-add": key, "aria-label": placeholder });
  input.value = drafts.get(key) ?? "";
  input.addEventListener("input", () => drafts.set(key, input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim() !== "") {
      e.preventDefault();
      const text = input.value;
      drafts.delete(key);
      onAdd(text);
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      drafts.delete(key);
      onCancel();
    }
  });
  return el("div", { class: "add-line" }, plusIcon(), input);
}
