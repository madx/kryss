// Pure logic of the list picker opened by `cl` (PRD 5.12).
import type { TodoDocument } from "../../shared/types";

/** Indexes of the lists whose title contains the text, ignoring case, in document order (all lists for an empty text). */
export function listPickerRows(doc: TodoDocument, text: string): number[] {
  const needle = text.trim().toLowerCase();
  return doc.lists.flatMap((l, i) => (l.title.toLowerCase().includes(needle) ? [i] : []));
}

/** Position in `rows` of the first list after the list of the task, or 0 when there is none. */
export function listPickerStart(rows: number[], source: number): number {
  const at = rows.findIndex((list) => list > source);
  return at < 0 ? 0 : at;
}
