// Highlights the occurrences of the search query in the rendered rows (PRD 5.15), by walking their text nodes.
const HIT = "search-hit";
const TARGETS = ".task-text, .list-title";

/** Removes the highlights of a previous pass and merges the text nodes back. */
function clear(root: HTMLElement): void {
  const parents = new Set<Node>();
  for (const mark of Array.from(root.querySelectorAll(`mark.${HIT}`))) {
    parents.add(mark.parentNode!);
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  }
  parents.forEach((p) => p.normalize());
}

/** Wraps every occurrence (ignoring case) inside one text node. A match that spans several inline elements is not highlighted. */
function mark(node: Text, needle: string): void {
  const text = node.data;
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return; // a case mapping that changes the length would misplace the offsets
  let at = lower.indexOf(needle);
  if (at < 0) return;
  const out = document.createDocumentFragment();
  let from = 0;
  while (at >= 0) {
    out.append(text.slice(from, at));
    const hit = document.createElement("mark");
    hit.className = HIT;
    hit.textContent = text.slice(at, at + needle.length);
    out.append(hit);
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  out.append(text.slice(from));
  node.replaceWith(out);
}

/**
 * Highlights `query` in the rows under `root`, or only clears the highlights when it is empty or null.
 * The row being edited shows no highlight, since its text is the editor's.
 */
export function highlight(root: HTMLElement, query: string | null): void {
  clear(root);
  const needle = (query ?? "").toLowerCase();
  if (needle === "") return;
  for (const target of Array.from(root.querySelectorAll<HTMLElement>(TARGETS))) {
    if (target.querySelector(".cm-editor")) continue;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    nodes.forEach((n) => mark(n, needle));
  }
}

/** Marks the row of the cursor (the other rows lose the mark), so that its occurrences are drawn solid. */
export function markCurrent(root: HTMLElement, row: Element | null): void {
  root.querySelectorAll(".search-current").forEach((e) => e.classList.remove("search-current"));
  row?.classList.add("search-current");
}
