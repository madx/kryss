import { serialize } from "../../shared/serializer";
import type { TodoDocument } from "../../shared/types";
import type { View } from "./views";

/** Canonical Markdown of the current view: every list in the All view, otherwise the selected list. A stale index gives the whole document. */
export function exportView(doc: TodoDocument, view: View): string {
  const list = view === null ? undefined : doc.lists[view];
  return serialize(list ? { lists: [list] } : doc);
}
