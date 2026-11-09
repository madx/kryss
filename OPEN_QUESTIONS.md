# Open questions

Each entry lists the initial task, the question, and the approach taken in the meantime.

## Sanitized inline Markdown rendering

- Should `![alt](url)` be literal text or a link?
  Taken: rendered as `!` followed by a link, because images are out of scope.
  Answer: It should not render at all. This is valid markdown but the parser forbids images.
- How should `***x***` and badly interleaved emphasis behave?
  Taken: a simple non-CommonMark approach, since it does not matter at the target scale.
  Answer: does not matter indeed. strong + emphasis is fine.
- `renderInline` (DOM) has no automated test because Bun has no DOM and no dependency was added.
  Should a DOM test dependency be added?
  Taken: no, only the AST is tested.
  Answer: no indeed

## Links: new tab, `rel="noopener noreferrer"`, allowed schemes

- Should a refused link show its literal source or only its label?
  Taken: the literal source, so the user can see and fix it.
  Answer: agreed
- Should a link target containing a space be refused?
  Taken: refused and shown literally, as in CommonMark.
  Answer: agreed
- Should relative URLs be allowed?
  Taken: refused, since only the four schemes are allowed.
  Answer: agreed

## Live preview: markers hidden away from the cursor

- The inline AST has no source offsets.
  Should the live preview use `@lezer/markdown` or should the AST gain `start` and `end` positions?
  Taken: left to the editor unit.
  Answer: ok

## Write the Markdown → JSON parser

- How should indentation units be defined?
  Taken: the first indented task of the file fixes the unit (one tab, 2 spaces or 4 spaces), any other indent is rejected as inconsistent, mixed tabs and spaces are rejected, and 3 or more levels get their own error.
  Answer: Use 2 spaces as the unit. Error out on tabs or incorrect indents
- What counts as multi-line versus free text?
  Taken: an indented non-task line right after a task is "multi-line tasks are not supported", any other non-task line is free text (or "text before the first list"), and frontmatter is detected only when line 1 is `---`.
  Answer: agreed

## Implement `PUT /api/todos` with `If-Match`

- Should `PUT` echo the body or the canonical state?
  Taken: the canonical state, parsed back from the serialized Markdown, so whitespace is trimmed.
  Blank or multi-line titles and texts, and a `children` field on a subtask, give `400`.
  Answer: agreed
- What is the check order?
  Taken: `428`, then `400`, then `422` for an invalid disk file, then `409`, so `422` wins over `409`.
  Answer: agreed
- With an invalid disk file, "keep my version" cannot overwrite it because no ETag is returned on `422`.
  Should the user be able to overwrite an invalid file from the app?
  Taken: no, which matches "the server never writes to an invalid file".
  Answer: agreed

## Implement `GET /api/todos` with `ETag`

- What should it return when the file is missing?
  Taken: an empty document, and `PUT` then creates the file.
  Answer: agreed

## Implement the `GET /api/events` SSE stream

- Should an external change that makes the file invalid emit an event?
  Taken: yes, so the client can reload and show the `422` error.
  Answer: agreed, but why not streaming a state update to the client so it updates right away (no need for an additional GET?) Sending the whole state is fine
- Should there be a heartbeat?
  Taken: no, Bun's idle timeout is disabled on the stream.
  Answer: agreed

## Watch the file (`fs.watch`)

- The watcher reacts to any event in the directory, not only the file name, because filtering missed rename-based saves.
  Is this acceptable?
  Taken: yes, since the ETag comparison discards unrelated events.
  Answer: agreed

## Parent / children checking rules

- Should a parent's state be recomputed when a subtask is moved or outdented out of it?
  Taken: no, only the rules listed in the PRD apply.
  Answer: yes it should, makes it more consistent. Update the PRD accordingly
- Should indenting an unchecked task under a checked previous task uncheck that parent?
  Taken: yes, like the drop rule.
  Outdent never changes a state.
  Answer: agreed
- Should a reorder under the same parent leave check states alone?
  Taken: yes, only a change of parent unchecks the new parent.
  Answer: agreed

## Move a task with the keyboard using Alt+↑ / Alt+↓

- Should the move cross the parent or list boundary?
  Taken: no, it swaps within the same level and parent, and does nothing at the edges.
  Answer: It would be great to have it move across boundaries!

## Add, delete and check a task

- How are task texts and list titles cleaned?
  Taken: trimmed, line breaks turned into spaces, empty values refused.
  Answer: agreed

## Create, rename and delete a list

- Should list titles be unique?
  Taken: no, as stated in the PRD.
  Answer: agreed

## Global undo / redo stack

- How large should the undo stack be?
  Taken: 200 snapshots.
  Answer: 100 is fine, even 50 should be

## Drop zones before, after and as child

- Is dropping a task onto itself refused or a no-op?
  Taken: refused (`self`) so the UI can hide that zone, while dropping at its own position through a neighbour is a no-op.
  Answer: agreed

