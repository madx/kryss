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

/** Whether the popup opens, given the line text up to the cursor: it ends with a typed `==` that opens a highlight, not one that closes it. */
export function opensHighlightPopup(before: string): boolean {
  let tokens = 0;
  let lastEnd = -1;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === "\\") i++;
    else if (before.startsWith("==", i)) {
      tokens++;
      lastEnd = i + 2;
      i++;
    }
  }
  return lastEnd === before.length && tokens % 2 === 1;
}
