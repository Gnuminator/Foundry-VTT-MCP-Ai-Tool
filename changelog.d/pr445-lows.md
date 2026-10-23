### Module (PR #445 follow-up lows)

- **User writes are narrower:** a guarded write that creates a User is refused when its `permissions` hold a true override, and a guarded `update` of a User is refused when it touches `role`, `permissions`, `password` or `passwordSalt`. The Table user's undo and redo still work.
- **The TV's Table user is not a player in the play log:** its join and leave records carry `tableViewer`, take no scene snapshot, and the Obsidian "Seen in" index and `get-play-stats` skip them, so a TV left on during prep no longer marks scenes and NPCs as seen.
- **TV start script:** the join address match is case-sensitive like the check in the page, and `https://host//join` gives no prefix.
