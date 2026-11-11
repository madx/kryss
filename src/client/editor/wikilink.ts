// CodeMirror parts of the wikilinks (PRD 5.17): the `[[` popup and the live preview of the brackets.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { fetchNotes, type NotesResult } from "../api";
import { filterNotes, insertText, parseWikilink } from "../logic/wikilink";
import { hasVaultName } from "../markdown/inline";

// The open file, relative to the Vault, which the `relative` link format needs.
let openFile = "";
export function setWikilinkFile(file: string): void {
  openFile = file;
}

// The index is fetched when the popup opens and dropped when it closes.
let index: Promise<NotesResult | null> | null = null;

/** The popup source: after `[[` and a word with no `]`, `|`, `#` or `^`. Only in Vault mode. */
export async function wikilinkSource(context: CompletionContext): Promise<CompletionResult | null> {
  const match = hasVaultName() ? context.matchBefore(/\[\[[^[\]|#^]*$/) : null;
  if (!match) {
    index = null;
    return null;
  }
  const loading = (index ??= fetchNotes());
  const result = await loading;
  if (!result) {
    index = null; // a failed fetch is tried again at the next keystroke
    return null;
  }
  if (context.aborted) return null;
  const query = match.text.slice(2);
  const options = filterNotes(result.notes, query).map((s): Completion => {
    const text = insertText(s, result.notes, result.newLinkFormat, openFile);
    const origin = s.alias === null ? s.folder : s.folder === "" ? s.note.name : `${s.note.name} · ${s.folder}`;
    return { label: text, displayLabel: s.alias ?? s.note.name, detail: origin, apply: text };
  });
  // Completing inside a link that already has its closing brackets replaces them too, so none are left behind.
  const to = context.state.sliceDoc(context.pos, context.pos + 2) === "]]" ? context.pos + 2 : context.pos;
  return options.length === 0 ? null : { from: match.from, to, filter: false, options };
}

const hide = Decoration.replace({});
const linkMark = Decoration.mark({ class: "cm-md-link" });

/** Marks every wikilink and, away from the cursor, hides its brackets and, with an alias, the target. */
function build(view: EditorView): DecorationSet {
  if (!hasVaultName()) return Decoration.none;
  const text = view.state.doc.toString();
  const sel = view.state.selection.ranges;
  const ranges = [];
  // Like the renderer, leave alone what sits in a code span or after a backslash.
  const code = [...text.matchAll(/`[^`]*`/g)].map((m) => [m.index!, m.index! + m[0].length] as const);
  for (let i = text.indexOf("[["); i >= 0; i = text.indexOf("[[", i + 1)) {
    if (text[i - 1] === "\\" || code.some(([from, to]) => i >= from && i < to)) continue;
    const link = parseWikilink(text, i);
    if (!link) continue;
    ranges.push(linkMark.range(i, link.end));
    if (sel.some((r) => r.from <= link.end && r.to >= i)) continue;
    const bar = text.indexOf("|", i);
    const aliasStart = bar >= 0 && bar < link.end && text.slice(bar + 1, link.end - 2).trim() !== "" ? bar + 1 : -1;
    ranges.push(hide.range(i, aliasStart >= 0 ? aliasStart : i + 2));
    ranges.push(hide.range(link.end - 2, link.end));
    i = link.end - 1;
  }
  return Decoration.set(ranges, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet) this.decorations = build(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

export const wikilinkPreview: Extension = plugin;
