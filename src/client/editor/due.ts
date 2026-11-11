// CodeMirror parts of the due dates (PRD 5.13): the `->` popup, the space that resolves a shortcut, and the date coloring.
import { autocompletion, startCompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { dayPeriod, dueEntries, dueState, resolveTrailing } from "../logic/due";
import { findDueRange } from "../markdown/inline";
import { localToday } from "../today";
import { wikilinkSource } from "./wikilink";

/** The popup source: after `->` (preceded by whitespace or the start) and a space-free word. Accepting writes `-> DATE`. */
function dueSource(context: CompletionContext): CompletionResult | null {
  const sel = context.state.selection.main;
  const before = context.state.doc.sliceString(0, sel.empty ? context.pos : sel.from);
  // With a selection (`cd` selects ` DATE` after the arrow) the arrow ends the text before it, and typing replaces the selection.
  const m = sel.empty ? /(?<=^|\s)->(\S*)$/.exec(before) : /(?<=^|\s)->()$/.exec(before);
  if (!m) return null;
  const entries = dueEntries(m[1]!, localToday());
  if (entries.length === 0) return null;
  return {
    from: m.index,
    to: sel.empty ? undefined : sel.to,
    filter: false, // dueEntries already filtered by what was typed
    options: entries.map((e) => ({ label: "->" + e.label, displayLabel: e.label, detail: e.date, apply: "-> " + e.date })),
  };
}

/** A space typed right after a valid `->shortcut` resolves it to `-> DATE`. */
const resolveOnSpace = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== " " || from !== to) return false;
  const before = view.state.doc.sliceString(0, from);
  const resolved = resolveTrailing(before, localToday());
  if (resolved === null) return false;
  view.dispatch({
    changes: { from: 0, to, insert: resolved + " " },
    selection: { anchor: resolved.length + 1 },
    userEvent: "input.type",
  });
  return true;
});

function colorDate(view: EditorView): DecorationSet {
  const match = findDueRange(view.state.doc.toString());
  const state = match ? dueState(match.value, dayPeriod(localToday())) : null;
  return match && state
    ? Decoration.set([Decoration.mark({ class: `cm-due cm-due-${state}` }).range(match.from, match.to)])
    : Decoration.none;
}

const colorPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = colorDate(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = colorDate(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

export const dueExtensions: Extension = [autocompletion({ override: [dueSource, wikilinkSource], icons: false }), resolveOnSpace, colorPlugin];

/** Resolves a trailing shortcut of the committed text, so a commit right after `->tomorrow` keeps the date. */
export function resolveOnCommit(text: string): string {
  return resolveTrailing(text, localToday()) ?? text;
}

export { startCompletion };
