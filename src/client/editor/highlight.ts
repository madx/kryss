// The `==` popup of the highlights (PRD 5.19): seven entries that insert both markers with the cursor inside.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { highlightEntries, highlightFill, highlightWrapFill, isWrappedHighlight } from "../logic/highlight";
import { opensHighlightPopup } from "../markdown/inline";

/**
 * The popup source: it opens on a typed `==` that opens a highlight, and a closing `==` does not open it.
 * It also opens over a selection wrapped by `==` (PRD 5.22), where accepting only inserts the emoji after the opening marker.
 */
export function highlightSource(context: CompletionContext): CompletionResult | null {
  const sel = context.state.selection.main;
  const text = context.state.doc.toString();
  const wrapped = isWrappedHighlight(text, sel.from, sel.to);
  if (!wrapped && (!sel.empty || !opensHighlightPopup(text.slice(0, context.pos)))) return null;
  return {
    from: wrapped ? sel.from : context.pos - 2,
    filter: false,
    options: highlightEntries().map(
      (e): Completion => ({
        label: e.label,
        apply: (view, _completion, from, to) => {
          const { main } = view.state.selection;
          if (isWrappedHighlight(view.state.doc.toString(), main.from, main.to)) {
            const wrap = highlightWrapFill(e, main.from, main.to);
            view.dispatch({ changes: { from: wrap.insertAt, insert: wrap.insert }, selection: { anchor: wrap.cursor }, userEvent: "input.complete" });
            return;
          }
          // The typing aids (PRD 5.22) already put the closing `==` after the cursor, so only the emoji goes in.
          const fill = highlightFill(e, view.state.sliceDoc(to, to + 2) === "==");
          const start = to - fill.back;
          view.dispatch({ changes: { from: start, to, insert: fill.insert }, selection: { anchor: start + fill.cursor }, userEvent: "input.complete" });
        },
      }),
    ),
  };
}
