# todoapp

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
The server only listens on the loopback interface and has no authentication.

## Configuration

`TODO_FILE` is the path of the Markdown file, `./todo.md` by default.
The file is created empty if it is missing.
`PORT` is the listening port, `5173` by default.

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
