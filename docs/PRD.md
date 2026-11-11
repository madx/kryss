# PRD — Kryss

## 1. Goal

A **single-user, local** todo list manager whose source of truth is a **Markdown file**, editable both from the web app and from an external editor (Obsidian, Vim).

**Success criterion**: alternate between the app and a Markdown editor on the same file for a full week without ever losing or corrupting content.

**Target scale**: about 100 tasks spread across fewer than 10 lists.
No virtualization needed.

## 2. Architecture

- A **Bun server** owns the file.
  The browser never accesses it directly, which makes the app browser-independent (Safari included).
- Client and server exchange **JSON** only.
  The server is the **only** component that parses Markdown.
  The serializer is a pure function in `src/shared/`, used by the server to write the file and by the client to build the Markdown view and the clipboard text.
- **Front end**: vanilla TypeScript, built by Bun from `index.ts`.
  No framework.
- **Configuration**: the file is set by the `TODO_FILE` environment variable, defaulting to `./todo.md`, and created empty if missing.
  One instance manages one file.
- **Network**: listens on `127.0.0.1` by default, **without authentication**.
  The `HOST` environment variable overrides the listening address, for example `HOST=0.0.0.0` when the app runs inside a container.
  Exposing the app beyond the loopback interface is an explicit opt-in.
- **Dependencies**: `xit-parse` is removed.
  `lucide` provides the icons (Markdown view toggle, sync status, due date arrow), and only the icons in use are bundled.
  `@codemirror/autocomplete`, from the CodeMirror 6 family already in use, provides the due date popup (5.13).

### 2.1 API

| Route | Description |
|---|---|
| `GET /api/todos` | Returns the JSON document and an `ETag` header (hash of the file contents). Returns `422` if the file is invalid. |
| `PUT /api/todos` | Replaces the whole document. Requires `If-Match` with the known ETag. Returns `200` and the new ETag, `409` if the file changed, `422` if the file on disk is invalid. |
| `GET /api/events` | SSE stream: an event is emitted whenever the file changes and the change was not caused by the server itself. |

`GET` and `PUT` return the JSON document as the body and the `ETag` header, so the client always holds the canonical state.
The `422` body is `{ "line": number, "reason": string }`, with 1-based lines.
`PUT` returns `400` when the body is not a valid document, `428` when `If-Match` is missing, and `409` with the current ETag in the header when it does not match.
The ETag is a quoted hash of the exact bytes of the file.
The SSE event is named `change`, and its data is a JSON `ChangeEvent` (defined in `src/shared/types.ts`) carrying the whole new state, so the client updates without an extra `GET`.
The `ChangeEvent` is `{ "etag": string, "doc": TodoDocument }` when the file is valid, or `{ "etag": string, "error": { "line": number, "reason": string } }` when it is invalid.
`PUT` validates the body (non-empty single-line titles and texts, at most 2 levels, and the saved filters of 5.14, where a body without a `filters` array is a `400`), then serializes it, and returns the document parsed back from the canonical text, so surrounding whitespace is trimmed.
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
  ],
  "filters": [
    { "name": "Work this week", "text": "list:Work due:week" }
  ]
}
```

A list is identified by its **position** in the array, not by its name.
Tasks have no stable identifier: `PUT` always sends the complete document.
`filters` are the saved filters of 5.14, in order, with unique non-empty single-line names and non-empty single-line texts.
They are stored in the frontmatter of the file (3.2.1), and `GET`, `PUT` and the SSE event carry them with the lists.

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
- A due date (5.13) is plain task text, `-> 2026-11-22` for example.
  The parser and the serializer do not know about it, and the JSON model has no date field.

### 3.2 Read tolerance

Accepted on read, then normalized on the next `PUT`: `-` or `*` bullets, uppercase `[X]`, indentation with tabs or 4 spaces.

### 3.2.1 Frontmatter

Obsidian adds a YAML frontmatter to notes, so a leading block opened by `---` on the first line and closed by `---` or `...` is ignored on read, except for one key, `filters`.
The blank lines that follow it are part of the block.
The server keeps the block byte for byte and writes it back unchanged in front of the serialized lists on every `PUT`, except for the `filters` block described below.
Every other line of the frontmatter never reaches the client, and error lines still count the frontmatter lines.
A block that is not closed is rejected (`422`, line 1).

**Saved filters**

- The saved filters of 5.14 live in one top-level key, `filters`, written as `filters:` alone on its line and followed by one indented line per filter, `  "name": "text"`.
- The name and the text are JSON double-quoted strings, which are valid YAML, so the server needs no YAML library and reads and writes only this block, line by line.
- The block ends at the first line that is not indented.
  `filters:` followed by nothing is an empty list, and an absent key means no saved filters.
- A second `filters` key, a line of the block that is not `"name": "text"`, an empty name or text, or a duplicate name is rejected (`422`, with that line).
  A `filters` key written by hand in another YAML style (a flow map, single quotes) is rejected the same way instead of being rewritten.
- On `PUT`, a `filters` equal to the one on disk leaves the block untouched, byte for byte.
  Otherwise the server replaces the block in place, or adds it before the closing delimiter when the key was absent.
  With no frontmatter at all, it creates one in front of the lists, followed by a blank line.
  Deleting the last filter removes the key, and a frontmatter left with nothing else in it is removed too.
- The rest of the frontmatter is never edited.

```markdown
---
filters:
  "Work this week": "list:Work due:week"
---

## Work
- [ ] Send the report -> 2026-W46
```

### 3.3 Rejection (`422`)

Everything else is rejected with line and reason: an unclosed frontmatter, a malformed `filters` block, free text, `#` or `###` headings, text before the first `##`, empty list name, tasks nested 3 or more levels deep, multi-line description under a task, inconsistent indentation.
**The server never writes to an invalid file.**

Indentation is read with a unit fixed by the first indented task of the file (one tab, 2 spaces or 4 spaces), and every later indent must be a whole multiple of that unit using the same characters.
`\r\n` line endings and blank lines are accepted on read.
A task with an empty text after trimming is rejected.

### 3.4 Canonical serialization

2-space indentation, one blank line between lists, trailing newline, `\n` line endings, `-` bullets.
The serializer is shared by the server and the client (2), and it serializes a whole document, a list or a task, so that the Markdown view and the clipboard text use the same canonical form.
A whole document ends with a newline when it is not empty, while a list and a task are returned without a trailing newline, so that the clipboard text and the register text hold exactly the lines of the element.
A whole document is its lists joined by a blank line, followed by that final newline.

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

### 5.1 Lists

- The app shows the lists of the document through the current filter of 5.14, and the filter bar replaces the former list selector.
- Create, rename and delete a list.
  Names are typed in an inline input that replaces the list title: Enter, Escape and a blur commit a non-empty name (like the task editor) and cancel an empty one.
  An external change discards the name being typed and closes the input.
  Deleting a list is immediate, with `dd` (5.9, 5.12), and undo recovers it.
  A new list is created at once, appended at the end and called "New list", as one undoable change.
  The filter is cleared (5.14) so that the new list is visible, and the name input opens on its title with the name selected.
  Cancelling (an empty name) keeps "New list".
  The header has no title: it holds the filter bar of 5.14 on the left and the siblings toggle of 5.14 and the Markdown view toggle of 5.11 aligned on the right.
  There is no button to create a list: `+` does it (5.9).
