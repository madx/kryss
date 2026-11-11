## Several files
- [ ] Server
  - [ ] Read `VAULT_DIR` and `NEW_FILE_DIR`, with single-file mode unchanged when `VAULT_DIR` is unset, and refuse a `NEW_FILE_DIR` outside the Vault
  - [ ] Rename the frontmatter key `filters` to `kryss-filters` in the parser, the serializer, the filters module and the tests
  - [ ] Scan the Vault for `kryss-enabled: true`, reading only the frontmatter, skipping dot folders and unclosed frontmatter
  - [ ] `GET /api/files` and `POST /api/files` with the name rules of the PRD and the exact content of a new file
  - [ ] Take `file` on `GET` and `PUT /api/todos` and on `GET /api/events`, resolve its real path inside the Vault and answer `404` otherwise
  - [ ] Keep the ETag, `409`, `422`, the watcher and the SSE stream per file, watching only the files with an open stream
  - [ ] Tests: scan, `file` outside the Vault and through a symbolic link, creation, per-file ETag and SSE, single-file mode
- [ ] Client
  - [ ] Carry the open file in `?file=`, send it on every call, and remember the last file in `localStorage`
  - [ ] Store the filter text and the cursor position per file, and clear the history on a switch
  - [ ] File picker opened by `go`, with a "New file…" first entry and its name input and error line
  - [ ] Header file name with the path as tooltip, empty state when the Vault has no Kryss file, switch refused while saving fails or conflicts
  - [ ] Add `go` to the key resolution, the cheat sheet and the keys allowed in the Markdown view, with tests
- [ ] Run `bun test` and `bun run build`
- [ ] Verify by hand: two tabs on two files, a file marked in Obsidian then picked, a refused name, a reload, an external change on the open file, light and dark, a window from 240 to 720 px wide

## Link rules and pasted URLs
- [ ] Rules
  - [ ] Read `.kryss.json` and serve it on `GET /api/config`, skipping invalid rules and reporting a malformed file
  - [ ] `GET /api/icons/<name>` from the installed Lucide package, with the name pattern and the `404`
  - [ ] Pure functions in `src/client/logic/`: matching a URL against the rules, building a label, validating an icon value
  - [ ] Tests: first match wins, capture groups, invalid regex, missing fields, each kind of icon value, refused values
- [ ] Autolinks and display
  - [ ] Render `<https://example.com>` in the inline parser under the scheme rules, with tests including `<javascript:…>`
  - [ ] Show the icon of a matching rule before the label of a link, drawn as a CSS mask, with the `Link` fallback
- [ ] Paste in the editor
  - [ ] Paste handler in `src/client/editor/`: selection becomes the label, a matching rule gives its label, otherwise the URL as it is, in one undo step
  - [ ] Tests for the decision of the paste (selection, rule, none, not a single URL)
- [ ] Run `bun test` and `bun run build`
- [ ] Verify by hand: a paste with and without a selection, an unknown URL, a Jira-like and a GitHub-like rule, an icon by Lucide name and by data URL, undo, light and dark

## Wikilinks
- [ ] Rendering
  - [ ] Parse `[[Note]]`, `[[Note|alias]]` and the heading and block forms in the inline parser, with the literal-text cases
  - [ ] Build the `obsidian://open` URL from the vault name and the target, and render it as a link, literal text in single-file mode
  - [ ] Live preview of the brackets in the editor
  - [ ] Tests: label, target, encoding, heading and block forms, invalid forms
- [ ] Note index
  - [ ] Read `newLinkFormat` and `userIgnoreFilters` from `.obsidian/app.json`, with the defaults when it is missing or malformed
  - [ ] `GET /api/notes` from the same scan as the file list, with the name, the path and the aliases in each YAML style
  - [ ] Tests: aliases, ignored folders, same names, each `newLinkFormat`, absent and malformed `app.json`
- [ ] Popup
  - [ ] CodeMirror autocomplete on `[[`, filtered on the name and the aliases, with the folder shown for same names
  - [ ] Insert `[[Note]]` or `[[Note|alias]]` with the path of `newLinkFormat`
  - [ ] Pure functions for the filtering and the inserted text, with tests
- [ ] Run `bun test` and `bun run build`
- [ ] Verify by hand: a note, an alias, two notes with one name, each `newLinkFormat`, a click that opens Obsidian, light and dark
