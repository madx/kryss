// The single seam between the task rows and the editor: delegates to the CodeMirror editor.
import { createEditor, isEditing, settleEditors, type EditEnd, type EditorOptions } from "../editor/editor";

export { isEditing, settleEditors };
export type { EditEnd };

/**
 * Replaces the content of `host` with an editor for `text`.
 * Calls `done(newText, how)` on commit (Enter, Escape or blur), or `done(null, "settle")` when a re-render discards it.
 * The caller re-renders the host afterwards (the editor does not restore it).
 */
export function startEdit(host: HTMLElement, text: string, done: (result: string | null, how: EditEnd) => void, options?: EditorOptions): void {
  createEditor(host, text, done, options);
}
