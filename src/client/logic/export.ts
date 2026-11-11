import { serialize } from "../../shared/serializer";
import type { TodoDocument } from "../../shared/types";
import { applyVisible, type Visible } from "./filter";

/** Canonical Markdown of the visible rows: every list with no filter, otherwise the visible lists, tasks and subtasks. */
export function exportView(doc: TodoDocument, visible: Visible): string {
  return serialize(applyVisible(doc, visible));
}
