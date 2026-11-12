# Changelog

All notable changes to Kryss, newest first.
The project has no tagged release yet, so entries are grouped by feature and dated by the day they were merged into `main`.
Features that were added and later removed are listed in both places, so that the history stays readable.

## Unreleased

### Added

- Vault mode: with `VAULT_DIR` set, Kryss manages every `.md` file of an Obsidian Vault whose frontmatter has `kryss-enabled: true`, and `NEW_FILE_DIR` says where new files go.
- `GET /api/files` and `POST /api/files`, and a `file` parameter on `GET` and `PUT /api/todos` and on `GET /api/events`, with a `404` for any path outside the Vault, symbolic links included.
- The ETag, `409`, `422`, the watcher and the SSE stream work per file, and a file is watched only while it has an open stream.
- `go` opens a file picker whose first entry creates a file, the header shows the open file with its path as tooltip, and an empty state explains how to start when the Vault has no Kryss file.
- The open file lives in `?file=`, the last file is remembered, and the filter text and cursor position are stored per file.
- A transparent dark layer behind the pickers and the `list:` popup, pickers pinned to the top of the window in the column of the app, and a slight shadow on the editor popups.

- Wikilinks: `[[Note]]`, `[[Note|alias]]` and the heading and block forms render as `obsidian://open` links in Vault mode, and stay literal text in single-file mode.
- `[[` opens a popup of the note index, filtered on names and aliases, which inserts the path format of `newLinkFormat` read from `.obsidian/app.json`, and the live preview hides the brackets away from the cursor.
- `GET /api/notes` returns the note index and the link format, and `GET /api/files` carries the vault name in its `X-Vault-Name` header.
- Each note of `GET /api/notes` carries its `modified` time, and the `[[` popup lists the matches that start with the typed text first, then the others, the most recently modified note first in each group.
- The detail of a popup entry is muted like a completed task, and drawn in the entry color at a lower opacity on the selected one.

- Link rules: `.kryss.json` at the root of the Vault holds `match` and `label` rules served by `GET /api/config`, and `GET /api/icons/<name>` serves Lucide icons.
- A link that matches a rule shows its icon, or the `Link` icon, as an inline SVG in the text color, rebuilt from an allow-list of shapes.
- Pasting one URL in the task editor gives `[selection](url)` with a selection, `[label](url)` when a rule matches, and `<url>` otherwise, in one undo step.
- `<https://…>` autolinks render as links under the scheme rules.
- The link rules are read again when the window regains the focus, and the lists are drawn again when they changed, so an edit of `.kryss.json` applies without a reload.

### Changed

- The saved filters now live in the `kryss-filters` key of the frontmatter instead of `filters`.

## 2026-11-11

### Added

- Incremental search: `/` opens a plain input above the footer, highlights every occurrence in the visible rows and moves the cursor, `n` and `N` jump to the next and previous match with a wrap, and Escape ends it.
- The footer statusline shows the active search as `/query  3/12`, with `no match` when nothing matches and "Wrapped" when a jump wraps.
- Key groups `g` (go), `s` (show or switch) and `c` (change), with `cd` for the due date, `sm` for the Markdown view, `sh` for the siblings, `cl` to rename the list of the cursor from an empty name, and `+` to create a list.
- `gf` focuses the filter bar and `gF` opens the saved filters.
- FILTER and SEARCH badges in the footer.
- Due dates: `-> 2026-11-22`, `-> 2026-W47` and `-> 2026-Q4` in the task text, rendered as a pill that is overdue, due now or later, with a warning icon on overdue ones.
- Due date popup opened by `->` in the editor, with shortcuts such as `->today`, `->+1w`, `->-tue`, `->W` and `->+1Q`, and `sd` in Normal mode to edit the date (renamed `cd` the same day).
- Filters and views: a one-line filter bar with bare words, `list:`, `due:` and `is:` terms, `AND` between terms and commas for `OR`, with popups, pills and visible counts.
- Built-in views `ga`, `gt` and `gw`, and `gl` to filter by list.
- Saved filters stored in the `filters` key of the file frontmatter, with a picker (opened by `gf` at first, then `gF`), carried by `GET`, `PUT` and the SSE event.
- Completing a task sets its due date to today and keeps the old one as `(was …)`, for a direct check, a cascade and an auto-checked parent.
- Siblings toggle and the muted eye with the number of hidden subtasks.
- `H` and `L` to move the focused list down and up.
- Moves, indent and outdent that work on the visible rows under a filter, jump over hidden tasks and lists, and pin the moved task.
- Cheat sheet restyled with key chips and group titles, opened by `g?`.

### Changed

- The app is renamed Kryss, and the storage keys and temporary directory prefixes are renamed with it.
- `cd`, `sm`, `sh` and `+` replace `sd`, `gm`, `gh` and `N`, and `/` no longer focuses the filter bar.
- The footer box is as wide as the list panels on wide windows and full width on narrow ones, and the page gutter is fixed at 8 px up to 720 px of window width.
- The header gets an 8 px margin above it, and the filter bar 4 px of vertical padding.
- The filter bar takes the Insert look when focused and a search color for its badge, and its pills are rounded like the due date pills.
- Escape in the filter bar commits like Enter, and a refresh of the view drops the pins.

