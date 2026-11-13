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
- **Configuration**: with no `VAULT_DIR`, the file is set by the `TODO_FILE` environment variable, defaulting to `./todo.md`, and created empty if missing.
  This single-file mode is the default, and in it one instance manages one file.
  With `VAULT_DIR` set to an Obsidian Vault, the instance manages every file of the Vault that opts in, `TODO_FILE` is ignored, and a few more settings apply (5.16, 5.17, 5.18).
  Kryss reads two Vault settings and never writes to them: `.obsidian/app.json` (5.17) and `.kryss.json` at the root of the Vault (5.18).
- **Network**: listens on `127.0.0.1` by default, **without authentication**.
  The `HOST` environment variable overrides the listening address, for example `HOST=0.0.0.0` when the app runs inside a container.
  Exposing the app beyond the loopback interface is an explicit opt-in.
- **Dependencies**: `xit-parse` is removed.
  `lucide` provides the icons (Markdown view toggle, sync status, due date arrow), and only the icons in use are bundled.
  The icons that the link rules of 5.18 name are the one exception: the server reads them from the installed package at runtime.
  `@codemirror/autocomplete`, from the CodeMirror 6 family already in use, provides the due date popup (5.13).

### 2.1 API

| Route | Description |
|---|---|
| `GET /api/todos` | Returns the JSON document and an `ETag` header (hash of the file contents). Returns `422` if the file is invalid. |
| `PUT /api/todos` | Replaces the whole document. Requires `If-Match` with the known ETag. Returns `200` and the new ETag, `409` if the file changed, `422` if the file on disk is invalid. |
| `GET /api/events` | SSE stream: an event is emitted whenever the file changes and the change was not caused by the server itself. |
| `GET /api/files` | Vault mode only. Scans the Vault and returns the files that opt in (5.16), with the Vault name in the `X-Vault-Name` header (5.17). |
| `POST /api/files` | Vault mode only. Creates a file from a name (5.16). |
| `GET /api/notes` | Vault mode only. Scans the Vault and returns `{ "newLinkFormat", "notes" }`, the note index for the `[[` popup (5.17). |
| `GET /api/config` | Vault mode only. Returns the link rules of `.kryss.json` (5.18). |
| `GET /api/icons/<name>` | Vault mode only. Returns the SVG of a Lucide icon named by a link rule (5.18). |

In Vault mode, `GET` and `PUT /api/todos` and `GET /api/events` take a `file` query parameter, the path of the file relative to `VAULT_DIR` (5.16).
In single-file mode they ignore it, and the five routes marked "Vault mode only" do not exist.

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

Obsidian adds a YAML frontmatter to notes, so a leading block opened by `---` on the first line and closed by `---` or `...` is ignored on read, except for one key, `kryss-filters`.
A second key, `kryss-enabled: true`, is read only by the Vault scan (5.16): it marks a file as a Kryss file, never reaches the client, and is kept byte for byte like the rest of the block.
The blank lines that follow it are part of the block.
The server keeps the block byte for byte and writes it back unchanged in front of the serialized lists on every `PUT`, except for the `kryss-filters` block described below.
Every other line of the frontmatter never reaches the client, and error lines still count the frontmatter lines.
A block that is not closed is rejected (`422`, line 1).

**Saved filters**

- The saved filters of 5.14 live in one top-level key, `kryss-filters`, written as `kryss-filters:` alone on its line and followed by one indented line per filter, `  "name": "text"`.
- The name and the text are JSON double-quoted strings, which are valid YAML, so the server needs no YAML library and reads and writes only this block, line by line.
- The block ends at the first line that is not indented.
  `kryss-filters:` followed by nothing is an empty list, and an absent key means no saved filters.
- A second `kryss-filters` key, a line of the block that is not `"name": "text"`, an empty name or text, or a duplicate name is rejected (`422`, with that line).
  A `kryss-filters` key written by hand in another YAML style (a flow map, single quotes) is rejected the same way instead of being rewritten.
- On `PUT`, saved filters equal to those on disk leave the block untouched, byte for byte.
  Otherwise the server replaces the block in place, or adds it before the closing delimiter when the key was absent.
  With no frontmatter at all, it creates one in front of the lists, followed by a blank line.
  Deleting the last filter removes the key, and a frontmatter left with nothing else in it is removed too.
- The rest of the frontmatter is never edited.

```markdown
---
kryss-filters:
  "Work this week": "list:Work due:week"
---

## Work
- [ ] Send the report -> 2026-W46
```

### 3.3 Rejection (`422`)

Everything else is rejected with line and reason: an unclosed frontmatter, a malformed `kryss-filters` block, free text, `#` or `###` headings, text before the first `##`, empty list name, tasks nested 3 or more levels deep, multi-line description under a task, inconsistent indentation.
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
- An autolink, `<https://example.com>`, is recognized by the same parser and rendered as a link whose label is the URL, under the same scheme rules as `[label](url)`.
  Its scheme is checked like any other, so `<javascript:alert(1)>` stays literal text.
