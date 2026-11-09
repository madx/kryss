---
name: implement
description: Implements one unit of work from docs/TODO.md test-first, with two mandatory human validations (test plan, then final review). Use when the user asks to "take", "implement" or "do" a section or task of the TODO, for example `/implement 3`.
argument-hint: "<TODO section number, e.g. 3, or the text of a task>"
disable-model-invocation: true
---

# Implement

Implements **one unit of work** from `docs/TODO.md`, test-first where tests are planned.
A unit is a `## N.` section, or a single task if the user names one.
The user validates at two checkpoints: **you stop and wait for explicit approval at each one**.
Without approval, you do not move on.

The argument is a section number (`3`) or the text of a task.
If it is missing, ask for it.

## 0. Preparation

1. Read the selected section of `docs/TODO.md`, the parts of `docs/PRD.md` it relies on, and `CLAUDE.md`.
2. Check that the earlier sections or tasks it depends on are ticked off.
   Otherwise say so and stop.
3. If the project is a git repository, check that the working tree is clean, then work on a branch named `type/slug`.
   If it is not a repository, skip every git step and never initialize one without being asked.
4. Check that `docs/TODO.md` still respects the file format defined in `CLAUDE.md`, because the app reads it.

## 1. Scoping, then STOP (validation 1)

Do not touch any code file.
Present:

- the tasks of the unit, restated in your own words;
- the **test plan** in plain language, grouped by task: one test is one sentence describing a behavior;
- for drag and drop and CodeMirror, which have no automated tests, the **manual check list** instead;
- what is out of scope, and the ambiguities or open questions, asked one at a time with a recommended answer and a one-sentence justification;
- any dependency or tool you intend to add, with the reason (default: none, see "Keep it simple" in `CLAUDE.md`).

Wait for the answer.
If the answer contradicts `docs/PRD.md`, point out the contradiction and update the PRD once the decision is confirmed.

## 2. Red

Write the tests of the validated plan with `bun test`.
Run them and show that they fail **for the right reason** (missing behavior, not a syntax error).
A test that passes right away is suspicious: explain it before moving on.
Commit the tests if the project is a git repository.

Skip this step for tasks whose plan has no automated tests (styles, drag and drop, CodeMirror, documentation).

## 3. Green, then refactor

- Implement the minimum that makes the tests pass, in small steps.
- Run `bun test` and the type check at each significant step.
  Both must pass before moving on.
- Refactor without changing behavior, with tests green.
- Commit each coherent step if the project is a git repository.
- **No drift**: if a need goes beyond the unit, do not do it.
  Raise it as a question, or propose a new task for `docs/TODO.md`.
- Any non-trivial decision taken along the way is recorded in `docs/PRD.md`, since it is the source of truth.
  Never put comments or free text in `docs/TODO.md`.

## 4. Self-review

Launch a subagent with a fresh context to review the changes.
Give it the list of changed files (or the diff), the tasks, the relevant PRD sections and the rules of `CLAUDE.md`.
Ask for a review of:

- correctness and test quality (do they test behavior, not implementation?);
- the architecture rules: only the server parses and serializes Markdown, client and server exchange JSON;
- the file format and the API contract of the PRD;
- security: link scheme allow-list, sanitized rendering, no write to an invalid file, `127.0.0.1` binding;
- simplicity: nothing beyond the PRD, no unneeded abstraction or dependency.

Fix what is well-founded and dismiss the rest with a justification.
Report the findings and their outcome in the presentation.

## 5. Presentation, then STOP (validation 2)

Present to the user:

- a summary of what changed;
- what is tested, and what is not;
- each task of the unit, **ticked only if verified**;
- deviations from the plan or from the PRD;
- how to check it themselves (commands, manual steps).

Wait for the decision:

- **Approved**: tick the tasks off in `docs/TODO.md`, keeping its format valid, and make sure the PRD is consistent with it.
  Commit if the project is a git repository.
  Never push.
  Merge a branch only after explicit approval given for this unit alone.
- **To fix**: apply the feedback and resume at the relevant step.

## Rules

- Never tick a task without the explicit validation 2.
- Never `git push`.
- Never merge without explicit approval, given for each merge.
- Write in English, in the conversation and in every file.
  In documentation, write one sentence per line.
- No real data: tests, fixtures and examples are fictional.
  If the user pastes some, stop and say so.
- Only edit `docs/TODO.md` to tick tasks off, or to change the plan once the user has confirmed it.
- An ambiguity or a blocker: ask the question, do not guess.
- One unit per invocation.