- Lists are reordered with the keyboard only (5.2, 5.9), also while a filter is active, where they move over the visible lists (5.14).
  Empty file: the app offers to create the first list.
- The theme follows the system (`prefers-color-scheme`), with no setting.
- When the page is installed as an app, the titlebar uses the list card background, set with two `theme-color` meta tags (light and dark) that must stay equal to `--color-surface`.

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
  With an empty filter the keys cross every list, and nothing happens at the very top or bottom of the document.
  While a filter is active they follow the visible rows (5.14): the neighbours above are the visible ones, hidden tasks are jumped over, and the visible lists are the lists that have a visible task.
  The check rules of 5.3 apply (an unchecked task landing under a parent unchecks it, the old parent is recomputed).
- Move a list with the same shortcuts on a list header (5.9).
  `J` / Alt+↓ moves the list below the next list, and `K` / Alt+↑ moves it above the previous list.
  There is no wrapping: nothing happens at the first or last list.
  While a filter is active, the previous and next lists are the previous and next visible lists, and the hidden lists between them keep their place (5.14).
  The cursor stays on the moved list header, which is scrolled into view.
- `H` / `L` move the whole list that holds the cursor, up / down, from a list header or from any task of the list.
  They behave like `K` / `J` on a header, with the same edges and the same rule under a filter.
  From a task, the cursor stays on that task, in the moved list.
  Each move is one undoable change (5.6).

### 5.3 Checking

- Checking a parent checks all its children.
  Unchecking a parent only changes the parent.
- When all children are checked, the parent is checked automatically.
- Unchecking a child, adding a child, or moving or indenting an unchecked task under a checked parent unchecks the parent.
- When a subtask leaves a parent (move, outdent or delete) and the parent still has subtasks that are all checked, the parent becomes checked.
  A parent left with no subtask keeps its state.
- These rules only apply to UI actions: the server does not normalize states.
- Checking a task also rewrites its due date, as described in 5.13.
- A completed task stays in place.
  It is distinguished by its checked box and a muted text color, with no background (not by strikethrough text, to avoid confusion with `~~strikethrough~~`).

### 5.4 Drag and drop (removed)

- The app has no drag and drop, for tasks or for lists, and no drag library.
  The app is keyboard first, and every move has a key: `J` / `K` and Alt+↑ / Alt+↓ (5.2), `>` and `<` for the depth, and `dd` then `p` to carry a task or a list across lists.
- Nothing starts a drag, no row or header is a drop target, and there is no drop indicator or dimmed row.
- This section keeps its number so that the references to the other sections stay valid.

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
- A due date (`-> 2026-11-22`) is recognized by the same inline parser, as one more node, and rendered as a pill (5.13).
  It is not Markdown syntax, so the file stays plain text.

### 5.6 Undo

- Global undo / redo stack over the document (Ctrl+Z / Ctrl+Shift+Z, or `u` / `U` in Normal mode), in memory.
  Each undo triggers a normal `PUT`.
- No confirmation to delete a task (undo recovers it).
- Inside a task's editor, Ctrl+Z first undoes typing (CodeMirror), then the global stack once the task is left.
- Each entry remembers the filter text that was active when the change was made, and undo and redo restore it, so a change made under another filter is never invisible.
  Undoing a move made under a filter returns to that filter, with the task or list back at its place.
- The snapshots hold the lists only, so undo and redo never change the saved filters, and saving or deleting a saved filter is not part of the history.
  The text typed in the filter bar is not part of it either.
- The stack is cleared on page reload and on any detected external change.
- The shortcut handler is global and does nothing while a task editor or a text input has focus, so that they keep their own undo.
  It is the same handler as the Normal mode handler of 5.9, so there is one global `keydown` listener and no second one.

### 5.7 Pure client logic decisions

- The pure logic lives in `src/client/logic/`, is immutable, and addresses tasks by `{ list, task, child? }` paths.
- An operation that is refused returns `null` (or the same document for simple edits), so the caller can detect a no-op.
- Keyboard move (`J` / `K`, Alt+↑ / Alt+↓) follows 5.2: it crosses parent and visible list boundaries, takes the visible list range as a parameter (default: the whole document), and returns `null` at the edges of that range and for a subtask with no task to join.
- List move takes the list to move, a target list and `before` or `after`, and returns `null` when the order would not change.
  The keyboard calls it with the previous or next visible list, so that a move under a filter only changes which list is the target.
  Like the task move, the keyboard resolution takes the visible list range as a parameter (default: the whole document).
- Indent makes the task the last subtask of the previous task, and unchecks that parent if the indented task is unchecked.
- Reordering under the same parent never changes a check state.
- Moving or outdenting a subtask out of a parent, or deleting one, recomputes that parent: if it still has subtasks and all are checked, it becomes checked.
- A parent left with no subtask keeps its state.
- The undo stack is bounded to 100 snapshots.
- Texts and list titles are trimmed, line breaks become spaces, and empty values are refused.

### 5.8 Client state and UI decisions

- `src/client/store.ts` holds the document, the ETag, the sync status, the filter text, the pinned rows of 5.14 and the history.
  Local changes enter through `commit(doc)`, server documents through `replace(doc, etag)`, which clears the history, and the saved filters through `commitFilters(filters)`, which saves them like any change but leaves the history alone.
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
- Tasks are added with the positional keys of 5.9 only.
  There is no "+ Add a task" or "+ Add a subtask" line.
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
The mouse only keeps what 5.9 and 5.10 list: a click on a task's text or on a row, a click on a checkbox, a click on a list title, a click on the filter bar, the buttons of the alerts and the Markdown view, and the click-outside close of the cheat sheet.

**Modes**

- There are two modes only, Normal and Insert.
  There is no Visual mode and no Command mode.
  A focused filter bar is Insert mode too, but it has its own color and label, FILTER (5.10, 5.14), and so does the search input, SEARCH (5.10, 5.15).
- Normal is the default.
  Single keys act on the **cursor**, which is the focused row or list header.
- Insert is active while a text field has focus (the task editor or a list name input).
  It only ever edits the one focused task or name.
- A click on a task's text enters Insert mode on it, and a click on a row moves the cursor to it.

**Cursor and navigation**

- The cursor walks a flat sequence of stops in document order: the list headers and the task rows, subtasks included, across the visible lists.
  It stops at both ends and never wraps.
