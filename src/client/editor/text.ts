// Pure text helpers of the single-line editor.

/** Replaces every line break (`\n`, `\r\n`, `\r`) with one space, so a task always stays on one line. */
export function toSingleLine(text: string): string {
  return text.replace(/\r\n|\r|\n/g, " ");
}

/**
 * What to do with an open editor when the lists are re-rendered.
 * `original` is the task text when editing began, `current` the task text now in the document (undefined if the task is gone).
 * Unchanged underneath (for instance the canonical document of a `PUT`): the typed text is committed.
 * Changed or gone (an external change): the disk version wins and the edit is discarded.
 */
export function settleDecision(original: string, current: string | undefined): "commit" | "discard" {
  return current === original ? "commit" : "discard";
}
