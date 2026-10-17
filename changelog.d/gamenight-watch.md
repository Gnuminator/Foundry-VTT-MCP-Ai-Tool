### Pi (I-145)

- **Game-night watch:** `scripts/gamenight-watch.mjs` checks Foundry every minute from the PC and posts to
  a Discord channel once when Foundry does not answer or is slow, and once when it is back. Posting is opt-in
  (`--post`); the default is a log-only dry run. The Pi is not changed. See "Game-night watch" in
  docs/dev/PI-SETUP.md.