- `j` / `k` and ↓ / ↑ move to the next / previous stop, and `gg` / `G` jump to the first / last stop.
- `h` / `l` move to the previous / next visible list header, in every view.
- `gf` focuses the filter bar, `gF` opens the saved filters, `ga`, `gt` and `gw` set the filter to the built-in views, and `gl` starts a list filter (5.14).
  `sh` toggles the display of the siblings of a match (5.14).
  `/` starts an incremental search, `n` / `N` jump to the next / previous match and Escape ends it (5.15).
  `H` / `L` move the whole list up / down (5.2).
  When the filter is set by a key, the cursor goes to the first stop.
- The cursor position is stored in `localStorage` as its index in the flat sequence of stops of the current view, next to the filter text, and it is restored on load.
  An index that no longer exists is clamped to the last stop, and an empty view has no cursor.
- With no focused row or header, the first Normal key press puts the cursor on the first stop.
- Normal keys are active only when focus is on a row, on a list header or on nothing.
  Buttons keep their native behavior, Enter or Space activates them, and Escape on any of them puts the focus back on the cursor.
  The filter bar and the saved filter picker have their own keys (5.14), and Escape on them puts the focus back on the cursor.
  The conflict banner is the first Tab stop and has no dedicated key.
- `sm` toggles the Markdown view of 5.11.
  `yy`, `dd`, `cc` and `p` work on the register of 5.12, and `yy` copies the content of the Markdown view while it is open.
- A pending first key (`g`, `d`, `y`, `c` or `s`) is cancelled by any other key or by a blur, with no timeout.
- Each prefix has one meaning: `g` goes (cursor, filter and help), `s` shows or switches a display, `c` changes a value, `d` deletes and `y` yanks.
- Escape in Normal mode ends the active search (5.15), and does nothing otherwise.

**Keys on a task**

| Key | Action |
|---|---|
| `x`, Space | toggle the check state (rules of 5.3) |
| `i`, Enter, F2 | edit the task, caret at the end |
| `dd`, Delete | delete the task with its subtree, into the register (5.12) |
| `yy` | copy the task with its subtree into the register (5.12) |
| `cc` | change the task: open the editor with an empty text (5.12) |
| `cd` | change the due date: open the editor on the date and its popup (5.13) |
| `cl` | change the name of the list of the task: open its name input with an empty name (5.12) |
| `p` | paste the register below the task (5.12) |
| `>` / `<` | indent / outdent, over the visible rows under a filter (5.14) |
| `J` / `K`, Alt+↓ / Alt+↑ | move down / up (5.2), over the visible rows under a filter (5.14) |
| `H` / `L` | move the whole list of the task up / down (5.2) |
| `u` / `U`, Ctrl+Z / Ctrl+Shift+Z | undo / redo |
| `o` / `O` | add a sibling below / above, always at the same level |
| `a` | on a top-level task, add its last subtask. On a subtask, same as `o`. |
| `I` / `A` | add the first / last subtask of the task. On a subtask, of its parent. |
| `g?` | open or close the cheat sheet |
| `/` | start an incremental search (5.15) |
| `n` / `N` | next / previous match of the active search (5.15) |

**Keys on a list header**

| Key | Action |
|---|---|
| `i`, Enter | rename the list in its inline name input (a click on the title does the same) |
| `dd`, Delete | delete the list at once, into the register (5.12), with no prompt since the register and undo recover it |
| `yy` | copy the list into the register (5.12) |
| `cc`, `cl` | change the list: open the name input with an empty name (5.12) |
| `p` | paste the register as the first task of the list, or after the list if it holds a list (5.12) |
| `o`, `a`, `I` | add a task as the first task of the list |
| `A` | add a task as the last task of the list |
| `J` / `K`, Alt+↓ / Alt+↑ | move the list down / up, over the visible lists under a filter (5.14) |
| `H` / `L` | move the list up / down, like `K` / `J` |
| `+` | create a list at the end and open its name input, from anywhere in Normal mode |
| `/`, `n` / `N` | search, as on a task (5.15) |

- `J` and `K` move the list down and up, like Alt+↓ and Alt+↑, as described in 5.2.
  `H` and `L` do the same on a header, and also work on a task.
- `x`, `>`, `<` and `cd` do nothing on a header.
- `+` creates the list as in 5.1 and clears the filter, so that the new list is visible.
  Once the name is confirmed, the cursor stays on the new list header.

**Positional add and Insert mode**

- `o`, `O`, `a`, `I` and `A` create an empty task at the target position, focus it and open the task editor on it.
  The empty task exists only in the client until it is committed, because an empty text is invalid in the file, and autosave never sends it.
- Enter commits a non-empty text and opens a new empty sibling right below it, at the same level, to chain several tasks.
  Enter on an empty text does nothing.
- Escape always commits and returns to Normal mode.
  A new task with an empty text is discarded, and the cursor returns to the row it started from.
  An existing task whose text was emptied gets its previous text back, and it is never deleted this way.
- A blur commits, as in 5.8.
- While a filter is active, the new task is pinned so that it stays visible (5.14), and with no cursor row, for example an empty result, these keys do nothing.
- The list name input follows the same rule as the task editor: Enter, Escape and a blur commit a non-empty name and cancel an empty one.

**Focus after an action**

- After `p`, the cursor goes to the pasted element (5.12).
- After `dd`, the cursor goes to the next stop at the same position, or to the previous stop if the deleted one was last.
- After a move, indent, outdent, check, or leaving Insert mode, the cursor stays on the same task, following it to its new position.
- After an undo or a redo, the cursor goes to the first task that changed, or to the same position clamped to the visible range if it cannot be determined.
- After an external change, the cursor keeps the same position clamped to the visible range, since tasks have no identity.

**Footer, statusline and cheat sheet**

- A fixed footer, like the header, shows the mode (NORMAL in accent blue, INSERT in green, FILTER in orange while the filter bar has the focus and SEARCH in yellow while the search input has the focus, as in 5.10), the done / total task counts of the current view and the sync status symbol on the right.
  The mode badge is a corner block of the footer, fully rounded in a wide window, and with only its top-right corner rounded in a narrow one, where it touches the left and bottom edges of the window.
- The counts are those of the visible tasks of the current filter (5.14), and each visible list also shows its own done / total counts of visible tasks at the top right of its header.
  Subtasks count as tasks.
- The statusline also shows a short transient text after a copy, as described in 5.12.
- `g?` opens a static cheat sheet overlay that lists every key, closed with Escape or `g?`.
  A bare `?` does nothing, since the keys that start with `g` all mean "go".
  The keys are drawn as accent-colored chips, one per key, the group titles are in the accent color, the filter grammar is in the filter orange, and the groups flow in as many columns as fit.
  It is not configurable.

**Implementation decisions**

- The key handling is a pure function in `src/client/shortcuts.ts` that takes the mode, the kind of focused target, the pending prefix, whether a search is active and the key, and returns an action.
  The DOM layer only applies the action.
- The positional add, the cursor movement and clamping, and the filter parsing and matching (5.14) are pure functions in `src/client/logic/`, with the same immutable and `null` conventions as 5.7.
- The empty task of a positional add is never put in the document.
  The pure logic only computes where it goes (`insertTarget`) and commits it once it has text (`commitInsert`), and the view layer renders the empty row at that position.
  A re-render while it is open (external change) drops it.
