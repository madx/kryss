import type { TodoDocument } from "../../shared/types";
import { cloneDoc, normalizeText } from "./paths";

/** Appends an empty list (its index is `lists.length - 1`). Empty title: same document returned. */
export function addList(doc: TodoDocument, title: string): TodoDocument {
  const clean = normalizeText(title);
  if (clean === "") return doc;
  return { lists: [...cloneDoc(doc).lists, { title: clean, tasks: [] }] };
}

/** Renames a list. Empty title or unknown list: same document returned. */
export function renameList(doc: TodoDocument, list: number, title: string): TodoDocument {
  const clean = normalizeText(title);
  if (!doc.lists[list] || clean === "" || doc.lists[list]!.title === clean) return doc;
  const next = cloneDoc(doc);
  next.lists[list]!.title = clean;
  return next;
}

/** Deletes a list with its tasks (the caller asks for confirmation if non-empty). */
export function deleteList(doc: TodoDocument, list: number): TodoDocument {
  if (!doc.lists[list]) return doc;
  const next = cloneDoc(doc);
  next.lists.splice(list, 1);
  return next;
}
