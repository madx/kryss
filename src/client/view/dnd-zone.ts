// Pure drop zone computation, kept free of the DOM so that it can be unit-tested.
export type Zone = "before" | "after" | "child";

/**
 * Zone under the pointer, from its vertical position in the row.
 * Top quarter: before. Bottom quarter: after. Middle half: as child.
 * When a child drop is not allowed, the row is split in two halves instead (top: before, bottom: after),
 * so that every point of the row still maps to a zone.
 */
export function zoneFromPointer(y: number, top: number, height: number, allowChild: boolean): Zone {
  const ratio = height > 0 ? (y - top) / height : 0.5;
  if (!allowChild) return ratio < 0.5 ? "before" : "after";
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "child";
}
