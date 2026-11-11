// The due date pill (PRD 5.10 and 5.13): an arrow icon and the date as written, colored by its state.
import { dayPeriod, dueState } from "../logic/due";
import { localToday } from "../today";
import { arrowRightIcon } from "./icons";
import { el } from "./dom";

/** Builds the pill of a valid date. The state is set on the element and recomputed by `refreshDueStates`. */
export function renderDuePill(value: string): HTMLElement {
  const pill = el("span", { class: "due", "data-date": value }, arrowRightIcon(), value);
  pill.dataset.state = dueState(value, dayPeriod(localToday())) ?? "";
  return pill;
}

/** Restyles every pill against today. It only sets an attribute, so an open editor is never touched. */
export function refreshDueStates(root: ParentNode = document): void {
  const horizon = dayPeriod(localToday());
  root.querySelectorAll<HTMLElement>(".due[data-date]").forEach((pill) => {
    pill.dataset.state = dueState(pill.dataset.date!, horizon) ?? "";
  });
}

/** Recomputes the states when the tab becomes visible again or gets the focus, with no timer. */
export function installDueRefresh(): void {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshDueStates();
  });
  window.addEventListener("focus", () => refreshDueStates());
}
