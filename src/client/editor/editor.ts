// Single-line CodeMirror 6 editor with live preview, created when a task enters editing and destroyed when it leaves.
import { acceptCompletion } from "@codemirror/autocomplete";
import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { dueExtensions, resolveOnCommit, startCompletion } from "./due";
import { wikilinkPreview } from "./wikilink";
import { linkPaste } from "./link-paste";
import { livePreview } from "./live-preview";
import { singleLine } from "./single-line";
import { typingAids, typingKeymap } from "./typing";
import { settleDecision, toSingleLine } from "./text";
import "./editor.css";

let active = 0;

/** The open editors, so that a re-render can settle them before their host is detached. */
const open = new Set<{ host: HTMLElement; original: string; finish: (commit: boolean, how?: EditEnd) => void }>();

/**
 * Closes every open editor before a content render replaces the DOM, so none is detached without `finish`.
 * `currentText(host)` returns the task text now in the document for the row holding `host` (undefined if gone).
 * An editor whose task is unchanged is committed, otherwise discarded (see `settleDecision`).
 */
export function settleEditors(currentText: (host: HTMLElement) => string | undefined): void {
  for (const e of [...open]) e.finish(settleDecision(e.original, currentText(e.host)) === "commit", "settle");
  if (open.size === 0) active = 0;
}

/** True while an editor exists. The global undo (Ctrl+Z) must not run then: CodeMirror has its own history. */
export function isEditing(): boolean {
  return active > 0;
}

/**
 * Replaces the content of `host` with the editor for `text`.
 * `done(newText, how)` is called once on Enter, Escape or blur (all commit), after the editor was destroyed.
 * `done(null, "settle")` means a re-render discarded it.
 * Tab and Shift+Tab are not bound, so the browser moves the focus (which commits through blur).
 * With `at` (viewport coordinates of a click), the cursor goes to the closest position, otherwise to the end.
 */
export type EditEnd = "enter" | "escape" | "blur" | "settle";
export type EditorOptions = {
  at?: { x: number; y: number };
  /** Enter on an empty text does nothing (new tasks). */
  keepOnEmptyEnter?: boolean;
  /** Text shown in the editor when it differs from `text` (`cd` appends ` ->`). `text` stays the task's own text. */
  initial?: string;
  /** Selection range at the start, instead of the caret at the end (`cd` selects the date). */
  select?: { from: number; to: number };
  /** Caret before the first character, instead of after the last (`E`). */
  caretAtStart?: boolean;
  /** Opens the due date popup right away (`cd`). */
  openPopup?: boolean;
};

export function createEditor(
  host: HTMLElement,
  text: string,
  done: (result: string | null, how: EditEnd) => void,
  options: EditorOptions = {},
): void {
  const { at, keepOnEmptyEnter, initial, select, openPopup, caretAtStart } = options;
  const shown = initial ?? text;
  if (host.querySelector(".cm-editor")) return;
  let view: EditorView | null = null;
  host.replaceChildren(); // the editor takes the place of the rendered text
  const entry = { host, original: text, finish: (commit: boolean, how: EditEnd = "settle") => finish(commit, how) };
  const finish = (commit: boolean, how: EditEnd) => {
    if (!view) return;
    const v = view;
    view = null; // later events (blur while destroying) do nothing
    open.delete(entry);
    const result = commit ? resolveOnCommit(v.state.doc.toString()) : null;
    active--;
    v.destroy();
    done(result, how);
  };

  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: toSingleLine(shown),
      selection: select ? EditorSelection.range(select.from, select.to) : EditorSelection.cursor(caretAtStart ? 0 : shown.length),
      extensions: [
        singleLine,
        history(),
        livePreview,
        wikilinkPreview,
        dueExtensions,
        linkPaste,
        typingAids,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Edit task" }),
        keymap.of([
          ...typingKeymap,
          {
            key: "Enter",
            run: () => {
              if (!(keepOnEmptyEnter && view?.state.doc.toString().trim() === "")) finish(true, "enter");
              return true;
            },
          },
          { key: "Tab", run: acceptCompletion }, // with the popup closed it does nothing, and the focus moves
          { key: "Escape", run: () => (finish(true, "escape"), true) },
          ...historyKeymap,
          ...standardKeymap,
        ]),
        EditorView.domEventHandlers({ blur: () => void finish(true, "blur") }),
      ],
    }),
  });
  active++;
  open.add(entry);
  const pos = at ? view.posAtCoords(at, false) : null;
  if (pos !== null) view.dispatch({ selection: EditorSelection.cursor(pos) });
  view.focus();
  if (openPopup) startCompletion(view);
}
