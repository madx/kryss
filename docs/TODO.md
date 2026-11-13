## Highlights (PRD 5.19)
- [ ] Add the colors and the `--highlight-background` token to `theme.css`, with `--color-base-10`
- [ ] Add the color table and the leading-emoji check as pure functions, with tests
- [ ] Parse `==text==` and `==🔴text==` in `inline.ts` as a `highlight` node, with tests for the rules of 5.19
- [ ] Render a highlight as a `mark` element with a class per color, the emoji hidden
- [ ] Style the highlight, keep its colors in a completed task and add the outline to a search match inside it
- [ ] Draw the highlight in the editor live preview with a custom Lezer inline extension
- [ ] Open the `==` popup in the editor, insert both markers with the cursor inside, and skip it on a closing `==`
- [ ] Check the popup, the live preview and the look by hand in light and dark
- [ ] Move this section to the changelog
