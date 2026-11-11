// The icon shown before the label of a link that matches a rule (PRD 5.18).
// It is a CSS mask, so it takes the text color and follows the theme, and an SVG is never inserted as HTML.
import { createElement, Link } from "lucide";
import { getLinkRules } from "../link-rules";
import { iconRef, matchLink } from "../logic/links";
import { setLinkDecorator } from "../markdown/inline";

let fallbackUrl: string | undefined;

/** The Lucide `Link` icon as a data URL, so that a rule with no usable icon still shows one without any request. */
function fallback(): string {
  fallbackUrl ??= `url("data:image/svg+xml,${encodeURIComponent(createElement(Link, { stroke: "black" }).outerHTML)}")`;
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
    const probe = new Image();
    probe.onload = () => span.style.setProperty("--link-icon", `url("${src}")`);
    probe.src = src;
  }
  return span;
}

setLinkDecorator(linkIcon);
