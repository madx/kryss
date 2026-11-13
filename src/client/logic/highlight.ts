// Colored highlights (PRD 5.19): the color table, the leading emoji check, the popup entries and the popup decision.

export type HighlightColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple";
export type HighlightEntry = { label: string; insert: string; cursor: number };

export const HIGHLIGHT_COLORS: readonly { emoji: string; name: string; color: HighlightColor }[] = [];

export function highlightColor(_emoji: string): HighlightColor | null {
  return null;
}

export function highlightClass(_color?: HighlightColor): string {
  return "";
}

export function highlightEntries(): HighlightEntry[] {
  return [];
}

export function opensHighlightPopup(_before: string): boolean {
  return false;
}
