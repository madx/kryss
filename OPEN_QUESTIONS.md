# Open questions

Each entry lists the initial task, the question, and the approach taken in the meantime.

## Fix the `fs.watch` error listener

- How should the `error` listener be tested, since a real watcher error cannot be triggered?
  Taken: a smoke test deletes the watched directory and checks that the server still answers `GET /api/todos`.
  It was not checked to fail without the listener, so it is weak evidence.

## Parser BOM and image rendering

- The tests and the fixes were written together and the tests were not run against the unfixed code.
  Should they be checked to fail on the old code?
  Taken: no, left as is.

## Send the whole state in the SSE event

- What does the event carry when the file is deleted?
  Taken: a missing file reads as an empty document, so the event carries `{ etag, doc: { lists: [] } }`.
- Should the server send the current state when a client connects?
  Taken: no, the server only sends `: connected` and the client reloads on reconnect.
- What if an SSE payload cannot be parsed?
  Taken: it is treated like a missed event and calls `onReconnect`, which reloads if nothing is pending.

## Surface `400` and `428` responses from `PUT` as an error

- Should this be a new status or reuse "offline"?
  Taken: a new `error` status ("Save failed") with its own banner, no automatic retry, and the next edit sends a new `PUT`.

## Reload on SSE event / editor re-render

- An external change applied while a task is being edited replaces the DOM.
  Taken: the editor is settled first, committing the typed text when the task text in the new document is unchanged and discarding it otherwise (the disk version wins).
- The store emits "content" for both an external reload and a local canonical document.
  Should it expose an explicit "external" kind instead of comparing texts?
  Taken: no, the text comparison is used, which could only misfire if an external change shifts task paths and the text at the old path is identical.

## Replace native `prompt` and `confirm` with a proper UI

- Should a blur on the list name input cancel or commit?
  Taken: cancel, so a stray click never creates or renames a list, which differs from the task editor where blur commits.
- A re-render caused by an external reload keeps the typed text but may move the focus.
  Taken: no special handling.

## Keep the add-input text in local state

- Drafts are keyed by list and parent indices, not by a stable task identity.
  Taken: all subtask drafts are cleared when a subtask input opens or is cancelled, and all drafts are cleared when a list is deleted.

## "All" / single list selector

- The raw stored index is kept, so a stale index can become selected again if a list later appears at that position.
  Taken: left as is.

## Fix `moveTask` when dropping the only subtask as a child of its own parent

- Should the drop be refused or be a no-op?
  Taken: `validateDrop` refuses it with reason `self`.
  With several subtasks the same drop is a valid reorder that moves the subtask last.

## Recompute a parent's state when a subtask is moved or outdented out of it

- What state does a parent keep when it is left with no subtask?
  Taken: it keeps its state, for move, outdent and delete.

## Alt+↑ / Alt+↓ moves a task across parent and list boundaries

- What happens with the first subtask of the first task of a list when pressing Alt+↑?
  Taken: it becomes a top-level task just before its parent, and pressing again moves it to the end of the previous list.
- Should the keys cross lists when a single list is shown instead of "All"?
  Taken: yes, the logic ignores visibility, so the task can leave the visible list.
  `app.ts` could suppress cross-list moves in a single-list view.
- Where does the last subtask go when moved down past its parent?
  Taken: before the first subtask of the next top-level task if it has subtasks, otherwise it becomes its only subtask.
- Moving a top-level task down past a task with subtasks.
  Taken: it goes after the whole next task and does not enter it.

## Drop "after" a parent with children inserts it as the first child

- Dropping a subtask "after" its own parent re-inserts it as the first subtask instead of outdenting it.
  Is that acceptable?
  Taken: yes, outdenting is done with Shift+Tab, and a moved task that has subtasks goes after the whole parent.

## Manual verification

- The editor tasks, live preview, cursor at the click position, drag and drop, and the week-long success criterion could not be verified because no browser was available.
  Taken: these tasks are left unticked in `docs/TODO.md` until they are checked by hand.
