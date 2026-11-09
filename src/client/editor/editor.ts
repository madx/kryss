// Single-line CodeMirror 6 editor with live preview, created when a task enters editing and destroyed when it leaves.
import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { livePreview } from "./live-preview";
import { settleDecision, toSingleLine } from "./text";
import "./editor.css";

let active = 0;

/** The open editors, so that a re-render can settle them before their host is detached. */
const open = new Set<{ host: HTMLElement; original: string; finish: (commit: boolean) => void }>();

/**
 * Closes every open editor before a content render replaces the DOM, so none is detached without `finish`.
 * `currentText(host)` returns the task text now in the document for the row holding `host` (undefined if gone).
 * An editor whose task is unchanged is committed, otherwise discarded (see `settleDecision`).
 */
export function settleEditors(currentText: (host: HTMLElement) => string | undefined): void {
  for (const e of [...open]) e.finish(settleDecision(e.original, currentText(e.host)) === "commit");
  if (open.size === 0) active = 0;
}

/** True while an editor exists. The global undo (Ctrl+Z) must not run then: CodeMirror has its own history. */
export function isEditing(): boolean {
  return active > 0;
}

/**
 * Replaces the content of `host` with the editor for `text`.
 * `done(newText)` is called once on Enter or blur, `done(null)` once on Escape, after the editor was destroyed.
 * Tab and Shift+Tab are not bound, so the browser moves the focus (which commits through blur).
 * With `at` (viewport coordinates of a click), the cursor goes to the closest position, otherwise to the end.
 */
export function createEditor(
  host: HTMLElement,
  text: string,
  done: (result: string | null) => void,
  at?: { x: number; y: number },
): void {
  if (host.querySelector(".cm-editor")) return;
  let view: EditorView | null = null;
  const entry = { host, original: text, finish: (commit: boolean) => finish(commit) };
  const finish = (commit: boolean) => {
    if (!view) return;
    const v = view;
    view = null; // later events (blur while destroying) do nothing
    open.delete(entry);
    const result = commit ? v.state.doc.toString() : null;
    active--;
    v.destroy();
    done(result);
  };

  // Line breaks, from paste, drop or any command, are replaced by spaces (same length, so selections stay valid).
  const singleLine = EditorState.transactionFilter.of((tr) => {
    let multi = false;
    tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
      if (inserted.lines > 1) multi = true;
    });
    if (!multi) return tr;
    const changes: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((from, to, _fb, _tb, inserted) => {
      changes.push({ from, to, insert: toSingleLine(inserted.toString()) });
    });
    return [{ changes, selection: tr.selection, scrollIntoView: tr.scrollIntoView }];
  });

  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: toSingleLine(text),
      selection: EditorSelection.cursor(text.length),
      extensions: [
        singleLine,
        history(),
        livePreview,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Edit task" }),
        keymap.of([
          { key: "Enter", run: () => (finish(true), true) },
          { key: "Escape", run: () => (finish(false), true) },
          ...historyKeymap,
          ...standardKeymap,
        ]),
        EditorView.domEventHandlers({ blur: () => void finish(true) }),
      ],
    }),
  });
  active++;
  open.add(entry);
  const pos = at ? view.posAtCoords(at) : null;
  if (pos !== null) view.dispatch({ selection: EditorSelection.cursor(pos) });
  view.focus();
}
