// The single alert component: a full-width strip with a message and text buttons on the same line (PRD 5.10).
import { el } from "./dom";

export type AlertTone = "warning" | "error";

export type AlertButton = { label: string; onClick(): void; attrs?: Record<string, string> };

export function renderAlert(tone: AlertTone, message: (Node | string)[], buttons: AlertButton[] = []): HTMLElement {
  const actions = buttons.map((b) => {
    const button = el("button", { type: "button", class: "alert-button", ...b.attrs }, b.label);
    button.addEventListener("click", b.onClick);
    return button;
  });
  const children: Node[] = [el("div", { class: "alert-message" }, ...message)];
  if (actions.length) children.push(el("div", { class: "alert-actions" }, ...actions));
  return el("div", { class: `alert alert-${tone}`, role: "alert" }, ...children);
}
