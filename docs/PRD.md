# PRD — todoapp

## 1. Goal

A **single-user, local** todo list manager whose source of truth is a **Markdown file**, editable both from the web app and from an external editor (Obsidian, Vim).

**Success criterion**: alternate between the app and a Markdown editor on the same file for a full week without ever losing or corrupting content.

**Target scale**: about 100 tasks spread across fewer than 10 lists.
No virtualization needed.

## 2. Architecture

- A **Bun server** owns the file.
  The browser never accesses it directly, which makes the app browser-independent (Safari included).
- Client and server exchange **JSON**.
  The server is the **only** component that parses and serializes Markdown.
- **Front end**: vanilla TypeScript, built by Bun from `index.ts`.
  No framework.
- **Configuration**: the file is set by the `TODO_FILE` environment variable, defaulting to `./todo.md`, and created empty if missing.
  One instance manages one file.
- **Network**: listens on `127.0.0.1` by default, **without authentication**.
  The `HOST` environment variable overrides the listening address, for example `HOST=0.0.0.0` when the app runs inside a container.
  Exposing the app beyond the loopback interface is an explicit opt-in.
- **Dependencies**: `xit-parse` is removed.
  `lucide` provides the icons (new list button, sync status), and only the icons in use are bundled.

### 2.1 API

| Route | Description |
|---|---|
| `GET /api/todos` | Returns the JSON document and an `ETag` header (hash of the file contents). Returns `422` if the file is invalid. |
| `PUT /api/todos` | Replaces the whole document. Requires `If-Match` with the known ETag. Returns `200` and the new ETag, `409` if the file changed, `422` if the file on disk is invalid. |
| `GET /api/events` | SSE stream: an event is emitted whenever the file changes and the change was not caused by the server itself. |

The `422` body contains the line number and the reason.
`GET` and `PUT` return the JSON document as the body and the `ETag` header, so the client always holds the canonical state.
The `422` body is `{ "line": number, "reason": string }`, with 1-based lines.
`PUT` returns `400` when the body is not a valid document, `428` when `If-Match` is missing, and `409` with the current ETag in the header when it does not match.
The ETag is a quoted hash of the exact bytes of the file.
The SSE event is named `change`, and its data is a JSON `ChangeEvent` (defined in `src/shared/types.ts`) carrying the whole new state, so the client updates without an extra `GET`.
The `ChangeEvent` is `{ "etag": string, "doc": TodoDocument }` when the file is valid, or `{ "etag": string, "error": { "line": number, "reason": string } }` when it is invalid.
`PUT` validates the body (non-empty single-line titles and texts, at most 2 levels), then serializes it, and returns the document parsed back from the canonical text, so surrounding whitespace is trimmed.
The server serializes `PUT` and file-change handling, and writes through a temporary file in the same directory followed by a rename.
The server watches the file's directory and, after a short debounce, compares the ETag of the file with the last one it knows, so its own writes and duplicate events emit nothing.
An external change that makes the file invalid still emits a `change` event, with the error in place of the document.
A watcher error (for example a deleted directory) is logged and does not stop the server.
The `PORT` environment variable sets the listening port, defaulting to 5173.
The `HOST` environment variable sets the listening address, defaulting to `127.0.0.1`.

### 2.2 JSON model

```json
{
  "lists": [
    {
      "title": "Groceries",
      "tasks": [
        { "text": "Milk", "done": false, "children": [
          { "text": "Semi-skimmed", "done": true }
        ] }
      ]
    }
  ]
}
```

A list is identified by its **position** in the array, not by its name.
Tasks have no stable identifier: `PUT` always sends the complete document.

## 3. Markdown file format

```markdown
## Groceries
- [ ] Milk
  - [x] Semi-skimmed
- [ ] Bread

## Work
- [x] Send the report
```

### 3.1 Rules

- The file is a sequence of `## List name` sections, each containing tasks.
- A task is a `- [ ] text` or `- [x] text` line.
  It is always **a single line**, and its text is non-empty.
- **Maximum 2 levels**: task and subtask, nested by indentation.
- A list name is plain text, on a single line, non-empty.
  Names are **not unique**.
- An empty list is valid.
  An empty file is valid (zero lists).
- Task text may contain inline Markdown, stored as-is.

### 3.2 Read tolerance

Accepted on read, then normalized on the next `PUT`: `-` or `*` bullets, uppercase `[X]`, indentation with tabs or 4 spaces.

### 3.3 Rejection (`422`)

Everything else is rejected with line and reason: frontmatter, free text, `#` or `###` headings, text before the first `##`, empty list name, tasks nested 3 or more levels deep, multi-line description under a task, inconsistent indentation.
**The server never writes to an invalid file.**

