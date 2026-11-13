// The `==` popup of the highlights (PRD 5.19): seven entries that insert both markers with the cursor inside.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { highlightEntries, opensHighlightPopup } from "../logic/highlight";

/** The popup source: it opens on a typed `==` that opens a highlight, and a closing `==` does not open it. */
export function highlightSource(context: CompletionContext): CompletionResult | null {
  const sel = context.state.selection.main;
  if (!sel.empty || !opensHighlightPopup(context.state.doc.sliceString(0, context.pos))) return null;
  return {
    from: context.pos - 2,
    filter: false,
    options: highlightEntries().map(
      (e): Completion => ({
        label: e.label,
        apply: (view, _completion, from, to) =>
          view.dispatch({ changes: { from, to, insert: e.insert }, selection: { anchor: from + e.cursor }, userEvent: "input.complete" }),
      }),
    ),
  };
}
