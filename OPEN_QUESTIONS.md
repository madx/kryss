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