Indentation is read with a unit fixed by the first indented task of the file (one tab, 2 spaces or 4 spaces), and every later indent must be a whole multiple of that unit using the same characters.
`\r\n` line endings and blank lines are accepted on read.
A task with an empty text after trimming is rejected.

### 3.4 Canonical serialization

2-space indentation, one blank line between lists, trailing newline, `\n` line endings, `-` bullets.

## 4. Synchronization

- **External changes**: the server watches the file (`fs.watch`) and emits an SSE event, ignoring its own writes (ETag comparison).
  With no pending local changes, the client reloads silently.
- **Conflict** (`409` with pending local changes): a banner offers "keep my version" (new `PUT` with the up-to-date ETag) or "take the disk version".
  No automatic merge.
- **Invalid file**: the app shows the error (line and reason) in place of the lists, without overwriting anything.
- **Autosave**: 500 ms debounce, only one `PUT` in flight at a time, intermediate changes go out in the next one.
- **Server unreachable**: visible "unsaved" indicator, retries with increasing delay, `beforeunload` warning if unsent changes remain.
  No offline mode: without the server, there is no local cache.

## 5. User interface

### 5.1 Lists and selector

- A **selector** shows a single list or "All" (default on first launch).
- The choice is stored in `localStorage` **by index**; if the index no longer exists, fall back to "All" and forget the stale index, so a list appearing later at that position is not selected.
- Create, rename and delete a list from the selector.
  Names are typed in an inline input (header for a new list, list title for a rename): Enter confirms, Escape cancels, and a blur commits a non-empty name (like the task editor) and cancels an empty one.
  An external change discards the name being typed and closes the input.
  Deleting a non-empty list asks for confirmation with an inline Delete / Cancel prompt in the list header, and an empty list is deleted at once.
  A new list is appended at the end.
  The header has no title: it holds the selector on the left, a Lucide plus icon button to create a list, and the sync status symbol on the right.
