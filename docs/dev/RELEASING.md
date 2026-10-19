# Releasing

The Orange Pi builds a release tag, never `main` (D-126), so game nights run a known version. Tags are
`vX.Y.Z`: v0.22.0 before G0, then one tag per gate. A tag is made only with the user's OK each time.

## Steps

Start from a clean, up-to-date checkout of `main` (the main checkout, or a worktree on `aitool/main`).

1. **Fold the changelog.** `npm run changelog:fold -- --dry-run` shows the result, then `npm run changelog:fold`
   moves every fragment in `changelog.d/` into CHANGELOG "Unreleased" and deletes the files (D-089). Rename the
   `## Unreleased` heading to `## vX.Y.Z (released YYYY-MM-DD): <short summary>` and add a fresh empty
   `## Unreleased` above it. Start the section with a line on whether the wire contracts changed.
2. **Set the version.** `npm run version:sync -- --set X.Y.Z`, then `npm run version:check`.
3. **Check.** `npm run green`.
4. **Land it.** Commit on a branch (`Release vX.Y.Z`), open a PR, merge through the normal gate (the `lane` skill).
5. **Tag the merge commit** (with the user's OK):

   ```bash
   git fetch aitool main
   git tag -a vX.Y.Z -m "vX.Y.Z" <sha of the release PR's merge commit>
   git push aitool vX.Y.Z
   ```

   The tag must equal the root `package.json` version. Pushing it starts `.github/workflows/release.yml`, which
   builds and publishes the GitHub release (assets and checks: [DEPLOYMENT](DEPLOYMENT.md#cutting-a-new-release-maintainers)).

6. **Verify the release** (the `curl` in DEPLOYMENT), then deploy to the Pi if wanted.

## The Pi

Stage 5 (`scripts/pi/remote/5-tool.sh`) and `scripts/pi/rebuild-drill.ps1` take the newest plain `vX.Y.Z` tag
from GitHub when `TOOL_REF` (`-ToolRef` for the drill) is not set. Release candidates and other tag names are
ignored. To pin a version, or to go back one:

```bash
cat scripts/pi/remote/lib.sh scripts/pi/remote/5-tool.sh | ssh foundry-pi 'TOOL_REF=v0.22.0 bash -s'
```

Stage 5 prints which tag it chose (`no TOOL_REF: building the newest release tag, vX.Y.Z`), and the build records
it in `/opt/foundry-ai-tool/app/.tool-ref`. The usual Pi rules apply (`dietpi-backup 1` first, the user's OK, never
on a game-night day); see [PI-SETUP](PI-SETUP.md).

Stage 5 refuses a default older than v0.22.0 (v0.21.0 is behind what the Pi runs) and refuses to go back from a
newer release tag on the Pi; a deliberate rollback needs `TOOL_REF`. The refusals are in `5-tool.sh` (`min_tag`).

A build of a tag that lists `playwright-core` as a runtime dependency drops its dev packages; v0.21.0 and older do
not, so the first release built on the Pi with the pruned layout is v0.22.0.