- The editor reports how it ended (Enter, Escape, blur, or settled by a re-render) so that the app can chain, return to the origin row or keep the focus where the user clicked.
  A blur that drops an empty new task does not move the focus.
- The cursor is the DOM focus.
  The app remembers the last cursor index, and a re-render that loses the focus puts it back on that index, clamped to the visible range.
- Creating a list through the UI, or pasting a list (5.12), clears the filter so that the list is visible.

### 5.10 Visual design

The goal is a compact and balanced UI that stays comfortable in a narrow window, with the color palette unchanged.
The static prototype that settled these decisions was a throwaway and is not kept.

**Layout and density**

- The page is one centered column that fills the window and stops growing at `--content-width` (720 px).
  The header, the list panels and the footer share the same left edge.
- The footer box is the column itself: centered, at most `--content-width` wide, with its own background and nothing drawn outside it, and full width in a narrow window.
  The search input of 5.15 is stacked right above it, with the same width, while it is open.
- A list is a flat panel: surface background, 8 px radius, no border and no shadow, with 8 px between panels.
  Panels are distinguished from the page by their background only.
- Task text is 12 px (the same as in Obsidian) with a line height of 20 px, rows have 3 px of vertical padding and no gap between them, which makes a row about 26 px tall.
  Text size and row height are the same at every window width.
- Horizontal spacing is tight in a narrow window and grows a little in a wide one, through `clamp()` tokens of the viewport width.
  The page gutter goes from 6 to 16 px, the panel padding from 4 to 6 px, the row padding and the checkbox gap from 6 to 8 px, and the subtask indent from 16 to 24 px.
- The header is fixed and about 32 px tall, the footer is fixed and about 24 px tall, and neither has a border or a separator.
- The scrollbar of the scroll area appears only when the content overflows, and no space is reserved for it, so the layout stays centered and balanced.
  It is 10 px wide (an 8 px thumb with 1 px of padding).
  When it appears, the panels shrink by its width and their edges move a few pixels away from those of the header and the footer, which is accepted.

**Rows and actions**

- A row is a checkbox (a 12 px chip with a 1 px border) and the task text.
  A completed task has a checked box and a muted text color, with no background.
- Hovering a row with the mouse slightly highlights it.
- A row and a list header have no button: no delete "×", no hover "+", no rename icon and no drag handle.
  Deleting, adding and moving are keys only (5.9).
- A click on the list title opens the name input, like a click on the text of a task opens its editor.
- A list ends with its last task: there is no "+ Add a task" line and no "+ Add a subtask" line.

**Due date pill**

- A due date is a small chip in the task text: a Lucide `ArrowRight` icon (a `CircleExclamationPoint` icon instead when the date is overdue and the task is not completed), then the date exactly as written, with no `->`.
  It follows the radii and spacing tokens, with a fully rounded shape (the pill radius), a semi-bold date and a tint stronger than the hover tint so that it stands out.
- Its colors depend on the state of 5.13: the danger color for overdue, the accent color for due now, and the muted color for later.
  On a completed task the pill is neutral, in the same muted text color as the task, with no state color.
- In the editor, the same colors apply to the literal text of a valid date, with no icon and no widget.

**Cursor and inputs**

- The cursor row and the cursor list header share one look: a tinted background and a 2 px bar on the left, in the color of the current mode.
  The mode color is accent blue in Normal mode and green in Insert mode, the same as the footer badge.
  The focused filter bar is orange (`--color-filter`), with the same tint and 2 px bar, and the footer badge says FILTER in that color.
  The search input is yellow (`--color-match`) in the same way, and the footer badge says SEARCH in that color.
- An input never looks like a box.
  It replaces the text or the placeholder it stands for, with the same font and size and no border or background of its own, and the cursor look in Insert color is the only signal.
  This applies to the task editor and to the list name input (which edits the title in place).
- The name input of a new list is the title of its section, with the same look as a rename.

**Alerts**

- Banners and notices are one component: a full-width strip with a 6 px radius, small padding, 14 px text (the body token, larger than the 12 px tasks), no border and a tinted background.
  Amber is for warnings (the conflict banner, the empty file and the unreachable server), and red is for errors (the invalid file and rejected requests).
- Its actions are text buttons on the same line, and they wrap below the message when the window is narrow.
- Banners sit between the header and the scroll area and never scroll away.
  The invalid file, empty file and unreachable server notices use the same strip in place of the lists.

**Filter bar and picker**

- The filter bar is a one-line input at the left of the header, in the body size, with the muted placeholder `All` when it is empty.
  It has no border or box of its own, like the other inputs, and the cursor look in Insert color is the only signal that it is focused.
- The saved filter picker opens below the bar and uses the panel look (surface background, 6 px radius items), with a tint on the highlighted item.
  It is a listbox usable with ↑ / ↓, Enter and Escape, it closes on an outside click, and it adds no dependency.
- The popups of `list:` and `due:` are the CodeMirror autocomplete popups of 5.13, with the same look.

**Cheat sheet**

- The overlay is inset by the page gutter and uses the panel look, with a fixed title and a vertical scroll limited to the window height.
- In a wide window the entries are two columns, keys then description.
  In a narrow window each entry is stacked, with the keys in `kbd` style above the muted description, the breakpoint being 520 px (a literal in the media query, since a media query cannot read a token).

**Tokens**

- Font sizes are 14 px (body, alerts and the filter bar) and 12 px (tasks, list titles, counts, footer, cheat sheet, `kbd`).
- Radii are 8 px (panels), 6 px (rows, buttons, alerts, inputs) and 4 px (chips: `code`, `kbd`, mode badge, checkbox).
- Spacing steps are 2, 4, 6, 8, 12 and 16 px, plus the responsive `clamp()` tokens above.
- Icons are Lucide SVG at 14 px with a stroke of 2, never text glyphs, and icon buttons are 22 px squares.
- Every size, radius and spacing value in the stylesheets comes from a token in `theme.css`, and a new value needs a new token first.
- Green means "saved" for the sync symbol and Insert for the mode, and these two never appear in the same place.

### 5.11 Markdown view

The Markdown view shows the Markdown equivalent of the current view, as the app holds it, to inspect it and to copy it in full or in part.
It is read-only: there is no editing and no text `PUT`, and the file stays editable from an external editor.

**Opening and closing**

- A header button toggles it, with the Lucide `square-m` icon and the label "Export as Markdown" as tooltip and accessible name.
  `sm` does the same in Normal mode, and `m` is left free for another feature.
- The view replaces the task area in place, between the header and the footer.
  The header, the filter bar, the SSE connection and the sync state stay alive.
- The button, `sm` or Escape closes it, and the cursor goes back to where it was.
- It is not stored in `localStorage`, so a reload always lands on the task UI.

**Content**

- It shows the canonical Markdown of the document held by the page, unsaved edits included: the visible rows of the current filter (5.14), which are all the lists when the filter is empty.
  The client builds it with the shared serializer of 3.4, which does not write the frontmatter.
