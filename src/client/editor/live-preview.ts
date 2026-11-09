// CodeMirror glue of the live preview: the inline-only Markdown language and a decoration plugin.
import { Language, defineLanguageFacet, syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { collectNodes, inlineParser, previewSpans } from "./preview";

const language = new Language(defineLanguageFacet(), inlineParser, [], "inline-markdown");
const hideMark = Decoration.replace({});

function build(view: EditorView): DecorationSet {
  const nodes = collectNodes(syntaxTree(view.state), view.state.doc.toString());
  const spans = previewSpans(nodes, view.state.selection.ranges);
  return Decoration.set(
    spans.map((s) => (s.hide ? hideMark : Decoration.mark({ class: s.cls })).range(s.from, s.to)),
    true,
  );
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = build(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

export const livePreview: Extension = [language, plugin];