- Lists cannot be reordered in the app (order is the file's order).
  Empty file: the app offers to create the first list.
- The theme follows the system (`prefers-color-scheme`), with no setting.

### 5.2 Tasks

- Add, edit in place, check and delete, with the mouse or with the modal keyboard keys of 5.9.
- Indent / outdent with `>` / `<` in Normal mode (5.9).
  Tab and Shift+Tab no longer indent: they only move the browser focus.
  A subtask cannot be indented, and a task that has subtasks cannot become a subtask.
- Move a task with the keyboard (up / down).
  Shortcuts: `J` / `K` in Normal mode, or Alt+↑ / Alt+↓.
  A top-level task swaps with the previous or next top-level task (it never enters a task that has subtasks), and at the top or bottom of a list it goes to the end of the previous list or the start of the next list.
  A subtask swaps with the previous or next subtask.
  At the edge of its parent, a subtask becomes the last subtask of the previous top-level task (up) or the first subtask of the next top-level task (down), and nothing happens when there is no such task in the list.
  The keys only cross the visible lists: with a single list shown, nothing leaves it.
  Nothing happens at the very top or bottom of the visible lists.
  The check rules of 5.3 apply (an unchecked task landing under a parent unchecks it, the old parent is recomputed).

### 5.3 Checking

- Checking a parent checks all its children.
  Unchecking a parent only changes the parent.
- When all children are checked, the parent is checked automatically.
- Unchecking a child, adding a child, or dropping an unchecked task under a checked parent unchecks the parent.
- When a subtask leaves a parent (move, outdent or delete) and the parent still has subtasks that are all checked, the parent becomes checked.
  A parent left with no subtask keeps its state.
- These rules only apply to UI actions: the server does not normalize states.
- A completed task stays in place.
  It is distinguished by its checked box and a different background or color (not by strikethrough text, to avoid confusion with `~~strikethrough~~`).

### 5.4 Drag and drop (Pragmatic drag and drop)

- Three drop zones per task: **before**, **after** and **as child**.
  A moved task takes its children with it.
- Dropping **after** a parent that has subtasks inserts the task as its **first subtask**, since the subtasks are displayed right below the parent row.
  If the moved task has subtasks itself, it cannot become a subtask and goes after the whole parent instead.
  Dropping before or after a subtask inserts the task at that position among the subtasks.
- Dropping into another list is possible in the "All" view, including into an empty list.
- Forbidden: dropping a task into one of its own descendants, and any drop that creates a third level.
- The drop zone comes from the pointer position in the hovered row: top quarter is before, middle half is as child, bottom quarter is after.
  When a child drop is refused for that row, the row is split in two halves (before, after) instead.
- A refused zone shows no indicator and a drop on it does nothing.
- The drag starts from the row's drag handle only, and the drop indicator is a line above or below the row, or a highlighted border for "as child".
- Only an empty list is a drop target of its own (the task is appended), a non-empty list is reached through the zones of its rows.
- The DOM is rebuilt on every change, so the drag and drop registrations are redone after each render.

### 5.5 Rendering and editing

- **Inline Markdown rendering only**: bold, italic, `code`, strikethrough, links.
  No images, headings, lists or raw HTML.
- At rest, the task is rendered.
  When editing, it switches to a **single-line CodeMirror 6 editor** with live preview (markers hidden away from the cursor), instantiated only on the task being edited.
  Enter commits, and Escape commits too and returns to Normal mode (5.9).
- **Links** are clickable and open in a new tab with `rel="noopener noreferrer"`.
  Allowed schemes: `http`, `https`, `mailto`, `obsidian`.
  Any other scheme (`javascript:`, `data:`…) is refused.
- Rendered text is sanitized (no raw HTML interpreted).
- Rendering is done by a small hand-written inline parser (`src/client/markdown/inline.ts`) that produces an AST, then builds the DOM with `createElement` and text nodes only, never `innerHTML`.
  Supported syntax: `**bold**`, `*italic*`, `_italic_`, `` `code` ``, `~~strikethrough~~`, `[label](url)`.
  Images (`![alt](url)`) render as nothing.
  Raw HTML and block syntax are shown as literal text.
- Unmatched markers are literal text.
  An underscore inside a word (`snake_case`) is never italic.
- Backslash escapes are supported for `` \ ` * _ ~ [ ] ( ) ``, any other backslash is literal.
- A link whose target is refused, or that contains whitespace, is shown as its literal source text.
  Before checking the scheme, whitespace, control and zero-width characters are removed (so `java\tscript:` is refused), and the cleaned URL is the one used as `href`.
  Relative URLs are refused.
- Links are not nested, and inline syntax inside a link label is supported.

### 5.6 Undo

- Global undo / redo stack over the document (Ctrl+Z / Ctrl+Shift+Z, or `u` / `U` in Normal mode), in memory.
  Each undo triggers a normal `PUT`.
- No confirmation to delete a task (undo recovers it).
- Inside a task's editor, Ctrl+Z first undoes typing (CodeMirror), then the global stack once the task is left.
- The stack is cleared on page reload and on any detected external change.
- The shortcut handler is global and does nothing while a task editor or a text input has focus, so that they keep their own undo.
  It is the same handler as the Normal mode handler of 5.9, so there is one global `keydown` listener and no second one.

### 5.7 Pure client logic decisions

- The pure logic lives in `src/client/logic/`, is immutable, and addresses tasks by `{ list, task, child? }` paths.
- An operation that is refused returns `null` (or the same document for simple edits), so the caller can detect a no-op.
- Keyboard move (`J` / `K`, Alt+↑ / Alt+↓) follows 5.2: it crosses parent and visible list boundaries, takes the visible list range as a parameter (default: the whole document), and returns `null` at the edges of that range and for a subtask with no task to join.
- Indent makes the task the last subtask of the previous task, and unchecks that parent if the indented task is unchecked.
- Reordering under the same parent never changes a check state.
- Moving or outdenting a subtask out of a parent, or deleting one, recomputes that parent: if it still has subtasks and all are checked, it becomes checked.
- A parent left with no subtask keeps its state.
- The undo stack is bounded to 100 snapshots.
- Texts and list titles are trimmed, line breaks become spaces, and empty values are refused.

### 5.8 Client state and UI decisions

- `src/client/store.ts` holds the document, the ETag, the sync status, the selected list and the history.
  Local changes enter through `commit(doc)` only, server documents through `replace(doc, etag)`, which clears the history.
- The sync statuses are saved, unsaved, saving, conflict, invalid, offline and error.
  Each one is shown in the header as a colored Lucide symbol with no text (check, pencil, loader, arrows, triangle, cloud-off and circle exclamation), the label being kept as tooltip and accessible name.
  "Error" means a `PUT` was refused with `400` or `428`, so retrying the same request cannot succeed: it is not retried, the local document is kept, a banner explains it and the next edit sends a new `PUT`.
  "Offline" means a save or the initial load failed on the network or with another unexpected status, and it is retried after 1 s, 2 s, 4 s and so on, capped at 30 s.
- A save that completes without changing the document only updates the status symbol, never the DOM of the lists, so typing is never interrupted.
- An SSE `change` event carries the new ETag and the parsed document or the parse error.
  With no pending change the client applies it directly without a `GET`, with pending changes it opens the conflict banner, and an event received during a `PUT` is handled once that `PUT` returns.
  A `GET` that returns after a local edit was made is ignored, so that the edit is never overwritten.
  When the SSE stream reconnects, the client reloads if nothing is pending, since events may have been missed.
- A `422` on `PUT` shows the invalid file error in place of the lists and keeps the local document in memory, and the next external change then opens the conflict banner.
- "Keep my version" re-sends the local document with the ETag of the disk version, and "take the disk version" reloads and discards local changes.
- Rows and list headers are focusable, and the keyboard shortcuts of 5.9 act on the focused row or header.
  Tab and Shift+Tab are plain focus keys and are never intercepted.
- Tasks are also added from the permanent input at the end of each list and from the "+" button of a top-level task, which stay for mouse use.
  The keyboard adds tasks with the positional keys of 5.9.
- The text typed in an add input is kept per list (or per parent task for subtasks), so it survives a re-render.
- Backspace no longer deletes a row.
- Lists are created, renamed and deleted with inline UI, never with `window.prompt` or `window.confirm`.
- Text editing goes through `view/edit-text.ts`, which delegates to the CodeMirror editor in `src/client/editor/`.
- The editor is created when a task enters editing and destroyed when it leaves, and `isEditing()` tells whether one exists, so the global undo can stay inactive meanwhile.
- Enter commits, Escape commits and leaves Insert mode (5.9), and a blur (click elsewhere, Tab, Shift+Tab) commits, so typing is never lost.
- Before a content render replaces the lists (external reload, canonical document of a `PUT`), every open editor is settled so that none is detached without being destroyed, and `isEditing()` stays accurate.
  If the task under the editor is unchanged in the new document, the typed text is committed through the normal edit path, so it is never lost.
  If the task changed or disappeared, which means an external change, the disk version wins and the edit is discarded.
- Line breaks, from paste or any other source, are replaced by one space each.
- Tab, Shift+Tab and Alt+arrows are not bound by the editor, so it never swallows them.
- The live preview uses the Lezer Markdown parser restricted to inline syntax (no block syntax, HTML, images or entities, plus strikethrough).
  Markers of a node are hidden unless a selection range is in or touching that node, and a link is only previewed when its URL is allowed.
- The cursor starts at the end of the text when editing begins.

### 5.9 Modal keyboard editing

The app is fully usable from the keyboard, with a Vim-like modal model.
The mouse keeps working as before.

**Modes**

- There are two modes only, Normal and Insert.
  There is no Visual mode and no Command mode.
- Normal is the default.
  Single keys act on the **cursor**, which is the focused row or list header.
- Insert is active while a text field has focus (the task editor or a list name input).
  It only ever edits the one focused task or name.
- A click on a task's text enters Insert mode on it, and a click on a row moves the cursor to it.

**Cursor and navigation**

- The cursor walks a flat sequence of stops in document order: the list headers and the task rows, subtasks included, across the visible lists.
  It stops at both ends and never wraps.
- `j` / `k` and ↓ / ↑ move to the next / previous stop, and `gg` / `G` jump to the first / last stop.
- In the "All" view, `h` / `l` move to the previous / next list header.
  They do nothing in a single-list view.
- `H` / `L` select the previous / next view in the sequence All, list 1, …, list n.
  The sequence wraps around, and focus goes to the first list header of the new view.
  The choice is stored in `localStorage` by index, as in 5.1.
- The cursor position is stored in `localStorage` as its index in the flat sequence of stops of the current view, next to the view index, and it is restored on load.
  An index that no longer exists is clamped to the last stop, and an empty view has no cursor.
- With no focused row or header, the first Normal key press puts the cursor on the first stop.
- Normal keys are active only when focus is on a row, on a list header or on nothing.
  Buttons and the selector keep their native behavior, Enter or Space activates them, and Escape on any of them puts the focus back on the cursor.
  The conflict banner is the first Tab stop and has no dedicated key.
- A pending first key (`g` or `d`) is cancelled by any other key or by a blur, with no timeout.
- Escape in Normal mode does nothing.

**Keys on a task**

| Key | Action |
|---|---|
| `x`, Space | toggle the check state (rules of 5.3) |
| `i`, Enter, F2 | edit the task, caret at the end |
| `dd`, Delete | delete the task with its subtree |
| `>` / `<` | indent / outdent |
| `J` / `K`, Alt+↓ / Alt+↑ | move down / up (5.2) |
| `u` / `U`, Ctrl+Z / Ctrl+Shift+Z | undo / redo |
| `o` / `O` | add a sibling below / above, always at the same level |
| `a` | on a top-level task, add its last subtask. On a subtask, same as `o`. |
| `I` / `A` | add the first / last subtask of the task. On a subtask, of its parent. |
| `?` | open or close the cheat sheet |

**Keys on a list header**

| Key | Action |
|---|---|
| `i`, Enter | rename the list in its inline name input |
| `dd` | delete the list: at once if empty, otherwise with the inline prompt, answered by `y` or Enter (confirm) and `n` or Escape (cancel) |
| `o`, `a`, `I` | add a task as the first task of the list |
| `A` | add a task as the last task of the list |
| `N` | create a list at the end and open its name input, from anywhere in Normal mode |

- `x`, `>`, `<`, `J` and `K` do nothing on a header, since lists cannot be reordered.
- `N` keeps the current view, except in a single-list view where it selects the new list so that the name input is visible.

**Positional add and Insert mode**

- `o`, `O`, `a`, `I` and `A` create an empty task at the target position, focus it and open the task editor on it.
  The empty task exists only in the client until it is committed, because an empty text is invalid in the file, and autosave never sends it.
- Enter commits a non-empty text and opens a new empty sibling right below it, at the same level, to chain several tasks.
  Enter on an empty text does nothing.
- Escape always commits and returns to Normal mode.
  A new task with an empty text is discarded, and the cursor returns to the row it started from.
  An existing task whose text was emptied gets its previous text back, and it is never deleted this way.
- A blur commits, as in 5.8.
- The list name input keeps its own rule: Enter confirms and Escape cancels.

**Focus after an action**

- After `dd`, the cursor goes to the next stop at the same position, or to the previous stop if the deleted one was last.
- After a move, indent, outdent, check, or leaving Insert mode, the cursor stays on the same task, following it to its new position.
- After an undo or a redo, the cursor goes to the first task that changed, or to the same position clamped to the visible range if it cannot be determined.
- After an external change, the cursor keeps the same position clamped to the visible range, since tasks have no identity.

**Footer, statusline and cheat sheet**

- A fixed footer, like the header, shows the mode (NORMAL or INSERT, with a different color for each) and a short statusline.
- The statusline shows the done / total task counts of the current view and of the whole document, then the index of the list that holds the cursor over the total number of lists.
  Subtasks count as tasks.
- `?` opens a static cheat sheet overlay that lists every key, closed with Escape or `?`.
  It is not configurable.

**Implementation decisions**

- The key handling is a pure function in `src/client/shortcuts.ts` that takes the mode, the kind of focused target, the pending prefix and the key, and returns an action.
  The DOM layer only applies the action.
- The positional add, the cursor movement and clamping, and the view cycling are pure functions in `src/client/logic/`, with the same immutable and `null` conventions as 5.7.
- The empty task of a positional add is never put in the document.
  The pure logic only computes where it goes (`insertTarget`) and commits it once it has text (`commitInsert`), and the view layer renders the empty row at that position.
  A re-render while it is open (external change) drops it.
- The editor reports how it ended (Enter, Escape, blur, or settled by a re-render) so that the app can chain, return to the origin row or keep the focus where the user clicked.
  A blur that drops an empty new task does not move the focus.
- The cursor is the DOM focus.
  The app remembers the last cursor index, and a re-render that loses the focus puts it back on that index, clamped to the visible range.
- Creating a list through the UI selects it only in a single-list view, in the "All" view the view is kept.

## 6. Tests

- **Parser / serializer** (`bun test`): empty file, empty list, 2 levels, each `422` case, syntax tolerance, normalization, stable round-trip.
- **API**: server started on a temporary file; `GET` with ETag, `PUT` with `If-Match`, `409`, `422`, SSE after external modification.
- **Pure client logic**: checking rules, move and depth validation, undo stack, the key resolution of 5.9 (modes, prefixes, target kinds), positional add, cursor clamping, view cycling and statusline counts.
- No e2e in v1: drag and drop and CodeMirror are verified by hand.

## 7. Out of scope

Authentication and network access; multi-user; Yjs / CRDT; offline mode; frontmatter and file-based settings; `xit` format; automatic conflict merging; list reordering; due dates, tags, priorities, search, filters; hiding completed tasks; non-inline Markdown; multi-line tasks; e2e tests; keyboard accessibility of drag and drop beyond the up / down moves; Visual and Command modes; counts, operator and motion grammar, and registers; custom keymaps; jumping to the first or last item of another list.
