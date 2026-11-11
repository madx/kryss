// Pasting a URL in the task editor (PRD 5.18). The decision itself is the pure `pasteInsertion`.
import { EditorView } from "@codemirror/view";
import { getLinkRules } from "../link-rules";
import { pasteInsertion } from "../logic/links";

/** One transaction, so one step of the editor's own undo. Anything but a single http(s) URL is left to the native paste. */
export const linkPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const { state } = view;
    const text = event.clipboardData?.getData("text/plain");
    if (!text || state.selection.ranges.length !== 1) return false;
    const { from, to } = state.selection.main;
    const insert = pasteInsertion(text, state.sliceDoc(from, to), getLinkRules());
    if (insert === null) return false;
    event.preventDefault();
    view.dispatch(state.replaceSelection(insert), { userEvent: "input.paste", scrollIntoView: true });
    return true;
  },
});
