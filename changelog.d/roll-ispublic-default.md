### Fixes

- **Roll requests no longer stall on a public/private question:** `request-player-rolls`,
  `request-ability-check` and `request-attack-roll` now default `isPublic` to true (visible to all;
  pass false for target player and GM only), and `request-player-rolls` drops the
  `userConfirmedVisibility` parameter. A client that still sends it is accepted and the value is
  ignored (one-player-roll-tool, first part; the fold of the three tools waits for usage data).
