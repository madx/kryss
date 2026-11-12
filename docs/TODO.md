## Wikilink popup order and look
- [ ] Add `modified` (file mtime in epoch milliseconds, `0` when unreadable) to each note of `GET /api/notes`, with server tests
- [ ] Sort the popup suggestions by tier (prefix, then others) then most recent `modified`, with the alias of a note using its `modified` and ties broken by matched text then path, with tests of the pure logic
- [ ] Mute the `detail` of a popup entry with `--color-done-text`, and give the selected entry the accent text color with a slight opacity
- [ ] Check by hand the popup in the light and dark themes, on selected and unselected entries, with and without an alias, with an empty query and with a typed one

## Due shortcuts and comparison in filters
- [ ] Add the shared unit and weekday completion of a sign and number (`+3` lists `d`, `w`, `m`, `y`, `W`, `Q`, `+t` lists `+tue`, `+thu`) to `src/client/logic/due.ts`, with tests, and use it in the `->` popup
- [ ] Parse the `due:` values `+1w`-style shortcuts and the `<` / `>` operators per comma value, with `overdue` invalid after an operator and `due:<` alone ignored, with tests
- [ ] Match `<` and `>` on whole periods (strict, completed tasks included, no date never matches) and resolve shortcuts to literals at each render, with tests
- [ ] Extend the `due:` popup: shortcut entry with its date, `today` and `week` only after an operator, unit completion, typed text inserted as is
- [ ] Update the cheatsheet filter line and check by hand the popups, a range of two terms and a saved filter with a shortcut