- A wikilink, `[[Note]]` or `[[Note|alias]]`, is one more node, rendered as a link that opens Obsidian (5.17).

### 5.6 Undo

- Global undo / redo stack over the document (Ctrl+Z / Ctrl+Shift+Z, or `u` / `U` in Normal mode), in memory.
  Each undo triggers a normal `PUT`.
- No confirmation to delete a task (undo recovers it).
- Inside a task's editor, Ctrl+Z first undoes typing (CodeMirror), then the global stack once the task is left.
- Each entry remembers the filter text that was active when the change was made, and undo and redo restore it, so a change made under another filter is never invisible.
  Undoing a move made under a filter returns to that filter, with the task or list back at its place.
- The snapshots hold the lists only, so undo and redo never change the saved filters, and saving or deleting a saved filter is not part of the history.
  The text typed in the filter bar is not part of it either.
- The stack is cleared on page reload, on any detected external change and on a switch to another file (5.16).
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
- `go` opens the file picker in Vault mode (5.16).
- `f` and `F` are the filter keys: `ff` focuses the filter bar, `fs` opens the saved filters, and `fa`, `ft`, `fw`, `fl`, `fx` and `fX` replace the whole text (5.14).
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
- A pending first key (`g`, `f`, `d`, `y`, `c` or `s`) is cancelled by any other key or by a blur, with no timeout.
- Each prefix has one meaning: `g` goes (cursor, file and help), `f` sets the filter, `s` shows or switches a display, `c` changes a value, `d` deletes and `y` yanks.
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
| `cl` | change the list of the task: open the list picker below the row (5.12) |
| `cL` | change the name of the list of the task: open its name input with an empty name (5.12) |
| `p` | paste the register below the task (5.12) |
| `>` / `<` | indent / outdent, over the visible rows under a filter (5.14) |
| `J` / `K`, Alt+↓ / Alt+↑ | move down / up (5.2), over the visible rows under a filter (5.14) |
| `H` / `L` | move the whole list of the task up / down (5.2) |
| `u` / `U`, Ctrl+Z / Ctrl+Shift+Z | undo / redo |
| `o` / `O` | add a sibling below / above, always at the same level |
| `a` | on a top-level task, add its last subtask. On a subtask, same as `o`. |
| `I` / `A` | add the first / last subtask of the task. On a subtask, of its parent. |
| `go` | open the file picker, in Vault mode only (5.16) |
| `g?` | open or close the cheat sheet |
| `/` | start an incremental search (5.15) |
| `n` / `N` | next / previous match of the active search (5.15) |

**Keys on a list header**

| Key | Action |
|---|---|
| `i`, Enter | rename the list in its inline name input (a click on the title does the same) |
| `dd`, Delete | delete the list at once, into the register (5.12), with no prompt since the register and undo recover it |
| `yy` | copy the list into the register (5.12) |
| `cc`, `cL` | change the list: open the name input with an empty name (5.12) |
| `p` | paste the register as the first task of the list, or after the list if it holds a list (5.12) |
| `o`, `a`, `I` | add a task as the first task of the list |
| `A` | add a task as the last task of the list |
| `J` / `K`, Alt+↓ / Alt+↑ | move the list down / up, over the visible lists under a filter (5.14) |
| `H` / `L` | move the list up / down, like `K` / `J` |
| `+` | create a list at the end and open its name input, from anywhere in Normal mode |
| `/`, `n` / `N` | search, as on a task (5.15) |

- `J` and `K` move the list down and up, like Alt+↓ and Alt+↑, as described in 5.2.
  `H` and `L` do the same on a header, and also work on a task.
- `x`, `>`, `<`, `cd` and `cl` do nothing on a header.
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
- The footer box is the column itself: centered, as wide as the list panels in a wide window (`--content-width` minus the two page gutters), with its own background and nothing drawn outside it, and full width in a narrow window.
  The search input of 5.15 is stacked right above it, with the same width, while it is open.
- A list is a flat panel: surface background, 8 px radius, no border and no shadow, with 8 px between panels.
  Panels are distinguished from the page by their background only.
- Task text is 12 px (the same as in Obsidian) with a line height of 20 px, rows have 3 px of vertical padding and no gap between them, which makes a row about 26 px tall.
  Text size and row height are the same at every window width.
- Horizontal spacing is tight in a narrow window and grows a little in a wide one, through `clamp()` tokens of the viewport width.
  The page gutter is fixed at 8 px up to 720 px of window width and 16 px above, the panel padding from 4 to 6 px, the row padding and the checkbox gap from 6 to 8 px, and the subtask indent from 16 to 24 px.
- The header is fixed and about 32 px tall, below an 8 px margin at the top of the page, the footer is fixed and about 24 px tall, and neither has a border or a separator.
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
- Its colors depend on the state of 5.13: the danger color for overdue, yellow for due now, the accent color for due this week, and the muted color for later.
  The yellow is a dark amber in the light theme, so that it stays readable on the light surface.
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

