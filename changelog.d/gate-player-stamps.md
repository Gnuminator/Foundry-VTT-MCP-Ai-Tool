### Process and tooling

- **Release PRs and the player extension:** the merge gate's release-PR check now knows the two player extension files that `version:sync` stamps (`tools/player-connector/manifest.json` and the `VERSION` line in `server/index.js`), so a release PR that only bumps versions passes it again. Backlog `release-v0-29-0`.