### Removed

- The list selector and its `H` / `L` view cycling, replaced by the filter bar.
- The guard that made moves, indent and outdent do nothing under a filter.

## 2026-11-10

### Added

- Modal keyboard editing, Normal and Insert only, with a pure key resolution, a cursor model over list headers and task rows, positional add (`o`, `O`, `a`, `I`, `A`) and a footer with the mode and a statusline.
- Task keys `x`, `i`, `dd`, `>`, `<`, `J`, `K`, `u` and `U`, and list header keys for rename, delete, add and new list.
- Cheat sheet overlay.
- Frontmatter passthrough: a leading `---` block is ignored on read and kept byte for byte on write, and an unclosed one is a `422`.
- Markdown view that shows the export of the current view, with a copy button and the `yy` key.
- List reordering with `J` / `K` and Alt+↑ / Alt+↓ on a header, each move being one undoable change.
- Shared serializer in `src/shared/`, used by the server and by the client, which builds the Markdown view and the clipboard text itself.
- Register with `dd`, `yy`, `p` and `cc`: a task subtree or a list is copied, written to the clipboard as Markdown and pasted back, with "Copied" feedback in the footer.
- Design iteration #1: design tokens, flat list panels, compact 12 px rows, a single centered column, Lucide icons, an alert component, and a custom cursor look in blue (Normal) and green (Insert).
- Counts of done and total tasks in the footer and in the list headers, and a corner mode badge.
- Installed-app titlebar color.

### Changed

- Completed tasks use a checked box and a muted color, never a strikethrough.
- A list is renamed by clicking its title, and a new list is created at once as "New list".
- The footer is a full-width flexbox so that the mode badge reaches the window edges.
- The mouseless version: tasks and lists move with the keyboard only, and the add lines, the hover buttons and the list delete confirmation are removed.

### Removed

- `GET /api/export`, replaced by the client-side export.
- Drag and drop of tasks and lists, with `@atlaskit/pragmatic-drag-and-drop`.
- Tab and Backspace as indent and delete keys.
- The "+ Add a task" and "+ Add a subtask" lines, the hover "×" and header icons, and the new list button.

### Fixed

- The task editor no longer adds a scrollbar in Safari.
- The list header height is stable on hover, and a list move resets the rename state.
- The cursor scrolls smoothly into view, and a whole list is revealed when the cursor lands on its header.
- Undo and redo restore the view of the change and the list that was moved.

## 2026-11-09

### Added

- Project foundation: `src/server`, `src/client` and `src/shared`, `dev`, `build` and `test` scripts, and `TODO_FILE` with an empty file created when missing.
- `HOST` environment variable, defaulting to `127.0.0.1`, so that a container can bind `0.0.0.0`.
- Markdown parser with `422` errors that carry a line and a reason, tolerant of `*` bullets, `[X]`, tabs and 4-space indentation, and a canonical serializer with a stable round-trip.
- API: `GET /api/todos` with `ETag`, `PUT /api/todos` with `If-Match` and `409`, atomic writes, a file watcher that ignores the server's own writes, and the `GET /api/events` SSE stream.
- Client with autosave on a 500 ms debounce and one `PUT` in flight, an unsaved indicator with retries, `beforeunload` protection, a conflict banner and an invalid file error.
- Lists and tasks: create, rename, delete, check, indent, outdent and move, with the parent and children checking rules.
- Sanitized inline Markdown renderer for bold, italic, code, strikethrough and links, limited to the `http`, `https`, `mailto` and `obsidian` schemes.
- Single-line CodeMirror 6 editor with live preview, created only on the task being edited.
- Global undo and redo with Ctrl+Z and Ctrl+Shift+Z, capped at 100 snapshots and cleared on reload and on external change.
- Drag and drop of tasks, with Pragmatic drag and drop (removed on 2026-11-10).
- Sonokai dark theme, themed scrollbar, fixed header and Lucide icons.
- `README.md` that explains how to run the app.

### Changed

- `xit-parse` is removed from the dependencies, and the server listens on `127.0.0.1` instead of `0.0.0.0`.
- Alt+↑ / Alt+↓ moves a task across parent and list boundaries, and only across visible lists.
- The SSE event carries the whole state, including the invalid file error, so that the client needs no extra `GET`.
- A parent is recomputed when a subtask is moved, outdented or deleted.
- Native `prompt` and `confirm` are replaced by an inline UI.
- The editor cursor is placed where the user clicked.

### Fixed

- Dropping the only subtask as a child of its own parent no longer deletes it.
- A `GET` in flight no longer overwrites local edits or clears the history.
- An open editor is settled before a content re-render, so an edit is no longer lost and undo no longer stays disabled.
- A `400` or `428` answer to `PUT` is shown as an error instead of being retried forever as offline.
- A UTF-8 BOM is stripped when parsing.
- A missing `error` listener on `fs.watch` no longer crashes the server.
- Images are rendered as nothing, since they are out of scope.
- A header padding rule is independent of the stylesheet order.