## Show the invalid file error

- When `PUT` returns `422` while local changes are pending, should the local lists be hidden?
  Taken: the error replaces the lists, the local document stays in memory, and the next external change opens the conflict banner.
  Answer: agreed


## Reload on SSE event when there are no pending changes

- What happens when an SSE event arrives while a `PUT` is in flight?
  Taken: the announced ETag is remembered and handled as an external change once the `PUT` returns, and a reconnect reloads silently if nothing is pending.
  Answer: agreed

## Show the "unsaved" indicator with increasing-delay retries

- Should "offline" be a status distinct from "unsaved"?
  Taken: yes, "offline" means the server is unreachable or answered unexpectedly, including a failed initial load.
  Answer: agreed

## Create, rename and delete a list

- Is native `prompt` and `confirm` acceptable?
  Taken: yes for now, with rename and delete buttons in each list header instead of the selector.
  Answer: no, add proper UI for these tasks.

## Add, delete and check a task

- How are subtasks added without a task to press Enter on?
  Taken: a "+" button on top-level rows, plus Tab to indent, F2 or Enter to edit a focused row and Delete to remove it.
  Answer: Backspace should also delete unless currently editing
- Re-rendering after a commit recreates the add inputs, so half-typed text is lost.
  Should the DOM be patched instead of fully re-rendered?
  Taken: full re-render for simplicity.
  Answer: keep a local state for the inputs, use it after a commit to restore half-typed text

## Indent and outdent with Tab / Shift+Tab

- Should a refused Tab keep its default behavior?
  Taken: yes, to avoid a keyboard trap.
  Answer: agreeed

## Global undo / redo stack

- The store exposes `undo()` and `redo()` but no shortcut is bound yet.
  Taken: the finishing unit binds them.
  Answer: implement them

## Integrate Pragmatic drag and drop

- Should the row stay in place or be lifted by the native drag preview?
  Taken: the library default (native preview) plus a dimmed original.
  Answer: agreeed
- All the dragging behavior is unverified because no browser was available.
  The manual check list is in the dnd report and must be run by hand (see "Verify drag and drop by hand").
  Answer: agreeed

## Drop across lists, including into an empty list

- A non-empty list has no "end" target, so appending at the bottom uses the "after" zone of the last row.
  Should the empty area below the last row, or the list header, also be a drop target?
  Taken: no, for simplicity.
  Answer: not yet

## Drop zones before, after and as child

- Dropping "after" a parent that has children makes the task the next top-level sibling, after the whole subtree.
  Should it mean "first child" instead?
  Taken: keep the `moveTask` semantics.
  Answer: first child. If dropping between children it should insert at that position
- Zones are the top, middle and bottom thirds of the row, and only halves when "child" is refused.
  Is this rule right?
  Taken: yes for now.
  Answer: yes. Maybe use 1/4ths instead of thirds to leave more room for subtask reorering

## Verify drag and drop by hand

- Drag and drop is not keyboard accessible beyond Alt+↑/↓, Tab and Shift+Tab.
  Is that enough?
  Taken: yes, as the PRD says.
  Answer: ok for now

## Single-line CodeMirror 6 editor (Enter commits, Escape cancels)

- Should blur commit the edit?
  Taken: yes, which includes Tab and Shift+Tab, so typing is never lost.
  Answer: agreed
- The cursor starts at the end of the text instead of selecting all, because selecting all would show every marker.
  Is this right?
  Taken: yes.
  Answer: agreed. Ideally it should be at the same position as where the user clicked. Tell me how hard it would be
- The editor is only verified by unit tests of its pure parts.
  The manual check list from the editor report must be run in a browser, and these three tasks are left unticked until then.
  Answer: agreed

## Live preview: markers hidden away from the cursor

- Should the preview match the hand-written renderer's marker rules exactly?
  Taken: no, it uses `@lezer/markdown`, so edge cases may differ slightly.
  Exact parity would require source positions in `markdown/inline.ts`.
  Answer: agreed
- Should markers reappear when the editor loses focus?
  Taken: no, a committed edit is simply re-rendered.
  Answer: agreed

## Coordinate with CodeMirror's own undo

- The global shortcut ignores key events while the editor or any text input has focus.
  Should it instead take over when the field has nothing left to undo?
  Taken: no, for simplicity.
  Answer: agreed

## Verify alternating use with Obsidian on the same file

- Not done: it needs a human with Obsidian and a browser, and is left unticked.
  Answer: verified, it's ok

## Validate the success criterion: one week of use without loss

- Not done: it needs a week of real use, and is left unticked.
  Answer: we'll see :)


## Apply styles: background and color for completed tasks, system theme

- No browser was available, so the styles are unverified visually and the task is left unticked.
- The CSS uses design tokens in `src/client/styles/theme.css` only.
  The old `.edit-input` rule in `components.css` is now unused and can be removed.
  Answer: great