- The filter bar is a one-line input at the left of the header, in the body size, with 4 px of vertical padding, with the muted placeholder `All` when it is empty.
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

- A header button toggles it, with the Lucide `square-m` icon and the label "Export as Markdown" as accessible name and, followed by its key in parentheses (`sm`), as tooltip.
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
  The `f` keys, `sh`, `sm`, `yy`, Escape and `g?` keep working.
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
- `cL` (`c` then Shift+L) opens the name input of the list of the cursor with an empty name, from its header or from any task of that list.
  It acts like `cc` on a header: it is one undoable change once committed, and Escape on the empty input discards the rename and restores the previous name.
  It works under every filter and touches neither the register nor the filter.
- `cl` (`c` then lowercase `l`) changes the list of the task under the cursor, and does nothing on a list header, with no cursor or while the Markdown view is open.
  It opens a list picker anchored below the row of the task, with the panel look and the keys of the saved filter picker of 5.14: ↑ / ↓ move, Enter confirms and Escape closes it without a change.
  The picker is a plain input with a list under it, not a CodeMirror editor, and the task text is not editable while it is open.
  It lists every list of the document in document order, one row per list, including the lists that a filter hides and the list that already holds the task, with no de-duplication, so that two lists with the same title are two rows.
  Typing in the input narrows the rows to the lists whose title contains the text, ignoring case.
  The highlighted row starts on the first list after the list of the task, or on the first row when there is none, and Enter on the list that already holds the task does nothing.
  Enter moves the task with its subtree to the end of the chosen list.
  A subtask leaves its parent and becomes a top-level task at the end of the chosen list, with its own children, and the rules of 5.3 recompute the parent it left.
  The check states are kept, and the register and the due dates are not touched.
  Under a filter the moved task is pinned (5.14), which also makes a hidden destination list visible, and the filter text is not changed.
  The cursor follows the moved task, scrolled into view.
  There is no list to create from the picker.
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
- `p`, `dd`, `cc`, `cL` and `cl` are each one undoable change, and `yy` is not one.
  Undoing the paste of a list goes back to the filter that was active when it was pasted, as in 5.6.
- While the Markdown view is open, `cc`, `cL`, `cl`, `p` and `dd` are ignored like the other Normal keys, and `yy` copies the content of the view (5.11).
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
- The move of a task to another list is a pure function in `src/client/logic/`, with the immutable and `null` conventions of 5.7, and the picker is verified by hand.
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
  **Due this week**: the due period starts after the horizon ends, within the ISO week of the horizon end.
  **Later**: the due period starts after the end of that week.
- With today as the horizon, `2026-11-11` is due now on that day and overdue the day after, `2026-W46` is due now for the whole week and overdue from the following Monday, and `2026-Q4` is due now for the whole quarter.
  On Thursday `2026-11-12`, `2026-11-15` is due this week and `2026-11-16` is later.
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
- A typed sign and number with no unit, such as `->+3` or `->-2`, lists one entry per unit in the order `d`, `w`, `m`, `y`, `W`, `Q`, each with its resolved date or period, for example `+3d  2026-11-14`, `+3w  2026-12-02` and `+3W  2026-W49`.
  A sign followed by a prefix of a weekday, such as `->+t`, lists the matching weekdays (`+tue`, `+thu`), and a bare `+` or `-` lists nothing.
  This completion is one pure function in `src/client/logic/due.ts`, shared with the `due:` popups of 5.14.
- A shortcut never contains a space: `->today`, `->tomorrow`, `->+1w`, `->-tue`.
  `+N` or `-N` followed by `d`, `w`, `m` or `y` is a day date, `N` days, 7 × `N` days, `N` months or `N` years from today.
  `+N` or `-N` followed by `W` or `Q` is the ISO week or the calendar quarter `N` periods from the current one, across year boundaries.
  `W` and `Q` alone are the current week and quarter.
  `+mon` is the first Monday strictly after today and `-mon` the last Monday strictly before it, with the weekdays `mon`, `tue`, `wed`, `thu`, `fri`, `sat` and `sun`.
  `N` is a positive integer, there is no `yesterday`, and a literal date, week or quarter is accepted as is.
  A shortcut whose result is not a valid date, week or quarter, such as `+8000y` or a shift too large to represent, is unknown, in the popups and in the `due:` terms of 5.14.
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
- `ff` focuses the bar and enters the filter mode, shown as FILTER in orange in the footer and on the bar, and a click on the bar does the same.
  The lists narrow live while typing.
- Enter accepts the highlighted popup entry when the popup is open, and otherwise applies the text and returns to Normal mode, with the cursor on the first visible stop.
  Escape closes the popup first, and a second Escape does the same as Enter: it keeps the text and returns to Normal mode, like Escape in the task editor (5.9).
  A blur keeps the typed text.
- The filter text is stored in `localStorage` with the cursor index (5.9) and restored on load.
  It is never sent to the server.

