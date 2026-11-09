# Open questions

Each entry lists the initial task, the question, and the approach taken in the meantime.

## Sanitized inline Markdown rendering

- Should `![alt](url)` be literal text or a link?
  Taken: rendered as `!` followed by a link, because images are out of scope.
- How should `***x***` and badly interleaved emphasis behave?
  Taken: a simple non-CommonMark approach, since it does not matter at the target scale.
- `renderInline` (DOM) has no automated test because Bun has no DOM and no dependency was added.
  Should a DOM test dependency be added?
  Taken: no, only the AST is tested.

## Links: new tab, `rel="noopener noreferrer"`, allowed schemes

- Should a refused link show its literal source or only its label?
  Taken: the literal source, so the user can see and fix it.
- Should a link target containing a space be refused?
  Taken: refused and shown literally, as in CommonMark.
- Should relative URLs be allowed?
  Taken: refused, since only the four schemes are allowed.

## Live preview: markers hidden away from the cursor

- The inline AST has no source offsets.
  Should the live preview use `@lezer/markdown` or should the AST gain `start` and `end` positions?
  Taken: left to the editor unit.

## Write the Markdown → JSON parser

- How should indentation units be defined?
  Taken: the first indented task of the file fixes the unit (one tab, 2 spaces or 4 spaces), any other indent is rejected as inconsistent, mixed tabs and spaces are rejected, and 3 or more levels get their own error.
- What counts as multi-line versus free text?
  Taken: an indented non-task line right after a task is "multi-line tasks are not supported", any other non-task line is free text (or "text before the first list"), and frontmatter is detected only when line 1 is `---`.

## Implement `PUT /api/todos` with `If-Match`

- Should `PUT` echo the body or the canonical state?
  Taken: the canonical state, parsed back from the serialized Markdown, so whitespace is trimmed.
  Blank or multi-line titles and texts, and a `children` field on a subtask, give `400`.
- What is the check order?
  Taken: `428`, then `400`, then `422` for an invalid disk file, then `409`, so `422` wins over `409`.
- With an invalid disk file, "keep my version" cannot overwrite it because no ETag is returned on `422`.
  Should the user be able to overwrite an invalid file from the app?
  Taken: no, which matches "the server never writes to an invalid file".

## Implement `GET /api/todos` with `ETag`

- What should it return when the file is missing?
  Taken: an empty document, and `PUT` then creates the file.

## Implement the `GET /api/events` SSE stream

- Should an external change that makes the file invalid emit an event?
  Taken: yes, so the client can reload and show the `422` error.
- Should there be a heartbeat?
  Taken: no, Bun's idle timeout is disabled on the stream.

## Watch the file (`fs.watch`)

- The watcher reacts to any event in the directory, not only the file name, because filtering missed rename-based saves.
  Is this acceptable?
  Taken: yes, since the ETag comparison discards unrelated events.

## Parent / children checking rules

- Should a parent's state be recomputed when a subtask is moved or outdented out of it?
  Taken: no, only the rules listed in the PRD apply.
- Should indenting an unchecked task under a checked previous task uncheck that parent?
  Taken: yes, like the drop rule.
  Outdent never changes a state.
- Should a reorder under the same parent leave check states alone?
  Taken: yes, only a change of parent unchecks the new parent.

## Move a task with the keyboard using Alt+↑ / Alt+↓

- Should the move cross the parent or list boundary?
  Taken: no, it swaps within the same level and parent, and does nothing at the edges.

## Add, delete and check a task

- How are task texts and list titles cleaned?
  Taken: trimmed, line breaks turned into spaces, empty values refused.

## Create, rename and delete a list

- Should list titles be unique?
  Taken: no, as stated in the PRD.

## Global undo / redo stack

- How large should the undo stack be?
  Taken: 200 snapshots.

## Drop zones before, after and as child

- Is dropping a task onto itself refused or a no-op?
  Taken: refused (`self`) so the UI can hide that zone, while dropping at its own position through a neighbour is a no-op.

## Show the invalid file error

- When `PUT` returns `422` while local changes are pending, should the local lists be hidden?
  Taken: the error replaces the lists, the local document stays in memory, and the next external change opens the conflict banner.

## Reload on SSE event when there are no pending changes

- What happens when an SSE event arrives while a `PUT` is in flight?
  Taken: the announced ETag is remembered and handled as an external change once the `PUT` returns, and a reconnect reloads silently if nothing is pending.

## Show the "unsaved" indicator with increasing-delay retries

- Should "offline" be a status distinct from "unsaved"?
  Taken: yes, "offline" means the server is unreachable or answered unexpectedly, including a failed initial load.

## Create, rename and delete a list

- Is native `prompt` and `confirm` acceptable?
  Taken: yes for now, with rename and delete buttons in each list header instead of the selector.

## Add, delete and check a task

- How are subtasks added without a task to press Enter on?
  Taken: a "+" button on top-level rows, plus Tab to indent, F2 or Enter to edit a focused row and Delete to remove it.
- Re-rendering after a commit recreates the add inputs, so half-typed text is lost.
  Should the DOM be patched instead of fully re-rendered?
  Taken: full re-render for simplicity.

## Indent and outdent with Tab / Shift+Tab

- Should a refused Tab keep its default behavior?
  Taken: yes, to avoid a keyboard trap.

## Global undo / redo stack

- The store exposes `undo()` and `redo()` but no shortcut is bound yet.
  Taken: the finishing unit binds them.
