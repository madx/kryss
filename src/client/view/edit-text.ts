// The single seam between the task rows and the editor: delegates to the CodeMirror editor.
import { createEditor, isEditing, settleEditors } from "../editor/editor";

export { isEditing, settleEditors };

/**
 * Replaces the content of `host` with an editor for `text`.
 * Calls `done(newText)` on commit (Enter or blur), or `done(null)` on cancel (Escape).
 * The caller re-renders the host afterwards (the editor does not restore it).
 */
export function startEdit(host: HTMLElement, text: string, done: (result: string | null) => void, at?: { x: number; y: number }): void {
  createEditor(host, text, done, at);
}
