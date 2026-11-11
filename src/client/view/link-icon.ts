// The icon shown before the label of a link that matches a rule (PRD 5.18).
// It is a CSS mask, so it takes the text color and follows the theme, and an SVG is never inserted as HTML.
import { createElement, Link } from "lucide";
import { getLinkRules } from "../link-rules";
import { iconRef, matchLink } from "../logic/links";
import { setLinkDecorator } from "../markdown/inline";

let fallbackUrl: string | undefined;
/** Whether the server knows a Lucide name, probed once per name and page load so that a render sends no request. */
const known = new Map<string, Promise<boolean>>();

function probe(name: string, src: string): Promise<boolean> {
  let result = known.get(name);
  if (!result) {
    result = new Promise<boolean>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = src;
    });
    known.set(name, result);
  }
  return result;
}

/** The Lucide `Link` icon as a data URL, so that a rule with no usable icon still shows one without any request. */
function fallback(): string {
  if (fallbackUrl === undefined) {
    const svg = createElement(Link, { stroke: "black" });
    // Lucide builds the element in the SVG namespace, which the HTML serializer leaves out: as a standalone image the SVG needs it.
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    fallbackUrl = `url("data:image/svg+xml,${encodeURIComponent(svg.outerHTML)}")`;
  }
  return fallbackUrl;
}

/** The element for the link `href`, or null when no rule matches it. */
export function linkIcon(href: string): HTMLElement | null {
  const match = matchLink(href, getLinkRules());
  if (!match) return null;
  const span = document.createElement("span");
  span.className = "link-icon";
  span.setAttribute("aria-hidden", "true");
  const ref = iconRef(match.icon);
  span.style.setProperty("--link-icon", ref === null ? fallback() : ref.kind === "data" ? `url("${ref.url}")` : fallback());
  if (ref?.kind === "lucide") {
    // The server answers `404` for an unknown name, in which case the fallback stays.
    const src = `/api/icons/${ref.name}`;
    void probe(ref.name, src).then((ok) => ok && span.style.setProperty("--link-icon", `url("${src}")`));
  }
  return span;
}

setLinkDecorator(linkIcon);
