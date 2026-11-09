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
- The choice is stored in `localStorage` **by index**; if the index no longer exists, fall back to "All".
- Create, rename and delete a list from the selector.
  Deleting a non-empty list asks for confirmation.
  A new list is appended at the end.
- Lists cannot be reordered in the app (order is the file's order).
  Empty file: the app offers to create the first list.
- The theme follows the system (`prefers-color-scheme`), with no setting.

### 5.2 Tasks

- Add (Enter), edit in place, check, delete.
- Indent / outdent with Tab / Shift+Tab.
  A subtask cannot be indented, and a task that has subtasks cannot become a subtask.
- Move a task with the keyboard (up / down).
  Shortcut: Alt+↑ / Alt+↓.

### 5.3 Checking

- Checking a parent checks all its children.
  Unchecking a parent only changes the parent.
- When all children are checked, the parent is checked automatically.
- Unchecking a child, adding a child, or dropping an unchecked task under a checked parent unchecks the parent.
- These rules only apply to UI actions: the server does not normalize states.
- A completed task stays in place.
  It is distinguished by its checked box and a different background or color (not by strikethrough text, to avoid confusion with `~~strikethrough~~`).

### 5.4 Drag and drop (Pragmatic drag and drop)

- Three drop zones per task: **before**, **after** and **as child**.
  A moved task takes its children with it.
- Dropping into another list is possible in the "All" view, including into an empty list.
- Forbidden: dropping a task into one of its own descendants, and any drop that creates a third level.
- The drop zone comes from the pointer position in the hovered row: top third is before, middle third is as child, bottom third is after.
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
  Enter commits, Escape cancels.
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

- Global undo / redo stack over the document (Ctrl+Z / Ctrl+Shift+Z), in memory.
  Each undo triggers a normal `PUT`.
- No confirmation to delete a task (undo recovers it).
- Inside a task's editor, Ctrl+Z first undoes typing (CodeMirror), then the global stack once the task is left.
- The stack is cleared on page reload and on any detected external change.
- The shortcut handler is global and does nothing while a task editor or an add input has focus, so that they keep their own undo.

### 5.7 Pure client logic decisions

- The pure logic lives in `src/client/logic/`, is immutable, and addresses tasks by `{ list, task, child? }` paths.
- An operation that is refused returns `null` (or the same document for simple edits), so the caller can detect a no-op.
- Keyboard move (Alt+↑ / Alt+↓) swaps with the previous or next sibling at the same level and parent, and does nothing at the edges, never crossing a list or a parent.
- Indent makes the task the last subtask of the previous task, and unchecks that parent if the indented task is unchecked.
- Reordering under the same parent never changes a check state.
- Moving a task out of a parent does not recompute that parent's state.
- The undo stack is bounded to 100 snapshots.
- Texts and list titles are trimmed, line breaks become spaces, and empty values are refused.

### 5.8 Client state and UI decisions

- `src/client/store.ts` holds the document, the ETag, the sync status, the selected list and the history.
  Local changes enter through `commit(doc)` only, server documents through `replace(doc, etag)`, which clears the history.
- The sync statuses are saved, unsaved, saving, conflict, invalid, offline and error.
  "Error" means a `PUT` was refused with `400` or `428`, so retrying the same request cannot succeed: it is not retried, the local document is kept, a banner explains it and the next edit sends a new `PUT`.
  "Offline" means a save or the initial load failed on the network or with another unexpected status, and it is retried after 1 s, 2 s, 4 s and so on, capped at 30 s.
- A save that completes without changing the document only updates the status badge, never the DOM of the lists, so typing is never interrupted.
- An SSE `change` event carries the new ETag and the parsed document or the parse error.
  With no pending change the client applies it directly without a `GET`, with pending changes it opens the conflict banner, and an event received during a `PUT` is handled once that `PUT` returns.
  A `GET` that returns after a local edit was made is ignored, so that the edit is never overwritten.
  When the SSE stream reconnects, the client reloads if nothing is pending, since events may have been missed.
- A `422` on `PUT` shows the invalid file error in place of the lists and keeps the local document in memory, and the next external change then opens the conflict banner.
- "Keep my version" re-sends the local document with the ETag of the disk version, and "take the disk version" reloads and discards local changes.
- Rows are focusable, and the keyboard shortcuts (Tab, Shift+Tab, Alt+↑, Alt+↓, Enter or F2 to edit, Delete) act on the focused row.
  A refused Tab or Shift+Tab keeps its default behavior.
- Tasks are added from an input at the end of each list, subtasks from the "+" button of a top-level task or with Tab.
- List names are asked with `window.prompt` and deletions confirmed with `window.confirm`.
- Text editing goes through `view/edit-text.ts`, which delegates to the CodeMirror editor in `src/client/editor/`.
- The editor is created when a task enters editing and destroyed when it leaves, and `isEditing()` tells whether one exists, so the global undo can stay inactive meanwhile.
- Enter commits, Escape cancels, and a blur (click elsewhere, Tab, Shift+Tab) commits, like the previous input, so typing is never lost.
- Before a content render replaces the lists (external reload, canonical document of a `PUT`), every open editor is settled so that none is detached without being destroyed, and `isEditing()` stays accurate.
  If the task under the editor is unchanged in the new document, the typed text is committed through the normal edit path, so it is never lost.
  If the task changed or disappeared, which means an external change, the disk version wins and the edit is discarded.
- Line breaks, from paste or any other source, are replaced by one space each.
- Tab, Shift+Tab and Alt+arrows are not bound by the editor, so it never swallows them.
- The live preview uses the Lezer Markdown parser restricted to inline syntax (no block syntax, HTML, images or entities, plus strikethrough).
  Markers of a node are hidden unless a selection range is in or touching that node, and a link is only previewed when its URL is allowed.
- The cursor starts at the end of the text when editing begins.

## 6. Tests

- **Parser / serializer** (`bun test`): empty file, empty list, 2 levels, each `422` case, syntax tolerance, normalization, stable round-trip.
- **API**: server started on a temporary file; `GET` with ETag, `PUT` with `If-Match`, `409`, `422`, SSE after external modification.
- **Pure client logic**: checking rules, move and depth validation, undo stack.
- No e2e in v1: drag and drop and CodeMirror are verified by hand.

## 7. Out of scope

Authentication and network access; multi-user; Yjs / CRDT; offline mode; frontmatter and file-based settings; `xit` format; automatic conflict merging; list reordering; due dates, tags, priorities, search, filters; hiding completed tasks; non-inline Markdown; multi-line tasks; e2e tests; keyboard accessibility of drag and drop beyond Tab / Shift+Tab and up / down moves.
