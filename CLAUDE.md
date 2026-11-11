# todoapp

A single-user, local todo list manager.
The source of truth is a **Markdown file** that can be edited both from the web app and from an external editor (Obsidian, Vim).
Full spec: `docs/PRD.md`.
Work plan: `docs/TODO.md`.

## Collaboration rules

- **Language**: communicate in English, in the conversation and in every file (docs, code, comments, commit messages).
- **Documentation style**: write one sentence per line, i.e. start a new line after each full stop.
  Keep the existing structure (paragraphs, lists, tables) and do not convert prose into lists.
- **Specification decisions**: ask one question at a time, always with a recommended answer and a one-sentence justification.
  Resolve structural decisions before details.
  Do not implement anything while specifying.
- **Source of truth**: `docs/PRD.md` records every decision taken.
  If a request contradicts it, point out the contradiction, then update the PRD once the decision is confirmed.
- **Keep it simple**: the target is about 100 tasks across fewer than 10 lists, for one user on one machine.
  Do not add features, abstractions or dependencies beyond the PRD.
- **`docs/TODO.md` is a live file the app itself must be able to read.**
  It must always respect the file format below (only `## List` sections and `- [ ]` / `- [x]` tasks, single lines, 2 levels max, no frontmatter, no free text, one blank line between lists).
  Tick tasks off as they are completed.
  Keep the PRD and TODO consistent.

## Git history

- Every branch forks from the tip of `main`, adds its commits, then is merged back into `main` with `git merge --no-ff`.
  The history must show no crossing lines.
- Never merge `main` or another branch into a feature branch, and never cross-merge feature branches.
  If `main` has moved, rebase the unmerged branch onto `main` instead.
- Never push, and never rewrite history that is already merged into `main`, without explicit approval.

## Architecture (summary)

- **Bun server** that owns the file.
  It is the only component that parses Markdown.
  It listens on `127.0.0.1` by default (overridable with `HOST`, e.g. `0.0.0.0` in a container), without authentication.
- **Serializer**: a pure function in `src/shared/`, used by the server to write the file and by the client for the Markdown view and the clipboard.
- **Client**: vanilla TypeScript, built by Bun from `index.ts`, no framework.
  Client and server exchange JSON only.
- **API**: `GET /api/todos` (JSON + `ETag`), `PUT /api/todos` (`If-Match`, `409` on conflict), `GET /api/events` (SSE for external file changes).
  Invalid file: `422` with line and reason; the server never writes to an invalid file.
- **File location**: `TODO_FILE` environment variable, default `./todo.md`.
- **Libraries**: CodeMirror 6 (single line, live preview, autocomplete popup for due dates) for task editing, a sanitized inline Markdown renderer.
  `xit-parse` is to be removed.

## Markdown file format

```markdown
## List name
- [ ] Task
  - [x] Subtask
```

- Only `## List` sections containing tasks, after an optional leading frontmatter block.
  The frontmatter (`---` … `---`) is ignored on read and kept byte for byte on write, except for its `filters` key, which holds the saved filters (`"name": "text"` lines) and is the only part that reaches the client.
  Anything else is rejected (`422`): an unclosed frontmatter, a malformed `filters` block, free text, `#` / `###` headings, empty list name, a third nesting level, multi-line tasks.
- A task is exactly one line, with non-empty text that may contain inline Markdown, stored as-is.
- Lists are identified by position, not by name (names are not unique).
  Empty lists and an empty file are valid.
- Tolerated on read, normalized on the next write: `*` bullets, `[X]`, tabs or 4-space indentation.
- Canonical output: 2-space indentation, `-` bullets, one blank line between lists, trailing newline, `\n` line endings.

## Key behaviors

- **Checking**: checking a parent checks its children; when all children are checked, the parent is checked; unchecking a child, adding a child or moving an unchecked task under a parent unchecks the parent.
  The server never normalizes states.
- **No drag and drop**: tasks and lists move with the keyboard only (`J` / `K`, Alt+↑ / Alt+↓, `>` / `<`), and only while the filter is empty (PRD 5.1, 5.4, 5.14).
- **Sync**: autosave with a 500 ms debounce, one `PUT` in flight; on `409` with pending changes, a banner offers "keep my version" or "take the disk version", with no automatic merge.
- **Keyboard**: modal editing, Normal and Insert only (PRD 5.9); Tab and Shift+Tab are plain focus keys, Escape commits the editor, and the footer shows the mode and a statusline.
- **Markdown view**: read-only toggle (`gm`, header button) that shows the export of the current view, built by the client from its document, with a copy button and `yy` (PRD 5.11); it is never persisted.
- **Register**: `dd` and `yy` put a task subtree or a list in an in-memory register and write its Markdown to the clipboard, `p` pastes it, and `cc` clears the text of a task or the name of a list to retype it (PRD 5.12).
- **Undo**: global in-memory stack (Ctrl+Z / Ctrl+Shift+Z), cleared on reload and on external change, remembering the filter text of each change and never touching the saved filters.
- **UI details**: filter bar in the header (PRD 5.14), its text stored in `localStorage`; system theme; task move via `J` / `K` or Alt+↑ / Alt+↓; completed tasks shown by a checked box and a muted text color, never by strikethrough, and rows and list headers have no action buttons (delete, add, move are keys only), hovering a row highlights it slightly, a click on a list title renames the list like a click on a task text edits it, with the visual design rules of PRD 5.10.
- **Due dates**: plain task text, `-> 2026-11-22`, `-> 2026-W47` (ISO week) or `-> 2026-Q4`, only the last valid one counts, and invalid ones are plain text (PRD 5.13).
  The server and the JSON model do not know about them: the inline parser recognizes them and the client renders a pill with a state (overdue, due now, later) computed by a pure function against a horizon that is today by default.
  Typing `->` opens a CodeMirror popup of space-free shortcuts (`->today`, `->+1w`, `->-tue`, `->W`, `->+1Q`), and `sd` in Normal mode opens the editor on the date and its popup.
- **Filters and views** (PRD 5.14): there is no list selector and no `H` / `L`.
  The header filter bar (`/`) holds one line of text: bare words, `list:name`, `due:today|week|overdue|DATE`, `is:done|todo`, terms ANDed and commas for OR inside a term.
  `ga`, `gt` and `gw` set it to empty, `due:today,overdue` and `due:week,overdue`, `gl` appends `list:` with a popup, and `gf` opens the saved filters, whose first entry saves the current text under a name.
  A task is visible if it or an ancestor or a descendant matches, tasks you just added, pasted, edited or checked stay visible until the filter changes, and moves, indent and outdent do nothing while a filter is active.
- **Completing a task** (PRD 5.13): checking a task, its children by cascade or an auto-checked parent sets its due date to today unless it is today or a later day, and keeps the old date as plain text, `-> 2026-11-11 (was 2026-10-30)`.
  It is done by the client only, and undo restores it.
- **Links**: allowed schemes are `http`, `https`, `mailto` and `obsidian`, opened in a new tab with `rel="noopener noreferrer"`.

## Out of scope

Authentication, multi-user, Yjs / CRDT, offline mode, editing the frontmatter other than the `filters` key, the `xit` format, automatic merging, moving tasks and lists under a filter, drag and drop, add lines and buttons, hover action buttons, a date picker, sorting by due date, tags, priorities, negation or regex in filters, a toggle that hides completed tasks, non-inline Markdown, multi-line tasks, e2e tests, editing in the Markdown view.

## Testing

`bun test` for the parser and the shared serializer (including round-trip), the API (temporary file, ETag, `409`, `422`, SSE) and the pure client logic.
CodeMirror is verified by hand.
