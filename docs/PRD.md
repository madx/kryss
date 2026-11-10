# PRD — todoapp

## 1. Goal

A **single-user, local** todo list manager whose source of truth is a **Markdown file**, editable both from the web app and from an external editor (Obsidian, Vim).

**Success criterion**: alternate between the app and a Markdown editor on the same file for a full week without ever losing or corrupting content.

**Target scale**: about 100 tasks spread across fewer than 10 lists.
No virtualization needed.

## 2. Architecture

- A **Bun server** owns the file.
  The browser never accesses it directly, which makes the app browser-independent (Safari included).
- Client and server exchange **JSON**, except for the read-only Markdown export of 2.1, which is plain text.
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
| `GET /api/export` | Returns the canonical Markdown of the document as `text/plain`, without frontmatter. The optional `list` query parameter is a 0-based list index and restricts the export to that list. Returns `422` if the file is invalid. |

The `GET /api/export` route is read-only and has no `ETag` handling.
Without `list`, it returns exactly the canonical serialization of 3.4 minus the frontmatter, which is an empty body for an empty document.
With `list`, it returns the same serialization of that one list, so an empty list gives just its `## Name` line.
A `list` that is not a non-negative integer gives `400`, and one that is out of range gives `404`.
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

### 3.2.1 Frontmatter

Obsidian adds a YAML frontmatter to notes, so a leading block opened by `---` on the first line and closed by `---` or `...` is ignored on read.
The blank lines that follow it are part of the block.
The server keeps the block byte for byte and writes it back unchanged in front of the serialized lists on every `PUT`.
The block never reaches the client, and error lines still count the frontmatter lines.
A block that is not closed is rejected (`422`, line 1).

### 3.3 Rejection (`422`)

Everything else is rejected with line and reason: an unclosed frontmatter, free text, `#` or `###` headings, text before the first `##`, empty list name, tasks nested 3 or more levels deep, multi-line description under a task, inconsistent indentation.
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
  Names are typed in an inline input that replaces the list title: Enter, Escape and a blur commit a non-empty name (like the task editor) and cancel an empty one.
  An external change discards the name being typed and closes the input.
  Deleting a list, empty or not, always asks for confirmation with an inline Delete / Cancel alert (5.10) that replaces the content of the list header.
  A new list is created at once, appended at the end and called "New list", as one undoable change.
  A single-list view switches to it, so that the selector shows its name, and the name input opens on its title with the name selected.
  The selector label follows the name while it is typed, and cancelling (an empty name) keeps "New list".
  The header has no title: it holds the selector on the left, a Lucide plus icon button to create a list, and the Markdown view toggle of 5.11.
  The selector is a custom control that follows the look of the app (5.10), not a native `<select>`.
- Lists are reordered in the "All" view only, with the keyboard (5.2, 5.9) or by drag and drop (5.4).
  In a single-list view the move keys and the drag do nothing.
  This restriction is temporary: later list modes, search and filters are meant to reuse the same move on the visible lists, so the logic must not depend on it (5.7).
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
  The keys only cross the visible lists: with a single list shown, nothing leaves it.
  Nothing happens at the very top or bottom of the visible lists.
  The check rules of 5.3 apply (an unchecked task landing under a parent unchecks it, the old parent is recomputed).
- Move a list with the same shortcuts on a list header (5.9).
  `J` / Alt+↓ moves the list below the next visible list, and `K` / Alt+↑ moves it above the previous visible list.
  There is no wrapping: nothing happens at the first or last visible list.
  The cursor stays on the moved list header, which is scrolled into view.
  Each move is one undoable change (5.6).

### 5.3 Checking

- Checking a parent checks all its children.
  Unchecking a parent only changes the parent.
- When all children are checked, the parent is checked automatically.
- Unchecking a child, adding a child, or dropping an unchecked task under a checked parent unchecks the parent.
- When a subtask leaves a parent (move, outdent or delete) and the parent still has subtasks that are all checked, the parent becomes checked.
  A parent left with no subtask keeps its state.
- These rules only apply to UI actions: the server does not normalize states.
- A completed task stays in place.
  It is distinguished by its checked box and a muted text color, with no background (not by strikethrough text, to avoid confusion with `~~strikethrough~~`).

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
- There is no drag handle: the drag starts from anywhere on the row, a click on the text still starts an edit, and a drag moves the task.
  The drop indicator is a single 2 px accent line (5.10): above or below the row, indented to the subtask level for "as child".