**Filter keys**

The prefix `f` sets the filter: each key replaces the whole text, so a key switches to another view.
To refine a filter, type in the bar.

| Key | Term |
|---|---|
| `fa` | empty, which shows everything |
| `ft` | `due:today,overdue` |
| `fw` | `due:week,overdue` |
| `fl` | `list:`, followed by the list popup |
| `fx` | `is:done` |
| `fX` | `is:todo` |

| Key | Action |
|---|---|
| `ff` | focuses the filter bar, which keeps its text |
| `fs` | opens the saved filter picker |
| `sh` | toggles the display of the siblings of a match (see Results) |

- There is no `F` prefix and no key that appends a term, and every other second key of `f` is unassigned.
- There are no `g` aliases: `ga`, `gt`, `gw`, `gl`, `gf` and `gF` do not exist.
- A replacing key changes the filter text, so it drops the pins like any other change of the text, even when it sets the same text.
- Hiding the completed tasks is `fX`, and it is a plain filter: no separate mode, no display setting.
  The hide-done toggle stays out of scope (see Out of scope).

Nothing else marks a view: it is the text in the bar.
There is no selector, and no way to show a single list other than `list:`.

**Grammar**

- A filter is terms separated by spaces, and an item must match every term (AND).
  Matching ignores case.
- A bare word matches when it is a substring of the task text.
- `list:name` matches the tasks of every list with that title.
  A name with spaces is quoted, as in `list:"Side projects"`, and a quote that is not closed runs to the end of the text.
- `due:` values are `today`, `week`, `overdue`, a literal day, ISO week or quarter (5.13), or a shortcut of 5.13 such as `+1w`, `-tue`, `W` or `+1Q`.
  A shortcut is replaced by the literal it resolves to, from today, and then matches like that literal, so with today being 2026-11-11 `due:+1w` is `due:2026-11-18`.
  `due:today` matches a task whose due period overlaps today, `due:week` one that overlaps the current ISO week, and `due:2026-11-10` one that overlaps that period.
  `due:overdue` matches a task that is not completed and whose due period ends before today.
  A task with no valid due date matches no `due:` term, and a due date before the period does not match `due:today`, so late tasks only come from `overdue`.
- A `due:` value can start with `<` or `>`, as in `due:<+1w` or `due:>today`.
  Both operators are strict and compare whole periods.
  `due:<X` matches a task whose due period ends before the period of X starts, and `due:>X` one whose due period starts after the period of X ends.
  A task whose period overlaps X matches neither, so it is found with `due:X`, and an inclusive bound is written with a comma, as in `due:<X,X`.
  After an operator the value is a literal, a shortcut, `today` or `week`, which are the current day and the current ISO week, and `overdue` is an invalid value.
  The operators ignore the checkbox, so completed tasks match, and `is:todo` narrows the result.
  With today being Wednesday 2026-11-11, `due:<+1w` matches `2026-11-17` and `2026-W46` but not `2026-11-18`, `2026-W47` or `2026-Q4`, and `due:>+1w` matches `2026-11-19`, `2026-W48` and `2027-Q1`.
- A range is two terms, as in `due:>today due:<+1w`, which are ANDed like any other terms.
- `is:done` and `is:todo` match the checkbox of the task itself, with no inheritance from its parent or its children.
- Commas inside one term mean OR on its values, as in `due:today,overdue` or `list:Work,Home`.
  Each `due:` value has its own optional operator, so `due:<-1w,>+1w` and `due:<today,2026-W50` are valid.
  There is no other OR, no negation and no regex.
- An unknown key is a plain word, so `foo:bar` or a pasted URL still works.
  A known key with an invalid value, such as `due:foo`, `due:2026-02-30` or `is:xyz`, makes the filter match nothing and is reported (see Results).
  A known key with no value yet, such as `due:` or `due:<` while typing, is ignored.
  Invalid `due:` values also include `due:<foo`, `due:<overdue`, `due:<<today`, `due:+3x` and `due:<2026-02-30`.
  A space ends the term, so `due:< today` is the ignored term `due:<` and the bare word `today`.
- Today is read from the local clock, when the filter is applied and at each render, like in 5.13.

**Popups**

- Typing `list:` opens a popup of the list titles, quoted when they need it, and `due:` opens one of `today`, `week` and `overdue`, plus one entry for a typed valid day, week, quarter or shortcut, which shows the date it resolves to, as in `+1w  2026-11-18`.
  After a comma, the popup completes the next value.
  After `<` or `>`, it offers `today` and `week` instead, with no `overdue`, plus the same typed entry.
- A typed sign and number with no unit, or a sign and a weekday prefix, gets the unit and weekday completion of 5.13.
  The popup does not list the default shortcut set of 5.13 and does not suggest the operators.
