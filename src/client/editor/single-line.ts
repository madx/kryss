import { EditorState } from "@codemirror/state";
import { toSingleLine } from "./text";

/** Line breaks, from paste, drop or any command, are replaced by spaces (same length, so selections stay valid). */
export const singleLine = EditorState.transactionFilter.of((tr) => {
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