- Only an empty list is a drop target of its own (the task is appended), a non-empty list is reached through the zones of its rows.
- The DOM is rebuilt on every change, so the drag and drop registrations are redone after each render.
- Lists are dragged by their header, in the "All" view only (5.1).
  The whole header row is the drag source, except its icon buttons, and it is not draggable while the name input or the delete alert is open.
  A click on the header still places the cursor, and the drag starts only once the pointer has moved.
  There is no drag handle.
- Every visible list panel is a drop target for a dragged list, with two zones: the top half is before the list and the bottom half is after it.
  The indicator is the same single 2 px accent line, above or below the panel.
  Dragging a list onto itself, or next to itself without changing the order, does nothing.
- List drags and task drags are separate drag types: a list is never dropped into a task row and a task never reorders lists.
- After a drop, the cursor goes to the moved list header, as after a keyboard move.

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
- Each entry remembers the view (All or a list) that was active when the change was made, and undo and redo switch back to it, so a change made in another view is never invisible.
  A list move is made in the "All" view, so undoing it returns to "All" before the lists change order, and a single-list index is never affected.
- The stack is cleared on page reload and on any detected external change.
- The shortcut handler is global and does nothing while a task editor or a text input has focus, so that they keep their own undo.
  It is the same handler as the Normal mode handler of 5.9, so there is one global `keydown` listener and no second one.

### 5.7 Pure client logic decisions

- The pure logic lives in `src/client/logic/`, is immutable, and addresses tasks by `{ list, task, child? }` paths.
- An operation that is refused returns `null` (or the same document for simple edits), so the caller can detect a no-op.
- Keyboard move (`J` / `K`, Alt+↑ / Alt+↓) follows 5.2: it crosses parent and visible list boundaries, takes the visible list range as a parameter (default: the whole document), and returns `null` at the edges of that range and for a subtask with no task to join.
- List move takes the list to move, a target list and `before` or `after`, and returns `null` when the order would not change.
  Drag calls it with the hovered list and the zone, and the keyboard calls it with the previous or next visible list, so that later list modes and filters only change which list is the target.
  Like the task move, the keyboard resolution takes the visible list range as a parameter (default: the whole document).
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
- Tasks are also added from the "+ Add a task" line at the end of each list and, for subtasks, from the "+ Add a subtask" line that a click on a top-level task's text reveals (5.10), which stay for mouse use.
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
  Escape leaving Insert mode also hides the "+ Add a subtask" line revealed by that click (5.10).

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
  While the selector menu is open, Escape closes it first and then puts the focus back on the cursor.
  The conflict banner is the first Tab stop and has no dedicated key.
- `gm` toggles the Markdown view of 5.11, and `yy` copies its content.
- A pending first key (`g`, `d` or `y`) is cancelled by any other key or by a blur, with no timeout.
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
| `i`, Enter | rename the list in its inline name input (a click on the title does the same) |
| `dd` | delete the list with the inline prompt, answered by `y` or Enter (confirm) and `n` or Escape (cancel) |
| `o`, `a`, `I` | add a task as the first task of the list |
| `A` | add a task as the last task of the list |
| `J` / `K`, Alt+↓ / Alt+↑ | move the list down / up ("All" view only) |
| `N` | create a list at the end and open its name input, from anywhere in Normal mode |

- `J` and `K` move the list down and up, like Alt+↓ and Alt+↑, as described in 5.2.
- `x`, `>` and `<` do nothing on a header.
- `N` creates the list as in 5.1, keeps the "All" view, and switches a single-list view to the new list.
  Once the name is confirmed, the cursor stays on the new list header.
  This also applies to a list created with the plus button.

**Positional add and Insert mode**

- `o`, `O`, `a`, `I` and `A` create an empty task at the target position, focus it and open the task editor on it.
  The empty task exists only in the client until it is committed, because an empty text is invalid in the file, and autosave never sends it.
- Enter commits a non-empty text and opens a new empty sibling right below it, at the same level, to chain several tasks.
  Enter on an empty text does nothing.
- Escape always commits and returns to Normal mode.
  A new task with an empty text is discarded, and the cursor returns to the row it started from.
  An existing task whose text was emptied gets its previous text back, and it is never deleted this way.
- A blur commits, as in 5.8.
- The list name input follows the same rule as the task editor: Enter, Escape and a blur commit a non-empty name and cancel an empty one.

**Focus after an action**

