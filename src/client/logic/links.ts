// Link rules and pasted URLs (PRD 5.18): pure functions, no DOM.

/** A rule of `.kryss.json`. The server only sends valid ones, but every function here also copes with a bad one. */
export type LinkRule = { match: string; label: string; icon?: string };
export type LinkMatch = { label: string; icon: string | undefined };
export type IconRef = { kind: "lucide"; name: string } | { kind: "data"; url: string };

const LUCIDE_NAME = /^[a-z0-9-]+$/;
// A data URL ends up between quotes in a CSS `url("…")`: no quote, backslash or line break may be in it.
const SVG_DATA_URL = /^data:image\/svg\+xml[;,][^"\\\r\n]*$/;
const MAX_DATA_URL = 20000;

/** Replaces `$0`, `$1`… in `template` with the capture groups of a match, and a missing group with nothing. */
export function buildLabel(template: string, groups: ArrayLike<string | undefined>): string {
  return template.replace(/\$(\d+)/g, (_all, n: string) => groups[Number(n)] ?? "");
}

/** The label and the icon of the first rule that matches `url`, or null. Invalid rules are skipped, and so is a rule with an empty label. */
export function matchLink(url: string, rules: readonly LinkRule[]): LinkMatch | null {
  for (const rule of rules) {
    if (typeof rule?.match !== "string" || typeof rule.label !== "string" || rule.match === "") continue;
    let found: RegExpExecArray | null;
    try {
      found = new RegExp(rule.match).exec(url);
    } catch {
      continue;
    }
    if (!found) continue;
    const label = buildLabel(rule.label, found).trim();
    if (label === "") continue;
    return { label, icon: typeof rule.icon === "string" ? rule.icon : undefined };
  }
  return null;
}

/** What an `icon` value designates: a Lucide name, a `data:image/svg+xml` URL, or null for any other value. */
export function iconRef(value: unknown): IconRef | null {
  if (typeof value !== "string") return null;
  if (LUCIDE_NAME.test(value)) return { kind: "lucide", name: value };
  if (value.length <= MAX_DATA_URL && SVG_DATA_URL.test(value)) return { kind: "data", url: value };
  return null;
}

/** The URL of a clipboard text that is exactly one `http` or `https` URL once trimmed, or null. */
export function singleUrl(text: string): string | null {
  const url = text.trim();
  if (!/^https?:\/\/[^\s<>]+$/i.test(url)) return null;
  try {
    return new URL(url).hostname === "" ? null : url;
  } catch {
    return null;
  }
}

const escapeLabel = (label: string) => label.replace(/[\\[\]]/g, "\\$&");

/** Keeps a URL usable as a Markdown target: parentheses are only a problem when they are not balanced. */
function safeTarget(url: string): string {
  let depth = 0;
  for (const c of url) {
    if (c === "(") depth++;
    else if (c === ")" && --depth < 0) break;
  }
  return depth === 0 ? url : url.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/**
 * The text a paste inserts (PRD 5.18), or null for the native paste.
 * A selection becomes the label whatever the rules say, otherwise a matching rule gives it, otherwise the URL goes in as an autolink, `<url>`.
 */
export function pasteInsertion(clipboard: string, selection: string, rules: readonly LinkRule[]): string | null {
  const url = singleUrl(clipboard);
  if (url === null) return null;
  const label = selection !== "" ? selection : matchLink(url, rules)?.label;
  return label === undefined ? `<${url}>` : `[${escapeLabel(label)}](${safeTarget(url)})`;
}
