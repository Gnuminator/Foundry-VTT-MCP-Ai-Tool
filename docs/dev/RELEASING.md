# Releasing

The Orange Pi builds a release tag, never `main` (D-126), so game nights run a known version. Tags are
`vX.Y.Z`: v0.22.0 before G0, then one tag per gate. A tag is made only with the user's OK each time.

## Steps

Start from a clean, up-to-date checkout of `main` (the main checkout, or a worktree on `aitool/main`).

1. **Fold the changelog.** `npm run changelog:fold -- --dry-run` shows the result, then `npm run changelog:fold`
   moves every fragment in `changelog.d/` into CHANGELOG "Unreleased" and deletes the files (D-089). Rename the
   `## Unreleased` heading to `## vX.Y.Z (released YYYY-MM-DD): <short summary>` and add a fresh empty
   `## Unreleased` above it. Start the section with a line on whether the wire contracts changed (say so when only
   additive fields changed, for example new fields in the dashboard `/api/health` response). Write the
   headline in words the previous release's headline did not use. Repeated headings in the fragments fold under one
   base heading (a trailing `(...)` tag is dropped for new sections; Testing, Test kit and Test environment go
   under `### Tests`). Duplicates already in Unreleased are left as they are: tidy them by hand.
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
   builds the release files, then waits for approval before it publishes (assets and checks:
   [DEPLOYMENT](DEPLOYMENT.md#cutting-a-new-release-maintainers)).

   **Approve the release in the Actions run:** open the run, press "Review deployments", tick `release` and
   Approve (also works on the phone in the GitHub app). The publish job is in the GitHub environment `release`,
   and only the user is its reviewer (Settings, Environments, `release`: required reviewer the user, "Prevent
   self-review" off; if the environment is ever deleted, recreate it before the next tag, or GitHub makes a
   new one with no reviewer). The environment also accepts only `v*` tags (deployment rule, type tag) and
   "Allow administrators to bypass" is off, so the Approve click is always needed. Nothing is published
   until then, so a tag pushed by mistake can be cancelled in the run.

   **Seeing the approval without a real release (tried 2026-11-13, run 43474782305):** a manual
   `workflow_dispatch` never reaches the publish job (it needs a tag), and a bare `v0.0.0-test` tag fails
   the version check. Use a throwaway commit instead: `node scripts/sync-version.mjs --set 0.0.0-test`,
   commit it on a local branch that is never pushed, `git tag -a v0.0.0-test -m "dry run"`, push only
   the tag (needs the user's OK). The run builds, then shows "publish GitHub release: waiting". Cancel it
   there (`gh run cancel <id>`, never approve), then delete the tag with
   `git push aitool :refs/tags/v0.0.0-test` and `git tag -d v0.0.0-test`.

6. **Verify the release** (the `curl` in DEPLOYMENT), then deploy to the Pi if wanted.
7. **Tell the players in #changelog and the GM in #dashboard-changelog.** Write 2 to 5 short English lines per post
   from the new CHANGELOG section: game terms as in the game, no em dashes, nothing purely internal (tooling,
   tests, CI). Sort each line by who notices it:
   - **Players' lines** (the player page, Foundry, the Discord bot, the character guides) go to #changelog,
     a normal post that never mentions anyone.
   - **GM and dashboard lines** (the co-GM dashboard, GM-only tools) go to the GM-only #dashboard-changelog
     with `announce.mjs dashboard`. Start with the GM role mention and the version, then one "• " line
     each. It pings the GM role and nobody else.
   - **A line both read** (say, a handout fix the GM triggers and players see) goes to the players. The
     GM reads both channels, so it is not repeated in #dashboard-changelog.
   - A release with no GM or dashboard line posts nothing to #dashboard-changelog.

   Post from the PC. Easiest: start the text with `{gm}` and the script fills in the role mention from
   `DISCORD_GM_ROLE_ID`. Or write the mention yourself as `<@&GM role id>`: replace the whole text `GM role id` (keep `<@&` and
   `>`) with the number from `grep DISCORD_GM_ROLE_ID "$APPDATA/foundry-ai-tool/discord-bot.env"` (that
   prints only the id line, never the token); left as is, the mention does not ping anyone. The role needs
   "Allow anyone to @mention this role" in Discord, else the post goes through without a ping: check that the
   first post pinged the GM.

   ```bash
   node packages/discord-bot/announce/announce.mjs changelog "**v0.26.0**
   - The player page now shows the combat live
   - ..."
   node packages/discord-bot/announce/announce.mjs dashboard "{gm} New in the dashboard (v0.26.0):
   • New Conditions button for several tokens at once
   • ..."
   ```

   A Pi stage 5 build of a new release tag posts "The server now runs vX.Y.Z." by itself once the Pi's bot env
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