- Accepting an entry inserts the typed text as is, so `due:<+1w` is not rewritten to a date and a saved filter stays relative to today.
- The popup is a CodeMirror autocomplete like the one of 5.13: ↑ / ↓ move, Enter or Tab accept, Escape closes it first.
- `fl` opens the bar with `list:` alone and its popup, replacing the current text.
  The other keys of the bar are those above.

**Results**

- A task is visible if it matches, or one of its ancestors matches, or one of its descendants matches.
  A matching parent therefore shows its whole subtree, and a matching subtask shows its parent as context.
- **Hidden subtasks**: a task that shows only some of its subtasks ends its row with a muted eye-off icon and the number of subtasks that are hidden, for example when it is shown because one subtask matches.
  Its tooltip reads "N other subtasks hidden by the filter".
- **Siblings toggle**: an icon button in the header, next to the Markdown view toggle, and `sh` switch between two displays.
  Off, which is the default, a task shown because a subtask matches shows only the matching subtasks.
  On, it shows all its subtasks, so no eye is shown, including the completed ones under `is:todo`.
  The button is accent-colored while it is on, and the choice is stored in `localStorage` and kept when the filter changes.
  It is a display setting: it is not in the document, the undo history or the saved filters, and the cursor stops, the counts and the Markdown view follow the rows it shows.
- A list with no visible task is hidden under any non-empty filter, and with an empty filter every list is shown, empty ones included.
  To add the first task of an empty list, clear the filter.
- Hiding only changes what is rendered: the document is whole, the cursor stops are the visible rows, and the counts of 5.9 are those of the visible tasks.
- **Pinned rows**: a task that the user adds, pastes, edits, checks or unchecks stays visible, with its ancestors, until the filter text changes or is applied again, even if it no longer matches.
  Applying the text again, with `ff` then Enter or Escape, or with a replacing key that sets the same text, drops the pins: it refreshes the view.
  Pins follow the task through the add, the paste or the move that shifts it, and they are cleared by a refresh, a delete, an undo, a redo and an external change.
- An empty result shows a muted "No matching task" and the filter text in place of the lists.
  When a known key has an invalid value, it shows the reason, for example "Unknown due value: foo".
  An empty file keeps the offer of 5.1.

**Editing under a filter**

- The keys `x`, `i`, `cc`, `dd`, `yy`, `p`, `cd`, `cl` and the positional adds work as usual on the visible rows.
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
- `fs` opens the picker below the filter bar.
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
- The server reads and writes the `kryss-filters` block in a small module next to the parser, with no YAML dependency.

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
- While the search is active, the footer statusline shows `/query  3/12` after the counts, the query in yellow (`--color-match`) and the counter in the muted color, with `no match` in place of the counter when nothing matches, whether the input is open or closed.
  It disappears when the search ends.
  The counter is the position of the cursor row among the matching rows, or the number of matching rows when the cursor is not on one.

**Implementation decisions**

- The matching rows, the next and previous match with wrap and the counter are pure functions in `src/client/logic/search.ts`, with the immutable and `null` conventions of 5.7.
  The key function of 5.9 takes whether a search is active, to resolve `n`, `N` and Escape.
- The view highlights by walking the text nodes of the rendered rows after each render, and the search input is built once, like the filter bar of 5.14.
- The input and the highlight are verified by hand.

### 5.16 Several files

These rules apply in Vault mode, that is when `VAULT_DIR` is set (2).
Single-file mode keeps one file and has none of them.

**Which files**

- A file is a Kryss file when it is a `.md` file inside `VAULT_DIR`, at any depth, whose frontmatter has the line `kryss-enabled: true`.
- The scan skips every folder whose name starts with a dot (`.obsidian`, `.git`, `.trash`), reads each file only up to the end of its frontmatter, and ignores a file whose frontmatter is not closed.
- The scan runs on demand, each time `GET /api/files` is called, and nothing watches the Vault for new files.
  `GET /api/files` returns the paths relative to `VAULT_DIR`, with `/` separators, sorted alphabetically ignoring case.
- A file is identified by its path relative to `VAULT_DIR`.
- A file that is listed keeps its own saved filters in its `kryss-filters` key (3.2.1), so each file has its own.

**Which file is open**

- The client carries the open file in the URL, as `?file=Projects/Work.md`, and sends it as the `file` parameter of every API call (2.1).
  Two tabs can show two files, and a reload or a bookmark returns to the same file.
- The server accepts a `file` only if its real path, after resolving symbolic links, is inside `VAULT_DIR` and the file is a Kryss file at that moment.
  Anything else is a `404`, so no path outside the Vault can be read or written.
- With no `file` in the URL, or one that is not listed, the client opens the last file it used, kept in `localStorage`, if it is still listed.
  Otherwise it opens the first file of the list, and when the Vault has no Kryss file it shows an empty state that explains how to create one, with a "New file…" button and `go` working as in the picker.
  The client then writes the file it opened into the URL, so a reload or a bookmark returns to it.
