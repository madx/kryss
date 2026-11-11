// The filter bar (PRD 5.14): a one-line CodeMirror editor in the header, always present, with the popup of `list:` and `due:` values.
import { acceptCompletion, autocompletion, startCompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, keymap, placeholder } from "@codemirror/view";
import { filterCompletion, filterPills } from "../logic/filter";
import { singleLine } from "./single-line";
import "./editor.css"; // the popup look is shared with the task editor
import "./filter-bar.css";

export type FilterBarOptions = {
  initial: string;
  /** The titles offered after `list:`. */
  listTitles(): string[];
  /** The text changed by typing: the lists narrow live. */
  onInput(text: string): void;
  /** Enter or Escape with the popup closed (a popup takes the key first): keep the text and go back to Normal mode. */
  onEnter(): void;
};

const keyMark = Decoration.mark({ class: "cm-filter-key" });
const valueMark = Decoration.mark({ class: "cm-filter-value" });

/** `list:` and `due:` terms are drawn as pills: a colored key and a gray value. */
function pillMarks(view: EditorView): DecorationSet {
  const marks = filterPills(view.state.doc.toString()).flatMap(({ key, value }) => [
    keyMark.range(key.from, key.to),
    ...(value.to > value.from ? [valueMark.range(value.from, value.to)] : []),
  ]);
  return Decoration.set(marks);
}

const pills = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = pillMarks(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = pillMarks(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

export function createFilterBar(options: FilterBarOptions) {
  const host = document.createElement("div");
  host.className = "filter-bar";
  let syncing = false;

  const source = (context: CompletionContext): CompletionResult | null => {
    const result = filterCompletion(context.state.doc.toString(), context.pos, options.listTitles());
    if (!result) return null;
    return { from: result.from, filter: false, options: result.options.map((o) => ({ label: o.label, apply: o.apply })) };
  };

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: options.initial,
      extensions: [
        singleLine,
        history(),
        placeholder("All"),
        pills,
        autocompletion({ override: [source], icons: false }),
        EditorView.contentAttributes.of({ "aria-label": "Filter" }),
        keymap.of([
          { key: "Enter", run: () => (options.onEnter(), true) },
          { key: "Escape", run: () => (options.onEnter(), true) },
          { key: "Tab", run: acceptCompletion },
          ...historyKeymap,
          ...standardKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !syncing) options.onInput(u.state.doc.toString());
        }),
      ],
    }),
  });

  /** Replaces the whole text with one the store already knows, so `onInput` is not called. */
  function replace(text: string) {
    if (view.state.doc.toString() === text) return;
    syncing = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
    syncing = false;
  }

  return {
    el: host,
    /** Shows a text that came from outside (a built-in view, an undo, a saved filter). */
    setText: replace,
    focus: () => view.focus(),
    /** Leaves the bar and drops its selection: some browsers keep drawing a blinking caret in an editable that lost the focus to a plain element. */
    blur() {
      view.contentDOM.blur();
      view.contentDOM.ownerDocument.getSelection()?.removeAllRanges();
    },
    isFocused: () => view.hasFocus,
    /** `gl`: focuses the bar, appends `list:` to the other terms and opens the popup. */
    appendListTerm() {
      view.focus();
      const text = view.state.doc.toString();
      const insert = text === "" || /\s$/.test(text) ? "list:" : " list:";
      view.dispatch({ changes: { from: text.length, insert }, selection: { anchor: text.length + insert.length } });
      startCompletion(view);
    },
  };
}

export type FilterBar = ReturnType<typeof createFilterBar>;
