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
- **Network**: listens on `127.0.0.1` by default, **without authentication** (local machine use only).
  The current `0.0.0.0` binding in `index.ts` must be changed.
- **Dependencies**: `xit-parse` is removed.

### 2.1 API

| Route | Description |
|---|---|
| `GET /api/todos` | Returns the JSON document and an `ETag` header (hash of the file contents). Returns `422` if the file is invalid. |
| `PUT /api/todos` | Replaces the whole document. Requires `If-Match` with the known ETag. Returns `200` and the new ETag, `409` if the file changed, `422` if the file on disk is invalid. |
| `GET /api/events` | SSE stream: an event is emitted whenever the file changes and the change was not caused by the server itself. |

The `422` body contains the line number and the reason.

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

### 5.6 Undo

- Global undo / redo stack over the document (Ctrl+Z / Ctrl+Shift+Z), in memory.
  Each undo triggers a normal `PUT`.
- No confirmation to delete a task (undo recovers it).
- Inside a task's editor, Ctrl+Z first undoes typing (CodeMirror), then the global stack once the task is left.
- The stack is cleared on page reload and on any detected external change.

## 6. Tests

- **Parser / serializer** (`bun test`): empty file, empty list, 2 levels, each `422` case, syntax tolerance, normalization, stable round-trip.
- **API**: server started on a temporary file; `GET` with ETag, `PUT` with `If-Match`, `409`, `422`, SSE after external modification.
- **Pure client logic**: checking rules, move and depth validation, undo stack.
- No e2e in v1: drag and drop and CodeMirror are verified by hand.

## 7. Out of scope

Authentication and network access; multi-user; Yjs / CRDT; offline mode; frontmatter and file-based settings; `xit` format; automatic conflict merging; list reordering; due dates, tags, priorities, search, filters; hiding completed tasks; non-inline Markdown; multi-line tasks; e2e tests; keyboard accessibility of drag and drop beyond Tab / Shift+Tab and up / down moves.