- The scan does not follow symbolic links, so a link is not listed, but a `file` that names a link is accepted when its target is a Kryss file inside the Vault.
- The server watches only the files that have an open SSE stream, and each stream carries the events of its own file.
  It stops watching a file when its last stream closes.
- The ETag, `409`, `422` and the conflict banner (4) work per file.
- The filter text and the cursor position in `localStorage` (5.8, 5.9) are stored per file, and the history is cleared on a switch (5.6).

**Switching**

- `go` (go to file) in Normal mode opens the file picker, a list with the same look and keys as the saved filter picker of 5.14: ↑ and ↓ move, Enter opens the file, Escape closes it.
  Its first entry is "New file…", which asks for a name in a plain input.
- The picker fetches the list each time it opens, so a file marked in Obsidian appears at once.
- The header shows the name of the open file, without its folder or extension, and the whole relative path as tooltip.
- A switch is a navigation to the new `?file=`, after the pending changes of the current file are saved.
  While a save is failing or in conflict, the switch is refused with a message in the statusline, and the file stays open.

**Creating a file**

- The folder for new files is the `NEW_FILE_DIR` environment variable, which defaults to `VAULT_DIR`.
  The server refuses to start when it lies outside `VAULT_DIR`, or in a folder whose name starts with a dot, since the scan would never list the new files.
- `POST /api/files` takes `{ "name": string }`.
  The server trims the name, adds `.md` unless the name already ends with it, and writes the file in `NEW_FILE_DIR`.
- The name is refused with a `400` when it is empty, starts with a dot, or contains a control character or one of `* " \ / < > : | ? # ^ [ ]`, which are the characters that Obsidian refuses in a note name or that break its links.
  The list comes from memory and is checked against Obsidian by hand.
  An existing file is refused with a `409`, and nothing is ever overwritten.
- The new file holds exactly `---`, `kryss-enabled: true`, `---` and a trailing newline, with no list, which is a valid file (3).
  The response is `201` with its path, and the client opens it.
- The picker shows the error under the input and keeps the typed name.
- There is no way to rename, move or delete a file from Kryss: it is done in Obsidian, and the next scan reflects it.

### 5.17 Wikilinks

**Rendering**

- `[[Note]]` and `[[Note|alias]]` render as a link whose label is the alias, or the note name when there is no alias.
  `[[Note#Heading]]`, `[[Note#^block]]` and `[[Note#Heading|alias]]` render with the label `Note > Heading`, or the alias, and the target is passed to Obsidian as it is.
- The link is `obsidian://open?vault=<vault>&file=<target>`, where `<vault>` is the basename of `VAULT_DIR` after symbolic links are resolved, URL-encoded, and `<target>` is the text before `|`, URL-encoded.
  It opens in a new tab like any other link (5.5).
- Kryss does not check that the note exists, so a link to a missing note looks like any other, and Obsidian resolves the name itself.
- A wikilink needs a non-empty target and no `[`, `]` or `|` inside it, otherwise it is literal text.
  In single-file mode there is no vault name, so wikilinks stay literal text.
- The client learns the vault name from the `X-Vault-Name` header of `GET /api/files`, which it already calls at startup, where the value is the URL-encoded basename of `VAULT_DIR` after symbolic links are resolved.
  So no extra scan is needed to render a link, and the header is absent in single-file mode.
- Inside the editor, the live preview hides the brackets away from the cursor like for any other link.

**Note index and popup**

- `GET /api/notes` returns `{ "newLinkFormat", "notes" }`, so the popup has the link format with the index, and `notes` holds one entry per Markdown file of the Vault, `{ "name", "path", "aliases", "modified" }`, where `name` is the basename without `.md`, `path` is relative to `VAULT_DIR` and without `.md`, `aliases` come from the `aliases` key of its frontmatter (a YAML list, an inline array or a single string), and `modified` is the modification time of the file in epoch milliseconds, or `0` when it cannot be read.
- The server builds it with the scan of 5.16, in the same pass, and it keeps nothing between two calls.
  It leaves out the dot folders and the folders of `userIgnoreFilters` (below), and attachments are not notes.
- Typing `[[` in the task editor opens a popup of the index, fetched when the popup opens and filtered as you type, ignoring case, on the name and on every alias.
  It is a CodeMirror autocomplete popup with the same look as the due date popup (5.13).
- The suggestions come in two tiers, the matches that start with what was typed and then the others, and inside each tier the most recently modified note comes first.
  An entry that matches an alias uses the `modified` of its note, and two entries with the same `modified` are ordered by the matched text, ignoring case, then by path.
  With nothing typed after `[[`, the popup therefore lists the most recent notes.
- The `detail` of an entry (the folder, or the note name and its folder for an alias) is drawn in the muted color of completed tasks (`--color-done-text`), and on the selected entry in the text color of the entry (the accent text color) at an opacity of 0.6, so that it stays readable on the accent background.
- A suggestion that matches the name inserts `[[Note]]`, and one that matches an alias inserts `[[Note|alias]]`, so the label stays the alias that was typed.
  Two entries with the same name show their folder next to the name.