- After `dd`, the cursor goes to the next stop at the same position, or to the previous stop if the deleted one was last.
- After a move, indent, outdent, check, or leaving Insert mode, the cursor stays on the same task, following it to its new position.
- After an undo or a redo, the cursor goes to the first task that changed, or to the same position clamped to the visible range if it cannot be determined.
- After an external change, the cursor keeps the same position clamped to the visible range, since tasks have no identity.

**Footer, statusline and cheat sheet**

- A fixed footer, like the header, shows the mode (NORMAL in accent blue, INSERT in green, as in 5.10), the done / total task counts of the current view and the sync status symbol on the right.
  The mode badge is a corner block that reaches the left and bottom edges of the window.
- The counts are those of the lists in the current view, and each list also shows its own done / total counts at the top right of its header.
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

### 5.10 Visual design

The goal is a compact and balanced UI that stays comfortable in a narrow window, with the color palette unchanged.
The static prototype that settled these decisions was a throwaway and is not kept.

**Layout and density**

- The page is one centered column that fills the window and stops growing at `--content-width` (720 px).
  The header, the list panels and the footer share the same left edge.
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
- There is no drag handle (5.4).
- A delete "×" appears on mouse hover only, on top of the end of the text with a solid background, so it reserves no width.
  There is no hover "+" on rows.
- The delete icon of a list header appears when the mouse is over that header only.
  There is no rename icon: a click on the list title opens the name input, like a click on the text of a task opens its editor.
  No delete icon appears for the keyboard cursor, since the keyboard has its own keys.
- Each list ends with a quiet "+ Add a task" line.
- A click with the mouse on the text of a task reveals a "+ Add a subtask" line right below it, indented to the subtask level and placed after the last subtask if there are some.
  A click on a subtask reveals the line of its parent, since a subtask cannot have subtasks.
  A click on a checkbox neither shows nor hides the line, and a click anywhere else hides it, as does Escape (5.9).
  Keyboard focus never reveals it.

**Cursor and inputs**

- The cursor row and the cursor list header share one look: a tinted background and a 2 px bar on the left, in the color of the current mode.
  The mode color is accent blue in Normal mode and green in Insert mode, the same as the footer badge.
- An input never looks like a box.
  It replaces the text or the placeholder it stands for, with the same font and size and no border or background of its own, and the cursor look in Insert color is the only signal.
  This applies to the task editor, to the add lines (which turn into an empty editing row) and to the list name input (which edits the title in place).
- The name input of a new list is the title of its section, with the same look as a rename.

**Drag feedback**

- The dragged row is dimmed to 40%.
- The drop position is a single 2 px accent line above or below the target row, indented to the subtask level for "as child", and inside the panel for an empty list.
  There is no border or tint on the target row.

**Alerts**

- Banners, notices and the list delete confirmation are one component: a full-width strip with a 6 px radius, small padding, 14 px text (the body token, larger than the 12 px tasks), no border and a tinted background.
  Amber is for warnings (the conflict banner, the empty file and the unreachable server), and red is for errors (the invalid file and rejected requests) and for the delete confirmation.
- Its actions are text buttons on the same line, and they wrap below the message when the window is narrow.
- Banners sit between the header and the scroll area and never scroll away.
  The delete confirmation replaces the content of the list header, and the invalid file, empty file and unreachable server notices use the same strip in place of the lists.

**List selector**

- The selector is a button showing the current view (All or a list title, truncated with an ellipsis) and a chevron, in the header title style (16 px, semibold).
- It opens a menu below it with "All" and one item per list, which uses the panel look (surface background, 6 px radius items), a tint on the hovered or keyboard-focused item and a check icon on the current view.
- The menu is a listbox usable with ↑ / ↓, Enter and Escape, it closes on an outside click, and it adds no dependency.

**Cheat sheet**

- The overlay is inset by the page gutter and uses the panel look, with a fixed title and a vertical scroll limited to the window height.
- In a wide window the entries are two columns, keys then description.
  In a narrow window each entry is stacked, with the keys in `kbd` style above the muted description, the breakpoint being 520 px (a literal in the media query, since a media query cannot read a token).

**Tokens**

