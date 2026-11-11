// Small hand-written inline Markdown parser and DOM renderer.
// Supported: **bold**, *italic*, _italic_, `code`, ~~strike~~, [label](url) and backslash escapes.
// `![alt](url)` renders as nothing.
// A top-level `-> DATE` becomes a `due` node (PRD 5.13), the view adds its state.
// Everything else (raw HTML, headings, lists) stays literal text.
// The DOM is only ever built with createElement and textContent, never innerHTML.

import { duePeriod } from "../logic/due";
import { parseWikilink, wikilinkUrl } from "../logic/wikilink";

// The name of the Vault, set once at startup in Vault mode. Without it, wikilinks stay literal text (PRD 5.17).
let vaultName: string | null = null;
export function setVaultName(name: string | null): void {
  vaultName = name;
}
export const hasVaultName = () => vaultName !== null;

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "due"; value: string }
  | { type: "strong" | "em" | "strike"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "obsidian"]);
// ASCII controls and whitespace, C1 controls, soft hyphen, zero-width and line separator characters.
// Browsers ignore some of them inside a URL, so they are removed before checking the scheme.
const IGNORABLE = new RegExp("[\\u0000-\\u0020\\u007f-\\u009f\\u00ad\\u200b-\\u200f\\u2028\\u2029\\u2060\\ufeff]", "g");
const ESCAPABLE = "\\`*_~[]()";

/** Removes the characters a browser may ignore inside a URL. The result is what gets validated and used as href. */
export function normalizeUrl(url: string): string {
  return url.replace(IGNORABLE, "");
}

/** True only for http, https, mailto and obsidian URLs (case-insensitive). */
export function isAllowedUrl(url: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(normalizeUrl(url));
  return match !== null && ALLOWED_SCHEMES.has(match[1]!.toLowerCase());
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Index of the closing marker for an opener whose content starts at `from`, or -1. */
function findClose(s: string, from: number, marker: string): number {
  for (let j = from; j < s.length; j++) {
    const c = s[j]!;
    if (c === "\\") {
      j++;
    } else if (c === "`") {
      const end = s.indexOf("`", j + 1);
      if (end > j + 1) j = end;
    } else if (s.startsWith(marker, j)) {
      if (marker.length === 1 && s[j + 1] === marker) {
        j++; // part of a double marker: not a closer for a single one
        continue;
      }
      const closes = j > from && !isSpace(s[j - 1]) && !(marker === "_" && isWordChar(s[j + 1]));
      if (closes) return j;
    }
  }
  return -1;
}

/** Index of the `)` matching an already consumed `(`, or -1. Balances nested parentheses. */
function findLinkEnd(s: string, from: number): number {
  let depth = 1;
  for (let j = from; j < s.length; j++) {
    if (s[j] === "(") depth++;
    else if (s[j] === ")" && --depth === 0) return j;
  }
  return -1;
}

/** Index of the `]` matching an already consumed `[`, or -1. Skips escapes and code spans. */
function findLabelEnd(s: string, from: number): number {
  let depth = 1;
  for (let j = from; j < s.length; j++) {
    const c = s[j]!;
    if (c === "\\") j++;
    else if (c === "`") {
      const end = s.indexOf("`", j + 1);
      if (end > j + 1) j = end;
    } else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return j;
  }
  return -1;
}

/** The valid date of a `-> DATE` marker at `i`, or null. The marker follows whitespace or the start, the date ends at whitespace or the end. */
function dueAt(s: string, i: number): string | null {
  if (!s.startsWith("-> ", i) || !isSpace(s[i - 1])) return null;
  const token = /^\S+/.exec(s.slice(i + 3))?.[0];
  return token !== undefined && duePeriod(token) ? token : null;
}

/** Keeps the last due node and turns the earlier ones back into literal text. */
function keepLastDue(nodes: InlineNode[]): InlineNode[] {
  let last = -1;
  nodes.forEach((n, index) => { if (n.type === "due") last = index; });
  const out: InlineNode[] = [];
  nodes.forEach((n, index) => {
    const node: InlineNode = n.type === "due" && index !== last ? { type: "text", value: "-> " + n.value } : n;
    const prev = out[out.length - 1];
    if (node.type === "text" && prev?.type === "text") prev.value += node.value;
    else out.push(node);
  });
  return out;
}

/** Where the due node sits in the source: the whole `-> DATE`, where the date starts, and the date. */
export type DueRange = { from: number; to: number; dateFrom: number; value: string };

function parse(s: string, allowLinks: boolean, topLevel = false, ranges?: DueRange[]): InlineNode[] {
  const nodes: InlineNode[] = [];
  const pushText = (value: string) => {
    const last = nodes[nodes.length - 1];
    if (last?.type === "text") last.value += value;
    else nodes.push({ type: "text", value });
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i]!;

    if (topLevel && c === "-") {
      const date = dueAt(s, i);
      if (date) {
        nodes.push({ type: "due", value: date });
        ranges?.push({ from: i, to: i + 3 + date.length, dateFrom: i + 3, value: date });
        i += 3 + date.length;
        continue;
      }
    }

    if (c === "\\") {
      const next = s[i + 1];
      if (next !== undefined && ESCAPABLE.includes(next)) {
        pushText(next);
        i += 2;
      } else {
        pushText(c);
        i++;
      }
      continue;
    }

    if (c === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        nodes.push({ type: "code", value: s.slice(i + 1, end) });
        i = end + 1;
      } else {
        pushText(c);
        i++;
      }
      continue;
    }

    if (c === "!" && s[i + 1] === "[") {
      // Images are out of scope: a well-formed `![alt](url)` renders as nothing.
      const labelEnd = findLabelEnd(s, i + 2);
      if (labelEnd > 0 && s[labelEnd + 1] === "(") {
        const urlEnd = findLinkEnd(s, labelEnd + 2);
        if (urlEnd > 0 && !/\s/.test(s.slice(labelEnd + 2, urlEnd))) {
          i = urlEnd + 1;
          continue;
        }
      }
    }

    if (c === "[" && allowLinks && vaultName !== null) {
      const wiki = parseWikilink(s, i);
      if (wiki) {
        nodes.push({ type: "link", href: wikilinkUrl(vaultName, wiki.target), children: [{ type: "text", value: wiki.label }] });
        i = wiki.end;
        continue;
      }
    }

    if (c === "<" && allowLinks) {
      // Autolink `<scheme:…>`, under the same scheme rules as a link. Anything else stays literal.
      const end = s.indexOf(">", i + 1);
      const target = end > i + 1 ? s.slice(i + 1, end) : "";
      if (target !== "" && !/[\s<]/.test(target) && /^[a-z][a-z0-9+.-]*:/i.test(target) && isAllowedUrl(target)) {
        nodes.push({ type: "link", href: normalizeUrl(target), children: [{ type: "text", value: target }] });
        i = end + 1;
        continue;
      }
    }

    if (c === "[" && allowLinks) {
      const labelEnd = findLabelEnd(s, i + 1);
      if (labelEnd > i + 1 && s[labelEnd + 1] === "(") {
        const urlEnd = findLinkEnd(s, labelEnd + 2);
        if (urlEnd > labelEnd + 2) {
          const raw = s.slice(labelEnd + 2, urlEnd);
          if (!/\s/.test(raw) && isAllowedUrl(raw)) {
            nodes.push({
              type: "link",
              href: normalizeUrl(raw),
              children: parse(s.slice(i + 1, labelEnd), false),
            });
          } else {
            pushText(s.slice(i, urlEnd + 1)); // refused target: literal source
          }
          i = urlEnd + 1;
          continue;
        }
      }
      pushText(c);
      i++;
      continue;
    }

    if (c === "*" || c === "_" || c === "~") {
      const double = s[i + 1] === c;
      if (c === "~" && !double) {
        pushText(c);
        i++;
        continue;
      }
      const marker = double ? c + c : c;
      const start = i + marker.length;
      const opens =
        !isSpace(s[start]) && !(c === "_" && !double && isWordChar(s[i - 1])) && s[start] !== c;
      const end = opens ? findClose(s, start, marker) : -1;
      if (end > start) {
        const type = c === "~" ? "strike" : double ? "strong" : "em";
        nodes.push({ type, children: parse(s.slice(start, end), allowLinks) });
        i = end + marker.length;
      } else {
        pushText(marker);
        i = start;
      }
      continue;
    }

    pushText(c);
    i++;
  }
  return topLevel ? keepLastDue(nodes) : nodes;
}