- It is a monospace block of selectable text, so the native selection and Ctrl+C copy any part of it.
- Opening the view needs no save and no request, so it also works during a conflict or when the server cannot be reached.
- The filter keys still work, and the view is rebuilt whenever the document or the filter changes, including after an SSE `change` event.
  A rebuild that gives the same text leaves the DOM alone, so a text selection survives.
- An empty export shows a muted "Nothing to export" placeholder.
  When the page holds no document, the view shows the same notice as the task UI in place of the block: the `422` line and reason, or the unreachable server.
  In both cases the copy button and `yy` are disabled.

**Copying**

- A copy button at the top right of the block copies the whole export with `navigator.clipboard`, and `yy` does the same from the keyboard.
- Both show the transient footer text of 5.12.
- While the view is open, the other Normal keys are ignored, so a task cannot be changed without being seen.
  `ga`, `gt`, `gw`, `gl`, `gf`, `gF`, `sh`, `sm`, `yy`, Escape and `g?` keep working.
  `/`, `n` and `N` do nothing there, and opening the view ends the active search (5.15).

**Implementation decisions**

- The export is a pure function in `src/client/logic/` that applies the shared serializer to the visible rows of the current filter.
- The `sm` and `yy` resolution belongs to the pure key function of 5.9, and its output depends on whether the view is open.
- Escape closes the view even when the focus is on a button, and undo and redo are ignored while it is open.
- The `square-m` icon is called `SquareLetterM` in the installed Lucide package.

### 5.12 Register, change and paste

`dd`, `yy`, `cc` and `p` work on a register, in Normal mode only.
They are keyboard keys with no mouse equivalent, and the mouse controls neither fill the register nor write the clipboard.

**Register**

- The register is one in-memory slot that holds either a task with its subtree or a list with its tasks, as a self-contained copy of the JSON model.
  It is never stored in `localStorage`, so a reload empties it.
- An external change of the file and a change of the filter leave it alone, since it refers to no document state, unlike the undo stack of 5.6.
- `p` does not consume it, so the same element can be pasted several times.
  With an empty register, `p` does nothing.

**Keys**

- `dd` and `Delete` delete the element under the cursor and put it in the register.
  On a list header the deletion is immediate, with no prompt, because the register and undo recover the list.
- `yy` puts the element in the register without changing the document.
- `cc` opens the editor of a task with an empty text, or the name input of a list with an empty name.
  The subtasks and the check state are kept, the register is not touched, and `cc` is one undoable change once committed.
  Escape on an empty editor restores the previous text, as in 5.9.
- `cl` opens the name input of the list of the cursor with an empty name, from its header or from any task of that list.
  It acts like `cc` on a header: it is one undoable change once committed, and Escape on the empty input discards the rename and restores the previous name.
  It works under every filter and touches neither the register nor the filter.
- `c` is a pending prefix like `g`, `d` and `y`: a lone `c` does nothing and any other key cancels it.
- `p` on a task pastes right below it, after its whole subtree, at the cursor's own level.
  A subtask pasted at the top level becomes a top-level task.
  A task that has children, pasted onto a subtask, goes to the top level right after the cursor's parent, so that its subtree survives and no third level appears.
- `p` on a header pastes a task as the first task of the list.
- A pasted task is pinned while a filter is active (5.14).
- When the register holds a list, `p` pastes it after the list the cursor is in, whether the cursor is on its header or on one of its tasks.
  A copied list keeps its title, since list names are not unique.
  It works under every filter, and the filter is cleared so that the pasted list is visible, as for `+` (5.9).
- The pasted element keeps its own check states and those of its children.
  The rules of 5.3 apply at the destination: an unchecked task pasted under a checked parent unchecks that parent.
- After `p`, the cursor goes to the pasted element, scrolled into view.
- `p`, `dd`, `cc` and `cl` are each one undoable change, and `yy` is not one.
  Undoing the paste of a list goes back to the filter that was active when it was pasted, as in 5.6.
- While the Markdown view is open, `cc`, `cl`, `p` and `dd` are ignored like the other Normal keys, and `yy` copies the content of the view (5.11).
- With no list there is no cursor, so the keys do nothing, and `+` creates the first list.

**Clipboard**

- `dd` and `yy` also write the Markdown of the element to the system clipboard with `navigator.clipboard`.
  It is write-only: `p` never reads the clipboard.
  Markdown coming from another application is pasted in Insert mode, with the native paste of the editor, which replaces line breaks by spaces (5.5).
- The text comes from the shared serializer of 3.4: a task is `- [ ] text` followed by its indented subtasks, and a list is its `## Title` line and its tasks.
- A refused clipboard write never blocks the edit, and the register is filled in every case.

**Feedback**

- A copy (`yy`, `dd`, the copy button and `yy` of the Markdown view) shows a short text in the footer statusline, after the counts: "Copied" once the clipboard write succeeds, and "Copy failed" in the danger color when it is refused.
  It disappears after 2 seconds, and a new copy restarts the timer.
- It is plain text, in the 12 px mono style of the statusline, with no icon and no popover.

**Implementation decisions**

- The register content, the paste placement and the depth rule are pure functions in `src/client/logic/`, with the immutable and `null` conventions of 5.7.
- The `cc`, `yy` and `p` resolution belongs to the pure key function of 5.9, with `c` as one more pending prefix.
- The task-to-text and list-to-text functions are the shared serializer, so the register never builds Markdown by hand.

### 5.13 Due dates

A task can carry one due date.
It is plain text in the task, `-> DATE`, and the app only adds formatting and an easy way to type it.

**Format**

- A date is one of `YYYY-MM-DD`, `YYYY-Www` (ISO week) and `YYYY-Qn` (calendar quarter), for example `2026-11-22`, `2026-W47` and `2026-Q4`.
  Only a strictly valid value counts: a real calendar day, a week from 01 to the last ISO week of that year, a quarter from 1 to 4, and zero-padded numbers.
  `2026-02-30`, `2026-W54`, `2026-Q5` and `2026-1-5` are plain text.
- The marker is `->` followed by one space and the date, as in `Renew passport -> 2026-12-01`.
  The marker must be preceded by whitespace or by the start of the text.
  The date must end at whitespace or at the end of the text.
- The due date of a task is its last valid `-> DATE`.
  Earlier ones stay plain text.
- The server and the JSON model do not know about dates: a date never makes a file invalid, and the Markdown view, the clipboard and the register carry it as text.
- A due date inside a link label or inside emphasis (`**`, `*`, `_`, `~~`) is plain text too, so a pill only sits at the top level of the text.
  The editor, `cd` and the view all use the range that the inline parser finds, so they always agree.
- A due date is not an inline Markdown syntax.
  It is recognized inside the inline parser of 5.5 only to render it, and a `-> DATE` inside a code span stays literal.

**Periods and states**

