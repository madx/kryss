// Lucide icons, built as SVG elements (no innerHTML). Only the icons listed here end up in the bundle.
import { ArrowRight, CircleExclamationPoint, Check, ChevronDown, CloudOff, Copy, createElement, GitCompareArrows, Loader, Pencil, SquareLetterM, TriangleExclamationPoint } from "lucide";
import type { SyncStatus } from "../sync";

type IconNode = Parameters<typeof createElement>[0];

function icon(node: IconNode): SVGElement {
  return createElement(node, { width: 14, height: 14, "stroke-width": 2, "aria-hidden": "true" });
}

export const caretIcon = () => icon(ChevronDown);
export const checkIcon = () => icon(Check);
export const markdownIcon = () => icon(SquareLetterM); // Lucide "square-m"
export const copyIcon = () => icon(Copy);
export const arrowRightIcon = () => icon(ArrowRight); // the due date pill
export const overdueIcon = () => icon(CircleExclamationPoint); // the pill of an overdue date

const STATUS_ICONS: Record<SyncStatus, IconNode> = {
  saved: Check,
  unsaved: Pencil,
  saving: Loader,
  conflict: GitCompareArrows,
  invalid: TriangleExclamationPoint,
  offline: CloudOff,
  error: CircleExclamationPoint,
};

export const statusIcon = (status: SyncStatus) => icon(STATUS_ICONS[status]);
