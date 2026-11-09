// Pure text helpers of the single-line editor.

/** Replaces every line break (`\n`, `\r\n`, `\r`) with one space, so a task always stays on one line. */
export function toSingleLine(text: string): string {
  return text.replace(/\r\n|\r|\n/g, " ");
}
