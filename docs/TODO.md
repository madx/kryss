## Wikilink popup order and look
- [ ] Add `modified` (file mtime in epoch milliseconds, `0` when unreadable) to each note of `GET /api/notes`, with server tests
- [ ] Sort the popup suggestions by tier (prefix, then others) then most recent `modified`, with the alias of a note using its `modified` and ties broken by matched text then path, with tests of the pure logic
- [ ] Mute the `detail` of a popup entry with `--color-done-text`, and give the selected entry the accent text color with a slight opacity
- [ ] Check by hand the popup in the light and dark themes, on selected and unselected entries, with and without an alias, with an empty query and with a typed one