- Which path is inserted follows the Obsidian setting `newLinkFormat` (below).
  There is no completion after `#` or `^`.

**Obsidian settings**

- The server reads `.obsidian/app.json` at each scan.
  A missing, unreadable or malformed file means the defaults, and nothing fails.
- `newLinkFormat` is `shortest` (the default when absent), `relative` or `absolute`.
  `shortest` inserts the name alone, or its shortest path that tells it from the other notes of the same name, `relative` inserts the path from the folder of the open file, and `absolute` inserts the path from the Vault root.
- `userIgnoreFilters` lists folders that the note index leaves out, each one a path from the Vault root that excludes the folder and everything below it.
  The scan for `kryss-enabled` still reads them.
- `useMarkdownLinks` is ignored: a suggestion always inserts a wikilink.

**Pure logic**

- The label and target of a wikilink, the `obsidian://` URL, the filtering of the index and the choice of the inserted text for each `newLinkFormat` are pure functions with tests.

### 5.18 Link rules and pasted URLs

**Rules**

- `.kryss.json` at the root of `VAULT_DIR` holds the rules, and `GET /api/config` returns them, read at each call.
  The client loads them at startup and again each time the window regains the focus, so an edit of the file applies without a reload.
  A failed fetch keeps the rules in use.
  When the rules changed, the lists are drawn again so that the links on screen follow them, except while a task or a list name is being typed, where the new rules apply at the next render.
  A missing file means no rules, and a malformed file is reported in the statusline and means no rules.
  The app never writes it.

```json
{
  "links": [
    { "match": "^https://[^/]+\\.atlassian\\.net/browse/([A-Z]+-\\d+)", "label": "$1", "icon": "jira" }
  ]
}
```

- `match` is a regular expression tested on the URL, `label` is a template where `$1`, `$2`… stand for the capture groups, and `icon` is optional.
  The first rule that matches wins.
- A rule with an invalid regular expression, or no `match` or `label`, is skipped, and the statusline reports it once per load.
- `icon` is either the name of a Lucide icon or a `data:image/svg+xml` URL.
  Any other value is ignored.
  Both are drawn as an inline SVG that the client rebuilds from an allow-list of shapes (`path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`, `g`) and attributes, with every fill and stroke set to the text color, so the icon follows the theme, and no script or external reference of an SVG can reach the page.
- A Lucide name is read by the server from the installed package: `GET /api/icons/<name>` accepts only `[a-z0-9-]+` and returns the SVG or a `404`.
  A rule with no icon, an unknown name or a refused value shows the Lucide `Link` icon.
- Kryss ships no rule and no brand icon, and the user writes them for Jira, Slack, Confluence, GitHub or anything else.

**Pasting a URL**

- In the task editor, a paste is handled in this order.
  A paste that is not a single `http` or `https` URL, after trimming, is the native paste of 5.8.
- With some text selected, the paste inserts `[selection](url)`, whatever the rules say.
- With no selection, if a rule matches the URL, the paste inserts `[label](url)` with the label of that rule.
- With no selection and no matching rule, the URL is inserted as an autolink, `<url>`, so that it renders as a link.
- The paste is one step of the editor's own undo, so Ctrl+Z restores the previous text.
- A URL pasted outside the editor, or in the filter bar or the search input, is never transformed.

**Display**

- A link whose URL matches a rule shows an icon before its label, at the size of the text: the icon of the rule, or the Lucide `Link` icon when the rule has none or a refused one.
  It is the same rule on a link typed by hand, pasted from elsewhere or already in the file, so the file stays plain Markdown.
- The label and the icon never change the stored text, and the Markdown view and the clipboard text (5.11, 5.12) are the stored Markdown.

**Details**

- `GET /api/config` returns `{ "links": [...], "problems": [...] }`: the valid rules in file order, and one sentence per problem (a malformed file, a missing `links` array, a skipped rule).
  The client loads it once per page load and shows the first problem, with a count of the others, in the statusline for a short time.
