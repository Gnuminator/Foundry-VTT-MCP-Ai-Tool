### Fixes

- **Session notes, undo and redo (PR #443 review lows):** undoing a planned undo or a planned redo
  (`undo-change`) now brings the session notes back, or sends them to staged, like the other undo
  paths; a redo reads the pages back from the put and does nothing when the journal was deleted by
  hand; the "Recap was revealed" refusal also covers undoing a redo; the "Left alone" line of an
  undo now says the document "was already gone when the undo reached it".
- **The TV (PR #400 review lows):** the Table user carries a flag, and the handout receipts, the
  player visibility check, "all players" ownership, play attendance and the player count of
  `get-world-info` leave it out. `plan-table-viewer` refuses when a GM user has the name, or when
  the users cannot be listed. The module only creates a User for the `table-viewer` feature (or its
  undo), with a role of Player or lower and no password. The TV script also refuses when a browser
  holds the profile's lockfile, understands a Foundry address with a path prefix
  (`https://host/foundry`), and the guide puts `-NoExit` in the Startup shortcut.
