### Process and tooling

- **Lane kit as a Claude Code plugin (first slice):** `node scripts/build-lane-plugin.mjs` builds the plugin `foundry-lane-kit` (every skill, the review agents, the `/ready` command and the guard hooks, with plugin-root hook paths) from `.claude/`, plus a marketplace file; `--check` reports drift. `.claude/` stays the one place to edit, so running lanes are not affected. The built copy is committed at release, not per pull request (I-161).
