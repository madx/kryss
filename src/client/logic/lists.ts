import type { TodoDocument } from "../../shared/types";
import { copyList, type Register } from "./register";
import { changedPaths, cloneDoc, normalizeText, pathsByNode, type PathMove } from "./paths";

/** Appends an empty list (its index is `lists.length - 1`). Empty title: same document returned. */
export function addList(doc: TodoDocument, title: string): TodoDocument {
  const clean = normalizeText(title);
  if (clean === "") return doc;
  return { ...doc, lists: [...cloneDoc(doc).lists, { title: clean, tasks: [] }] };
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
 * Returns the new document, the new index of the moved list and the tasks whose path changed (so that the pins follow), or `null` when the order would not change.
 */
export function moveList(doc: TodoDocument, list: number, target: number, place: ListPlace): { doc: TodoDocument; list: number; moves: PathMove[] } | null {
  if (!doc.lists[list] || !doc.lists[target] || list === target) return null;
  const at = place === "before" ? target : target + 1;
  const index = at > list ? at - 1 : at; // the index once the list has left its old position
  if (index === list) return null;
  const next = cloneDoc(doc);
  const before = pathsByNode(next);
  const [moved] = next.lists.splice(list, 1);
  next.lists.splice(index, 0, moved!);
  return { doc: next, list: index, moves: changedPaths(before, next) };
}

/** Target of a keyboard move: the next (down) or previous (up) visible list, or `null` at the edge of the visible lists. `visible` is in document order. */
export function listMoveTarget(list: number, dir: "up" | "down", visible: number[]): { target: number; place: ListPlace } | null {
  const at = visible.indexOf(list);
  const target = visible[at + (dir === "down" ? 1 : -1)];
  if (at < 0 || target === undefined) return null;
  return { target, place: dir === "down" ? "after" : "before" };
}

/** Like `deleteList`, and also returns the removed list as a register. Unknown list: `null`. */
export function cutList(doc: TodoDocument, list: number): { doc: TodoDocument; register: Register } | null {
  const register = copyList(doc, list);
  return register ? { doc: deleteList(doc, list), register } : null;
}
