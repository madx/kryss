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
  It is the only component that parses and serializes Markdown.
  It listens on `127.0.0.1` by default (overridable with `HOST`, e.g. `0.0.0.0` in a container), without authentication.
- **Client**: vanilla TypeScript, built by Bun from `index.ts`, no framework.
  Client and server exchange JSON, except for the read-only Markdown export, which is plain text.
- **API**: `GET /api/todos` (JSON + `ETag`), `PUT /api/todos` (`If-Match`, `409` on conflict), `GET /api/events` (SSE for external file changes), `GET /api/export` (canonical Markdown as text, optional `list` index).
  Invalid file: `422` with line and reason; the server never writes to an invalid file.
- **File location**: `TODO_FILE` environment variable, default `./todo.md`.
- **Libraries**: Pragmatic drag and drop for drag and drop, CodeMirror 6 (single line, live preview) for task editing, a sanitized inline Markdown renderer.
  `xit-parse` is to be removed.

## Markdown file format

```markdown
## List name
- [ ] Task
  - [x] Subtask
```

- Only `## List` sections containing tasks, after an optional leading frontmatter block.
  The frontmatter (`---` … `---`) is ignored on read and kept byte for byte on write, and never reaches the client.
  Anything else is rejected (`422`): an unclosed frontmatter, free text, `#` / `###` headings, empty list name, a third nesting level, multi-line tasks.
- A task is exactly one line, with non-empty text that may contain inline Markdown, stored as-is.
- Lists are identified by position, not by name (names are not unique).
  Empty lists and an empty file are valid.
- Tolerated on read, normalized on the next write: `*` bullets, `[X]`, tabs or 4-space indentation.
- Canonical output: 2-space indentation, `-` bullets, one blank line between lists, trailing newline, `\n` line endings.

## Key behaviors

- **Checking**: checking a parent checks its children; when all children are checked, the parent is checked; unchecking a child, adding a child or dropping an unchecked task under a parent unchecks the parent.
  The server never normalizes states.
- **Drag and drop**: drop before, after or as child; the subtree moves with the task; no drop into a descendant, none that creates a third level.
  Lists are reordered in the "All" view only, by dragging the header row (no handle) onto the top or bottom half of another list, or with `J` / `K` and Alt+↑ / Alt+↓ on a header (PRD 5.1, 5.4).
- **Sync**: autosave with a 500 ms debounce, one `PUT` in flight; on `409` with pending changes, a banner offers "keep my version" or "take the disk version", with no automatic merge.
- **Keyboard**: modal editing, Normal and Insert only (PRD 5.9); Tab and Shift+Tab are plain focus keys, Escape commits the editor, and the footer shows the mode and a statusline.
- **Markdown view**: read-only toggle (`gm`, header button) that shows the export of the current view with a copy button and `yy` (PRD 5.11); the pending autosave is flushed before it opens, and it is never persisted.
- **Undo**: global in-memory stack (Ctrl+Z / Ctrl+Shift+Z), cleared on reload and on external change.
- **UI details**: list selector ("All" or one list) stored in `localStorage` by index; system theme; task move via `J` / `K` or Alt+↑ / Alt+↓; completed tasks shown by a checked box and a muted text color, never by strikethrough, and row and list actions (delete, rename, add subtask) are mouse-only controls shown on hover or after a click, with the visual design rules of PRD 5.10.
- **Links**: allowed schemes are `http`, `https`, `mailto` and `obsidian`, opened in a new tab with `rel="noopener noreferrer"`.

## Out of scope

Authentication, multi-user, Yjs / CRDT, offline mode, editing the frontmatter, the `xit` format, automatic merging, reordering lists outside the "All" view, a drag handle, due dates, tags, priorities, search, filters, hiding completed tasks, non-inline Markdown, multi-line tasks, e2e tests, editing in the Markdown view.

## Testing

`bun test` for the parser and serializer (including round-trip), the API (temporary file, ETag, `409`, `422`, SSE) and the pure client logic.
Drag and drop and CodeMirror are verified by hand.
