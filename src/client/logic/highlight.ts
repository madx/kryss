// Colored highlights (PRD 5.19): the color table, the leading emoji check, the popup entries and the popup decision.

export type HighlightColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple";
export type HighlightEntry = { label: string; insert: string; cursor: number };

export const HIGHLIGHT_COLORS: readonly { emoji: string; name: string; color: HighlightColor }[] = [
  { emoji: "🔴", name: "Red", color: "red" },
  { emoji: "🟠", name: "Orange", color: "orange" },
  { emoji: "🟡", name: "Yellow", color: "yellow" },
  { emoji: "🟢", name: "Green", color: "green" },
  { emoji: "🔵", name: "Blue", color: "blue" },
  { emoji: "🟣", name: "Purple", color: "purple" },
];

/** The color of a leading emoji, or null when it is not one of the six circles. */
export function highlightColor(emoji: string): HighlightColor | null {
  return HIGHLIGHT_COLORS.find((c) => c.emoji === emoji)?.color ?? null;
}

/** The CSS classes of a highlight, shared by the view and the live preview. */
export function highlightClass(color?: HighlightColor): string {
  return color ? `hl hl-${color}` : "hl";
}

/** The popup entries: the default, then one per color. Accepting inserts both markers, with the cursor at `cursor`. */
export function highlightEntries(): HighlightEntry[] {
  return [
    { label: "Default", insert: "====", cursor: 2 },
    ...HIGHLIGHT_COLORS.map((c) => ({
      label: `${c.emoji} ${c.name}`,
      insert: `==${c.emoji}==`,
      cursor: 2 + c.emoji.length,
    })),
  ];
}

/**
 * What accepting an entry changes (PRD 5.22).
 * With the closing `==` already after the cursor, only the emoji goes in after the typed `==`, so `back` is 0.
 * Without it, the typed `==` is replaced by both markers (`back` is 2).
 * `cursor` is counted from the start of the replaced range.
 */
export function highlightFill(entry: HighlightEntry, closerAfter: boolean): { back: number; insert: string; cursor: number } {
  if (!closerAfter) return { back: 2, insert: entry.insert, cursor: entry.cursor };
  const emoji = entry.insert.slice(2, -2);
  return { back: 0, insert: emoji, cursor: emoji.length };
}
