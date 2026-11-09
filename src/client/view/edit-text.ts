// Fallback in-place text editor: a plain <input>. Enter commits, Escape cancels, blur commits.
// This module is the single seam the CodeMirror editor will replace: keep the signature.
import { el } from "./dom";

/**
 * Replaces the content of `host` with an editor for `text`.
 * Calls `done(newText)` on commit, or `done(null)` on cancel.
 * The caller re-renders the host afterwards (the editor does not restore it).
 */
export function startEdit(host: HTMLElement, text: string, done: (result: string | null) => void): void {
  if (host.querySelector("input.edit-input")) return;
  const input = el("input", { type: "text", class: "edit-input", value: text, "aria-label": "Edit task" });
  let finished = false;
  const finish = (result: string | null) => {
    if (finished) return;
    finished = true;
    done(result);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
    }
    e.stopPropagation(); // keys typed in the editor never reach the row shortcuts
  });
  input.addEventListener("blur", () => finish(input.value));
  host.replaceChildren(input);
  input.focus();
  input.select();
}