- Every due date covers a period: the day, the ISO week (Monday to Sunday) or the calendar quarter.
- The state of a due date is computed against a **horizon**, which is also a period.
  The horizon is today, and it stays a parameter of the pure function.
  The `due:` terms of 5.14 use the same periods, with their own matching rules.
- **Overdue**: the due period ends before the horizon starts.
  **Due now**: the due period overlaps the horizon.
  **Later**: the due period starts after the horizon ends.
- With today as the horizon, `2026-11-11` is due now on that day and overdue the day after, `2026-W46` is due now for the whole week and overdue from the following Monday, and `2026-Q4` is due now for the whole quarter.
- Today is read from the local clock.
  The states are recomputed on every render and when the tab becomes visible again or gets the focus, with no timer, and this only restyles the pills, never the editor.
- The state is classified by one pure function in `src/client/logic/`.
  The look is described in 5.10.

**Entering a date**

- Typing `->` in the task editor opens a popup, and `cd` in Normal mode opens it too (see below).
  The popup is a CodeMirror autocomplete, so ↑ / ↓ move in it, Enter or Tab accept the highlighted entry, and Escape closes it without committing the editor, a second Escape committing as in 5.9.
  With the popup closed, Enter and Escape behave as in 5.9.
- Each entry shows a shortcut and the date it resolves to, for example `tomorrow  2026-11-12`.
  A bare `->` lists a default set: `today`, `tomorrow`, `+1d`, `+1w`, `+1m`, `+1y`, `+mon`, `W`, `Q`, `+1W` and `+1Q`.
  A valid shortcut or literal that is not in the set, such as `->+3d`, `->-2m`, `->+fri` or `->2026-W52`, appears as one entry with its resolved date.
  An unknown word shows nothing.
- A shortcut never contains a space: `->today`, `->tomorrow`, `->+1w`, `->-tue`.
  `+N` or `-N` followed by `d`, `w`, `m` or `y` is a day date, `N` days, 7 × `N` days, `N` months or `N` years from today.
  `+N` or `-N` followed by `W` or `Q` is the ISO week or the calendar quarter `N` periods from the current one, across year boundaries.
  `W` and `Q` alone are the current week and quarter.
  `+mon` is the first Monday strictly after today and `-mon` the last Monday strictly before it, with the weekdays `mon`, `tue`, `wed`, `thu`, `fri`, `sat` and `sun`.
  `N` is a positive integer, there is no `yesterday`, and a literal date, week or quarter is accepted as is.
- Month and year shifts keep the day of the month and clamp to the last day of the target month, so one month after 31 January is 28 February (29 in a leap year).
- With today being Wednesday 2026-11-11, `+1w` is `2026-11-18`, `+mon` is `2026-11-16`, `-tue` is `2026-11-10`, `W` is `2026-W46`, `+1W` is `2026-W47`, `Q` is `2026-Q4` and `+1Q` is `2027-Q1`.
- Accepting an entry replaces the `->` and the typed shortcut with `-> DATE`, and never touches the text before the arrow.
  Typing a space or committing right after a valid shortcut also resolves it, so the popup is a convenience and not a requirement.
  An unknown word is left as typed, and a prose arrow such as `A -> B` stays plain text.
- A bare arrow left behind, such as the ` ->` that `cd` appends, is kept as typed.
- The editor colors the literal text of a valid date with its state (5.10), and an invalid date is not colored, which shows that it is not recognized.

**`cd` in Normal mode**

- `cd` works on a task only, with `c` as a pending prefix like `g`, `d`, `y` and `s` (5.9).
- On a task with no due date, it opens the editor with the caret at the end, appends ` ->` and opens the popup.
- On a task with a due date, it opens the editor with the space and the date after the arrow selected, and opens the popup.
  Typing a shortcut replaces the selection, and Escape leaves the text as it was.
- The committed change is one undoable change, like any other edit of the text (5.6).
- `cd` is in the cheat sheet, and the footer statusline shows nothing about dates.

**Completing a task**

- When a task goes from unchecked to checked, its due date is set to today, so that a completed task always sits at the day it was done.
  This applies to `x` / Space, to the children that a checked parent checks, and to a parent that is checked automatically because all its children are (5.3).
  Children that were already checked are left alone, and it does not apply to a paste, an undo, an external change or a task that is checked in another editor.
- The date that changes is the due date of the task, which is its last valid `-> DATE`, and only when it is a week, a quarter or a day before today.
  A day that is today or later stays as it is, and a task with no due date gets none.
- The old date is kept as plain text right after the new one: `-> 2026-10-30` becomes `-> 2026-11-11 (was 2026-10-30)`, and `-> 2026-W46` becomes `-> 2026-11-11 (was 2026-W46)`.
  Text that followed the date moves after the suffix.
  When a `(was …)` already follows the date, it is kept as it is and no new one is added, so the oldest date survives checking, unchecking and checking again.
- The `(was …)` suffix is plain text, not a due date, since it has no arrow.
- Unchecking a task does not restore its date.
  A check that rewrote dates is one undoable change (5.6), and undo restores the check states and the dates together.
- The rewrite is made by the client only.
  The server never changes a task, and a task checked in Obsidian keeps its date.

**Implementation decisions**

- The date logic is pure functions in `src/client/logic/due.ts`, with the immutable and `null` conventions of 5.7: parsing a date, its period, the state against a horizon, and the shortcut resolution and its list of entries.
  The rewrite of a text on completion is `completeDue` in `src/client/logic/complete.ts`, a separate file because it needs the inline parser, which itself imports `due.ts`.
  The current date is a parameter, never read inside them.
- The inline parser returns a node that holds the date text, and the view adds the state, so the parser stays independent of the clock.
- The popup source, its entry rendering and the date coloring are the only CodeMirror parts, and they are verified by hand.
- `->` and a date in the file are the whole contract: an external editor can type, change or delete a due date with no help from the app.

### 5.14 Filters and views

A filter is one line of text that narrows what the lists show.
A view is only a filter text: the built-in views set it, and a saved filter is a named text.

**Filter bar**

- The header holds a one-line filter bar, always visible, with the placeholder `All` when it is empty (5.10).
  It is a single-line CodeMirror editor, so that it shares the popup mechanism of 5.13.
- `gf` focuses the bar and enters the filter mode, shown as FILTER in orange in the footer and on the bar, and a click on the bar does the same.
  The lists narrow live while typing.
- Enter accepts the highlighted popup entry when the popup is open, and otherwise applies the text and returns to Normal mode, with the cursor on the first visible stop.
  Escape closes the popup first, and a second Escape does the same as Enter: it keeps the text and returns to Normal mode, like Escape in the task editor (5.9).
  A blur keeps the typed text.
- The filter text is stored in `localStorage` with the cursor index (5.9) and restored on load.
  It is never sent to the server.

**Built-in views**

| Key | Filter text |
|---|---|
| `ga` | empty, which shows everything |
| `gt` | `due:today,overdue` |
| `gw` | `due:week,overdue` |
| `gl` | replaces the text with `list:` and opens the list popup |
| `gf` | focuses the filter bar, which keeps its text |
| `gF` | opens the saved filter picker |
| `sh` | toggles the display of the siblings of a match (see Results) |

