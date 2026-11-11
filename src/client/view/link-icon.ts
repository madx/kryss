// The icon shown before the label of a link that matches a rule (PRD 5.18).
// It is a real inline SVG in the text color, rebuilt element by element from an allow-list of shapes and attributes,
// so that nothing else of an icon, a script included, ever reaches the page, and no markup is ever inserted as HTML.
import { createElement, Link } from "lucide";
import { getLinkRules } from "../link-rules";
import { iconRef, matchLink } from "../logic/links";
import { setLinkDecorator } from "../markdown/inline";

const SVG_NS = "http://www.w3.org/2000/svg";
const SHAPES = new Set(["g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
const ATTRIBUTES = new Set([
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points", "transform",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "opacity",
]);

/** Copies an allowed shape and its allowed children. A color becomes the text color, and a value that could load something is dropped. */
function copyShape(source: Element, depth = 0): SVGElement | null {
  const tag = source.localName;
  if (!SHAPES.has(tag) || depth > 4) return null;
  const copy = document.createElementNS(SVG_NS, tag);
  for (const { name, value } of Array.from(source.attributes)) {
    if (!ATTRIBUTES.has(name) || /url\(|javascript:/i.test(value)) continue;
    copy.setAttribute(name, (name === "fill" || name === "stroke") && value !== "none" ? "currentColor" : value);
  }
  for (const child of Array.from(source.children)) {
    const kept = copyShape(child, depth + 1);
    if (kept) copy.appendChild(kept);
  }
  return copy;
}

/** A clean SVG element from the text of an SVG, or null when it is not one. Lucide icons are strokes, so that is the default. */
export function cleanSvg(text: string): SVGElement | null {
  const root = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
  if (root.localName !== "svg" || root.querySelector("parsererror")) return null;
  const svg = document.createElementNS(SVG_NS, "svg");
  const viewBox = root.getAttribute("viewBox");
  svg.setAttribute("viewBox", viewBox && /^[\d\s.,-]+$/.test(viewBox) ? viewBox : "0 0 24 24");
  const fill = root.getAttribute("fill");
  svg.setAttribute("fill", fill && fill !== "none" ? "currentColor" : "none");
  const stroke = root.getAttribute("stroke");
  if (stroke && stroke !== "none") svg.setAttribute("stroke", "currentColor");
  for (const name of ["stroke-width", "stroke-linecap", "stroke-linejoin"]) {
    const value = root.getAttribute(name);
    if (value && !/url\(|javascript:/i.test(value)) svg.setAttribute(name, value);
  }
  for (const child of Array.from(root.children)) {
    const kept = copyShape(child);
    if (kept) svg.appendChild(kept);
  }
  return svg.childElementCount > 0 ? svg : null;
}

/** The SVG text of a `data:image/svg+xml` URL, percent-encoded or base64, or null. */
function dataUrlText(url: string): string | null {
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  try {
    return /;base64$/i.test(url.slice(0, comma)) ? atob(url.slice(comma + 1)) : decodeURIComponent(url.slice(comma + 1));
  } catch {
    return null;
  }
}

/** The Lucide `Link` icon, built locally so that a rule with no usable icon still shows one without any request. */
function fallback(): SVGElement {
  const svg = createElement(Link);
  svg.setAttribute("stroke", "currentColor");
  return svg;
}

/** The icon of each Lucide name, fetched once per page load (null when the server does not know it). */
const named = new Map<string, Promise<SVGElement | null>>();

function lucideIcon(name: string): Promise<SVGElement | null> {
  let icon = named.get(name);
  if (!icon) {
    icon = fetch(`/api/icons/${name}`)
      .then((res) => (res.ok ? res.text() : null))
      .then((text) => (text === null ? null : cleanSvg(text)))
      .catch(() => null);
    named.set(name, icon);
  }
  return icon;
}

/** The element for the link `href`, or null when no rule matches it. */
export function linkIcon(href: string): HTMLElement | null {
  const match = matchLink(href, getLinkRules());
  if (!match) return null;
  const span = document.createElement("span");
  span.className = "link-icon";
  span.setAttribute("aria-hidden", "true");
  const ref = iconRef(match.icon);
  const text = ref?.kind === "data" ? dataUrlText(ref.url) : null;
  const own = text === null ? null : cleanSvg(text);
  span.appendChild(own ?? fallback());
  if (ref?.kind === "lucide") {
    // The server answers `404` for an unknown name, in which case the fallback stays.
    void lucideIcon(ref.name).then((icon) => icon && span.replaceChildren(icon.cloneNode(true)));
  }
  return span;
}

setLinkDecorator(linkIcon);
