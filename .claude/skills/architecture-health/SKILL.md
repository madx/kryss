---
name: architecture-health
description: Audit the Kryss codebase and produce a measured design-quality scorecard with a short, ranked list of refactoring candidates. Use when the user asks for a code quality indicator, an architecture review, a design health check, or where to refactor first. Read-only, it never edits code and never adds dependencies.
---

# Architecture health

Produce evidence, not opinions.
Every claim in the report must cite a number or a `file:line`.
This skill only reads and measures.
It does not edit source files, does not install anything, and does not touch `docs/TODO.md`.

## Ground rules

- Read `CLAUDE.md` (architecture summary, out of scope) and the relevant parts of `docs/PRD.md` first.
  The design rules there are the yardstick, so a finding is a deviation from them or a measurable smell, never a matter of taste.
- Keep it simple applies to the audit too: the target is about 100 tasks, one user, one machine.
  Do not recommend abstractions, layers or dependencies the PRD does not call for.
  The best finding is usually a deletion or a merge, not a new module.
- Write throwaway scripts to the scratchpad directory, never into the repo.
- Exclude `.claude/worktrees/`, `node_modules/`, `dist/` and test files from production metrics, and report test files separately.

## Step 1: Gates (pass or fail)

Run these and report the exact result.
A failing gate is reported first and is not scored.

- `bun run typecheck`
- `bun test` (and `bun test --coverage` for the coverage table below)

## Step 2: Measurements

Collect each indicator with shell tools or a scratchpad script.
Report the raw numbers in a table, with the worst offenders named.

**Size and shape**
- Lines per production file, top 10, and the share of total lines held by the top 3 files.
- Longest functions (top 10 by line count).
  Flag any above 60 lines.
- Branching density per file: count of `if`, `else`, `case`, `?`, `&&`, `||`, `for`, `while`, `catch` per 100 lines, as a rough complexity proxy.
  Name the files at the top.

**Dependencies and layering**
- Build the import graph from `import` / `export ... from` statements.
- Fan-in and fan-out per module, top 5 of each.
- Import cycles (report every cycle as a chain of files).
- Layer violations against the architecture in `CLAUDE.md`:
  - `src/shared/` must import nothing from `src/client/` or `src/server/`.
  - `src/client/logic/` must stay pure: no DOM, no `fetch`, no CodeMirror, no `localStorage`, no `Date.now()` / `new Date()` without an injected value.
  - Only the server parses Markdown.
    The client must use the serializer and the JSON model, apart from the inline renderer.
  - The server and the JSON model must know nothing about due dates or highlights.
  - `src/client/view/` and `src/client/editor/` may use the DOM, but must not hold document rules that belong in `logic/`.

**Module depth** (the main design indicator)
- For each module, compare the size of its public surface (number of exports, parameters per exported function) to the amount of behavior behind it (lines).
- Shallow candidates: many exports with a few lines each, pass-through wrappers, functions that only rename or forward arguments, files whose exports are used by exactly one caller.
- Deep modules are the goal: a small interface that hides a lot.
  Name the three shallowest and the three deepest modules.

**State and coupling**
- Module-level mutable state (`let` at top level, mutable singletons), and who writes to it.
- God objects or god functions: a function or file that touches more than three of these concerns: document mutation, history, filter, cursor, register, saved filters, files, network, DOM.
- Functions with more than four parameters, or boolean flag parameters that switch behavior.
- Duplicated logic: near-identical blocks of 8 lines or more across files.
  Use a normalized-line hash in a scratchpad script.

**Type and safety hygiene**
- Count of `any`, `as unknown as`, non-null `!`, `@ts-ignore`, `@ts-expect-error`, `// eslint-disable`.
- Count of `TODO` / `FIXME` / `HACK` comments, and empty `catch` blocks.
- Exported symbols never imported elsewhere (dead exports), excluding entry points.

**Tests**
- Coverage per production file from `bun test --coverage`.
- Pure logic files in `src/client/logic/` and `src/shared/` without a sibling `.test.ts`.
- Test files larger than the file they test, and tests that mock more than they assert.
  Both hint at a design that is hard to test.

**Consistency with the docs**
- Behaviors listed in `CLAUDE.md` "Key behaviors" that have no implementation, or implementation with no PRD mention.
- Dependencies in `package.json` that are not imported, and out-of-scope items from `CLAUDE.md` that appear in the code (drag and drop, hover action buttons, a date picker, tags, priorities).

## Step 3: Scorecard

Score each dimension from 0 to 5 using only the measurements above, and show the number that justifies the score.
Do not average the scores into one headline number, because it hides the one dimension that needs work.

| Dimension | What drives the score |
|---|---|
| Layering | violations and cycles |
| Module depth | shallow modules, pass-through wrappers |
| Cohesion | god files and god functions, branching density |
| Coupling and state | mutable globals, fan-in / fan-out |
| Duplication | duplicated blocks, dead exports |
| Type safety | casts, ignores, `any` |
| Testability | coverage, untested pure logic |
| Docs consistency | drift between code, PRD and `CLAUDE.md` |

Scale: 5 = no finding, 4 = cosmetic only, 3 = a few contained findings, 2 = a finding that slows every change, 1 = a finding that blocks changes, 0 = gate failing.

## Step 4: Refactoring candidates

List at most 5 candidates, ranked by value divided by effort.
Each one has:

- the evidence (numbers and `file:line`),
- the proposed change in one or two sentences, preferring deletion, merge or moving code to the right layer over adding structure,
- the risk, and which existing tests protect it, or the tests to write first,
- the effort as small, medium or large.

Do not include more than 5, even if there are more findings.
Mention the rest in one line as "also seen".
Mark anything you could not verify as an assumption.

## Step 5: Baseline and trend

Keep the previous run comparable:

- Save the raw numbers as JSON in the scratchpad directory and, if the user agrees, as a dated snapshot under `docs/` so a later run can show the delta.
  Never create it without asking.
- If a previous snapshot exists, add a "Since last run" column to the scorecard.

## Output

End with a report in this order: gates, scorecard, top candidates, also seen, and the one question to ask the user, which is which candidate to turn into a branch.
Do not add candidates to `docs/TODO.md` and do not start any refactoring.
If the user picks one, follow the specification rules of `CLAUDE.md`: one question at a time, each with a recommended answer, and no implementation while specifying.
