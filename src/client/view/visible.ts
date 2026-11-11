// The rows on screen: the document narrowed by the filter text, with today read from the clock (PRD 5.14).
import { visibleRows, type Visible } from "../logic/filter";
import type { StoreState } from "../store";
import { localToday } from "../today";

/** The visible rows of the state, or null when the page holds no document. */
export function visibleOf(state: StoreState): Visible | null {
  return state.doc ? visibleRows(state.doc, state.filter, localToday(), state.pins) : null;
}
