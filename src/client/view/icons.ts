// Lucide icons, built as SVG elements (no innerHTML). Only the icons listed here end up in the bundle.
import { CircleExclamationPoint, Check, ChevronDown, CloudOff, createElement, GitCompareArrows, Loader, Pencil, Plus, TriangleExclamationPoint, X } from "lucide";
import type { SyncStatus } from "../sync";

type IconNode = Parameters<typeof createElement>[0];

function icon(node: IconNode): SVGElement {
  return createElement(node, { width: 14, height: 14, "stroke-width": 2, "aria-hidden": "true" });
}

export const plusIcon = () => icon(Plus);
export const caretIcon = () => icon(ChevronDown);
export const checkIcon = () => icon(Check);
export const editIcon = () => icon(Pencil);
export const closeIcon = () => icon(X);

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
