import type { TodoDocument } from "../../shared/types";
import type { Range } from "./cursor";
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

export type ListPlace = "before" | "after";

/**
 * Moves a list before or after a target list (PRD 5.7).
 * Returns the new document and the new index of the moved list, or `null` when the order would not change.
 */
export function moveList(doc: TodoDocument, list: number, target: number, place: ListPlace): { doc: TodoDocument; list: number } | null {
  if (!doc.lists[list] || !doc.lists[target] || list === target) return null;
  const at = place === "before" ? target : target + 1;
  const index = at > list ? at - 1 : at; // the index once the list has left its old position
  if (index === list) return null;
  const next = cloneDoc(doc);
  const [moved] = next.lists.splice(list, 1);
  next.lists.splice(index, 0, moved!);
  return { doc: next, list: index };
}

/** Target of a keyboard move: the next (down) or previous (up) visible list, or `null` at the edge of the visible range. */
export function listMoveTarget(list: number, dir: "up" | "down", range: Range): { target: number; place: ListPlace } | null {
  const target = dir === "down" ? list + 1 : list - 1;
  if (target < range.first || target > range.last) return null;
  return { target, place: dir === "down" ? "after" : "before" };
}
