## 1. Foundation
- [x] Remove `xit-parse` from the dependencies
- [x] Listen on `127.0.0.1` instead of `0.0.0.0` in `index.ts`
- [x] Read `TODO_FILE` (default `./todo.md`) and create the empty file if missing
- [x] Structure the project
  - [x] Split into `src/server`, `src/client` and `src/shared` (JSON types)
  - [x] Add the `dev`, `build` and `test` scripts to `package.json`

## 2. Parser and serializer
- [x] Define the JSON model types (list, task, subtask)
- [x] Write the Markdown → JSON parser
  - [x] `## Name` sections, empty lists and empty file
  - [x] `- [x]` / `- [x]` tasks with 2 nesting levels
  - [x] Tolerance: `*` bullets, `[X]`, tabs and 4-space indentation
  - [x] `422` errors with line and reason (frontmatter, free text, `#` / `###`, empty name, 3 levels, multi-line)
- [x] Write the JSON → canonical Markdown serializer
- [x] Test the parser and serializer (edge cases and stable round-trip)

## 3. Server API
- [x] Implement `GET /api/todos` with `ETag` (file hash) and `422` if invalid
- [x] Implement `PUT /api/todos` with `If-Match`, `409` and refusal if the file is invalid
- [x] Write the file atomically (temporary file then rename)
- [x] Watch the file (`fs.watch`) while ignoring the server's own writes
- [x] Implement the `GET /api/events` SSE stream
- [x] Test the API on a temporary file (ETag, `409`, `422`, SSE)

## 4. Client: state and sync
- [x] Load the document and track the ETag
- [ ] Write the full DOM rendering from the JSON
- [x] Autosave with a 500 ms debounce and a single `PUT` in flight
- [x] Show the "unsaved" indicator with increasing-delay retries
- [ ] Warn on close with `beforeunload` if changes remain
- [ ] Reload on SSE event when there are no pending changes
- [ ] Show the conflict banner (keep my version / take the disk version)
- [ ] Show the invalid file error (line and reason)

## 5. Client: lists and tasks
- [ ] "All" / single list selector, stored in `localStorage` by index
- [ ] Create, rename and delete a list (confirmation if non-empty)
- [ ] Offer to create the first list when the file is empty
- [ ] Add, delete and check a task
- [ ] Indent and outdent with Tab / Shift+Tab (2-level limit)
- [ ] Move a task with the keyboard using Alt+↑ / Alt+↓
- [x] Parent / children checking rules
  - [x] Checking a parent checks its children
  - [x] Parent checked automatically when all children are
  - [x] Parent unchecked when a child is unchecked, added or dropped unchecked
- [x] Test the pure logic (checking, depth, move validation)
- [ ] Apply styles: background and color for completed tasks, system theme

## 6. Drag and drop
- [ ] Integrate Pragmatic drag and drop
- [ ] Drop zones before, after and as child
- [ ] Move a task together with its children
- [ ] Drop across lists, including into an empty list
- [ ] Refuse drops into a descendant and drops that create a 3rd level
- [ ] Verify drag and drop by hand

## 7. Markdown rendering and editing
- [x] Sanitized inline Markdown rendering (bold, italic, code, strikethrough, links)
- [x] Links: new tab, `rel="noopener noreferrer"`, `http`, `https`, `mailto` and `obsidian` schemes
- [ ] Single-line CodeMirror 6 editor (Enter commits, Escape cancels)
- [ ] Live preview: markers hidden away from the cursor
- [ ] Instantiate CodeMirror only on the task being edited

## 8. Finishing
- [ ] Global undo / redo stack (Ctrl+Z / Ctrl+Shift+Z)
  - [ ] Clear the stack on reload and on external change
  - [ ] Coordinate with CodeMirror's own undo
- [ ] Document how to run the app in `README.md`
- [ ] Verify alternating use with Obsidian on the same file
- [ ] Validate the success criterion: one week of use without loss
