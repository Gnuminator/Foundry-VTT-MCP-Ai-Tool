### Fixes

- **Pi scripts lows, round 4 (from the #355 review):** the `confirm-revert-starts` container scenario
  clears the command log before `CONFIRM=1`, so the "revert timer was stopped" check in
  `ssh-keys-only.test.mjs` can no longer pass on the stop logged by the first run. The player-run
  comment now says the temp folder is made after the refusals that need no browser, and the world
  refusal message is built in one place.