`ga`, `gt`, `gw` and `gl` replace the whole text.
Nothing else marks a view: it is the text in the bar.
There is no selector, and no way to show a single list other than `list:`.

**Grammar**

- A filter is terms separated by spaces, and an item must match every term (AND).
  Matching ignores case.
- A bare word matches when it is a substring of the task text.
- `list:name` matches the tasks of every list with that title.
  A name with spaces is quoted, as in `list:"Side projects"`, and a quote that is not closed runs to the end of the text.
- `due:` values are `today`, `week`, `overdue`, or a literal day, ISO week or quarter (5.13).
  `due:today` matches a task whose due period overlaps today, `due:week` one that overlaps the current ISO week, and `due:2026-11-10` one that overlaps that period.
  `due:overdue` matches a task that is not completed and whose due period ends before today.
  A task with no valid due date matches no `due:` term, and a due date before the period does not match `due:today`, so late tasks only come from `overdue`.
- `is:done` and `is:todo` match the checkbox of the task itself, with no inheritance from its parent or its children.
- Commas inside one term mean OR on its values, as in `due:today,overdue` or `list:Work,Home`.
  There is no other OR, no negation and no regex.
- An unknown key is a plain word, so `foo:bar` or a pasted URL still works.
  A known key with an invalid value, such as `due:foo`, `due:2026-02-30` or `is:xyz`, makes the filter match nothing and is reported (see Results).
  A known key with no value yet, such as `due:` while typing, is ignored.
- Today is read from the local clock, when the filter is applied and at each render, like in 5.13.

**Popups**

- Typing `list:` opens a popup of the list titles, quoted when they need it, and `due:` opens one of `today`, `week` and `overdue`, plus one entry for a typed valid day, week or quarter.
  After a comma, the popup completes the next value.
- The popup is a CodeMirror autocomplete like the one of 5.13: ↑ / ↓ move, Enter or Tab accept, Escape closes it first.
- `gl` opens the bar with `list:` alone and its popup, and the other keys of the bar are those above.

**Results**

- A task is visible if it matches, or one of its ancestors matches, or one of its descendants matches.
  A matching parent therefore shows its whole subtree, and a matching subtask shows its parent as context.
- **Hidden subtasks**: a task that shows only some of its subtasks ends its row with a muted eye-off icon and the number of subtasks that are hidden, for example when it is shown because one subtask matches.
  Its tooltip reads "N other subtasks hidden by the filter".
- **Siblings toggle**: an icon button in the header, next to the Markdown view toggle, and `sh` switch between two displays.
  Off, which is the default, a task shown because a subtask matches shows only the matching subtasks.
  On, it shows all its subtasks, so no eye is shown.
  The button is accent-colored while it is on, and the choice is stored in `localStorage` and kept when the filter changes.
  It is a display setting: it is not in the document, the undo history or the saved filters, and the cursor stops, the counts and the Markdown view follow the rows it shows.
- A list with no visible task is hidden under any non-empty filter, and with an empty filter every list is shown, empty ones included.
  To add the first task of an empty list, clear the filter.
- Hiding only changes what is rendered: the document is whole, the cursor stops are the visible rows, and the counts of 5.9 are those of the visible tasks.
- **Pinned rows**: a task that the user adds, pastes, edits, checks or unchecks stays visible, with its ancestors, until the filter text changes or is applied again, even if it no longer matches.
  Applying the text again, with `gf` then Enter or Escape, or with a built-in view key that sets the same text, drops the pins: it refreshes the view.
  Pins follow the task through the add, the paste or the move that shifts it, and they are cleared by a refresh, a delete, an undo, a redo and an external change.
- An empty result shows a muted "No matching task" and the filter text in place of the lists.
  When a known key has an invalid value, it shows the reason, for example "Unknown due value: foo".
  An empty file keeps the offer of 5.1.

**Editing under a filter**

- The keys `x`, `i`, `cc`, `dd`, `yy`, `p`, `cd` and the positional adds work as usual on the visible rows.
- `J` / `K`, Alt+↑ / Alt+↓, `>` and `<` work on the visible rows, for tasks and for lists.
  The visible rows are the rows shown, so the siblings toggle changes which subtasks count as neighbours.
- **Move**: a task swaps with the next visible sibling in the direction of the key, and lands right after it (down) or right before it (up), so the hidden siblings between them stay where they were.
  A task that has visible subtasks counts as one block with its whole subtree.
  At the edge of its parent or of its list the rules of 5.2 apply to the visible neighbours: a subtask becomes the last subtask of the previous visible top-level task or the first subtask of the next visible one, and a top-level task crosses into the previous or next visible list.
  It lands right before the first visible top-level task of the next visible list, or right after the last visible top-level task of the previous one together with its subtree, and nothing happens when there is no such task or list.
- **Indent** makes the task the last subtask of the previous visible top-level task, after its hidden subtasks, and jumps over hidden tasks.
  **Outdent** places the task right after its parent, as without a filter.
- **List move**: a list moves before or after the previous or next visible list, and the hidden lists keep their place.
- **Pinning**: the moved, indented or outdented task is pinned, so that it stays visible with its ancestors until the filter changes, even when it lost the parent that made it visible, for example an outdented subtask that does not match.
  The pins of the other tasks follow the move, so that every pin keeps pointing at the task it was set on.
  A list move needs no pin, since a list with a visible task stays visible.
- The check rules of 5.3 apply unchanged, and each move is one undoable change that restores the filter text it was made under (5.6).
- `+` and the paste of a list clear the filter, so that the new list is visible.
- Completing a task rewrites its due date (5.13), and pinning keeps it visible even in a filter that it no longer matches, such as `is:todo`.

**Saved filters**

- A saved filter is a name and a filter text, stored in the frontmatter (3.2.1) and carried by the document (2.2).
- `gF` opens the picker below the filter bar.
  Its first entry is "Save current filter…", shown only when the text is not empty, followed by the saved filters in file order.
- Picking "Save current filter…" replaces the list by a name input.
  Enter saves, Escape or an empty name cancels, and an existing name is overwritten with the new text.
- Picking a saved filter replaces the filter text with its text and closes the picker.
- `dd` on a highlighted saved filter deletes it at once and for good, with no prompt and no undo.
- Saving and deleting are saved like any change of the document, so they are subject to the autosave and conflict rules of 4, and they are not in the undo history (5.6).
- The built-in views of this section are fixed: they are not in the picker, and they cannot be renamed or deleted.

**Implementation decisions**

- The filter parsing, the matching of a task (with today as a parameter) and the computation of the visible rows are pure functions in `src/client/logic/filter.ts`, with the immutable and `null` conventions of 5.7.
  The Markdown view of 5.11 and the counts of 5.9 use the same visible rows.
- Pinned rows are paths, shifted by the add, paste or move that changes them, and the store clears them as described above.
- The store holds the filter text and the pins, and `commit` takes the pin and whether it is an insertion.
  The undo history keeps the lists and the filter text of each change, and never the saved filters, which `commitFilters` changes outside the history.
