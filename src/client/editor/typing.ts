// CodeMirror part of the typing aids (PRD 5.22): the decisions are the pure functions of `logic/typing.ts`.
import { EditorSelection, type EditorState, MapMode, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import { composedEdit, emptyPairRemoval, linkEdit, toggleMarker, typedEdit, type Edit, type Pair } from "../logic/typing";

/** `drop` is a pair position before the change, `add` a pair position after it. */
const trackPairs = StateEffect.define<{ drop?: number; add?: Pair }>();

/** The pairs inserted by the editor and not stepped over yet, followed through the document changes. */
const pairsField = StateField.define<readonly Pair[]>({
  create: () => [],
  update(pairs, tr) {
    let next = pairs;
    for (const e of tr.effects) if (e.is(trackPairs) && e.value.drop !== undefined) next = next.filter((p) => p.at !== e.value.drop);
    if (tr.docChanged) {
      next = next.flatMap((p) => {
        const at = tr.changes.mapPos(p.at, 1, MapMode.TrackDel);
        return at !== null && tr.newDoc.sliceString(at, at + p.closer.length) === p.closer ? [{ ...p, at }] : [];
      });
    }
    for (const e of tr.effects) if (e.is(trackPairs) && e.value.add) next = [...next.filter((p) => p.at !== e.value.add!.at), e.value.add];
    return next;
  },
});

/** One transaction for the whole edit, so one undo step of the editor. */
function apply(view: EditorView, edit: Edit, userEvent: string): void {
  view.dispatch({
    changes: edit.from === edit.to && edit.insert === "" ? undefined : { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.single(edit.anchor, edit.head),
    effects: edit.drop !== undefined || edit.track ? trackPairs.of({ drop: edit.drop, add: edit.track }) : [],
    userEvent,
    scrollIntoView: true,
  });
}

function single(state: EditorState): { from: number; to: number } | null {
  return state.selection.ranges.length === 1 ? state.selection.main : null;
}

/**
 * Typed characters: pairs, growth, step over a closer, and wrapping a selection. Anything else is the native input.
 * While a composition is running (a dead key such as `~` or the backtick on an AZERTY keyboard) the browser owns the text, so nothing is done here, see `composition`.
 */
const typed = EditorView.inputHandler.of((view, from, to, text) => {
  const sel = single(view.state);
  if (!sel || sel.from !== from || sel.to !== to || view.composing) return false;
  const edit = typedEdit(view.state.doc.toString(), from, to, text, view.state.field(pairsField));
  if (!edit) return false;
  apply(view, edit, "input.type");
  return true;
});

/**
 * A dead key is composed, so the editor holds the character when the composition ends, and no typed character reaches `typed`.
 * The document is remembered when the composition starts, and once it has ended, `composedEdit` decides as for a typed character.
 * The wait lets CodeMirror read the composed text first, and the decision is dropped if anything else changed meanwhile.
 */
const composition = EditorView.domEventHandlers({
  compositionstart(_event, view) {
    const sel = single(view.state);
    started = sel && sel.from === sel.to ? { doc: view.state.doc.toString(), at: sel.from } : null;
  },
  compositionend(_event, view) {
    const from = started;
    started = null;
    if (!from) return;
    setTimeout(() => {
      const sel = single(view.state);
      if (!view.dom.isConnected || view.compositionStarted || !sel || sel.from !== sel.to || sel.from !== from.at + 1) return;
      const edit = composedEdit(from.doc, view.state.doc.toString(), from.at, view.state.field(pairsField));
      if (edit) apply(view, edit, "input.type");
    }, 20);
  },
});
let started: { doc: string; at: number } | null = null;

function toggle(marker: "**" | "_"): (view: EditorView) => boolean {
  return (view) => {
    const sel = single(view.state);
    if (sel) apply(view, toggleMarker(view.state.doc.toString(), sel.from, sel.to, marker), "input.format");
    return true; // the browser's own action (bookmarks for Ctrl+B) is always prevented
  };
}

/** Ctrl+K reads the clipboard once, and inserts only if the editor and its selection are as they were at the keystroke. */
function link(view: EditorView): boolean {
  const { doc, selection } = view.state;
  const sel = single(view.state);
  if (!sel) return true;
  const read = navigator.clipboard?.readText?.bind(navigator.clipboard);
  const text: Promise<string | null> = read ? read().catch(() => null) : Promise.resolve(null);
  void text.then((clipboard) => {
    if (!view.dom.isConnected || !view.state.doc.eq(doc) || !view.state.selection.eq(selection)) return;
    apply(view, linkEdit(doc.toString(), sel.from, sel.to, clipboard), "input.format");
  });
  return true;
}

/** Backspace inside an empty pair of the editor removes both halves, anywhere else it is the native one. */
function backspace(view: EditorView): boolean {
  const sel = single(view.state);
  if (!sel || sel.from !== sel.to) return false;
  const range = emptyPairRemoval(view.state.doc.toString(), sel.from, view.state.field(pairsField));
  if (!range) return false;
  view.dispatch({ changes: range, selection: { anchor: range.from }, userEvent: "delete.backward", scrollIntoView: true });
  return true;
}

export const typingKeymap: readonly KeyBinding[] = [
  { key: "Backspace", run: backspace },
  { key: "Mod-b", run: toggle("**") },
  { key: "Mod-i", run: toggle("_") },
  { key: "Mod-k", run: link },
];

export const typingAids: Extension = [pairsField, typed, composition];
