## 1. Foundation
- [x] Remove `xit-parse` from the dependencies
- [x] Listen on `127.0.0.1` instead of `0.0.0.0` in `index.ts`
- [x] Read `TODO_FILE` (default `./todo.md`) and create the empty file if missing
- [x] Read the listening address from a `HOST` environment variable (default `127.0.0.1`) so the container can bind `0.0.0.0`
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
- [x] Write the full DOM rendering from the JSON
- [x] Autosave with a 500 ms debounce and a single `PUT` in flight
- [x] Show the "unsaved" indicator with increasing-delay retries
- [x] Warn on close with `beforeunload` if changes remain
- [x] Reload on SSE event when there are no pending changes
- [x] Show the conflict banner (keep my version / take the disk version)
- [x] Show the invalid file error (line and reason)

## 5. Client: lists and tasks
- [x] "All" / single list selector, stored in `localStorage` by index
- [x] Create, rename and delete a list (confirmation if non-empty)
- [x] Offer to create the first list when the file is empty
- [x] Add, delete and check a task
- [x] Indent and outdent with Tab / Shift+Tab (2-level limit)
- [x] Move a task with the keyboard using Alt+↑ / Alt+↓
- [x] Parent / children checking rules
  - [x] Checking a parent checks its children
  - [x] Parent checked automatically when all children are
  - [x] Parent unchecked when a child is unchecked, added or dropped unchecked
- [x] Test the pure logic (checking, depth, move validation)
- [x] Apply styles: background and color for completed tasks, system theme

## 6. Drag and drop
- [x] Integrate Pragmatic drag and drop
- [x] Drop zones before, after and as child
- [x] Move a task together with its children
- [x] Drop across lists, including into an empty list
- [x] Refuse drops into a descendant and drops that create a 3rd level
- [ ] Verify drag and drop by hand

## 7. Markdown rendering and editing
- [x] Sanitized inline Markdown rendering (bold, italic, code, strikethrough, links)
- [x] Links: new tab, `rel="noopener noreferrer"`, `http`, `https`, `mailto` and `obsidian` schemes
- [ ] Single-line CodeMirror 6 editor (Enter commits, Escape cancels)
- [ ] Live preview: markers hidden away from the cursor
- [ ] Instantiate CodeMirror only on the task being edited

## 8. Finishing
- [x] Global undo / redo stack (Ctrl+Z / Ctrl+Shift+Z)
  - [x] Clear the stack on reload and on external change
  - [x] Coordinate with CodeMirror's own undo
- [x] Document how to run the app in `README.md`
- [x] Verify alternating use with Obsidian on the same file
- [ ] Validate the success criterion: one week of use without loss

## 9. Follow-ups from answered questions
- [x] Render `![alt](url)` as nothing in the inline renderer, since images are out of scope
- [x] Recompute a parent's state when a subtask is moved or outdented out of it (update the PRD)
- [x] Send the whole state in the SSE event, including the invalid-file error, so the client updates without an extra `GET`
- [x] Alt+↑ / Alt+↓ moves a task across parent and list boundaries
- [x] Reduce the undo stack from 200 to 100 snapshots
- [x] Replace native `prompt` and `confirm` with a proper UI to create, rename and delete a list
- [x] Backspace also deletes the focused task, unless an input or the editor is being edited
- [x] Keep the add-input text in local state and restore it after a re-render
- [x] Drop "after" a parent with children inserts it as the first child, and a drop between children inserts at that position
- [x] Use quarters instead of thirds for the drop zones of a row
- [ ] Place the editor cursor where the user clicked (implemented, to verify by hand)
- [x] Remove the unused `.edit-input` rule from `components.css`

## 10. Bugs found in review
- [x] Dropping the only subtask as a child of its own parent deletes it (`moveTask` pushes into the array detached by `pruneChildren`; reproduced)
  - [x] Fix `moveTask` in `src/client/logic/move.ts` and add a regression test (also refuse or no-op this drop in `validateDrop`)
- [x] `reload` in `src/client/store.ts` overwrites local edits made while the `GET` is in flight, and clears the history (check `dirty` again after the `await`)
- [x] A content re-render while the CodeMirror editor is open (SSE reload, canonical document from a `PUT`) detaches it without `finish`, which loses the edit and leaves `active` stuck above 0, so global undo stays disabled
- [x] The client retries forever on `400` and `428` responses from `PUT /api/todos` (reported as offline); surface them as an error instead
- [x] The parser does not strip a UTF-8 BOM, so a file saved with one is rejected as "Text before the first list"
- [x] `fs.watch` has no `error` listener in `src/server/app.ts`, so a deleted or unreadable directory can crash the server
- [x] Deleting or moving out the last unchecked subtask leaves the parent unchecked, which is inconsistent with "all children checked means parent checked" (clarify in the PRD, then fix or document)
