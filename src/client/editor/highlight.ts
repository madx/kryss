// The `==` popup of the highlights (PRD 5.19): seven entries that insert both markers with the cursor inside.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { highlightEntries, highlightFill } from "../logic/highlight";
import { opensHighlightPopup } from "../markdown/inline";

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
        apply: (view, _completion, from, to) => {
          // The typing aids (PRD 5.22) already put the closing `==` after the cursor, so only the emoji goes in.
          const fill = highlightFill(e, view.state.sliceDoc(to, to + 2) === "==");
          const start = to - fill.back;
          view.dispatch({ changes: { from: start, to, insert: fill.insert }, selection: { anchor: start + fill.cursor }, userEvent: "input.complete" });
        },
      }),
    ),
  };
}
