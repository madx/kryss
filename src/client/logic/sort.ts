// Sort by due date (PRD 5.21): pure functions, not implemented yet.
import type { Task, TodoDocument, TodoList } from "../../shared/types";
import type { Stop } from "./cursor";
import type { PathMove } from "./paths";

export type SortDate = { end: string; rank: number };
export type SortResult = { doc: TodoDocument; moves: PathMove[]; lists: number[] };

export function dueSortDate(_text: string): SortDate | null { throw new Error("not implemented"); }
export function compareSortDates(_a: SortDate | null, _b: SortDate | null): number { throw new Error("not implemented"); }
export function taskSortDate(_task: Task): SortDate | null { throw new Error("not implemented"); }
export function listSortDate(_list: TodoList): SortDate | null { throw new Error("not implemented"); }
export function sortList(_doc: TodoDocument, _list: number): SortResult | null { throw new Error("not implemented"); }
export function sortLists(_doc: TodoDocument): SortResult | null { throw new Error("not implemented"); }
export function sortedStop(_stop: Stop, _result: SortResult): Stop { throw new Error("not implemented"); }
export function sortAll(_doc: TodoDocument): SortResult | null { throw new Error("not implemented"); }
