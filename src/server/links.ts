// Link rules (`.kryss.json`) and Lucide icons served to the client (PRD 5.18). Both are read only.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type LinkRule = { match: string; label: string; icon?: string };
export type LinkConfig = { links: LinkRule[]; problems: string[] };

const ICON_NAME = /^[a-z0-9-]+$/;

/** Reads `.kryss.json` at each call: a missing file means no rules, a malformed one means no rules and a problem, an invalid rule is skipped with a problem. */
export async function readLinkConfig(vaultDir: string): Promise<LinkConfig> {
  let text: string;
  try {
    text = await readFile(join(vaultDir, ".kryss.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { links: [], problems: [] };
    return { links: [], problems: [`.kryss.json cannot be read: ${(error as Error).message}`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { links: [], problems: [`.kryss.json is not valid JSON: ${(error as Error).message}`] };
  }
  const links = (parsed as { links?: unknown } | null)?.links;
  if (!Array.isArray(links)) return { links: [], problems: [".kryss.json has no links array"] };
  const result: LinkConfig = { links: [], problems: [] };
  links.forEach((rule, index) => {
    const n = index + 1;
    const r = rule as Partial<Record<keyof LinkRule, unknown>> | null;
    if (typeof r !== "object" || r === null || typeof r.match !== "string" || r.match === "" || typeof r.label !== "string" || r.label === "") {
      result.problems.push(`Link rule ${n} needs a match and a label`);
      return;
    }
    try {
      new RegExp(r.match);
    } catch {
      result.problems.push(`Link rule ${n} has an invalid regular expression`);
      return;
    }
    result.links.push({ match: r.match, label: r.label, ...(typeof r.icon === "string" ? { icon: r.icon } : {}) });
  });
  return result;
}

type IconNode = [string, Record<string, string | number>][];
const escapeAttr = (v: string | number) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The SVG of a Lucide icon, read from the installed package, or null for a name outside `[a-z0-9-]+` or an unknown one. */
export async function lucideSvg(name: string): Promise<string | null> {
  if (!ICON_NAME.test(name)) return null;
  let node: IconNode;
  try {
    node = (await import(`lucide/dist/esm/icons/${name}.mjs`)).default;
  } catch {
    return null;
  }
  if (!Array.isArray(node)) return null;
  // The client rebuilds the shapes of this SVG and draws them in the text color, so the stroke color here does not matter.
  const body = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(" ")}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
