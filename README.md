# Kryss

A single-user, local todo list manager.
The source of truth is a Markdown file that can be edited both from the web app and from an external editor such as Obsidian or Vim.
The full specification is in `docs/PRD.md`.

## Requirements

[Bun](https://bun.sh) is the only requirement.

## Run

```sh
bun install
bun run dev
```

The app is then available on `http://127.0.0.1:5173`.
The server only listens on the loopback interface by default and has no authentication.

## Configuration

`TODO_FILE` is the path of the Markdown file, `./todo.md` by default.
The file is created empty if it is missing.
`VAULT_DIR` is the path of an Obsidian Vault.
When it is set, `TODO_FILE` is ignored and Kryss manages every `.md` file of the Vault whose frontmatter has `kryss-enabled: true`, which `go` lets you switch between.
`NEW_FILE_DIR` is the folder of the files that Kryss creates, `VAULT_DIR` by default, and it must be inside the Vault.
In a Vault, an optional `.kryss.json` at its root holds link rules, for example `{ "links": [{ "match": "^https://github\\.com/([^/]+/[^/]+)/pull/(\\d+)", "label": "$1#$2", "icon": "git-pull-request" }] }`.
A URL pasted in a task that matches a rule becomes `[label](url)`, and the icon, a Lucide name or a `data:image/svg+xml` URL, is shown before the label of such links.
`PORT` is the listening port, `5173` by default.
`HOST` is the listening address, `127.0.0.1` by default.
Set `HOST=0.0.0.0` to expose the app, for example inside a container, and remember that there is no authentication.

```sh
TODO_FILE=~/notes/todo.md PORT=5200 bun run dev
```

## File format

```markdown
## List name
- [ ] Task
  - [x] Subtask
```

Only `## List` sections with single-line tasks and at most two nesting levels are accepted.
An invalid file is shown as an error with its line and reason, and the app never writes to it.
Fix the file in your editor and the app reloads it.

## Scripts

`bun run dev` starts the server with hot reload.
`bun run build` builds the client into `dist`.
`bun test` runs the tests.
`bun run typecheck` runs the TypeScript type check.

## Editing from another editor

The app watches the file and reloads it when it changes on disk.
If the app holds unsaved changes at that moment, it offers to keep its version or to take the disk version.