- Today is read by the view at each render, and passed to the pure functions.
- The filter bar is built once and never re-rendered with the lists, so that typing in it is not interrupted by the live narrowing.
- The CodeMirror parts (the bar, the popups) and the picker are verified by hand.
- The server reads and writes the `filters` block in a small module next to the parser, with no YAML dependency.

### 5.15 Incremental search

`/` starts an incremental search over the visible rows, to find a task or a list without narrowing anything.
It is separate from the filter of 5.14: a filter hides rows, a search only highlights them and moves the cursor.

**Starting and ending**

- `/` works in Normal mode, on a task, on a list header or on nothing, and it is ignored in the Markdown view (5.11).
  It opens the search input above the footer, a plain input with the look of 5.10, and the footer badge says SEARCH in yellow while it has the focus.
- While typing, every match is highlighted and the cursor goes to the first matching row at or after the row where `/` was pressed, wrapping from the end to the start.
  With no match, or with an empty query, the cursor goes back to that row.
- Enter and Escape do the same: the input closes, the cursor stays where it is and the search stays active.
  With an empty query they end the search, and so does Backspace on an empty input.
- While the search is active, `n` / `N` move the cursor to the next / previous matching row from the cursor row, wrapping at both ends, and the footer statusline shows "Wrapped" for 2 seconds when they wrap.
- Escape in Normal mode ends the search: the query is forgotten and the highlights and the search bar disappear.
  With no active search, `n`, `N` and Escape do nothing, and `/` always opens an empty input.
- The query lives in memory only.
  It is not in `localStorage`, the undo history or the document, a reload ends it, and so does opening the Markdown view.

**Matching**

- A query is a literal substring, matched ignoring case, against the rendered text of the visible rows of 5.14: the task texts, including the text of a due date pill and the label of a link but not its URL, and the list titles.
  There is no grammar, no regex and no `list:` or `due:`.
- A row matches on its own text only, not on the text of its ancestors or descendants.
- The search never reveals a row hidden by the filter, including a subtask hidden by it, and it pins nothing.
- The matches, the highlights and the counter are recomputed from the document and the filter at each render, so an edit, an undo, an external change and a change of the filter all update them, and the search stays active even when nothing matches.
- The task editor shows no highlight in Insert mode, and the row is highlighted again once it is committed.

**Look**

- Every occurrence is highlighted with `--color-match`, which is `#edc763` (the Sonokai yellow) in both themes.
  On other rows it is a 40% tint behind the normal text color, and on the cursor row it is solid with a fixed dark text color (`#1f2328`).
  It has the chip radius, and no underline or bold, so the layout never shifts.
  An occurrence that spans several inline elements, for example across a bold marker, still matches but is not highlighted.
- The search input is stacked right above the footer, with the same width, the 12 px font, the input tint and a 2 px bar in `--color-match`, like the focused filter bar of 5.10.
  It takes no space when it is closed, and the page grows by its height and an 8 px gap above the footer while it is shown, so that the last rows stay reachable.
- While the search is active, the footer statusline shows `/query  3/12` after the counts, in the muted color and with `no match` in place of the counter when nothing matches, whether the input is open or closed.
  It disappears when the search ends.
  The counter is the position of the cursor row among the matching rows, or the number of matching rows when the cursor is not on one.

**Implementation decisions**

- The matching rows, the next and previous match with wrap and the counter are pure functions in `src/client/logic/search.ts`, with the immutable and `null` conventions of 5.7.
  The key function of 5.9 takes whether a search is active, to resolve `n`, `N` and Escape.
- The view highlights by walking the text nodes of the rendered rows after each render, and the search input is built once, like the filter bar of 5.14.
- The input and the highlight are verified by hand.

## 6. Tests

- **Parser / serializer** (`bun test`): empty file, empty list, 2 levels, each `422` case, syntax tolerance, normalization, stable round-trip, and the serialization of a whole document, one list and one task.
- **API**: server started on a temporary file; `GET` with ETag, `PUT` with `If-Match`, `409`, `422` and SSE after external modification.
- **Frontmatter filters**: the `filters` block (each `422` case, byte for byte when unchanged, add, replace and remove, creating and removing the frontmatter, the rest of the frontmatter untouched) and the `PUT` round-trip with filters.
- **Pure client logic**: checking rules, move and depth validation, list move (before, after, edges, no-op), undo stack, the key resolution of 5.9 (modes, prefixes, target kinds, and the keys of the Markdown view and of the register), positional add, cursor clamping, the filter presets and statusline counts, the Markdown view export (whole document, one list, empty document, empty list), and the register (content, paste placement, depth rule, check states, list paste, clipboard text), and the due dates (validation of each form, week 53 and leap years, periods, the state against a horizon, every shortcut with month clamping and year boundaries, the popup entries, the last-date rule, and the `cd` keys), the filter parser and matching (each term, commas, quotes, bad values, unknown keys, the tree visibility rule, empty lists, pinned rows), the moves under a filter (hidden siblings jumped over, edges of the visible range, indent on the previous visible task, crossing to the previous or next visible list, list move over hidden lists, pins kept on the right tasks after a move, an outdented subtask pinned), and the due date rewrite on completion (overdue day, week, quarter, today, future day, existing `(was …)`, cascade and auto-checked parent), and the search (matching ignoring case, titles, rendered text, hidden rows, next and previous with wrap, the counter, no match, and the keys `/`, `n`, `N` and Escape with and without an active search).
- No e2e in v1: CodeMirror is verified by hand, and so is the visual design of 5.10 in a window from 240 to 720 px wide, in light and dark.

## 7. Out of scope

Authentication and network access; multi-user; Yjs / CRDT; offline mode; editing the frontmatter other than the `filters` key, and file-based settings other than the saved filters; `xit` format; automatic conflict merging; wrapping of the cursor at the edges (the search wraps, 5.15); tags, priorities; sorting by due date, "this month" and "this quarter" views, a date picker, relative labels such as "tomorrow" on the pill, a warning for an invalid date, a midnight timer, a `yesterday` shortcut, month and year precision; a toggle that hides completed tasks; non-inline Markdown; multi-line tasks; e2e tests; drag and drop, with or without a handle; add lines and add buttons; hover buttons on rows and list headers; a button to create a list; Visual and Command modes; counts, operator and motion grammar, named registers, a persistent register, `P` (paste above), reading the system clipboard, pasting Markdown outside Insert mode; custom keymaps; jumping to the first or last item of another list; editing in the Markdown view, a rendered or split Markdown view, persisting the view across reloads, per-list copy buttons; row and list actions for the keyboard cursor; a theme setting or a new color palette; negation, regex and a general OR in filters, renaming saved filters, undo of saved filter changes, a separate filters file, a persistent undo history, restoring a due date when a task is unchecked; cycling by occurrence, a remembered last query, regex, filter terms, search in the Markdown view and highlights inside the editor for the search.