- A rule whose label comes out empty after filling the groups does not match, so a missing group never gives an empty link.
- A missing capture group gives an empty string, and `$0` is the whole match.
- A `data:image/svg+xml` value must be at most 20000 characters and hold no double quote, backslash or line break, since it ends up in a CSS `url("…")`.
- An icon that is a Lucide name unknown to the server shows the `Link` icon, like a rule with no icon or a refused value.
- The paste handles a single selection only, and the inserted label has its `[`, `]` and `\` escaped.
  A URL with unbalanced parentheses has them percent-encoded, so that the Markdown link stays well formed.
- The autolink `<scheme:…>` is only recognized outside a link label, and its content holds no space.
- The editor's live preview does not draw the rule icon, which only appears in the rendered text.

**Pure logic**

- Matching a URL against the rules, building a label, validating an icon value and the decision of the paste (selection, rule, none) are pure functions with tests.

## 6. Tests

- **Parser / serializer** (`bun test`): empty file, empty list, 2 levels, each `422` case, syntax tolerance, normalization, stable round-trip, and the serialization of a whole document, one list and one task.
- **API**: server started on a temporary file; `GET` with ETag, `PUT` with `If-Match`, `409`, `422` and SSE after external modification.
- **Frontmatter filters**: the `kryss-filters` block (each `422` case, byte for byte when unchanged, add, replace and remove, creating and removing the frontmatter, the rest of the frontmatter untouched) and the `PUT` round-trip with filters.
- **Pure client logic**: checking rules, move and depth validation, list move (before, after, edges, no-op), undo stack, the key resolution of 5.9 (modes, prefixes, target kinds, and the keys of the Markdown view and of the register), positional add, cursor clamping, the filter keys (`fa`, `ft`, `fw`, `fl`, `fx`, `fX`, `ff` and `fs`, and the pins dropped) and statusline counts, the Markdown view export (whole document, one list, empty document, empty list), and the register (content, paste placement, depth rule, check states, list paste, clipboard text), and the due dates (validation of each form, week 53 and leap years, periods, the state against a horizon, every shortcut with month clamping and year boundaries, the popup entries, the last-date rule, and the `cd` keys), the filter parser and matching (each term, commas, quotes, bad values, unknown keys, the `due:` shortcuts, the operators `<` and `>` on days, weeks and quarters with overlap, `today`, `week`, completed tasks, a task with no date, the invalid values, a range of two terms and an operator in each comma value, the unit and weekday completion of a sign and number and the popup entries after an operator, the tree visibility rule, empty lists, pinned rows), the moves under a filter (hidden siblings jumped over, edges of the visible range, indent on the previous visible task, crossing to the previous or next visible list, list move over hidden lists, pins kept on the right tasks after a move, an outdented subtask pinned), and the due date rewrite on completion (overdue day, week, quarter, today, future day, existing `(was …)`, cascade and auto-checked parent), and the move of a task to another list (top-level task and subtask, end of the destination, parent recomputed, destination equal to the source, empty destination list, the picker rows and their narrowing, and the key `cl` on a task, on a header and with the Markdown view open), and the search (matching ignoring case, titles, rendered text, hidden rows, next and previous with wrap, the counter, no match, and the keys `/`, `n`, `N` and Escape with and without an active search).
- **Vault**: the scan (opt-in, dot folders, unclosed frontmatter, depth, order), a `file` outside the Vault or through a symbolic link, the `404`, the creation of a file (each refused name, an existing file, the content written, `NEW_FILE_DIR` outside the Vault), per-file ETag, `409` and SSE, and single-file mode ignoring `file`.
- **Wikilinks and rules**: the note index (aliases in each YAML style, ignored folders, same names), `app.json` (each `newLinkFormat`, absent and malformed), `.kryss.json` (missing, malformed, invalid rule), `GET /api/icons/<name>` (valid, unknown, refused name), and the pure logic of 5.17 and 5.18.
- No e2e in v1: CodeMirror is verified by hand, and so is the visual design of 5.10 in a window from 240 to 720 px wide, in light and dark.

## 7. Out of scope

Authentication and network access; multi-user; Yjs / CRDT; offline mode; editing the frontmatter other than the `kryss-filters` key, writing `kryss-enabled` other than in a new file, and file-based settings other than the saved filters, `.obsidian/app.json` and `.kryss.json`, which are read only; a desktop shell (Tauri, Electron); a watcher on the Vault, and renaming, moving or deleting a file from Kryss; a subfolder chosen at creation; completion after `#` or `^` in a wikilink, a check that a wikilink target exists, and following `useMarkdownLinks`; fetching page titles for a pasted URL, and bundled brand icons; custom checkbox states (`[>]` and the like, still rejected by 3.3, to be decided later); due dates on lists; `xit` format; automatic conflict merging; wrapping of the cursor at the edges (the search wraps, 5.15); tags, priorities; sorting by due date, "this month" and "this quarter" views, a date picker, relative labels such as "tomorrow" on the pill, a warning for an invalid date, a midnight timer, a `yesterday` shortcut, month and year precision; a toggle that hides completed tasks; non-inline Markdown; multi-line tasks; e2e tests; drag and drop, with or without a handle; add lines and add buttons; hover buttons on rows and list headers; a button to create a list; Visual and Command modes; counts, operator and motion grammar, named registers, a persistent register, `P` (paste above), reading the system clipboard, pasting Markdown outside Insert mode; custom keymaps; jumping to the first or last item of another list; editing in the Markdown view, a rendered or split Markdown view, persisting the view across reloads, per-list copy buttons; row and list actions for the keyboard cursor; a theme setting or a new color palette; negation, regex and a general OR in filters, renaming saved filters, undo of saved filter changes, a separate filters file, a persistent undo history, restoring a due date when a task is unchecked; cycling by occurrence, a remembered last query, regex, filter terms, search in the Markdown view and highlights inside the editor for the search.
