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
   The PR needs no `changelog.d` fragment: the gate sees a release PR and passes its changelog check
   (`lane:merge: changelog: a release PR ...`) when it changes only `CHANGELOG.md`, deletes `changelog.d/*.md`
   files, and changes nothing but the version in the places `version:sync` stamps (the package.json files, the
   lock file's own entries, `module.json`, the Obsidian `manifest.json`, `shared/src/version.ts` and the NSIS
   script), with the root `package.json` version changed. Anything more (a fix in the same PR, a fold without a
   version bump) is not a release PR: the refusal says which file, and then a fragment or
   `--no-changelog "reason"` is needed. The PR touches wire contracts (`module.json`, `shared/src`), so its
   review note must be an Opus review.
5. **Tag the merge commit** (with the user's OK):

   ```bash
   git fetch aitool main
   git tag -a vX.Y.Z -m "vX.Y.Z" <sha of the release PR's merge commit>
   git push aitool vX.Y.Z
   ```

   The tag must equal the root `package.json` version. Pushing it starts `.github/workflows/release.yml`, which
   builds and publishes the GitHub release (assets and checks: [DEPLOYMENT](DEPLOYMENT.md#cutting-a-new-release-maintainers)).

6. **Verify the release** (the `curl` in DEPLOYMENT), then deploy to the Pi if wanted.
7. **Tell the players in #changelog and the GM in #dashboard-changelog.** Write 2 to 5 short Danish lines per post
   from the new CHANGELOG section: game terms in English, no em dashes, nothing purely internal (tooling,
   tests, CI). Sort each line by who notices it:
   - **Players' lines** (the player page, Foundry, the Discord bot, the character guides) go to #changelog,
     a normal post that never mentions anyone.
   - **GM and dashboard lines** (the co-GM dashboard, GM-only tools) go to the GM-only #dashboard-changelog
     with `announce.mjs dashboard`. Start with the GM role mention and the version, then one "• " line
     each. It pings the GM role and nobody else.
   - **A line both read** (say, a handout fix the GM triggers and players see) goes to the players. The
     GM reads both channels, so it is not repeated in #dashboard-changelog.
   - A release with no GM or dashboard line posts nothing to #dashboard-changelog.

   Post from the PC. Replace `GM role id` in the mention with the number from
   `grep DISCORD_GM_ROLE_ID "$APPDATA/foundry-ai-tool/discord-bot.env"` (that prints only the id line, never the
   token); left as is, the mention does not ping anyone:

   ```bash
   node packages/discord-bot/announce/announce.mjs changelog "**v0.26.0**
   - Spillersiden viser nu kampen live
   - ..."
   node packages/discord-bot/announce/announce.mjs dashboard "<@&GM role id> Nyt i dashboardet (v0.26.0):
   • Ny Conditions-knap til flere tokens ad gangen
   • ..."
   ```

   A Pi stage 5 build of a new release tag posts "Serveren kører nu vX.Y.Z." by itself once the Pi's bot env
   has `DISCORD_CHANGELOG_CHANNEL_ID`. Posting is optional and never blocks a release; it prints one warning
   if Discord cannot be reached. The two channel ids and the GM role id belong in the PC's
   `%APPDATA%\foundry-ai-tool\discord-bot.env` (template: `packages/discord-bot/deploy/discord-bot.env.example`).

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