/** The range of the due date that `parseInline` recognizes (the last valid one), so the editor agrees with the view. */
export function findDueRange(text: string): DueRange | null {
  const ranges: DueRange[] = [];
  parse(text, true, true, ranges);
  return ranges[ranges.length - 1] ?? null;
}

/** Parses one line of inline Markdown into a small AST. Pure, no DOM. */
export function parseInline(text: string): InlineNode[] {
  return parse(text, true, true);
}

const TAGS = { strong: "strong", em: "em", strike: "del" } as const;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Serializes the AST to an HTML string. Only meant for tests and debugging, the app uses renderInline. */
export function astToHtml(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return escapeHtml(n.value);
        case "code":
          return `<code>${escapeHtml(n.value)}</code>`;
        case "due":
          return `<span class="due">${escapeHtml(n.value)}</span>`;
        case "link":
          return `<a href="${escapeHtml(n.href)}" target="_blank" rel="noopener noreferrer">${astToHtml(n.children)}</a>`;
        default:
          return `<${TAGS[n.type]}>${astToHtml(n.children)}</${TAGS[n.type]}>`;
      }
    })
    .join("");
}

/** Builds what goes before the label of a link (its rule icon, PRD 5.18). Set by the view, so this module stays free of the rules. */
let linkDecorator: ((href: string) => HTMLElement | null) | undefined;
export const setLinkDecorator = (fn: (href: string) => HTMLElement | null) => void (linkDecorator = fn);

/** Builds the element of a due node from its date text. */
export type DueRenderer = (value: string) => HTMLElement;

function build(nodes: InlineNode[], parent: Node, renderDue?: DueRenderer): void {
  for (const n of nodes) {
    if (n.type === "text") {
      parent.appendChild(document.createTextNode(n.value));
      continue;
    }
    if (n.type === "due") {
      if (renderDue) {
        parent.appendChild(renderDue(n.value));
      } else {
        const pill = document.createElement("span");
        pill.className = "due";
        pill.textContent = n.value;
        parent.appendChild(pill);
      }
      continue;
    }
    const el = document.createElement(n.type === "link" ? "a" : n.type === "code" ? "code" : TAGS[n.type]);
    if (n.type === "code") {
      el.textContent = n.value;
    } else {
      if (n.type === "link") {
        el.setAttribute("href", n.href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
        const icon = linkDecorator?.(n.href);
        if (icon) el.appendChild(icon);
      }
      build(n.children, el, renderDue);
    }
    parent.appendChild(el);
  }
}

/** Renders inline Markdown to DOM nodes using only createElement and text nodes (no innerHTML). */
export function renderInline(text: string, renderDue?: DueRenderer): DocumentFragment {
  const fragment = document.createDocumentFragment();
  build(parseInline(text), fragment, renderDue);
  return fragment;
}
