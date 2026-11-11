// The filter bar (PRD 5.14): a one-line CodeMirror editor in the header, always present, with the popup of `list:` and `due:` values.
import { acceptCompletion, autocompletion, startCompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { filterCompletion } from "../logic/filter";
import { singleLine } from "./single-line";
import "./filter-bar.css";

export type FilterBarOptions = {
  initial: string;
  /** The titles offered after `list:`. */
  listTitles(): string[];
  /** The text changed by typing: the lists narrow live. */
  onInput(text: string): void;
  /** Enter with the popup closed: apply the text and go back to Normal mode. */
  onEnter(): void;
  /** The second Escape: the text was restored, go back to Normal mode. */
  onEscape(): void;
};

export function createFilterBar(options: FilterBarOptions) {
  const host = document.createElement("div");
  host.className = "filter-bar";
  let focusText = options.initial;
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
        autocompletion({ override: [source], icons: false }),
        EditorView.contentAttributes.of({ "aria-label": "Filter" }),
        keymap.of([
          { key: "Enter", run: () => (options.onEnter(), true) },
          {
            key: "Escape",
            run: () => {
              replace(focusText, true);
              options.onEscape();
              return true;
            },
          },
          { key: "Tab", run: acceptCompletion },
          ...historyKeymap,
          ...standardKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !syncing) options.onInput(u.state.doc.toString());
        }),
        EditorView.domEventHandlers({ focus: () => void (focusText = view.state.doc.toString()) }),
      ],
    }),
  });

  /** Replaces the whole text. `notify` tells the store, otherwise the store already knows. */
  function replace(text: string, notify: boolean) {
    if (view.state.doc.toString() === text) return;
    syncing = !notify;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
    syncing = false;
  }

  return {
    el: host,
    /** Shows a text that came from outside (a built-in view, an undo, a saved filter). */
    setText: (text: string) => replace(text, false),
    focus: () => view.focus(),
    blur: () => view.contentDOM.blur(),
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
