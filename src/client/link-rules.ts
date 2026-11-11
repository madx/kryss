// The link rules of the Vault (PRD 5.18), loaded once per page load and read by the renderer and the editor.
import type { LinkRule } from "./logic/links";

let rules: readonly LinkRule[] = [];

export const setLinkRules = (next: readonly LinkRule[]) => void (rules = next);
export const getLinkRules = (): readonly LinkRule[] => rules;