- Font sizes are 16 px (list selector only), 14 px (body and alerts) and 12 px (tasks, list titles, counts, footer, cheat sheet, `kbd`).
- Radii are 8 px (panels), 6 px (rows, buttons, alerts, inputs) and 4 px (chips: `code`, `kbd`, mode badge, checkbox).
- Spacing steps are 2, 4, 6, 8, 12 and 16 px, plus the responsive `clamp()` tokens above.
- Icons are Lucide SVG at 14 px with a stroke of 2, never text glyphs, and icon buttons are 22 px squares.
- Every size, radius and spacing value in the stylesheets comes from a token in `theme.css`, and a new value needs a new token first.
- Green means "saved" for the sync symbol and Insert for the mode, and these two never appear in the same place.

### 5.11 Markdown view

The Markdown view shows the Markdown equivalent of the current view, to inspect it and to copy it in full or in part.
It is read-only: there is no editing and no text `PUT`, and the file stays editable from an external editor.

**Opening and closing**

- A header button toggles it, with the Lucide `square-m` icon and the label "Export as Markdown" as tooltip and accessible name.
  `gm` does the same in Normal mode, and `m` is left free for another feature.
- The view replaces the task area in place, between the header and the footer.
  The header, the selector, the SSE connection and the sync state stay alive.
- The button, `gm` or Escape closes it, and the cursor goes back to where it was.
- It is not stored in `localStorage`, so a reload always lands on the task UI.

**Content**

- It shows the response of `GET /api/export`, with `list` set to the index of the selected list in a single-list view and absent in the "All" view.
- It is a monospace block of selectable text, so the native selection and Ctrl+C copy any part of it.
- Opening the view first flushes the pending autosave and waits for the in-flight `PUT`, then fetches the export.
  If the flush does not succeed (`409`, network error or `422`), the view does not open and the task UI stays, with the existing banner or sync symbol showing why.
- `H` / `L` still switch views and fetch the export again.
  An SSE `change` event fetches it again silently, which drops any text selection.
- An empty export shows a muted "Nothing to export" placeholder.
  A `422` shows the line and the reason, as the task UI does, in place of the block.
  In both cases the copy button and `yy` are disabled.

**Copying**

- A copy button at the top right of the block copies the whole export with `navigator.clipboard`, and `yy` does the same from the keyboard.
- Both show a "Copied" popover anchored to the copy button.
  It disappears after 1 second, or at once on a click.
- While the view is open, the other Normal keys are ignored, so a task cannot be changed without being seen.
  `H` / `L`, `gm`, `yy`, Escape and `?` keep working.

**Implementation decisions**

- The server builds the export with the same serializer as the file, restricted to the requested list and without the frontmatter, so the client never serializes Markdown.
- The `gm` and `yy` resolution belongs to the pure key function of 5.9, and its output depends on whether the view is open.
- The store exposes `flush()`, which sends the pending changes at once, waits for the `PUT` in flight and resolves to `false` when the save does not succeed.
- When the server cannot be reached, the view shows a "Cannot reach the server." alert in place of the block, with copy disabled.
- Escape closes the view even when the focus is on a button, and undo and redo are ignored while it is open.
- The `square-m` icon is called `SquareLetterM` in the installed Lucide package.

## 6. Tests

- **Parser / serializer** (`bun test`): empty file, empty list, 2 levels, each `422` case, syntax tolerance, normalization, stable round-trip.
- **API**: server started on a temporary file; `GET` with ETag, `PUT` with `If-Match`, `409`, `422`, SSE after external modification, and `GET /api/export` (whole document, `list` index, empty document, empty list, frontmatter left out, `400`, `404`, `422`).
- **Pure client logic**: checking rules, move and depth validation, list move (before, after, edges, no-op), undo stack, the key resolution of 5.9 (modes, prefixes, target kinds, and the keys of the Markdown view), positional add, cursor clamping, view cycling and statusline counts.
- No e2e in v1: drag and drop and CodeMirror are verified by hand, and so is the visual design of 5.10 in a window from 240 to 720 px wide, in light and dark.

## 7. Out of scope

Authentication and network access; multi-user; Yjs / CRDT; offline mode; editing the frontmatter, and file-based settings; `xit` format; automatic conflict merging; reordering lists outside the "All" view, and wrapping at the edges; due dates, tags, priorities, search, filters; hiding completed tasks; non-inline Markdown; multi-line tasks; e2e tests; keyboard accessibility of drag and drop beyond the up / down moves; Visual and Command modes; counts, operator and motion grammar, and registers; custom keymaps; jumping to the first or last item of another list; editing in the Markdown view, a rendered or split Markdown view, persisting the view across reloads, per-list copy buttons; a drag handle; row and list actions for the keyboard cursor; a theme setting or a new color palette.
