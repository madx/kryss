## Due shortcuts and comparison in filters
- [ ] Add the shared unit and weekday completion of a sign and number (`+3` lists `d`, `w`, `m`, `y`, `W`, `Q`, `+t` lists `+tue`, `+thu`) to `src/client/logic/due.ts`, with tests, and use it in the `->` popup
- [ ] Parse the `due:` values `+1w`-style shortcuts and the `<` / `>` operators per comma value, with `overdue` invalid after an operator and `due:<` alone ignored, with tests
- [ ] Match `<` and `>` on whole periods (strict, completed tasks included, no date never matches) and resolve shortcuts to literals at each render, with tests
- [ ] Extend the `due:` popup: shortcut entry with its date, `today` and `week` only after an operator, unit completion, typed text inserted as is
- [ ] Update the cheatsheet filter line and check by hand the popups, a range of two terms and a saved filter with a shortcut
