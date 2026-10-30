# Changelog

## Unreleased

## v0.23.0 (released 2026-10-30): paper nights, the rules check and rules search, waiting for game events, the NPC turn assistant, the Tarokka table, Pi stage scripts, Obsidian and test kit work

**Unchanged:** the module id, the socket channel, the `foundry-mcp-bridge.*` method prefix, the settings
namespace and the WebSocket port 31415. **Added:** the bridge queries `playerRoll`, `getLevelUpOptions`,
`getSpentActions`, `planCombatChange`, `planPaperSync` and `searchRules`, and five tools (the bridge
serves 98, up from 93): `get-level-up-options`, `search-rules`, `wait-for-game-event`,
`plan-combat-change` and `plan-paper-sync`. The `roll-request` session event now carries
`details.targetUserId` (older modules fall back to the whisper list), and `get-combat-state`
combatants carry `img` and `tokenUuid`. **Removed:** the module's `getTarokkaReading` query (the
reading is no longer read module-side). Update the module and the bridge together. The Orange Pi
builds the newest release tag, not `main` (D-126).

### Tooling

- **One advisor call per PR:** the lane skill now asks for one `advisor` call a PR, after the work
  is committed and before the PR opens, named in the PR handover and the `- progress:` line (it was
  two; measured 0.7 a PR). `npm run usage:week` prints the calls per merged PR next to the
  `Advisor calls (main sessions)` line, and adds `advisorPerPr` to `--json` and `advisor-per-pr` to
  the weekly check note. The lane skill also makes the API review runner the default review path
  until its credit ends on 2026-11-14.
- **Advisor calls in the weekly check:** `npm run usage:week` counts the `advisor` tool calls made in
  main sessions, prints them as one line, and adds them to `--json` and to the `Weekly check.md`
  section (`advisor-calls`). The lane skill now asks for one advisor call before coding and one
  before the PR.
- **CodeQL cache cleanup:** a new workflow, `codeql-cache-cleanup.yml`, deletes old
  `codeql-overlay-base-database-*` Actions caches nightly and after CodeQL runs, keeping the newest
  two per branch, config and language. CodeQL saves a JavaScript cache of about 330 MB on every push
  to main and never removes the old ones, so 60 of them filled 9.4 GB of the repo's 10 GB cache
  limit and evicted the npm caches. The job fails if a cache it tried to delete is still there.
- **CI on the PR head is the green for lanes:** the lane skill now says a lane runs quick local
  checks, pushes, and lets CI be the full green. The full local `npm run green` is for a request or
  for what CI cannot see (Windows-only local behaviour such as the heavy lock and the `.husky` hook
  path).
- **`npm run green -- --quick`:** typecheck and unit tests of the packages a branch touched against
  `aitool/main`, the node tests of changed scripts and hooks, and the dashboard e2e specs it
  touched. It takes no heavy-check lock.
- **The pre-push hook** runs only the em-dash check now (a second, no lock). The lint ratchet and
  the typecheck are left to CI; waiting for the heavy-check lock made the hook take a median 22
  minutes.
- **The merge gate builds `shared` when it has to:** `drift-check` (which the gate runs from main's
  copy) now builds `@gnuminator/shared` in the lane checkout when `shared/dist` is missing or older
  than `shared/src`, before the mcp-server tests run, so a docs-only lane no longer fails with
  "Failed to resolve entry for @gnuminator/shared". A failed build stops the check with its output.
- **`npm run green -- --cloud`:** runs the checks on GitHub instead of the PC, for when the local
  heavy-check queue is long. It refuses a dirty tree or a HEAD that is not pushed to `aitool`,
  reuses the CI run already started for that commit or else starts `ci.yml` by workflow_dispatch,
  waits, and prints one line: OK with the run URL and time, or the failed job, step and URL. It takes
  no heavy-check lock and runs nothing locally. The lane skill says when to use it.
- **The heavy lock stops counting a running holder's memory twice:** another run is admitted when
  the PC has, for each holder, only the part of its expected peak it has not used yet (estimated
  from the fall in free RAM since the oldest holder was admitted, credited once, and never below
  1 GB a holder because other programs growing also lower free RAM), plus the reserve. Before, a
  green that already used 3 GB was still reserved at the full 5 GB on top of a free-RAM figure that
  excluded those 3. Lint-only holders (lint-ratchet, the drift check's lint guard) count at a lower
  peak (`lightPeakGb`, 3.5 GB, settable in `~/.foundry-ai-tool/heavy-lock.json`). Each admission
  now records the free RAM at that moment (`freeGb` in the owner, `pendingGb` in `admissions.jsonl`).
- **Lint baseline lowered:** after the Lint zero 10a, 10b and 10c rounds the ratchet baseline drops from 2542 to 295 warnings, so the cleared rules cannot creep back.
- **Lint warnings are errors (D-109):** every ESLint rule that used to warn now fails `npm run lint` and CI, and the lint baseline is 0.
- **Lint wording after the zero baseline:** the lint ratchet header, the CI step names and
  `DEV-SETUP.md` now say errors, not warnings.
- **Caught errors are linted:** `caughtErrors: 'all'` is on. The three unused `catch (error)`
  bindings became `catch {`.
- **Low mode follows pace:** the planner sets the context hook's low mode (handover at 200k and 250k)
  only while weekly usage is on or above pace, the share of the week gone since the reset, instead
  of at a fixed 50%. Planner and lane skills and the hook comment say so.
- **Review runner pins the head and has a small-delta mode:** the runner now reads the PR head when
  it plans and checks it again just before the SDK starts (nothing booked if it moved) and before it
  writes the note (no note, so no round is counted, if it moved), so a push during a review can no
  longer leave a note for an old sha. `--delta <sha>` writes a short sha-bound note for a docs, test
  or changelog commit, or a merge of main that leaves the PR's own files alone, after a Merge note
  for `<sha>`, with a small budget and no `--allow-round3`; a change to the PR's own code is refused
  and stays a normal round. The lane skill says to wait for CI green on the head before the last
  review round and to use `--delta` for small commits after a Merge.
- **Live sweep step 25 explains its rare failure:** when "an AI-ended concentration" finds no
  "Also restored" note, the message now names the cause seen on 2026-10-30: a second GM browser
  logged in as the same user on the test server also runs dnd5e's dependent delete and can win the
  race, so the journal files the dependent under that browser's own action. The foundry-test-env
  skill says to keep one GM browser per test server. No product code changed.
- **`npm run usage:now`:** writes the vault note `Usage now.md` that the PM board's Today view reads, from the plan percentages passed in (`get_usage`) plus the `usage:week` check numbers. The planner skill says when to write it (each planner start and before each lane start).
- **Skills:** the planner skill names the `- progress:` line as the ready state, moves the Planner title step to "Starting lanes", renames the old planner "CLOSED (handed over DATE) Planner" before detaching, and tidies long lines; the lane skill says what to do about the worktree hold when no planner is left.
- **Dashboard screenshot baselines before the PR:** `npm run visual:baselines -- <branch>` starts
  the new `visual-baselines` workflow, which renders the screens and story shots in the same
  Playwright image as `dashboard-visual`, and unpacks the changed or new PNGs into the checkout.
  Commit them before opening the PR so the first PR run is green. The lane skill now says so.
- **Dashboard screenshots run in 4 parallel CI shards:** the `dashboard-visual` job is now four
  `dashboard-visual-shard` jobs (`--shard=i/4`, same image and baselines) plus a summary check still
  named `dashboard-visual (screenshots)` (the gate judges every check, shards included, so it needs
  no change; the visual part takes about 5 minutes instead of 14). The diff report is one
  artifact per shard (`dashboard-visual-report-1` to `-4`). The baseline refresh workflow stays a
  single run.
- **Weekly check note for the PM board:** `npm run usage:week -- --write-vault` writes the numbers
  against the D-122 targets into vault `Weekly check.md`, one section per week, for the board's
  Week page. The planner skill's weekly check step runs it.

### Session notes

- **Notes run by themselves after a game night:** `tools/session-notes/register-auto.ps1` registers a Windows scheduled task (hourly and at logon, catches up after the PC was off) that runs `auto.ps1`: transcribe, write the notes, publish to the GM-only journal. A usage-limit pause continues the next hour.
- **Consent gate:** nothing is transcribed, written or published unless every speaker has a recorded yes in `consent.json` (`session-notes consent set | list | check`). A blocked session shows as "waiting" with the reason in the After view.

### Process tooling

- **Lane heartbeat:** `npm run lane:beat -- "<lane>" "<step>"` (`scripts/lane-beat.mjs`) writes `- last seen: <date time> <step>` under the lane's claim in the vault Backlog at each milestone (claimed, PR open, review, fixes, ready to merge, handed over; the `lane` skill says when), so the PM board's lane card shows the step and its age and its stale rule counts it. A vault problem only prints a warning.
- **Merge train on the PM board:** `scripts/lane-merge.mjs` writes the merge train (count, last roundtrip, last event) to the vault note `Dev/Foundry AI Tool/Merge train.md` on every merge, every `--train-reset` and every refusal, so the board's Today card shows it. A vault problem only prints a warning and never fails or undoes a merge; `--dry-run` writes nothing.
- **Test server locks on the PM board:** `scripts/test-env/lock.ps1` writes each test server's lock state (A, B, C: free or held, the holder's title, since when, queue length) to the vault note `Dev/Foundry AI Tool/Test servers.md` on every take, release (steal included), queue and leave, and `lock.ps1 publish` writes it again. A vault problem only prints a warning and never fails the lock.
- **Heavy-check lock:** `scripts/heavy-lock.mjs` is a machine-wide lock (one slot by default, `HEAVY_LOCK_SLOTS` for more, a folder under the temp directory) so only one heavy run goes at a time. `npm run green` takes it per heavy step (type check, lint ratchet, build, test suites, e2e), the pre-push hook per check, `lint:ratchet` around its ESLint pass and the merge gate's drift check around the lint, mcp-server and write-gate guards (through the script's CLI, since the gate's copy of `drift-check.mjs` may not import other files). A run that has to wait prints `heavy-lock: <run> waits for <holder> ...`, then every minute; a lock whose process is gone or older than 1 hour is taken over; after 60 minutes (or on any lock problem) the run goes on without the lock and does not wait again, so the lock never blocks the gate. Exit codes and output lines of the checks are unchanged. ESLint `--cache` is not used: the type-aware rules read other files' types, so a per-file cache can go stale.
- **Lint zero, character tools:** `packages/mcp-server/src/tools/character.ts` has no ESLint warnings left. Bridge replies and actor data are read through the narrowing helpers in `tools/bridge-data.ts` instead of `any`; no change to what the tools return.
- **Lint zero, compendium tools:** `packages/mcp-server/src/tools/compendium.ts` has no ESLint warnings left. Bridge replies and Foundry item data are read through small narrowing helpers (`tools/bridge-data.ts`) instead of `any`; no change to what the tools return.
- **Lint zero, dnd5e tools and system adapters:** `tools/dnd5e/` (add-feature, npc, features) and `src/systems/` have no ESLint warnings left. The system adapter interface and the add-feature response builders use small named types (`tools/dnd5e/types.ts`, `systems/data.ts`) instead of `any`; no change to what the tools return.
- **Mirror tests under load:** the temp-folder teardown in the Obsidian tests (`packages/mcp-server/src/obsidian/`) goes through `rmTmp` (`src/test-support/rm-tmp.ts`, `fs.rm` with retries), so a locked folder on Windows no longer fails with ENOTEMPTY, and the mcp-server vitest test and hook timeouts are 30 s instead of 5 s, so the gate's drift check and parallel green runs stop refusing a PR on load-sensitive tests (`mirror-pump-flake`).
- **One Foundry app folder for the test servers:** the folder the test servers start Foundry from now comes from one machine-wide file, `appdir.txt` next to server A's `lock.json`, instead of each worktree's gitignored `local.json`, so every checkout runs the same Foundry version. `status.ps1` prints the version it will start and warns when a `local.json` `AppDir` disagrees; `status.ps1 -SetAppDir <folder>` writes the file.

### Process

- **Lane link on the claim:** a lane writes its own session link as a `- link:` line under its claim,
  so the PM board's lane card can open that session in the desktop app. The `lane` and `planner`
  skills say so (board-lane-link).
- **Lanes report in the vault:** the `lane` skill has a lane write a `- progress:` line (PR, head sha, review note) on its Backlog item at "ready to merge" and at handover, before any message, and never message a session id from its brief. The `planner` skill reads those lines, does not message idle lanes above about 150k, detaches its lanes before it hands over, and writes no planner id in briefs.
- **Reviewer agents in the lane skill (I-143):** the lane skill says when to run the three read-only review agents before the formal review. All three agents now ask for the PR description and a checkout at the head sha, and the chat-mode wording in the guarded-writes agent is corrected.

### Pi

- **Board status report (stage 16):** a systemd timer on the Pi sends a small read-only health report (up, disk free, last nightly backup, Foundry up or down with the Foundry and dnd5e versions) to the PM board once an hour, over Cloudflare Access with a service token kept in a root-only file. The board shows it on Today, red when the backup is older than 30 hours or no report came for 3 hours. Not installed yet: it runs in the Saturday Pi sitting.
- **Join page look (stage 19, backlog join-page-look):** the page players see before they log in can now get a
  background picture and a written description of the world. `scripts/pi/remote/19-join-page-look.sh` stops Foundry,
  puts the picture in the world's folder, sets `background` and `description` in `world.json` (Join Page Theme and
  Next Session untouched), starts Foundry again and checks the join page. It has a dry run, needs a snapshot from
  today and nobody online, saves the old values and has `UNDO=1`. It is a stage and not a GM script because
  Foundry accepts the world edit only from the full Gamemaster role, which the Assistant GM does not have. The
  picture itself is campaign art and is not in the repo.
- **GitHub Actions runners on the Pi (stage 17):** two self-hosted runners for the PM board's workflows
  (obsidian-vault and the board repo), so board builds no longer use GitHub's free hosted minutes. They run as
  their own user with no access to the game's files or ports, and a gate timer keeps them stopped while a play
  session is marked (builds wait and run afterwards). A PC helper hands over the one-hour registration token
  without printing it (board-local-deploy).
- **Pi clock stays under NTP (stage 18, backlog pi-ntp):** DietPi's default time sync is "boot + daily",
  so `timedatectl` said "NTP service: inactive" and the clock could drift between syncs, which Cloudflare
  Access tokens and the board's hourly report depend on. `scripts/pi/remote/18-time-sync.sh` switches DietPi
  to its daemon mode (`dietpi-set_software ntpd-mode 4`), with `DRY_RUN=1`, `CHECK=1` and `UNDO=1`, and
  waits until "NTP service: active" and "System clock synchronized: yes".
- **World switches (G0):** stage 11 now sets the AI Tool and dnd5e switches a world starts with (Handouts,
  Party, Tarokka and the other live-play writes, Allow Write Operations, GM windows, Auto-apply downed set to
  all, Item Piles trading) in every world it installs or resets, so a reset training world no longer starts with
  them off. A kept world gets them with `WORLD_SWITCHES=1` (its settings are copied to prev first); a Plan B
  push-back never does. The list and the reason for each value is in `docs/dev/PI-SETUP.md`, "World switches".
  Upload `scripts/pi/remote/world-switches.mjs` to `/root/` before the run, or add `WORLD_SWITCHES=0`.

### Fixes

- **Bridge link:** a response frame from the module with no `data` now rejects its pending query with "Query response had no data" instead of deleting it and throwing, which left the tool call waiting forever (its timeout had already been cancelled).
- **CI python-tests can no longer hang on a slow apt mirror:** the ffmpeg install is bounded (5 minutes, short per-download timeouts) and a failure only skips the narration render tests with a warning; the job also has a 20 minute limit.
- **CI:** in the Python test job the ffmpeg install now bounds each apt-get call on its own (`timeout -k 20`, 120 s for update and 180 s for install), so an apt that ignores the first signal gets a kill 20 s later. The apt network timeout also covers https mirrors.
- **Live Feed damage line:** every damage line in the Live Feed now reads "Wolf 1 took 5 damage (HP 11 to 6)" with the hit points before and after (it showed them only at 0 HP). A Damage or Heal apply from the dashboard also names the type ("took 5 fire damage") and its separate "Applied: ..." row is folded into the line. A change that does more than hit points (a paper sync, say) keeps its row. Recent Changes is unchanged.
- **Undo of a drop to 0 HP:** dnd5e's follow-ups of an AI change (Unconscious and Prone when a character goes down, Bloodied and Unconscious removed by the undo) stay in the AI change's group when they start up to 3 seconds after the write (the limit was 0.3 seconds), so a slow link no longer shows them as someone's own change next to the undo. The 3 seconds count from the write itself, and Next turn and initiative from the bridge always start their own change, so a click on the strip right after a Damage apply stays your own change. A hand edit in Foundry within 3 seconds of an AI change on the same thing can still be grouped with it.
- **End combat and the other combat tools:** End combat, Next turn, set initiative, roll initiative and the combatant picker act on the fight the combat strip shows, also when the GM browser that answers views another scene than the fight is on (they said "No active combat" there, though the dashboard and Foundry's tracker showed the fight). Of several encounters the started one wins, then the newest.
- **Live Feed combat lines:** "Combat ended after 1 rounds" and "Combat started with 1 combatants" now
  read "1 round" and "1 combatant" (the player feed already did).
- **Neutral names in tests, part 2:** the guarded-write, session-notes, player-visibility, preflight, secret-terms and theme tests use invented names instead of Curse of Strahd characters and places. World ids stay `curse-of-strahd`.
- **Neutral names in scripts and tests, part 3:** the Pi stage tests, test kit tests, Tarokka specs, combat tests, livekit recorder, session-notes and session-pipeline tests use invented names instead of Curse of Strahd characters and places. World ids (`curse-of-strahd`, `strahd-kit`) and the Tarokka `strahdLocation` position stay.
- **Demo recorder fallback:** `FOUNDRY_DEMO_GRAB=gdigrab` makes `demo:take --recorder ffmpeg` capture with gdigrab instead of ddagrab, for a night when ddagrab opens the screen but never delivers a frame (video-voice lane).
- **Merge gate after #531:** the drift check no longer runs the MCP modern-client probe test,
  which needs a built `dist/index.js` that its trial-merge worktree never has. Since #531 every gate
  refused on it. CI and `npm run green` still run the probe after a build.
- **Flaky dashboard e2e test:** the "GM Actions gate shows the docked Pre-flight" test clicked in the Party drawer before Pre-flight had docked, so Pre-flight floated over Party and Party stayed open. The test now waits for the docked Pre-flight first. No product change.
- **Flaky audit test:** "keeps every history line even past the ring size" no longer does 505 fsync'd rewrites in one test (it timed out at 30 s on a loaded disk); it seeds a full ring in one write and appends 5 more. The audit code is unchanged.
- **Undo of a plan whose token the GM already deleted:** undoing a plan that created several
  documents no longer refuses the whole undo when one of them is gone (a spawned token killed in
  play). The rest is removed, the change history says which one was already gone, and a redo puts
  back only the ones the undo removed.
- **Session notes after a redo:** undoing the undo of a session-notes put brings the notes back to
  "in Foundry" (the Recap is queued for reveal again), not only the journal.
- **Foundry link:** a query whose send fails is dropped at once instead of lingering for up to two
  minutes.
- **A refused write names the switch to turn on:** when "Allow Write Operations" or a feature switch is off, the refusal now gives the switch exactly as Game Settings shows it ("AI Tool: Handouts (writes)") and where it is (Game Settings, Configure Settings, the AI Tool section), instead of `The "handouts" feature is switched off in the module settings`. The dashboard shows it as a hint, not a red error.
- **Handouts drawer says why Reveal next would be refused:** while "AI Tool: Handouts (writes)" or "Allow Write Operations" is off, the drawer shows a notice with the switch name and where to turn it on. Creating a quest journal, queueing and reordering never needed the switch; only the reveal itself does. That is what stopped both training tests (the switch was off in the reset training world).
- **Heavy-lock test with more slots:** the test that two runs started together queue one after the
  other now pins one slot, so it no longer fails on a PC where `HEAVY_LOCK_SLOTS` is set to more
  than one.
- **wait-for-game-event:** the reply carries `gap: true` when the `sinceTimestamp` is older than the oldest event the server still remembers (some events were dropped); dead code removed; tests for the handler, abort on a closed connection, the event-type list and the play-log hook. A wait for any event no longer wakes on the AI's own changes and roll requests.
- **Dashboard rate limit:** the asset limit is 5,000 per 10 seconds, the comment says one bucket per tunnel, and a test shows the assets still answer when the page limit is used up.
- **Join form on Foundry 14.369:** the Pi Assistant GM and kit-session logins, the player-creation check, the demo recorder and the table viewer now pick the user from 14.369's `<select id="join-username">` as well as typing it into 14.368's text field.
- **Lint zero (D-109, lane 10b, part 1):** the scene, quest, campaign and actor-creation tools use typed bridge replies instead of `any` (508 fewer lint warnings). No change in what the tools return.
- **Lint zero (D-109, lane 10b, part 2):** the token, movement, combat, dice-roll, ownership, chat-log, diagnostics, session-log, effects, encounter and resources tools, the tool router and the small utils use typed bridge replies instead of `any`. No change in what the tools return.
- **Lint zero (D-109, lane 10b, part 3):** the server entry point, backend client and the bridge connector and client use typed messages and replies instead of `any`. No change on the wire.
- **Play recorder create hooks:** the actor, item, effect and token create handlers expected Foundry's old four arguments, but Foundry 14 passes three (document, options, userId). They read the options as the user, so create records had no user name. They now take three, and the tests call them the way Foundry does.
- **Item, spell and feature cards reach the Live Feed:** posting a card to chat now shows "Akra used Bless" in the Live Feed, with or without a roll, and a PC's use shows on the player page. A whispered or blind card stays GM-only.
- **Review lows from the item-use feed and Live Feed down line (#495, #497):** the item-use
  session-event test now speaks as a real player character and covers an NPC card; the play
  recorder tests check the user id on item, effect and token records; `get-session-log` lists
  `item-use`; an item use gets the roll rail in the Live Feed; stale "dropped to 0 HP" wording is
  updated in the co-GM prompt, the GM guide and the storybook fixture.
- **Module pages for the board's picker:** the Item Piles title line and one FXMaster verdict sentence
  now follow what the module picker page reads (title `# Name (`id`)`, no players' spoiler words), so
  its data builds again after batch E.
- **Module page monks-player-settings:** the verdict and the first gotcha now lead with the caution that the
  author's manifest claims Foundry 13 only, so the module picker no longer reads it as certified for 14.
- **Module rehearsal zip check:** the zip reader now also checks that the entries it read add up to the directory size the zip states, so a zip with a too-low entry count can no longer hide names. The version mismatch message got its missing space.
- **Module rehearsal write sweep:** the `live:sweep` step ran the read sweep (`live-read-sweep.mjs`); it now runs `live-write-sweep.mjs`, the sweep the step is named for.
- **Pi nightly backup: the skip marker is dated:** when players stay online all night the backup is skipped and a marker is left. The marker now holds the date, and the "back up anyway" rule applies only when it says yesterday. A manual run or a stage 6 rerun the evening after a skipped night waits for the players and skips again, instead of stopping Foundry under them. A marker from the earlier version (empty) is not trusted. Reaches the Pi with the next stage 6 run.
- **MCP probe test cleanup:** the modern-client probe test waits for the wrapper processes it started to exit before it removes its temp folder, and removes it with the retrying `rmTmp`. This ends the occasional `ENOTEMPTY` failure on CI.
- **Session notes, undo and redo (PR #443 review lows):** undoing a planned undo or a planned redo
  (`undo-change`) now brings the session notes back, or sends them to staged, like the other undo
  paths; a redo reads the pages back from the put and does nothing when the journal was deleted by
  hand; the "Recap was revealed" refusal also covers undoing a redo; the "Left alone" line of an
  undo now says the document "was already gone when the undo reached it".
- **The TV (PR #400 review lows):** the Table user carries a flag, and the handout receipts, the
  "all players" ownership, play attendance and the player count of
  `get-world-info` leave it out. `plan-table-viewer` refuses when a GM user has the name, or when
  the users cannot be listed. The module only creates a User for the `table-viewer` feature (or its
  undo), with a role of Player or lower and no password. The TV script also refuses when a browser
  holds the profile's lockfile, understands a Foundry address with a path prefix
  (`https://host/foundry`), and the guide puts `-NoExit` in the Startup shortcut.
- **Review lows from 2026-10-28 (I-126, I-078, I-139, I-149):** the rules check writes "the grappler's
  Strength modifier" and "the shover's Strength modifier", and has tests for finding an activity by
  id and for the looser Grapple or Shove name match. The Party drawer's "Who would notice" row has
  an e2e test. A new player vault says "this page is still empty" instead of pointing at sections it
  does not have, and Campaign Home has a first-use note. In the Tool Runner, text areas keep their
  3.2rem minimum height and the footer always reserves two lines for the error or waiting message.
- **Roll-request buttons apply conditions:** the chat buttons that `request-ability-check`, `request-attack-roll` and `request-player-rolls` (ability, skill, save) post now roll through dnd5e's own actor and attack-activity API instead of a plain `1d20` formula, so poisoned and other conditions, advantage sources and Automated Conditions 5e apply (a poisoned player rolls `2d20dis`). An attack button now also adds the weapon's real to-hit bonus. The DC still rides on the roll and the card is still marked rolled. Initiative and custom rolls, an attack with no matching weapon and a roll dnd5e does not make still roll the plain formula. An attack button spends ammunition like the sheet does, and a GM or dashboard click leaves the target AC off the player's card. Kit scenario `module-ac5e-roll-mode` now clicks the buttons and expects disadvantage.
- **Roll requests use the player's assigned character:** a roll button asked for a player rolled for the first actor that player owns, so a player with more than one actor (an alternate character, a familiar) could roll with the wrong bonuses, or fall back to a plain d20 when the weapon was on another actor. It now uses the character assigned to the player in User Configuration, and the first owned actor only when none is assigned.
- **Rules check, review lows:** a second Healing Word (or other repeat) is now counted in the pre-check before a use or attack; unlinked tokens that share one actor no longer share the spent-actions ledger (nothing is claimed for them); a rules version the GM stored on the actor wins over detection; the spell level is read from the usage card first (scroll casts count as spells).
- **Rules search:** a background rebuild of a rules pack index that has not finished after 60 s counts as failed, so one hung pack no longer blocks the refresh of the others.
- **Scene tools work with no canvas:** `get-current-scene`, `get-token-positions`, `measure-distance`, scene state, the player-visible scene and token placement now fall back to the active scene when the client has no canvas (the Pi's Assistant GM runs with core `noCanvas`, which left them failing with "Scene not found").
- **Session notes say when Claude is logged out:** when the `claude` command on the PC has lost its
  login, the notes run now stops at the first scene and writes "Claude is not logged in on this PC
  (open a terminal, run claude, then /login)" to `notes/status.json`, instead of trying every scene
  twice and reporting only "kept raw" with no reason.
- **Session notes calls are much lighter:** each Claude call of the notes writer no longer loads the
  PC's connectors, skills and settings (about 180k tokens of context per call; a 5-line test
  recording went from 365k to 10k input tokens).
- **Session notes consent:** `consent set` now also refuses to overwrite a consent.json that is not an object or whose `players` is not an object.
- **Pi join page look:** stage 19 keeps the old picture by reading it as the foundry user instead of root `install`.
- **Settings path in switch-off messages:** the message that tells you which Foundry switch to turn on now says "open the Settings tab, Game Settings, Foundry AI Tool" (Foundry 14 has no "Configure Settings").
- **Version tracker tooltip** says the tracker is on by default, and the "Live play, apply without confirming" hint no longer claims the dashboard's Damage and Condition buttons skip the confirm step.
- **Dashboard:** the stream status `lastPollAt` now moves with each successful poll. It stayed at the first poll time while events flowed (seen on the Pi), because the status is only published when something else changes. The time is updated quietly, with no extra message to the browsers.
- **Clearer Tarokka card errors:** a card in the wrong deck, or given by name, now gets an error that
  shows what a card id looks like (`swords-7`, `raven`). The cookbook example says Claude passes ids.
- **Tool size figures refreshed:** the totals in the tool sets page and the README match the real
  tool definitions again.
- **Tarokka clear:** `clear: true` with a `source` or `userId` is now refused with a clear message instead of silently clearing and dealing nothing. The Obsidian notes say "No current reading" after a clear, and an archived reading is described as no longer current (replaced or cleared). A test covers a clear plan that goes stale when a reading is imported after it.
- **Test environment shows ribbon portraits:** `scripts/test-env/start.ps1` now gives the test dashboard `DASHBOARD_FOUNDRY_URL` (its own Foundry port), so the initiative ribbon shows portraits there like on the Pi and in Plan B, not only initials.
- **use-item with targets works on Foundry 14:** `use-item` with named targets called `game.user.updateTokenTargets`, which Foundry 14 (14.368 and 14.369) does not have, so the call failed before the item was used. Targets are now set through `canvas.tokens.setTargets`. If the canvas is not ready, shows another scene than the active one, or Foundry refuses, the item is still used, the targets are left alone, and the answer says "targets not set" instead of claiming a target.
- **Screenshot baselines no longer get lost in the workflow:** the "Collect the changed and new PNGs" step of `visual-baselines.yml` ran under `sh`, where `read -d` fails without failing the step, so the artifact held no PNGs while six had changed. It now runs under bash, fails on a mismatch, and writes a `png-count.txt` marker. `npm run visual:baselines` fails loudly when the marker says N PNGs but the artifact holds fewer, and writes nothing in that case.

### Tooling (CI failure review fixes 3 to 8)

- **Pre-push check:** `git push` now runs the lint and em-dash ratchets and the typecheck first
  (skipped when `npm run green` passed on the same commit), so a +1 warning is refused locally.
- **Merge gate verdict:** `lane:merge --wait-ci` always ends with one `wait-ci ended` line with the
  exit code and the reason, also after a killed relaunched copy or an unexpected error.
- **Visual Docker runs:** the node_modules volumes are per worktree, and a stopped Docker Desktop
  gets a plain message.
- **Tool-set budgets:** the drift check prints each set's headroom and warns under 500 characters.

### Internal

- **Neutral names in tests and comments:** test fixtures and code comments in `packages/` no longer use Curse of Strahd plot or NPC names (Strahd, Ireena, Ismark, Rahadin, Barovia, Vallaki and the like); they use neutral made-up ones. The live features that match the real campaign content are untouched: the Tarokka reading, the secret-term check, the Veil theme, the book index, player visibility, the pre-flight scan, the mirror notes' Tarokka cross, the combat button text and the world id `curse-of-strahd`. Wire identifiers are unchanged.

### Module

- **Creature index upload message is less certain:** the save-failure error now says Foundry
  refused the upload and gives the replaced-session clue only as a hint when the console says
  "does not have permission", since a refusal can also come from missing upload permission or a
  full disk.
- **Creature index save failure explains itself:** when Foundry refuses the index upload (a
  replaced browser session, `User [] does not have permission to upload files`), the error now
  says so and suggests reloading the world. Found on the test servers, where joining two servers on
  the same host name in one browser shares the session cookie.
- **Ability checks show pass or fail:** a roll made from a `request-ability-check` card with a DC carries the DC, so the Live Feed says "vs DC 15: failure". On a public request the player page gets it too (the card already showed the DC to everyone); a private one stays GM-only.
- **Live Feed damage line:** a hit that takes a character to 0 HP reads "took 9 damage (HP 9 to 0)". dnd5e 6 adds Unconscious or Dead at 0 HP only in combat and only when its "Auto-apply downed" world setting asks for it (default off); our damage path goes through a normal HP update, so that setting applies to it too.
- **Roll requests are session events:** `request-player-rolls`, `request-ability-check` and `request-attack-roll` log a `roll-request` event (GM only; the /player feed never shows it). A private roll's event records who it was whispered to.
- **`plan-combat-change` start action:** Claude can start a fight too (`action: "start"`, optional
  `tokenIds`; by default the player characters and Hostile tokens). The combat is created already
  begun, and the session log still gets its "Combat started" line.
- `get-targets` also returns `selected`, the tokens selected on the canvas, in the same shape as
  `targets`. It also reads the targets of the other active GMs when the bridge user has none, so it
  works when the bridge runs in another GM's browser showing the same scene (Foundry only syncs
  targets then); `selected` is local to the bridge's browser
  and only reflects the GM when the bridge runs in the GM's own.
- **GM windows are on by default:** the world switch "AI Tool: GM windows" now starts ticked, so a new world gets the Combat, Party, Session, Scene and Loot buttons without a trip to the settings (W52). A world where the module settings were ever saved keeps the switch as it was (Foundry stores every setting on save); tick it once there.
- **Lint cleanup in the compendium search:** `data-access/compendium.ts` and `data-access/types.ts` carry real types for creature filters, search hits and compendium documents instead of `any` (194 lint warnings gone). Types only; search results are unchanged.
- **Lint cleanup in the module's query layer:** `queries.ts` and `data-access.ts` no longer use `any` (259 lint warnings gone). Types only; the bridge handlers behave as before.
- **Lint zero, last warnings:** the remaining ESLint warnings in the module, the dashboard and the Discord bot are cleared with types and narrowing. One side effect: campaign progress toggles now ignore a malformed saved status flag instead of failing.
- **Lint cleanup in the scene plans:** `scene-plan.ts` and `scene-plan-geometry.ts` use typed scene, token and note shapes instead of `any` (115 lint warnings gone). Types only; the plans are unchanged.
- **Module reference pages, batch B:** verified pages for Monk's TokenBar (drop: its saves bypass the play log), Combat Spell Timer (drop, optional; it also sends an install ping), DAE (optional) and Monk's Combat Details (keep), in `.claude/skills/foundry-modules/references/`.
- **Module reference pages for the nine Strahd-list modules that had none:** Carousel Combat Tracker,
  5e Resource trackers, Monk's Common Display, Monk's Little Details, Universal Battlemap Importer,
  Dice Tray, GM Vision, Health Estimate and Nice more Dice, each tried on Foundry 14.369 with
  dnd5e 6.0.6 (`.claude/skills/foundry-modules/`). The skill index now shows each module's version and
  lists a one-line verdict for the 17 modules that were switched off in the old Frostmaiden world.
- **Four conflicts between the pages and the walkthrough settled by a live check:** Calendaria is
  keep, Monk's Player Settings is keep (its player drop-down works; the first check opened the wrong
  window), Automated Animations stays optional (the null `id` error did not reproduce on 8.0.1),
  and the DDB Importer page now says it is in the `modules-all` kit profile.
- **`scripts/modules/strahd-modules.json` carries a `verdict` per module,** the same word as the page.
- **Party roll bar and combat lows (#612, #608):** the "roll requests are off" hint now only says to turn on Allow Write Operations. The GM windows guide says a bare typed roll fills a waiting row and to wait a moment between an AI damage change and a turn or initiative change. A test now checks that Next turn, set initiative and roll NPC initiative each end the AI change group.
- **NPC turn review lows (PR #464):** two tokens of one linked actor hit in one plan now give one hit point change instead of two that overwrite each other; a plan with more than one legendary action is refused (one at a time, at the end of another creature's turn); a normal attack planned on another creature's turn gets a note; the `damageWith` hints and the `results` description ask for one entry per `damageByType` entry; tests for activities, the per-type damage sum and the old-module guards.
- **NPC turn small fixes (#468 review lows):** the off-turn note appears only for creatures that have legendary actions and now also names reactions; the refusal for several legendary actions says an area action is planned against one target and the other targets go in `results`; a damage line that merges two tokens of one actor names the second token.
- **Party place packs small tokens together:** on a scene where `place` makes tokens smaller than a square (for example 0.25 squares on a 40 ft map), the party now stands close together around the spot instead of one token per square. The placed tokens also get their `depth` set next to width and height, like fit-scale.
- **Roll requests in Foundry's Party window:** the Party window has the same one-click bar as the dashboard: pick an ability check, saving throw or skill (with an optional DC, advantage and Public), then press Ask on one character, or "Group save" / "Ask everyone" for the whole party. Each answer lists under the bar per character as the roll comes in (the total, and passes or fails against the DC). It uses the same roll request as the AI tool, so every roll lands in the play log, recap, stats and Live Feed. Needs "Allow Write Operations"; without it the buttons are disabled with the reason.
- **Fixes:** a roll request to "Mira" now goes to the character Mira before a player whose name only contains "Mira" (Miranda).
- **Latest recap button for players:** the Journal sidebar has a "Latest recap" button for everyone. It opens the newest session recap the GM has revealed, or says "No recap yet" when none is. It only reads pages the player can already see and writes nothing.
- **Combat snapshot carries the token image and uuid:** `get-combat-state` combatants now include
  `img` (a Foundry path) and `tokenUuid`. `open-in-foundry` takes an optional `pan: true` with a
  token uuid to pan the GM's view to it instead of opening its sheet.
- **Roll request events name the player:** the `roll-request` session event now carries
  `details.targetUserId`, so the dashboard can tell who still owes a roll (older modules fall back
  to the whisper list for a private request).

### Dashboard

- **The Tool runner says what it is waiting for:** a change that waits on Foundry (up to 4 minutes) greys out Run in every tool's form, so a Damage / Heal form opened for another target looked dead. The form now shows "Waiting for plan-actor-change damage to finish", and Enter says the same in a toast (David's test, `david-damage-form-stuck`).
- **Danni's picks are the defaults (2026-10-30):** the During screen starts on the Auto layout (the layout is counted as picked, so the "try the layouts" card stays away), the Combat buttons start on, and players no longer see a health band on enemies (`PLAYER_SHOW_ENEMY_HP_BANDS` now defaults to false; set it to true to bring the bands back). A world that already saved its own choices keeps them.
- **Quick Undo checked:** undoing a normal HP or condition change already needs no "I understand" tick; it only shows for undoing a created or deleted thing and for undo-all rewinds. No change needed.
- **End combat from the Combat Tracker:** the strip has an End combat button (needs Combat buttons and GM
  Actions). It opens the Tool runner on the new `plan-combat-change` tool; you confirm the plan, the
  fight is removed from the tracker, and Recent Changes has Undo, which brings the fight back with its
  round, turn and initiative. David missed this in his GM test (david-end-combat).
- **Recent Changes, Everyone tab, updates by itself:** a token moved in Foundry shows within a few seconds, without the refresh button.
- **Roll requests from the Tool Runner:** the roll tools no longer ask for `userConfirmedVisibility`; the Public tick on the form is the pick. Claude still has to ask first.
- **Live Feed says who is down:** a PC or NPC dropping to 0 HP now reads "Akra is down: 0 HP, unconscious, death saves begin" (NPC: "Goblin is down (0 HP)") under a "down" chip, whatever caused it. The player page keeps its own wording.
- **Live Feed keeps going:** the feed no longer depends on one time cursor alone. Every few polls it reads the newest events again and passes on the ones it has not shown, and a cursor that is ahead of Foundry's clock is dropped, so an event stamped behind the cursor cannot hide the feed after a session ends and starts again.
- **During layouts are easier to find:** the During bar has a **Try layouts** button that starts the layout trial (with the sample fight), so you no longer have to find it in the Advanced menu. The line for Auto now says that it looks like Cards until a fight starts.
- **Private rolls in the Live Feed:** a whispered or blind roll reads "private roll" on its chip (it said `gm-roll`), and a roll request shows as its own "roll request" line ("Private roll request to Alice: ...").
- **Your private rolls on /me:** a player's own page lists the private rolls asked of them and their results (only the line they may read: no DC or outcome unless dnd5e shows them). Nothing from other players, blind rolls, the GM's own rolls or public requests.
- **Start combat with a token picker:** with no fight running and GM Actions on, the Combat Tracker
  offers Start combat. It lists every token on the scene, with the player characters and Hostile
  tokens ticked and Neutral and Friendly ones not (Foundry's token disposition); you change the ticks
  and start. The fight is created at round 1 and logged in Recent Changes with Undo. The tracker
  card still shows with no fight only in the Full view; in every other During layout a small Start
  combat button on the During bar opens the same picker (david-start-combat-picker).
- **One start button:** the Pre-flight button that switched on the write switches is now called **Turn on for tonight** (it was "Ready for session"), so **Start session** in the header is the only start button. The banner about the old dashboard now says what is missing (the Features cards, the status lights and the AI commentary) and where to find it.
- **End session reaches every open dashboard:** starting or ending the session from one dashboard window now moves the other open windows too (Before, During, After) at once, instead of up to a minute later.
- **Auto now says what it shows:** the note beside the During layout switch is a pill that reads "Auto is showing Cards now, because no fight is running" or "Auto is showing Combat now", and it is tinted while the combat view is up, so Auto no longer looks the same as Cards with no fight.
- **Start combat picker on the During bar:** it no longer reopens by itself after a fight began or ended while it was open, takes keyboard focus when it opens, and hands focus back to the button when it is cancelled.
- **Use Foundry targets:** the combat strip has a "Use Foundry targets" button that picks the
  combatants you have targeted (or, with none targeted, selected) in Foundry, so Damage / Heal and
  "Ask picked" follow them. Token and actor fields in the Tool runner (group saves, roll requests)
  have the same button beside Pick.
- **Handout queue reorder is one write:** the up and down arrows on the Handouts drawer now use a
  new `move` action on `plan-page-reveal` (with `position`), so a failed move leaves the queue as it
  was instead of possibly dropping pages. Keyboard focus stays on the moved row's arrow.
- **Handouts: move queued pages up and down:** the queue on the Handouts card now has up and down buttons, so the GM sets which page "Reveal next" shows first. Reveal next and Remove are unchanged; the order is kept by the bridge, so it survives a reload and Claude sees the same order.
- **Showing a handout is one question:** a page reveal is an ordinary change with an Undo, no
  longer a destructive one. The window asks `Show "<title>" to <players>?` in one line, with a
  **Show page to players** button and no tick box.
- **A refusal can turn the switch on:** when a change is refused because one of the session
  switches is off (the GM Actions gate still opens Pre-flight), the warning toast has a **Turn on (switch name) and the rest for tonight**
  button (the same click as Turn on for tonight in Pre-flight, so it turns on all of them). Switches the
  dashboard does not control keep the named pointer to Foundry's settings.
- **One switch-off sentence:** the guarded-write refusals of the bridge and the dashboard take the
  "is switched off. In Foundry,
  open Game Settings..." wording from one shared constant; the module (which cannot import it in
  the browser) keeps a copy that a test checks against it.
- **Fewer requests at first load:** the floating panels (Paper sync, Tarokka, Tools, links, diagnostics, versions) now start downloading five seconds after the page appears, one per idle moment, instead of all at once. Two seconds in, the page has made 38 requests instead of 47 (10 script files instead of 18). A panel opened earlier loads when opened.
- **Tool Runner form (I-149):** parameter names are set in mono as identifiers, hint text uses the dim text token (clears two recorded contrast findings), fields have more room, and Run sits in a sticky footer with a reserved message slot. Tokens only, in `next.css`.
- **Start session is the only switch for live play:** it turns on GM Actions and every Turn on for tonight switch in one click, End session turns them off. The header's GM Actions button is now one line, "Live play on: all set" (or "Handouts is off: Turn on"), that opens the list of switches.
- **Controls stay when a switch is off:** Start combat, End combat, the Ask the party roll buttons and Reveal next render greyed out with a one-line reason and a Turn on button instead of disappearing.
- **The Combat buttons setting is gone:** the pick bar follows GM Actions and a running fight only.
- **Player page, scene look:** the header shows the scene's time of day and weather next to its
  name, for example "Village Square (Dusk, Rain)". Both come from the viewed scene's darkness and
  weather and use fixed labels only; a scene mood preset name or any other text never reaches the
  page.
- **Player page, "New" handouts:** a handout revealed after the current session started (or, between
  sessions, after the last one ended) carries a "New" mark.
- **Player page, enemy health:** the coarse enemy bands (healthy, bloodied, critical, down) are now on
  by default. Set `PLAYER_SHOW_ENEMY_HP_BANDS=false` to hide them.
- **Roll buttons on the player page:** a player with their `/me` link sees their open roll requests
  on `/player` as buttons. Pressing one makes the GM's Foundry client roll for their character
  (same formula, DC and whisper as clicking the chat button) and marks the request done. Only the
  player's own requests are listed, and the page only gets a button id and its text.
- **Player page: a "You" section (David's ideas 1, 2 and 4):** a player who has opened their own `/me` link on the device sees, at the top of `/player`, "Your turn" or "You are up next" from the combat order, a small card for each of their characters (HP, conditions, concentration) with a link to the full sheet, and a concentration reminder (Constitution save, DC 10 or half the damage) when a character who is concentrating takes damage. The combat feed now carries the actor id of player characters only. Nothing is added for other players or for enemies.
- **Initiative ribbon (UI-07):** the Combat Tracker in the During view now has a ribbon above its rows: the creature up now large, the next two clear, the rest fading out, a Round marker where the order wraps, a Lair marker for a boss's lair action, HP bars and conditions (Concentrating first). It reads the same fight as the rows, writes nothing and has no motion with reduced motion on. The docs and the package README no longer list the Combat Tracker as old-dashboard-only.
- **Ask for a roll in one click:** the Party card has an "Ask for a roll" bar (check, save or skill, DC, private or public, advantage) with "Ask the whole party" and an "Ask roll" button on each member. The combat strip has the same bar with "Ask the party" and "Ask" plus the picked player character's name. The requests go through request-player-rolls, so they show on the player page and land in the play log. The last pick is remembered.
- **Simpler Damage / Heal:** the strip's Damage / Heal opens a small form with one amount field, a Damage or Heal toggle and damage type chips. One button, named for what it does ("Deal 8 fire damage to Goblin Archer and Ogre Brute in Foundry"), plans and applies in the same click, with Undo on the toast. Condition still opens the Tool runner.
- **Initiative ribbon: portraits and pan to token (UI-07):** each creature in the ribbon shows its
  token portrait (its initials when it has none or it does not load), and clicking it pans the GM's
  Foundry view to that token, switching scene first when needed. It only moves that GM's screen;
  nothing in the game changes. Portraits load from `DASHBOARD_FOUNDRY_URL` (the address your
  browser uses for Foundry); without it the ribbon shows initials.
- **Roll requests reach players at once, and the GM sees who has rolled:** a roll request sent from
  the dashboard is pushed over the player stream within a second (it used to wait for the 4 second
  poll and then the 8 second page refresh). The player page shows a banner naming the roll for each
  player it is for, also without the personal link (it still asks "Who are you?" first; the Roll
  button needs the link). The GM's roll bar shows the latest ask as "waiting for 2 of 4" with a
  line per player ("Brenna rolled 17"). The toast says "Sent" and a request has no Undo. The Player
  links card says each player pins their own link in Discord.
- **Tarokka card pickers show one deck:** in the Tool Runner, each card field of "Plan a Tarokka
  import" (tome, holy symbol, sunsword, ally, Strahd's location) lists only the deck that fits that
  position.
- **Who would notice (I-078):** a new read-only switch, "AI Tool: Who would notice" (off by default),
  adds a row to the Party drawer. Type a DC and every character shows a chip for passive Perception,
  Investigation and Insight, marked with a check or a cross. The scores are dnd5e's own, so
  conditions, advantage flags and exhaustion are already counted. GM only; `get-party` carries a
  new `passives` field per member, empty while the switch is off.

### Modules

- **Not Your Turn blocks players:** `scripts/modules/strahd-modules.json` records `BlockPlayer` and `BlockTrusted` as Autoblock (3) and `BlockAssistant` and `BlockGM` as Warning Only (1), so AI token moves are never blocked. The foundry-modules page says so. Applying it to the Pi world is a separate step.

### David's GM test fixes

- **Remove a condition:** when a remove finds nothing, the message lists the conditions the
  character has and says to name one, instead of only "no expired effects".
- **Advanced, Party and Handouts:** in a During layout that hides the card (Simple view has no
  Party), the menu now opens the drawer over the page instead of doing nothing.
- **Handouts drawer:** the empty queue says that only queued or revealed pages show and points to
  the Queue a page button; `create-quest-journal` results suggest queueing the new page.
- **GM guide:** the AI Tool group in Foundry's scene controls is the wand icon at the bottom of the
  left toolbar.

### Demo recorder

- **Maximum quality recordings:** the ffmpeg recorder captures at constant quality 10 with the
  slowest NVENC preset and no bitrate cap (4:4:4 on the gdigrab path), and `compose.mjs` encodes
  the final cuts with x264 at an average of 12 Mbps instead of NVENC at constant quality 21, which
  had left the GM videos near 4.7 Mbps (spec: 8 to 12).
- **Chapters without a title card:** a compose chapter with `"card": false` in the manifest goes into
  a cut with no title card (for an intro or outro shot), and `"clip": false` leaves it out of the
  per-chapter clip cuts.

### Setup

- **Claude Desktop connector updates in two scripts:** `scripts/desktop/build-connector.ps1` builds the
  connector from a git ref into its own `foundry-mcp-server-<sha>` folder next to the older ones (with a smoke
  check on the test port), and `scripts/desktop/repoint-connectors.ps1` points the five `foundry-mcp*` entries
  at it. The repoint shows a dry run first, backs the config up before it writes, can put the backup back, and
  never restarts Claude Desktop.

### D&D helper (I-152)

- **`get-level-up-options` (core, read-only):** for a character, and optionally one class, lists what the next class level grants (hit points, ability score improvement or feat, subclass, granted features, spell and cantrip counts, item and trait choices), which choices are still open, and any advancement from earlier levels that was never finished. Read from the class item's advancement data; it advises only and changes nothing.

### D&D helper (I-152; dnd-helper-skill)

- **D&D helper skill:** `npm run dnd-helper` builds `foundry-dnd-helper.zip`, a Claude skill for
  character creation (build card, Actor Studio steps, the ten level-1 snags as a checklist), sheet
  checks, level-up advice (advise only, the player clicks in Foundry), rules questions and a
  character plan note format. It works on the core connector and holds no book text. Project
  instructions for Claude Desktop are in `tools/dnd-helper/project-instructions.md`.

### Docs

- **Dashboard screenshots from the React page:** the pictures in the README and the dashboard
  reference (During with the initiative ribbon, the turn-order strip with Combat buttons on, the
  Tool Runner drawer, the destructive confirm window) and a new Before shot are retaken on Foundry 14;
  the join-page picture on the player docs shows the user list. The demo video is unchanged.
- **Docs sweep (docs-sweep):** README, `docs/gm`, `docs/player` and `docs/reference` checked against
  main. The GM guides now describe the home server (Orange Pi) setup, with the one-PC setup as the
  admin's own PC and Plan B. The dashboard guide covers Start combat and End combat, the Theme
  picker, After a paper night, the four `/me` views, handout order arrows and the player page's roll
  buttons; the Combat strip's Damage / Heal and Condition buttons are described as opening the Tool
  Runner for a confirm. The README and reference page no longer say "planned" for the Cloudflare
  route, list the ribbon and the real switch defaults, and `COGM-DASHBOARD.md` lost its em dashes.
  Player docs gain the roll buttons and the roll-request record.
- **Training world switch:** `docs/dev/PI-SETUP.md` now says who switches Foundry to the Frostmaiden
  training world (Claude, on the user's request, after a snapshot) and how (stage 11 with `LAUNCH`),
  and that Foundry goes back to `curse-of-strahd` after the call. A failed switch back leaves Foundry on the training world, so it is
  repeated until it works.
- **Death guide:** `docs/gm/death-and-new-characters.md` quotes the Live Feed line and the players'
  page line separately, for going down and for getting back up.
- **First hour and before-session pages:** "Your first hour as GM" now points at our own Foundry
  basics pages instead of Foundry's knowledge base (kept as a pointer for going deeper), and the
  before-session checklist has a line to check the GM windows are on.
- **Foundry UI reference:** the `foundry-core-ui` skill now says where Start Combat, Show Players
  (the three-dot menu in v14) and the scene navigation tabs really are.
- **Picture script:** `scripts/demo/foundry-basics.mjs` honours `DEMO_WORLD_ID` through
  `demoWorld()`.
- **Our own Foundry basics pages:** `docs/foundry/` explains Foundry itself for a new GM (screen
  tour, glossary, worlds and joining, users and permissions, scenes, actors, tokens, journals, chat
  and dice, combat, layers/walls/lighting, measuring and templates, compendiums, modules,
  playlists), written from the verified Foundry 14 UI and checked live. They replace the links to
  Foundry's own knowledge base, whose pictures predate Foundry 14.
- **Re-runnable pictures:** `npm run docs:foundry-images` (`scripts/demo/foundry-basics.mjs`) makes
  every screenshot and short MP4 loop in `docs/images/foundry/` from the demo world on a test
  server (`FOUNDRY_TEST_SERVER=B` picks server B; the demo scripts' `testEnv()` now honours it).
- **GM coach brought up to date:** the coach skill's page table now covers every GM and player page
  (dashboard, GM windows, feature switches, Asking Claude, runbook, TV viewer and more). It knows it
  cannot see the game, explains plan, confirm and undo, and gives the game night runbook first.
  The coach guide says what the coach can and cannot do and that a built zip is a copy from its
  build day.
- **The GM windows (guide for the GM):** a new page, `docs/gm/gm-windows.md`,
  with pictures: how to switch them on, where the buttons are and what each window is for. Listed
  in the GM guides index and in the feature list.
- **GM guide:** `docs/gm/gm-windows.md` gets a Loot section and new pictures.
- **Guides checked against main:** every GM and player guide on the wiki was read against the code
  and the Foundry 14 client. The player page section follows I-111 (live and between-session
  order, recap and quests boxes, enemy health words, Paper night view), the Obsidian pages name the
  quest import and the prep-note commands, the Features and Asking Claude pages list every switch,
  and the Settings path reads "Settings tab, Game Settings" as in Foundry 14. The after-session
  steps put Undo before End session, which switches the write switches off.
- **Guides design, part 2:** the dashboard's help panel now also shows the Foundry basics (`docs/foundry`, page keys `foundry-<name>`, "Open on the wiki" points into `/foundry/`; the Docker image copies the folder), and renders `:::note`, `:::tip` and `:::caution` blocks as callout boxes. On the wiki, a time at the end of a heading ("(15 minutes)") shows as a chip, the start page links First 15 minutes, and a link written inside inline code is left as an example.
- **GM guides, points from the first test with Danni and David:** the Features page says what "AI Tool"
  means (the module, the dashboard and the GM windows) and where all the switches are in Game
  Settings; the cookbook has "Start and end a fight" for Foundry and for the dashboard, with the
  note that the combat buttons need GM Actions; Troubleshooting has a row for a creature that always
  rolls with advantage or disadvantage under Automated Conditions 5e.
- **Help and wiki build checks:** the help builder fails when a gm page and a foundry page map to the same page key, and has a unit test for cross-folder links, broken links and callouts. Links inside double-backtick code spans are now left alone in the wiki staging, as in the help.
- **The wiki moves to Astro Starlight:** the public wiki is built with Astro Starlight instead of MkDocs Material (which is in maintenance mode). Same pages and the same `/gm/` and `/gm/<page>/` addresses; the links validator still fails the build on a broken link or anchor, and Python is gone from the wiki workflow. The pages are the "field guide" look (bone and wine palette, serif headings, a sidebar grouped as Start here, Game night, The tool, Your campaign, When it breaks, For players), with dark mode. `docs/foundry/` is added to the wiki stage, and a clip written as `![text](clip.mp4)` plays in the page.
- **UX review list (I-149):** `docs/dev/UX-REVIEW-LIST.md` is a short checklist for dashboard and player-page changes, named in the lane review step.
- **Player join guide:** the three missing pictures are in (the code page, the code email with the digits blurred, and the two windows that open on the first join), with a note that the two windows overlap.
- **Module reference skill (batch A):** `.claude/skills/foundry-modules/` holds one verified page per
  module (what it does, where its UI is, the settings we use, how it touches the AI Tool, Foundry 14
  and dnd5e 6 gotchas, a keep or drop verdict and a line for Danni's guides) for Actor Studio,
  ddb-importer, the Player's Handbook, Token Action HUD (core and 5e), Dice So Nice, Not Your Turn,
  Automated Conditions 5e, Monk's Player Settings, Tokenizer and tarokka-reading.
- **Quest pages for the GM:** three optional pages turn the longest checklists into stages with
  times and tick boxes: Quest: your first hour, Quest: prepare session 0 and Quest: before a
  session. Each source page has a "Do this as a quest" box that opens its quest page; the pages
  are in the wiki sidebar next to their parents and in the dashboard help.

### Module (I-134; gm-windows-g0)

- **GM windows, ready for G0:** turning the "GM windows" switch off now closes every open window
  (before, an open Combat window went blank and the others kept showing stale numbers; the Session
  window kept polling the bridge). The four windows open side by side instead of stacked on one
  spot. The switch is named and explained for all four windows ("AI Tool: GM windows (Combat,
  Party, Session, Scene)"); the Scene window says "Dusk, darkness 40%" instead of "Dusk (40%)"; a
  Session window says "The AI Tool is not connected right now" with a next step instead of
  "Is the Assistant GM browser running?"; a
  tag in a window column (Global light, Defeated, Hidden) keeps its own width.

### Module (I-134; gm-windows-loot)

- **A Loot window, behind the "GM windows" switch (off by default):** a fifth button in the AI Tool
  group opens what the party carries in treasure: per player character the coins (and what they come
  to in gold) and the items whose Loot Type is Art Object, Gemstone, Treasure or Trade Good, with a
  party total. Read from Foundry's own data on the GM client and redrawn when coins or items change;
  nothing goes through the bridge, so no new bridge handler or wire change. The switch is now called
  "AI Tool: GM windows" (the key `gmWindows` is unchanged) and its hint lists all five windows.

### Guides

- **First 15 minutes:** a new GM page, the one page to read first, with four small steps, what to
  ignore for now and where to go next. It is first in "Start here" on the wiki and linked first
  from the GM guides index.
- **Characters start at level 3:** the player guide "Make your character" now builds a level-1 character and levels it up twice to level 3 (subclass picked at the level-up), with the live snags found on the test server: the Level Up button needs Milestone Levelling or the XP, Take Average before Next, and the second Complete that adds the subclass. The D&D helper's project instructions, build card, sheet check, plan note and level-up page say level 3 too.

### Development

- **Local checks with many lanes:** `npm run green` takes the heavy-check lock once per run and
  keeps it to its last heavy step, instead of queueing again for every step (with ten lanes a
  5-minute green took 30 to 40 minutes). Waiters are served in arrival order; the merge gate's
  drift check and the pre-push hook go first. The slot count comes from
  `~/.foundry-ai-tool/heavy-lock.json` (`HEAVY_LOCK_SLOTS` still wins), read on every poll, so a
  change applies with no restart; a second or third run starts only while enough RAM is free.
  `node scripts/heavy-lock.mjs status` shows the settings, the holders and who waits.
- **Merges wait once:** the merge gate holds one high-priority slot for its whole drift check, so
  the guards inside no longer queue behind greens one by one. A slot left by a killed run is free
  again after 20 minutes without a beat (was an hour); a hold through `heavy-lock.mjs run` beats
  every minute.
- **No second check on push:** green records the tree it passed on, uncommitted edits included, and
  the pre-push hook skips its checks when every pushed commit has that tree.
- **Parallel greens and e2e:** two greens never run the dashboard e2e step at the same time (it
  shares a state folder), and green gives it a free port (`E2E_PORT`), so a run on the default
  port elsewhere cannot fail it.
- **Green timings:** each run writes `timings.json` (step times, lock wait) next to its logs, and
  two greens started in the same second no longer share one log folder.
- **Lanes pick the reviewer with the merge gate:** the `lane` skill now has lanes run the gate's
  `--dry-run` before the first review and use Opus whenever the gate says the PR is risky, so a
  Sonnet review on a risky PR is no longer wasted.

### MCP server (I-001)

- **`wait-for-game-event` (Play set):** Claude can wait for the next game event of a kind (combat
  turn, scene change, roll, damage, condition applied or removed and the other session event types; an unknown type is refused with the list of known ones) instead of polling
  `get-recent-events` in a loop. It returns as soon as the event pump logs a match, or empty after
  25 seconds (at most 45), and hands back a `latestTimestamp` to pass as `sinceTimestamp` so nothing
  between two calls is lost. It sleeps on the existing event pumps and never queries Foundry, so it
  adds no load; at most four waits run at once, and a wait ends when its connection closes.

### Obsidian (I-052 O5)

- **Keep a prep note from Claude:** the companion plugin gets "Toggle: Claude may read this prep note", which sets `ai_context` to false or true on the open prep note.
- **Prep notes stay private:** a test now checks that a note with `ai_context: false`, a mirror note, a sync-conflict copy and a prep template never reach what Claude reads.

### Obsidian (I-052 O6)

- **Quest import from Obsidian:** a quest note in your `Prep` folder (`type: quest-prep`, empty `fvtt_uuid`) becomes a GM-only quest journal in Foundry. In Obsidian run "Import this quest prep note into Foundry", then confirm the plan in the dashboard. It is off until you switch on "AI Tool: Obsidian import (writes)" in the module settings, and Undo removes the journal. It is not offered to Claude as a tool (the plugin starts it through the dashboard), so the tool sets and their sizes are unchanged. Planning writes nothing to Foundry; the journal lands in the top level of the Journal tab. Importing the same note twice is refused until you undo the first or delete the journal.

### Dashboard (I-098)

- **The dashboard's JavaScript is gzipped:** the hashed files under `/next/assets/` are sent
  compressed to a browser that accepts it (the first load drops from about 456 KB to 145 KB of
  JavaScript on the wire, compressed once per file and kept in memory). The event stream and
  everything else are untouched.
- **Smaller refreshes:** `/api/state` and the stylesheets of the old pages (`styles.css`, 56 KB
  here) go out gzipped to a browser that accepts it; the page headers of the player and `/open`
  pages are unchanged.
- **Lighter page load:** the pre-flight check that runs by itself when Foundry connects now waits
  two seconds, so the panels' own first reads get the bridge first. The dashboard also remembers
  the play stats and the scene list for five seconds (two windows or a quick reload share one
  bridge call); any change through the dashboard or new game event clears that memory, and Recent
  Changes, Handouts, the Prep digest and combat are never remembered.

### Module (I-106)

- **Advantage or disadvantage on rolls:** `request-player-rolls`, `request-ability-check`,
  `request-attack-roll` and `roll-npc-check` take an optional `advantage` (`advantage` or
  `disadvantage`). It goes into dnd5e's own roll, so it combines with the roller's conditions
  (advantage against a poisoned roller comes out normal). Left out, dnd5e decides as before. The
  request card names a chosen mode.
- **NPC rolls use dnd5e:** `roll-npc-check` now rolls through dnd5e, so an NPC's conditions (poisoned,
  prone) apply, and the reply carries `mode` (advantage, disadvantage or normal).

### Player page (I-111 follow-ups)

- **Quest titles:** a quest page named "Quest Details" now shows the quest's own title (read from the page heading) in the Quests card, so two quests no longer look the same.
- **Session post wording:** the Discord post at the end of a session says the recap shows up on the player page once it is written, instead of promising it is there already. `docs/dev/PI-SETUP.md` warns to post a link with `?token=` only in a players-only channel.

### Player page and Discord (I-111)

- **The player page follows the session:** during a session `/player` shows the combat order, the session feed and the handouts first; between sessions it leads with the last recap, the handouts and the quests the party knows. A link to your own character sheet sits at the top between sessions and at the bottom during one. The player state carries a new `session` flag (open or not, and when the last session ended) and nothing else of the session marker; the canary tests cover it.
- **Discord post when a session ends (off by default):** set `DISCORD_SESSION_POST_CHANNEL_ID` in the bot settings and the bot posts a link to the player page in that channel when a session ends. `FOUNDRY_AI_PLAYER_PAGE_URL` (required, the link players can open) says which link it posts; `FOUNDRY_AI_DASHBOARD_URL` (default `http://127.0.0.1:3100`) and `FOUNDRY_AI_PLAYER_TOKEN` say where and how it reads the session.

### Docs (I-116 follow-ups)

- **Make your character:** the player guide now names the Actor Studio workarounds found in the
  I-116 check: equip armour, shield and weapons on the Inventory tab (AC reads too low until you
  do), pick Amulet, Emblem or Reliquary for a holy symbol, press Enter in the spell browser, reset
  the spellcasting ability on a second Magic Initiate step, set Size to Medium, watch "Chosen x of
  y" before Next, and reload (F5) plus ask the GM to delete the half-made character when Actor
  Studio says it is busy.
- **Prepare session 0:** says plainly that the admin's script only sets who may create characters,
  equipment selection and the equipment pack. Spell selection and the other pack rows are the GM's
  to set, and the table now shows which is which.

### Rules check (I-126)

- **2014 vs 2024 differences:** `check-action` adds a short note, in our own words, when the action is one the two rule sets handle differently (Counterspell, Grapple, Shove, Hide), and says which rules the item or creature follows. It never changes the verdict. Still off until "AI Tool: Rules check" is switched on.

### Obsidian (I-139)

- **A start page for the GM vault:** the Campaign Home is now written in plain words and sorted by
  what the GM is doing (before, during and after a session, the campaign, the play log, rules
  lookups, help), with links and live tables to NPCs, scenes, quests, story items and session
  notes. It is still created once and never rewritten after an edit; an untouched older Home
  upgrades to it on the next export.
- **Player vault Home:** opens with a short "Start here" paragraph in plain words (character,
  recaps, handouts, session log); player-safe text only.

### NPC turn assistant (I-125; lows from the PR #456 review)

- **A creature's square costs one more, as in dnd5e:** a creature inside a core movement-cost region
  now adds a square on top of the region's cost (2x makes 3x); only dnd5e's own Difficult Terrain
  already counts as that square.
- **Creatures at another height are left out:** a creature outside the NPC's elevation band (one grid
  distance) neither blocks nor slows, and a token with no actor is no creature. The drawn map and the
  scene-data fallback now agree.
- **The plan note says the real rules:** "a creature of another disposition (neutral too) blocks
  unless ..."; "creatures do not block" when dnd5e movement automation is not full; and, when the map
  is drawn, that tokens selected in Foundry are ignored.

### Module (lows from the PR #455 review)

- **User-create check is stricter:** a created User may carry a `permissions` entry only when its
  value is exactly `false`, so Foundry's serialized operator objects cannot get through.

### Obsidian (lows from the PR #445 review)

- **Redo without a Recap page:** when an undone then redone notes journal comes back without its Recap
  page, the put is restored without queuing the Recap and the notes show an error naming the missing
  page, instead of dropping the put.

### Tooling (I-138)

- **MCP modern-client probe test:** a test starts the built stdio server and sends it what an MCP 2026-07-28 client would (`server/discover`, `tools/list` and `tools/call` with `_meta` and no `initialize`, `initialize` asking for the new version), next to the normal handshake. It checks nothing crashes or hangs and that `tools/list` keeps the same order on repeated calls. It pins what the connectors do today, so the later move to the new protocol starts from facts.

### MCP server (I-138)

- **MCP SDK 1.32.2:** the five connectors run on `@modelcontextprotocol/sdk` 1.32.2 (was 1.29.0 in the lockfile), and the range in `packages/mcp-server/package.json` is now `^1.32.2` instead of `^1.10.0`. No behaviour change for our tools; it keeps us on the v1 line's latest fixes until we move to the MCP 2026-07-28 protocol revision.

### Module guides (batch C)

- **Eleven module reference pages** under `.claude/skills/foundry-modules/references/`: Calendaria, Travel Pace, Share Media, 3DS:ATLAS, the Racooze map library and free battlemaps, Automated Animations, and the light pages for Sequencer, socketlib, libWrapper and the free JB2A set. Each says what the module does, where its UI is, the settings that matter, how it meets the AI Tool, the Foundry 14 gotchas and a keep or drop verdict.
- **Kit scenario `module-animations-calendar`** (full size): when the modules are on in a kit world, an attack roll with a target plays an Automated Animations effect, and moving world time fires Calendaria's day hooks without writing journals. It skips when the modules are off.

### Module notes (module-learn-e)

- **Batch E of the module reference:** Item Piles (with its dnd5e companion), Tidy 5e Sheets, Quick Insert, Find the Culprit, FXMaster, Token Magic FX, FX Bus, Theatre Inserts and Polyglot each have a page under `.claude/skills/foundry-modules/references/`, tried on test server B with a keep, optional or drop verdict for the GM. Findings that matter: Quick Insert lists hidden actor names to players unless "GMs only" is on, Item Piles pile actors show up in `list-characters`, Theatre lines reach our chat log with no speaker, and Polyglot keeps the real text readable to anything that republishes chat.

### Tooling (I-117; Backlog module-rehearsal-lows, ac5e-kit-scenario)

- **Module rehearsal fixes:** `run` on server A refuses to start the live steps unless you hold the lock, the report now lists the module errors the kit's `module-load` scenario saw (known and new), `archive` refuses a report whose package versions no longer match the server, `unpackZip` refuses a zip entry that climbs out with `../`, the round-trip test uses a real zip, and the expected-findings caps and the legacy-syntax match in the `modules-all` profile are tuned against a real run.
- **Kit scenario `module-ac5e-roll-mode`:** poisons a hero and a monster and compares the roll mode of `request-ability-check`, `request-attack-roll` and `roll-saving-throws` with the same creatures unpoisoned (full size, modules-all profile; skips without Automated Conditions 5e). Finding: `roll-saving-throws` gets disadvantage from the module (measured); the two request buttons post a plain `1d20` formula and, from reading the code, roll it outside dnd5e's hooks, so a poisoned player's button roll would have none (the scenario does not click the button).

### Tooling (I-117; D-128)

- **Module update rehearsal:** `node scripts/modules/rehearse.mjs` lists modules, dnd5e and Foundry with a newer version, stages and installs them on a stopped test server, runs the load check, the kit (new `modules-all` profile from the Strahd list), `live:roundtrip` and `live:sweep`, and writes a report with known upstream findings kept apart from new ones. Passing versions go into a PC archive (zip, manifest, sha256) with a pinned list; licensed packages are archived but never in the repo. See `docs/dev/MODULE-REHEARSAL.md`, which also has the Pi install-from-archive plan (not run).
- **Rehearsal install guards:** `install` also needs the test server's lock held by you (set `REHEARSE_LOCK_SESSION` to your session id; a lock held by another session, or none, refuses), `run` needs it on server A before the live steps, `archive` needs a passing kit step from the same server and refuses a report whose package versions no longer match the server, a zip entry that climbs out with `../` is refused before unpacking, the report lists the module errors the kit's `module-load` scenario saw, downloads must stay on https after redirects and are written to a `.part` file first, and an installed zip must carry the package id it was staged for.

### Module guides (index)

- **Index rows for the module reference pages** in `.claude/skills/foundry-modules/SKILL.md`: the four batch B pages (Combat Spell Timer, DAE, Monk's Combat Details, Monk's TokenBar) and the eleven batch C pages that the index was missing. Every page in `references/` now has one row, and every row points to a page.

### Session notes (notes-review-lows, notes-status-line-polish)

- **Summary not reused after a rewrite:** the session summary is cached together with a digest of
  the scene notes it was written for, so a manual re-run after a raw scene was fixed writes a new
  summary instead of keeping the old one.
- **Unfinished notes say so:** `transcript.*.md` and `scenes.*.md` start with a notice, and
  `notes.json` has `complete: false`, while scenes are raw or missing or the summary is not written.
- **The card's pill names the state:** with no staged notes the After card says Done, Paused or
  Incomplete (as well as Failed, Published and Waiting) instead of "Waiting" for those states.
- **One default sessions folder:** the dashboard's pipeline route and the recorder bot take
  `Documents/FoundrySessions` from `shared/src/sessions-dir.ts` (the bot keeps an identical copy,
  checked by a test) and `voice-stack.ps1` from one function.
- **Tests:** `cli.main` exit codes 75 and 76 with `status.json`, the fallback counter restarting
  when a scene changes, a pause plus a fallback in one run, `auto.ps1`'s lock and `-KeepFresh`
  (a smoke test that runs the script on Windows), the pipeline route (GM only, before `/:id`,
  the `sessionsDir` option) and one e2e case per pill.

### NPC turn assistant (I-125, npc-turn-lows; still off by default)

- **Walls on the NPC's level:** the wall check uses the level and elevation of the NPC's token, not
  the level the GM is looking at. Foundry's own collision test gets that level, and the scene-data
  fallback leaves out walls that belong to other levels.
- **Who blocks follows dnd5e:** a creature of another disposition (neutral too) blocks unless it is
  two sizes apart, Tiny (modern rules), dead or unconscious, a non-creature or a hidden token; none
  blocks when the dnd5e movement automation is not "full". Walking through a creature's square costs one square more (allies too under the
  legacy rules; not at all when the creature ignores difficult terrain). When the map is drawn the
  plan asks dnd5e's own `isOccupiedGridSpaceBlocking` and `isOccupiedGridSpaceDifficult`.
- **Dash:** a Dash takes the action, so `plan-npc-turn` refuses attacks after a Dash unless `reason`
  names a bonus-action Dash (then the attack steps say so).
- **Previews say the token is placed:** the `plan-npc-turn` move step and the `plan-token-change`
  move preview now say the token is placed, not walked, and that Foundry's ruler does not count it
  (in a started combat it still shows the full speed). `plan-token-change` also warns when a wall or
  closed door lies between the old and the new square.
- **Multiattack text:** `&Reference[condition=prone]` and `&Reference[prone apply=false]` show as
  "prone", and `&mdash;`, `&rsquo;`, `&hellip;` and the other common named entities are decoded.

### NPC turn assistant (I-125, npc-turn-more; still off by default)

- **Multiattack:** `plan-npc-turn` takes `attacks` (an item and a target each, up to 10). Every
  attack is checked for reach, and a melee attack with a wall or closed door in between is refused.
  The context shows the text of the monster's Multiattack feature, so Claude can see how many
  attacks it gets.
- **Walls, doors and difficult terrain:** the move is found with a path search instead of a
  straight count. Walls and closed doors block (Foundry's own check when the map is drawn, the
  scene's wall data otherwise), hostile creatures cannot be walked through (allies can), and
  movement-cost regions multiply the cost of the squares they cover. The plan returns the path and
  what it costs.
- **Smarter targets:** each enemy shows whether it is concentrating, prone or at 0 hit points, the
  cheapest square to attack it from this turn, and a score with the reasons (lowest hit points,
  concentrating, prone for melee or ranged, bloodied, out of reach). The context names the
  suggested target.
- **Review lows from PR #414:** diagonals follow the world's `gridDiagonals` setting (alternating,
  exact, 1.5 and 2 included); hex and gridless scenes are refused; squares past the scene edge or in
  the padding are refused, by the whole footprint of a large token; tokens on other Foundry 14
  levels are left out as blockers and targets; a combat on another scene is not used; a speed kept
  in other units than the scene (metres, miles) is converted, or refused when it cannot be;
  `dash: true` plans twice the speed; a weapon keeps its normal range when its activity holds the
  long range; a familiar is refused as player-owned, not as a player character.
- **A planned token move is a placement:** Foundry 14 stops an `x`/`y` update at the first wall,
  and dnd5e stops it at a hostile creature, so a move planned round a wall was refused ("Foundry
  did not keep x, y") when applied. Guarded writes of a token's position (or size, elevation,
  level) now place the token with one teleport (`displace`) step, also in a rollback and in undo:
  walls and movement cost do not apply (the token can end up behind a wall), and no trap, teleport
  or pause region along a straight line fires (undo cannot take those back). Teleport Token and
  Change Level regions ignore such a move. This applies to every guarded token move,
  `plan-token-change` included. Found live on test server C.
- **dnd5e Difficult Terrain:** the path search also counts dnd5e's own Difficult Terrain region
  behavior (Spike Growth, Web): one extra step of cost, not stacked, skipped for creatures that
  ignore it. Regions on another level of the scene are left out.
- **Smaller fixes:** Multiattack text also loses `&Reference[...]`, unlabelled `@UUID[...]` and HTML
  entities; a Dash lists its attacks as "only with a bonus-action Dash"; a newer server says so when
  the Foundry module is too old to check `attacks` or `dash`.
- **Tool budget:** the play tool set budget in `tool-catalog.test.ts` is raised by 1,000
  characters for the new fields.

### NPC turn assistant (I-125, part 3)

- **Save-based actions and activities:** `plan-npc-turn` lists every activity of an NPC's items (attack, save, utility, legendary) and takes `activity` on an attack. A save-based action names the save to roll with `roll-saving-throws`, its DC, and what a success does to the damage.
- **Legendary actions:** planned on another creature's turn only, within the legendary actions left (refused on the NPC's own turn, or when the cost is more than what is left); a move taken as a legendary action covers at most half the speed. `use-npc-activity` takes `activity`, uses the activity (spending its legendary actions) and rolls its damage.
- **Roll first, then one plan:** after rolling, call `plan-npc-turn` again with the move and `results` (the damage each target takes, with `multiplier` 0.5 for half on a save). One guarded plan holds the move and every hit point change, so one confirm covers the turn and one undo puts it back. Damage goes through dnd5e's own rules, so resistance counts.
- Test for the creature-square note when the NPC ignores difficult terrain (PR #461 review).

### Obsidian (I-052 O7)

- **Roll numbers in the player stats note:** the play log now records each roll's visibility
  (public, gm, blind or self). "My stats" shows a character's rolls, attack critical hits and
  misses, natural 20s and 1s and best roll, counting public rolls only. Blind, GM and self rolls, and rolls
  recorded before this change, are never counted.
- **Player vault: My stats:** each player vault gets a `My stats.md` note with the campaign so far
  (sessions, time played, fights, rounds) and the numbers of the player's own characters (damage
  taken, healing, times down, spells, slots, coins, experience). Built from `get-play-stats`
  through an allowlist, so GM-only data never reaches it: no unfiltered roll numbers (only public
  rolls count, see the roll stats entry), no damage dealt, loot names,
  scene names, user names or other players' characters. The spoiler canary now plants a value in
  every excluded field and fails on any file kind it does not know in a vault.

### Obsidian (I-052; encounter blocks)

- **Encounter blocks as suggestions:** an `encounter` block (Initiative Tracker syntax) in a
  prep note (encounter-prep first, a session plan too) now shows in the prep digest's `prep.encounters` as a read-only suggested
  encounter (name, creatures, counts). Nothing is written; `ai_context: false`, templates and the
  note's other text stay out.

### Obsidian (lane D follow-ups, structure audit 2026-10-29)

- **No loose journals, scenes or NPCs:** a note that sits in no adventure folder in Foundry is
  linked from `AI Tool/Foundry/Without an adventure.md`, which links the campaign home. An unedited
  one is trashed again when nothing is left to list. It is not an adventure hub (no graph colour,
  not in Home's Adventures table).
- **Everyone notes in the graph:** each day note under `AI Tool/Everyone/` links the campaign home,
  so the days are no longer orphans.
- **`AI Tool/_status.md`:** the line about the Foundry mirror status is plain text until
  `AI Tool/Foundry/_status.md` exists, so it is not a dead link when the mirror is off.
- **Plugin:** the commands **Hide the Library in the graph** and **Show the Library in the graph**
  (and two buttons in the settings) add or remove one search term in the graph options. Off by
  default; the GM's own colour groups and search text stay.

### Dashboard (Paper nights B; paper-form)

- **After a paper night:** a new drawer in the dashboard (Advanced menu, and a card in After) for
  syncing the paper sheets back into Foundry. One card per player character, filled in from the
  sheet in Foundry; type what the player reads from the paper sheet (HP and temp HP, spell slots,
  hit dice, class resources and item uses, coins, exhaustion, conditions, inspiration, death
  saves, inventory quantities, and new items from the compendium picker). **Plan** builds one
  guarded `plan-paper-sync` plan for that character from the fields that changed; the confirm
  window lists what changes (removing an item asks for the second confirm), Apply writes it, and
  Recent Changes holds one Undo per character. A "Which night was this?" date can log the night as
  a paper session. Needs GM Actions and the "AI Tool: Paper sync (writes)" switch.

### Paper nights (paper-log)

- **Paper sessions in the play log:** `mark-play-session` takes `mode: "paper"` for a night played
  on paper, and with `date` (and `time`) marks a night after the fact. It works with Foundry
  closed, using the last world this bridge saw. `synced: true` marks a paper night as done.
- **Stats keep paper syncs out of the play numbers:** changes made by `plan-paper-sync` no longer
  count as damage, healing, slots or loot. A paper night shows a "Paper night: net change" block
  (per character: HP lost and regained, slots, resources, coins, XP, items gained and lost), in
  `get-play-stats`, the session note and the campaign stats; a late sync no longer opens a
  session of its own.
- **Recap and pre-flight:** the `session-recap` prompt handles a paper session (story from the
  session notes, sheet changes from the net block, no invented dice). The pre-flight play-session
  line warns about a paper night with no paper sync yet.

### MCP prompts (paper-photos)

- **Sync from sheet photos:** a new prompt, `paper-sync-photos` (play set), for a night played on
  paper. Attach a photo of each sheet and Claude reads the numbers, compares them with the
  character in Foundry, makes one `plan-paper-sync` plan per character and shows each plan with
  the sheet value next to the Foundry value. Every reading it was unsure of or could not read is
  marked CHECK and listed together before anything is applied. Plans are applied only after your
  yes and can be undone. It never changes XP, level, class or maximum hit points.

### Dashboard (paper-print)

- **Paper night print:** a fourth view on `/me`, "Paper night", is a sheet for a table that plays on
  paper. Each block shows the value as it was when the sheet was printed and a box to write the new
  one in: HP and temp HP, spell and pact slots, hit dice per class, class resources and item uses,
  coins, exhaustion, conditions, inspiration, death saves, and the inventory with a quantity column
  and empty lines. A carry-over strip at the end lists what gets read out when the night is synced.
  No XP. The other three views and their print are unchanged.
- **Print all party sheets:** a GM-only button in the Player links panel opens
  `/party-print.html`, every player character's paper-night sheet, two pages each, from the new
  GM-only route `GET /api/party-sheets`. Players still see only their own sheets.

### Paper nights (Paper nights A)

- **Sync a paper sheet back into Foundry:** the new Play tool `plan-paper-sync` takes the numbers on
  one paper character sheet and plans them as one change for that character, with the usual confirm
  and Undo. It covers hit points and temp HP, spell and pact slots, hit dice per class, class
  resources and item uses, the five coins, exhaustion, the exact set of conditions, inspiration,
  death saves (reset) and item quantities (a quantity of 0 removes the item and asks for the second
  confirm; a compendium uuid adds one). Every value is what the sheet says now, only changed fields
  become part of the plan, and a value above its maximum refuses the whole request. XP, level, class
  and max HP are never changed. It ships off: turn on "AI Tool: Paper sync (writes)" in Foundry's
  module settings. It never applies without confirming.

### Pi (PR #554 review lows and the first live run)

- **Stage 17 registers from the runner folder:** the first live run failed with `ldd: ./bin/libcoreclr.so: No such file or directory` because GitHub's `config.sh` checks its libraries relative to the current folder and the stage started it from the ssh login folder. It now starts inside the runner folder (`env -C`). A new ARM64 container scenario (`stage17-scenarios.sh`) runs the registration command from a folder the runner user cannot enter, and fails on the old script.
- **Stage 17 refuses nameservers that would open the Pi to the runner:** a nameserver in `/etc/resolv.conf` in `127.0.0.0/8` (a local resolver such as 127.0.0.53, which would have opened loopback), in `100.64.0.0/10` (Tailscale, which would have opened the Pi's Tailscale side) or at one of the Pi's own addresses (which would have opened the Pi itself) is no longer put on the runner's allow list. The stage stops before writing anything and names the address.
- **PI-SETUP, stage 17:** says that IPv6 is denied as a whole, that the `/etc/resolv.conf` nameservers are allowed along with the router, and that when the fence probe still connects the stage turns the gate timer off and stops (a failing control probe only stops the stage).

### Pi (stage 17, second live failure)

- **Stage 17 installs libicu when it is missing:** the second live run got past the folder fix and then failed to register because the Pi has no libicu, which GitHub's `config.sh` needs even with invariant globalization. The stage now installs the newest `libicuNN` package apt knows (`libicu72` on Debian 12) only when no libicu is in the library cache, says so, and removes nothing.
- **Stage 17 shows why registering failed:** `config.sh` reports on stdout, which the stage sent to `/dev/null`, so the error blamed an old token. The last lines of its output are now printed on failure, minus any line that could hold the token. The ARM64 container scenario now starts without ICU and fails on the old script.

### Orange Pi stage scripts (pi-stage-safety-2; follow-ups from PR #432)

- **Stage 3 puts the old Foundry back:** if it fails after stopping Foundry (the swap, or a new program that does
  not start), it restores `/opt/foundry.prev`, starts Foundry again and keeps the zip, so a failed run never leaves
  the Pi without a Foundry. Stage 2 puts the old Node back if the second rename fails.
- **The Assistant GM (and the Kit GM) is subtracted only once it has joined:** `require_quiet` looks for the
  browser's "joined world" line in the unit's current systemd run, so a browser that runs but has no world no longer
  hides a real player.
- **Token scripts check first:** `set-tunnel-token.sh`, `set-dashboard-access.sh` and `set-discord-token.sh` refuse,
  before asking for anything, while players are online or a recording runs. `FORCE=1` goes on;
  `set-discord-token.ps1 -Force` passes it through. The first two now need `lib.sh` copied next to them
  (Remote access, steps 8 and 10).
- **The nightly 04:30 backup waits for the players:** while anyone is online it does not stop Foundry, looks again
  every 30 minutes (six times), then skips the night with an ERROR line, but never two nights in a row (a tab left
  open all night cannot stop the backup for good). An unreadable status is looked at three times before it backs up.
  The unit's timeout is now 5 hours.
- **Tests:** failing-`mv` tests for stages 2 and 3, the nightly backup, the three token scripts and the ps1.
  `7-vault.sh` loses two unused variables.

### Pi setup (stage 14, system trial)

- **A new dnd5e version runs on the kit world first:** stage 14 (`14-system-trial.sh`) installs a pinned
  dnd5e release (the first is 6.0.6; the download must match its sha256 and fit the Pi's Foundry) and
  launches only `strahd-kit` on it, after keeping the old version and a copy of every world. `MODE=switch`
  then moves the campaign to the new version; `MODE=rollback` puts the old version back and resets
  `strahd-kit` from the copy. A world launched during the trial is not reset unless `RESTORE_MIGRATED=1`,
  and a rollback that stops halfway finishes on a second run. `MODE=status` shows where a trial stands.
  Nothing runs with people online (`FORCE=1` overrides), and a failed run puts back what ran before it.
  The trial and the switch wait for dnd5e's data migration in the Assistant GM browser when the new version
  asks for one, and a failed run launches a world again only on the version that world runs on. The copies'
  bytes are checked against the free space first, one run goes at a time, and every run is logged.
- **No other stage launches a world during a trial:** stages 5-check-world, 11 and 13 refuse to run while a
  trial is open, and stage 5's check world no longer replaces an installed dnd5e (a rerun after a switch used
  to put 6.0.5 back under migrated worlds).
- **The test kit runs during a trial:** `kit-session.sh MODE=up` accepts `strahd-kit` as the launched world
  while a dnd5e trial is open and puts Foundry back on it with `MODE=down`; with any other original world
  `MODE=down` is refused during a trial. Stage 14 refuses every mode but `status` while a kit session is up.
  A failed trial or switch now stops Foundry and the Assistant GM browser before it moves any world folder,
  and stage 3's `FOUNDRY_EXPECT_VERSION` also checks the installed program when no zip is given.
- **The Assistant GM driver declares its features:** `assistant-gm.mjs` has a
  `// assistant-gm features: extra-gm` line, and stage 11 checks that line instead of looking for an
  environment variable's name anywhere in the file (a comment no longer counts). A driver installed before
  this change is refused when an extra GM is involved: run stage 5 again first.

### Player page

- **"New" handouts through a session:** while a session is open, a handout counts as new from the previous session's end, so what the GM revealed during prep still shows New when the table sits down. The session marker is read once a minute instead of every 5 seconds.
- **Time of day only on sunlit scenes:** the "Daylight / Dusk / Night" label shows only on scenes with global illumination on, so a crypt kept dark by design no longer says "Deep night". Weather is unchanged.
- **Roll button fixes:** pressing Roll on the page no longer rolls twice when the card could not be marked afterwards (the button is held back until the GM client restarts), and a Foundry click on a card already rolled from the page does nothing. Requests made before the DC was stored now use the DC printed on the card. With writes switched off the page says rolling is switched off instead of quoting a module setting.

### Module (PR #445 follow-up lows)

- **User writes are narrower:** a guarded write that creates a User is refused when its `permissions` hold a true override, and a guarded `update` of a User is refused when it touches `role`, `permissions`, `password` or `passwordSalt`. The Table user's undo and redo still work.
- **The TV's Table user is not a player in the play log:** its join and leave records carry `tableViewer`, take no scene snapshot, and the Obsidian "Seen in" index and `get-play-stats` skip them, so a TV left on during prep no longer marks scenes and NPCs as seen.
- **TV start script:** the join address match is case-sensitive like the check in the page, and `https://host//join` gives no prefix.

### NPC turn assistant (I-125; PR #460 lows)

- **Honest creature-square note:** the `plan-npc-turn` note says a creature's square costs one
  square more only when it does; with dnd5e movement automation off, or an NPC that ignores
  difficult terrain, it says the square costs nothing extra.
- **Recap-missing hint:** the Recap-missing error on a redone notes put now says how to recover
  (undo the put and put the notes again).

### Tools

- **request-player-rolls takes a DC:** an optional `dc` the card shows and the roll is judged against, as request-ability-check already did for checks.

### Tooling (D-127; review-runner)

- **Review runner on the API credit:** `node scripts/review-runner/run.mjs <PR>...` reviews pull
  requests with the Claude Agent SDK on a separate API key (`REVIEW_RUNNER_API_KEY`), writes the
  review note in the merge gate's format to the vault, commits it, logs each review's cost and stops
  at $95 in total. `--dry-run` shows the plan and spends nothing. The `lane` skill carries the
  hybrid review rules: one round plus one delta check, a third round needs the planner, low-risk
  PRs are reviewed in batches.

### Process (I-143)

- **Reviewer subagents:** three read-only Opus review agents in `.claude/agents/` (`review-guarded-writes`, `review-wire-contracts`, `review-pi-ci`), each with a narrow checklist from CLAUDE.md, D-101 and past review notes, and the review note format the merge gate reads.

### Orange Pi

- **Initiative ribbon portraits on the Pi and in Plan B:** stage 7 takes `DASHBOARD_FOUNDRY_URL`
  (for example `https://play.<domain>`), validates it, keeps it on later runs and writes it to the
  dashboard's settings; Plan B passes its local Foundry address. Without it the ribbon shows
  initials. The remote-access guide explains why no image proxy is needed behind Cloudflare Access.

### Rules check (I-126; second PR)

- **Spent actions:** with the `rules-check` switch on, `check-action` (and the pre-check in front of use-item and attack requests) now warns when the creature has already used its action, bonus action or reaction this turn. The module keeps a short ledger of the activities used through Foundry and counts them from the start of the creature's own turn, so a reaction stays spent until its next turn. A second weapon attack is treated as Extra Attack, not a second action.
- **Stated limit:** only what was used through Foundry is seen. Dash, Dodge, Help, hand-rolled attacks and extra actions (Action Surge, haste) are not, and the report says so.
- **2014 and 2024:** the report adds a rules-version line and warns when an item follows different rules from the creature using it.
- **Fixes:** two same-named combatants are now reported as "cannot tell whose turn" instead of picking the first; the `check-action` description mentions concentration and spent actions again.
- **Module:** new read-only bridge query `getSpentActions`.

### Rules check

- **Advice before you act:** with "AI Tool: Rules check" on, `use-item`, `request-attack-roll` (when the player name is a character and the weapon is one of its items) and a token move in `plan-token-change` now add the rules check to their reply (turn, cost, range, slots, uses). It only advises: nothing is refused or delayed, and with the switch off or on any error the reply is unchanged.
- **Movement check:** a planned move in a fight is compared with the creature's walking speed (or best other speed): within speed passes, up to twice the speed needs the Dash action, beyond that is flagged. Distance is a straight line, so route, difficult terrain and movement already used this turn are not counted.
- **Concentration:** `check-action` warns when a concentration spell would end the concentration the caster already holds, and says which spell.

### Rules search (I-152)

- **The DMG 2024 is searched by default:** it lives in the `aitool-content` "Books" pack, which
  `search-rules` now reads with the other rules packs. `includeWorld` is only for the imported
  adventure text, and the empty-result note says so.
- **Faster after the cache expires:** a stale index answers at once and one rebuild runs in the
  background, so a search no longer waits for a whole pack (the dashboard gave up after 15 s).
- **Fewer wrong matches:** "cone" no longer finds "Con", "uses" no longer finds "us", and "ally"
  finds "allies". Encoded `&lt;` and `&gt;` in rules text read as ‹ and › instead of a space.
- **Settings hint** names the real default packs.

### Tools (I-152)

- **`search-rules` (core, read-only):** full-text search of rulebook journal pages and item, spell and feature descriptions, limited to an allowlist of packages (setting "Rules search packs"; default the Player's Handbook module, `aitool-content` and the dnd5e SRD). World journals and other packs are searched only when asked. Returns the page or item id with a short snippet; the full text comes from `get-compendium-item` or `list-journals`. The `rules-question` prompt now starts with it.

### Voice (Backlog: danish-transcription-tuning, pipeline-vocab-productnames)

- **Transcription default is now large-v3:** on six slices of the David GM test recording (Danish with
  English game words) it spells Danish better than large-v3-turbo (judged by agreement and by reading, there is no reference text) and runs at 0.06 of real
  time, so a 3 hour session takes about 11 minutes. Language stays `da`; the results table is in
  `tools/voice-stack/README.md`.
- **Hotwords are off by default:** `voice-stack.ps1 transcribe` passes `names.txt` to Whisper only with
  `-Hotwords` (a short list did not clearly win). `names.txt` still feeds the pipeline's name fixes.
- **Names the recogniser gets wrong are fixed after transcription:** the session pipeline ships rules
  for KGM to co-GM, Strut to Strahd, Danny to Danni and Poundry to Foundry (`--no-product-rules` turns
  them off, a session `rules.json` wins). Host names such as `kgm.example.com` are left alone.

### Tarokka

- **Clear a reading:** `plan-tarokka-import` takes `clear: true` to remove the current reading. It is
  archived, not deleted, and Undo restores it, so a reading can be reset before a session.

### Tarokka (tarokka-gm-choice)

- **A reading the GM chooses:** `plan-tarokka-import` takes the five cards the GM picked (arguments
  `tome`, `holySymbol`, `sunsword`, `ally`, `strahdLocation`) and stores them as the current
  reading with no draw and without the tarokka-reading module. The Tarokka drawer has a **Choose the
  cards…** form for it (open while **Show cards** is ticked). Cards are checked against their deck
  and cannot repeat; the previous reading is archived and the change can be undone. Reveals already
  go one position at a time.

### Tarokka (I-101)

- **Link suggestions find NPCs in page headings:** `suggest-tarokka-links` also matches headings inside journal pages and returns the page with `heading` and `anchor`, so an NPC that only exists as a heading can be found.

### Tarokka (tarokka-table; D-130 step 2)

- **A Tarokka card table in Foundry:** the AI Tool group in the scene controls has a **Tarokka
  table** button (GM only). Place the five cards face down one at a time, flip them one at a time,
  and **Show to players** opens the table on every player's screen: they see the backs of placed
  cards and the faces of flipped ones, never the position names, the notes or a card that is not
  flipped. Cards are drawn in CSS; a card can get a picture from the world's files. A flip is a
  normal Tarokka reveal, so the dashboard drawer and the player page follow it. This replaces the
  community module `tarokka-reading`.
- **No more `tarokka-reading` import:** `plan-tarokka-import` no longer takes `source:
"tarokka-reading"` or `userId`, the dashboard drawer lost its **Import from tarokka-reading**
  button, and the "Offer this reading to the AI Tool?" dialog is gone. Roll a reading or choose the
  five cards. Readings stored earlier from the module still open. Update the backend and the
  module together: the module no longer answers the old `getTarokkaReading` query, so an older
  backend rolling with `plan-tarokka-import {}` would fail against it.

### Test servers

- **Safer test server setup (PR #435 review lows):** `config.ps1` refuses a server Root that is, or
  sits inside, another server's Root (they would share data and one lock). The start-of-session
  alerts hook now reads server C's lock like B's ("Test server C lock"). The forbidden-port lists
  of the voice stack, the LiveKit proof of concept and the Pi rebuild drill include test servers B
  and C, a test checks that Plan B and those lists cover every port in `servers.json`, and the
  `local.json` example names `local.B.json` / `local.C.json` with a free port.

### Dashboard (I-127)

- **Version tracker on by default:** the module version tracker shows in the dashboard header without
  switching it on first. A stored prefs file without the setting reads as on; turning it off still
  sticks.

### Demo video

- **Slower pace (video-voice):** `demo:compose` keeps the screen still for `HOLD_AFTER` (2 s) after a click, so a viewer can see its result before the next step starts. With narration at about 150 spoken words a minute the GM videos run about 2:45 and 4:00 (Danish) and 2:50 and 4:15 (English).

## v0.22.0 (released 2026-10-20): undo for everything, scene mood and restore, the NPC turn assistant, remote access, the pruned Pi build that follows release tags, Obsidian and test kit work

**Unchanged:** the module id, the socket channel, the `foundry-mcp-bridge.*` method prefix, the settings
namespace and the WebSocket port 31415. **Removed:** the WebRTC path (port 31416, test 31516, and the
`FOUNDRY_CONNECTION_TYPE`, `FOUNDRY_STUN_SERVERS` and `FOUNDRY_WEBRTC_PORT` settings; the module's
"Connection Type" setting). **Added:** new bridge queries (`planSceneMood`, `getSceneMoods` and others listed
below), `module-request` and `module-reply` messages and a capabilities list in the bridge's handshake, new
tools (the bridge serves 93) and new feature switches: scene mood and the NPC turn assistant ship off, the
table viewer and undo for everything ship on. Update the module and the bridge together. The Orange Pi builds
the newest release tag, not `main` (D-126).

### Docs (campaign plan, D-126)

- **Campaign plan moved out of the public repo:** the Curse of Strahd plan now lives in the private vault, and links to it in the docs and code comments point to a note saying so. Test fixtures use neutral names. Older commits still hold the file.

### Development (tool call log)

- **Tool call log (D-126, I-113):** every MCP tool call writes one line (time, tool, tool set, ms, result size, ok or error, no arguments) to `<data folder>/_usage/<date>.calls.jsonl`. `npm run usage:calls` counts calls per tool and set, errors, slowest calls and the tools never called, so the tool sets can be trimmed on data. `FOUNDRY_AI_USAGE_LOG=off` turns it off.

### Dashboard

- **"Co-GM" is retired as a visible name:** the AI panel is "AI commentary" (its button, settings
  label, close button and ask box say AI), its whispers to the GM start with "🧠 AI:", and the
  page titles, messages, setting hints, vault note texts and docs say "the dashboard". Internal
  names stay (`cogm-dashboard`, `cogm_*` keys, `COGM_*` variables). The dashboard's own name is
  still open.
- **"co-GM" follow-ups (#136):** the README banner's tagline and alt text say "a real-time
  dashboard for the GM" instead of "co-GM dashboard" (the tagline redrawn in the brand's
  JetBrains Mono, the rest of the image unchanged, and the em dash gone). The AI commentary's
  persona no longer calls itself "Co-GM": it is the AI behind the dashboard's "AI commentary"
  panel, so its replies match the panel name and the "🧠 AI:" whispers.
- **React page loads faster:** Tools, Tarokka, Prep, Party, Handouts, Player links and Module
  diagnostics load from their own chunks, so the first load is 140.2 KB gzip instead of 150.5 KB.
  The three that sit in a view download right after the page draws, the others when the browser is
  idle; a failed download shows a toast instead of a blank page. The bundle budget lists each chunk.
- **Layout trial and the session:** if the session opens or closes while the old page's layout trial
  is running, Stop or Escape no longer puts back the tab the GM had pinned before the trial.
- **A GM behind Cloudflare Access stays on the GM page when the sign-in cannot be checked:** when the
  dashboard cannot verify the Access token it was sent (the keys did not load, they rotated, or
  GM_EMAILS is set without the CF_ACCESS settings), `/api/state` marks the answer and both GM pages
  stay put instead of sending the browser to the player view. A reload heals a rotated key; a missing setting still needs the fix, and the page says so (#346 follow-up).
- **The GM pages say why they are empty on a stale GM link:** one line under the header, "This
  browser's GM link is not accepted any more. Open the GM link again." (the old and the new page).
- **Help links to the wiki (D-108):** the help side panel has an "Open this page on the wiki"
  link that opens the same guide page, at the same heading, on the wiki. The module settings Help
  button already opened the GM guides there. The GM guide's Help section says so.
- **Lighter danger text:** one new colour, `--bad-text` (the danger red mixed toward the text colour, as the Enemy tag already did), is used for red text on its own tint on both dashboards: the Damage and Death chip, the module error badge, death saves, Destructive tags, the Not ready line and the Pre-flight button. They now pass the contrast check, and their entries are gone from the known-violation lists.
- **Keyboard and screen reader fixes (React dashboard):** the change list in the confirm window and the Module Diagnostics list can be scrolled with the keyboard, and an empty picker no longer announces an empty listbox.
- **Old dashboard:** Stop (or Escape) on the layout trial now gives the page back and returns to where the trial started, instead of pinning it to During. Use and picking a layout still keep you on During.
- **Short GM tokens refused off loopback:** when `DASHBOARD_HOST` is not a loopback address, the
  dashboard refuses to start unless `GM_DASHBOARD_TOKEN` is at least 32 characters (the error
  gives the length, never the token). Loopback setups and the Pi's token (24 random bytes, 32
  characters) are unchanged. A Docker or other off-loopback setup with a shorter token must replace
  it before upgrading (`openssl rand -hex 32` gives 64 characters).
- **Header focus:** after a theme pick or a GM Actions click in the new dashboard, the keyboard
  focus stays on the control once the save settles (it used to fall back to the page start).
- **Links inside a guide work in the new dashboard's help panel:** a link to another guide page
  (for example "Getting started" in the guide index) opens that page in the same panel, and the
  "Open this page on the wiki" link follows to the new page. Before, those links did nothing.
- **The guide says where the wiki link is:** "Open this page on the wiki" is in the help panel of
  the new dashboard only for now, and the dashboard guide now says so.
- **Help panel on a phone:** the "Open this page on the wiki" link has its own line under the title,
  so a long guide title no longer wraps into five lines. A link to a heading scrolls to it every
  time you press it, not only the first time.
- **Recent Changes, Everyone tab (I-109):** Recent Changes has an **AI** tab (the list as before)
  and an **Everyone** tab with the last 7 days of changes by players, the GM and the AI, with a
  person filter, the lines of each change, an "Undone by ..." badge, **Undo** and **Redo**. Undo
  shows what it will put back and asks first. When a later change touched the same thing it asks
  **Just this** or **Everything since**; **Advanced** has **Rewind the whole table to here**, which
  shows the count and asks twice. The tab is hidden when the bridge is too old to have
  `list-changes`.
- **`/api/state` carries the GM's screen choices:** the GM role's state now has `prefs` (null
  until the world is known), the same as the stream's `prefs` event.
- **Panels that load late (React dashboard):** after a panel failed to load, clicking its button
  again now opens the drawer with the error and a hint to reload, instead of a dimmed page with
  nothing on it. Escape closes the drawer that shows while a panel is still loading. A docked
  panel that has the focus keeps it when the real panel replaces it. (Backlog: lazy-panel-lows-2;
  #356 review L1, L2)
- **Panels that load late:** a drawer opened before its download finished (Tarokka, Tool runner,
  Prep, Party, Handouts) shows an empty loading drawer instead of a dimmed page with nothing under
  it, and a docked panel's slot no longer jumps when it arrives. If the download fails, the drawer
  and its backdrop close along with the toast.
- **New dashboard, Live Feed:** once the feed holds 120 events, the head says how many are on
  screen, for example "120 of 340 events". An event from another day shows a short date before its
  time ("Oct 9, 8:00:00 PM").
- **New dashboard, lost connection:** when the page loses its live link to the dashboard server for
  more than a few seconds, the header says "Connection lost, reconnecting…" once for every panel,
  and it goes away when the link is back. If the browser gives up on the link, the header says to
  reload the page.
- **The session-notes card shows how the last notes pass ended:** "Last notes pass: ..." (done,
  paused, incomplete, failed, waiting or published), read from the newest session folder's
  `notes/status.json` in `FVTT_SESSIONS_DIR`. It shows even when no notes are staged yet, so a
  failed or paused pass is visible. GM only.
- **The GM token leaves the address bar:** after the GM page saves `?token=` in the browser it
  removes it from the address with `history.replaceState` (other parameters and the hash stay),
  so the token does not stay in the browser history.
- **Recent Changes on the new dashboard:** the list of changes with Undo is now on the new
  dashboard (`/next/`), in the During and After views. The AI tab shows the AI's guarded changes
  and the Everyone tab (when the bridge has `list-changes`) shows everyone's, with a person filter
  and Redo. Undo works as on the full dashboard: the AI tab asks in the confirm window, the
  Everyone tab plans the undo and asks (just this, everything since, or the advanced rewind), and
  a reveal is undone with the plain undo after its own confirm. The list reloads when a change
  lands, also one made in Foundry (the `gm-change` event). It is a fold card in During and loads
  as its own chunk.
- **GM Actions switch in the new dashboard's header:** the "⚔ GM Actions: on / off" button of the old
  page. A click flips the master switch on the server and every open dashboard follows; if the
  server does not answer, a toast says why and the switch stays as it was. (Backlog: ports-header;
  React dashboard port)
- **Play session marker in the new dashboard's header:** the status ("No session", "Session since
  19:30"), a Start / End session button and, with the Obsidian mirror on, a link to the campaign
  Home note, as on the old page. It writes only to the session log, never to the game. (Backlog:
  ports-header; React dashboard port)
- **Theme picker in the new dashboard's header:** the old page's Theme select (Neutral or The Veil)
  for the look of this world, which the players' page follows. A pick is saved on the server and
  the page changes look when the server answers; a theme another dashboard page chose now arrives
  on the live stream and moves the picker too. If the save fails, a toast says why and the picker
  goes back. The Mist choice stays on the old page for now. (Backlog: ports-header; React
  dashboard port)
- **After in the new dashboard:** the After view at `/next/` now has what the full dashboard's After has: Tonight's stats (rolls, most damage, highest roll, who went down, the session line, Copy the stats for Discord, Open the session note in Obsidian, Refresh) and the Session notes card (Read in a side pane, Put in Foundry, Approve without revealing, Undo, About the switch). Nothing loads until After is on screen. This is part 2 of making the new dashboard the default (D-126).
- **The combat strip in the new dashboard:** the turn order is in the During view's strip slot, as
  in the full dashboard. It has one row per combatant in the order Foundry sends them, with the
  initiative, name, PC, Enemy or NPC tag, conditions, death saves and hit points with a bar. It
  shows while a fight runs (and in Full), and the layouts place it as before. The layout trial's
  Auto step shows its sample fight there too.
- **Damage, Heal and Condition from the strip:** with Combat buttons and GM Actions on, click
  combatants to pick them and use Damage / Heal or Condition. Each opens the Tool runner on
  `plan-actor-change` with the picked names filled in. Nothing is changed from the strip itself:
  you press Run there and confirm as for any guarded change. The full dashboard applies a
  one-click change straight away; the new one asks first.
- **Boss prompts fixed:** the reaction button (R) now shows only on a boss that is still standing
  (one with legendary actions or a lair), and only while Boss prompts is on. The Boss prompts
  switch shows whenever it is on or a boss is in the fight, so it can always be turned off. In the
  full dashboard a switch left on gave every combatant an R button in later fights, with no way
  to turn it off.
- **A fight is marked old when the bridge is away:** the strip keeps the rows and says "The bridge
  is away: this is the fight as last seen." The rows are dimmed and the action bar and R buttons
  are switched off until the bridge is back.
- **Conditions show in every layout:** the full dashboard hides the condition chips in the strip
  except in Auto during a fight. The new dashboard shows them in Cards and Simple/Full too.
- **Keyboard and screen readers:** rows can be picked with Tab and Enter or Space, and say whether
  they are picked. Each R button has a name ("Reaction ready: Name" or "Reaction used: Name") and
  a state, and ticking it no longer moves the keyboard focus. The hit point bar and death saves
  are also written out in words. A fight with nobody in it says so.
- **React dashboard: focus after the confirm window:** the confirm window now remembers the button
  that started the change before the panel disables it, so on close focus goes to that button, or
  to its drawer while the change still runs and back to the button once it is enabled again. This
  covers Party as well as Handouts; before, Party left focus on the page body. Reveal next in
  Handouts stays disabled until the queue has reloaded, so it never offers the page just revealed.
- **The React dashboard gets Module diagnostics and Help (D-109):** the new page at `/next/`
  shows the Foundry module errors and warnings from the live stream (with the overdue space-check
  note) and opens the GM guides in a Help pane, with a "?" on each panel heading. One live stream
  connection feeds every panel. Playwright covers both panels, and a server test checks that the
  player-links routes answer 401 when a player token is set and the caller has none.
- **React dashboard: #271 and #272 review follow-ups:** a drawer that is already open comes to the
  top again when it is asked for (the GM Actions gate's Pre-flight, the Tool runner's own gate),
  and Escape now always closes the drawer on top, not the one opened last. After Hide cards the
  Pre-flight row keeps the keyboard focus. A Tool runner Undo that GM Actions refuse focuses the
  Enable GM Actions button whether the drawer was open, under another drawer or closed. When the
  server refuses a change because GM Actions are off, the page shows them off at once instead of
  waiting for the stream. The Tool runner's form reads the server's list of tools whose confirm
  flags the confirm window answers, instead of a copy.
- **React dashboard: the Advanced menu:** the header's panel and tool buttons moved into an
  Advanced ▾ menu, as on the old page (GM guides; Prep, Party, Handouts, Tarokka; Tools, Module
  diagnostics, Player links). Arrow keys move through it, and a drawer picked from it keeps the
  focus. A drawer that is already open comes to the top instead of closing. Pre-flight stays in the
  header, where its status shows.
- **React dashboard: #276 review follow-ups:** a drawer that is already open and picked again from
  the Advanced menu takes the keyboard focus as it comes to the top, instead of leaving it on the
  page. The Tool runner's Enable GM Actions button takes the focus whenever it appears after a
  refusal, not only when it was already drawn.
- **The React dashboard gets the Party drawer (D-109):** a 🛡 Party button on `/next/` shows the
  dnd5e party as the old page does (members with HP, AC, passive Perception, hit dice,
  conditions, death saves and tokens; the group picker; travel pace, combat and rest), and runs
  its four one-click changes (pace, into the encounter, place the party, rest requests) through
  plan and apply, with Undo on the toast. With GM Actions off nothing is planned and Pre-flight
  opens. Playwright covers every section, the empty and failed states, each change, Undo and the
  refusals.
- **The React dashboard gets the Pre-flight drawer (D-109):** the first drawer on `/next/`, with
  the tool's checks, the verdict on the header button, the spoiler-scan findings, the version
  banner and the hand checklist (its ticks are shared with the old page). It runs again by itself
  when Foundry comes back. Ready for session and the Tarokka "Show cards" check follow in later
  PRs. Playwright covers the drawer, including the real route with the bridge down.
- **The React dashboard gets the Prep drawer (D-109):** a 📋 Prep button on `/next/` opens the
  same facts as the old page: last session (scenes, fights, downs, handouts, beats with All beats),
  open quests and campaign parts with Open buttons, the Next session journal, the handout queue,
  bosses, the pre-flight count with a jump to Pre-flight, recent changes and the Tarokka note.
  It only reads. Playwright covers every section, the empty and failed states and the Open calls.
- **The React dashboard gets Ready for session (D-109):** inside the Pre-flight drawer on
  `/next/`, as on the old page: the switch chips with GM Actions, Ready for session, Turn them off
  again with the same toasts (including a switch Foundry did not change), and Start the session
  log. GM Actions follow the live stream, and the pre-flight row runs again after each change.
  Playwright covers the block, including the real route with the bridge down.
- **The React dashboard starts (D-109):** a new dashboard page in React + TypeScript + Vite at
  `/next/`, next to the old page, with Radix UI primitives, TanStack Query and Playwright browser
  tests in CI. It keeps the old look (it links the same stylesheets and themes). The first panel
  on it is Player links; the old page is unchanged and stays the default. The build puts it in
  `dist/web`, so the Docker image and the Pi get it with the rest.
- **The React dashboard is now the page at `/` (D-126):** the old page stays at `/legacy/` until after G1 (an **Old dashboard** button in the header and a link in the banner), `/next/` redirects to `/` and keeps the query, and `/player`, `/me` and `/open` are unchanged. The Obsidian plugin's plan link (`/?plan=<planId>`) now works on the React page too: it opens the plan's confirm window once GM Actions are on. The "preview" wording is gone from the header and the banner. The test kit and the demo takes open the old page at `/legacy/`.
- **The layout buttons that wait for the world can be reached with the keyboard:** before Foundry has
  told the new dashboard which world it is, the Cards, Simple/Full and Auto buttons and "Use this
  one" look off and do nothing, but the keyboard still lands on them and a screen reader reads why
  they are off.
- **Escape keeps your place:** when Escape ends the layout trial from inside its guide, the focus
  moves to the layout switch instead of the top of the page.
- **The During folds in the new dashboard:** the four During cards (Live Feed, Recent Changes,
  Handouts and Party) have a fold button first in their head, as in the full dashboard. A folded
  card shows only its head, and a click on its title opens it. Each layout starts with the same
  cards folded as before (Cards folds Handouts and Party, Simple/Full folds nothing, Auto in a
  fight folds the feed and opens Party, and a phone folds the feed). On a screen 900 px wide or
  more, opening a side card folds the other side cards. The Live Feed and Recent Changes are still
  placeholders there, with the same head and button.
- **Your fold choices are kept:** in the full dashboard the folds started over every time a fight
  began or ended and every time the window crossed 600 or 900 px. In the new dashboard a card you
  folded or opened stays that way for the same layout, fight and width, until you reload the page.
  Auto still shows its combat look the first time a fight starts, and going back to calm gives you
  the calm cards as you left them. Leaving During and coming back keeps the folds too, and a
  folded card keeps what it loaded.
- **The fold button has a name:** screen readers hear "Fold Party" or "Open Party", with the state
  and the card body it controls. The title click stays a pointer shortcut; the button is the
  keyboard way. The four fold clicks (`dash.during.fold-feed`, `-changes`, `-handouts`, `-party`)
  are now in the usage catalogue, so the usage report can say when they were never used.
- **Fix:** a stale comment in the stylesheet said a folded card keeps its count; no card shows one.
- **Screen choices saved at the same time no longer undo each other (new dashboard):** when two
  saves overlapped (a layout click while the quiet hint count was still being saved, for one) and
  the first failed, the page put back the old values of the whole object and lost the second
  choice from the screen. A failed save now takes back only its own fields, and an older answer
  that arrives after a newer change is ignored.
- **The layout trial is easier to follow with a screen reader (new dashboard):** the step is
  announced from a live region that is always in the page, so the first step is no longer missed.
  After "Use this one" or "Stop" the focus moves to the layout button instead of dropping to the
  page. The layout buttons, "Use this one" and Combat buttons now say why they are off (Foundry has
  not told the dashboard which world it is yet) in a way a screen reader reads, not only in a
  tooltip.
- **Escape closes a tooltip or popup first (new dashboard):** with the layout trial running, an
  open tooltip or popup takes the Escape key and the trial goes on; the next Escape ends it.
- **The During layouts in the new dashboard:** the During screen now has its bar with the Cards,
  Simple/Full and Auto switch, the "Show everything" button, the note for Auto and the quiet hint,
  and the Advanced menu has its "During screen" group (Combat buttons, Try the During layouts). The
  choice is the same one the full dashboard keeps for the world, so a layout picked on either page
  shows on the other, and the Before card with the layout trial (Try the layouts, Keep Cards, and
  the guide with Use this one, Next and Stop) works as it does there. The turn-order strip, the
  folds, the Live Feed and Recent Changes are not in the new dashboard yet and keep their
  placeholders.
- **The layout trial shows the button its text points to:** in the full dashboard the Simple/Full
  step says "Show everything on the bar switches to Full", but the trial hid that button. In the new
  dashboard the button shows during the trial and previews Full without saving it; "Use this one"
  keeps the layout and the view you were looking at.
- **No error before the world is known:** until Foundry has told the dashboard which world it is,
  the layout buttons and the Combat buttons entry are off, with a note why, instead of failing with
  a "Could not save the screen choice" toast.
- **React dashboard: the Tool runner's gate focus expires (#280 review):** a change refused for GM
  Actions asks for the focus on the gate bar's Enable button, and the request now lasts about a
  second. Before, a refusal that never drew the bar (a 403 for another reason, or the stream saying
  GM Actions are on first) left the request waiting, so GM Actions going off later took the focus
  from the field being typed in, and the next opening of the Tool runner went to the gate button
  instead of its usual first button.
- **React dashboard: guarded changes after the #243 review:** an apply or undo whose answer got
  lost on the way back (the bridge link dropped, a proxy gave up, or the network failed) now says
  it may have applied and points to Recent Changes, as a timeout already did. Opening Pre-flight
  before the live stream has sent its settings no longer leaves the GM Actions gate shut while
  Pre-flight shows GM Actions on. A tool answer that says it failed is logged with its kind, not
  as a network error.
- **React dashboard: guarded changes after the #239 review:** Escape with a toast showing closes
  the drawer or panel under it and keeps the toast, so a GM closing a drawer right after a change
  keeps the Undo button. GM Actions count as off until the live stream says otherwise (no plan
  left behind by an early click). An apply or undo that times out at the bridge says it may have
  applied and points to Recent Changes, and the panels reload in case it did. Usage logs record
  the server's failure kind (tool, timeout, channel) as the old page does.
- **React dashboard: Handouts after the #248 review:** Reveal next reloads the queue after every
  attempt, so a cancelled or failed reveal no longer shows old rows until Refresh. When the confirm
  window closes, focus goes to the drawer while the reveal runs and back to Reveal next once there
  is a next page, instead of landing on the page body.
- **The React dashboard gets the Handouts drawer and the confirm window (D-109):** a 📜 Handouts
  button on `/next/` shows the reveal queue (the next page marked, its scene and who it is for)
  and each revealed handout with a tick for every player who has opened it, as the old page does.
  **Reveal next** opens the confirm window with the plan's summary and what it changes; a reveal
  is destructive, so **Run destructive action** waits for the "I understand" tick, and the toast
  has Undo. **Show it now** goes with one reveal and unticks after it. **Remove** takes a page off
  the queue without GM Actions. The drawer reloads after any apply or Undo (the old page left it
  stale until Refresh) and when a player opens a handout. Any one-click change whose plan is not
  an ordinary write now asks in the same window instead of sending the GM to the full dashboard.
  Queueing a page still happens on the full dashboard (**+ Queue a page** links there).
- **The Live Feed in the new dashboard:** the session events are in the During view's feed slot,
  newest first, as in the full dashboard. Each event shows its line (a roll shows its full
  breakdown), its kind and the time, and the head counts every event since the page loaded. The
  newest 120 stay on screen. The card still folds with its button, and it has the "?" to the
  guide like the full dashboard's. Like the full dashboard's feed it has no filter, clear or pause.
- **Faces and the bridge:** before the first answer the card says it is loading, a quiet table says
  "Waiting for events…", and while the bridge is away it keeps the events and says "The bridge is
  away: new events will show here when it is back." With no events yet it says the bridge is away
  instead of waiting.
- **Live Feed fixes:** events are ordered by the time they happened, so a replay after a reconnect
  can no longer put old events on top of new ones. The count says "1 event" instead of "1
  events". An odd event kind from a module can no longer break the page.
- **Keyboard and screen readers:** the events are a named list that you can scroll with the
  keyboard (Tab to it, then the arrow, Page and End keys). New events are announced as one short
  message per batch, so a burst of hits is not read out one by one, and the events already there
  when the page loads are not read out at all.
- **Combat strip fixes (new dashboard):** a page that was disconnected while the fight ended no
  longer keeps showing it as live (the dashboard now answers every new stream with the fight or
  "no fight"). Damage / Heal and Condition send the token, so two "Wolf" rows are two targets, and
  the Tool runner names them under the field. One failed poll no longer greys the strip: the
  panels wait five seconds on "not sure" before they say the bridge is away (a dropped link shows at
  once, and stays until the bridge is back). The Live Feed's screen reader line is spoken again
  when two events read the same. The Enemy tag has a lighter red that can be read, and the "bridge
  away" look keeps the text's contrast.
- **React dashboard: Pre-flight checks Tarokka's Show cards:** Pre-flight lists "Tarokka cards
  hidden" again, as on the old page. When the GM Actions gate opens Pre-flight over a Tarokka
  drawer with Show cards ticked, the row warns, and its **Hide cards** button unticks it from
  Pre-flight. The row shows even when the tool's own checks did not run, and
  a ticked box counts as one more "to look at" in the summary.
- **React dashboard: the drawer opened last is on top:** when the GM Actions gate opened Pre-flight
  from Tarokka, Handouts or Party, Pre-flight opened under the drawer that asked for it, out of
  sight, while Escape closed it first. The drawer opened last now covers the others, the same one
  Escape closes.
- **The React dashboard gets the Tarokka drawer (D-109):** a 🃏 Tarokka button on `/next/` shows
  the five positions of the current reading, their links and whether each is revealed, as the old
  page does. **Import from tarokka-reading**, **New reading** and a **Link** pick apply in one
  click with an Undo toast; **Reveal** opens the confirm window and waits for the "I understand"
  tick. With **Show cards** off the card names and notes are no longer on the page at all, only a
  blurred placeholder, and the box unticks when the drawer closes. An open link search or reveal
  draft now survives a reload, a failed reload keeps the reading under the error, and a link
  search shorter than two characters says so without asking the bridge. With GM Actions off
  nothing is planned. The 📓 Obsidian link shows once the vault and the world are known. One
  change runs at a time in the drawer: while a reveal waits on its plan or its confirm window,
  Import, New reading and the other Link and Reveal buttons wait too, so a reveal can no longer
  land on a card a new reading just dealt. A reveal that went in closes its form and clears the
  text, so a second click cannot plan it again as an update of the players' page.
- **React dashboard: Tool runner review follow-ups (#267):** `apply-planned-change` and
  `undo-change` no longer show their `confirm` and `confirmDestructive` ticks (the confirm window
  answers them), so the form has no required `confirm` box and the Undo window no longer lists
  "confirm: false". The confirm window shows a picked value after its name ("Vallaki (s2)"), so two
  scenes or tokens of the same name stay apart. Number fields name text that is not a number
  instead of dropping it, and a picker's Show all and filter no longer carry over to another tool.
  An Undo from a Tool runner toast that GM Actions refuse says the Tool runner's text and opens the
  Tool runner at its GM Actions bar, even after the drawer closed.
- **The React dashboard gets the Tool runner (D-109):** a 🛠 Tools button on `/next/` lists every
  bridge tool by category with a search, and opens one as a form built from its parameters, with
  **Pick…** lists for anything that names a scene, a token, a page, a plan and so on. Reads run at
  once and show their result under the form. A plan typed by hand always opens the confirm window
  before it applies (Enter in a field never applies a change by itself), and so does any other
  write; the toast has Undo. With GM Actions off nothing is planned, and the gate bar's **Enable
  GM Actions** turns them on. **+ Queue a page** in the Handouts drawer now opens it on
  `plan-page-reveal` with the queue action and the active scene filled in. Better than the old
  drawer: a prefilled or picked value shows its name under the field (a scene id shows the
  scene's name), the confirm window names what an id points at, each tool keeps its form while
  the drawer is closed or another tool is open, numbers and JSON are checked before anything is
  sent (all problems at once), plans are tagged `plan` in the list, and a click on Run while a
  Pick… list is open is no longer lost.
- The new dashboard's Before / During / After tabs stay correct when the bridge is down: After now turns into Before after 12 hours even if every check of the session fails, and a hidden browser tab keeps checking once a minute so the moment is current when you come back.
- In the neutral theme the selected moment tab has its ring and glow again.
- The old dashboard page now reads when the session ended from the bridge, as the new page does, instead of a value kept in the browser, so the two pages agree on After.
- Tests: the new dashboard's view and Tool runner tests wait for the right moment before they count calls or reopen a drawer, so they no longer depend on timing.
- **The React dashboard gets the Before / During / After views (D-109):** the header on `/next/`
  has the three moment tabs, and each view holds its panels in the page: Pre-flight (with Ready
  for session) and Prep in Before, Party and Handouts in During, Prep and Handouts in After. A
  panel in the page has no close button, no dark backdrop and Escape leaves it alone; its header
  or menu button scrolls to it instead of opening a second copy. The moment follows the play
  session (open is During, ended in the last 12 hours is After, else Before) and a tab click holds
  the pick until a session starts or ends. The page waits for the first session answer, so a
  reload during play no longer shows Before first. A panel that stays in the page when the moment
  changes keeps what it loaded; one that comes back loads again, as when its drawer opens. The
  tabs work from the keyboard (arrow keys, Home, End), and when a moment change takes away the
  panel holding the focus, the focus goes to the new tab. Live Feed, Recent Changes, the feature
  cards and the After stats show a short card that points to the full dashboard until they move.
- **get-play-session says when the last session ended:** a closed session now also gives
  `endedAt` (its end marker, or its last activity when it went quiet), so After shows on any
  browser and after a reload, not only in the browser that saw the session end.
- **The live stream comes back by itself:** after a dashboard restart or a tunnel 502 the browser used to give up on the live stream for good, and the page stayed stale until a reload. The new dashboard, the full dashboard and `/player` now make a new connection after a short wait (2, 4, 8, then 10 seconds). The new dashboard's header says "reload the page" only after three new connections in a row failed, and still keeps trying.
- **Screenshot tests and a bundle budget for the React dashboard (UI-01, UI-05):** Playwright
  screenshots of the Before, During and After views, every ported drawer, the Advanced menu and the
  version banner, in both themes at 1440, 1080 and 390 pixels wide (78 baselines, made in the
  Playwright Linux image so they match CI), plus an axe accessibility check on each screen.
  `npm run test:visual` runs them in Docker and `npm run test:visual:update` refreshes the
  baselines. A new CI job, `dashboard-visual`, runs them and keeps the diff report as an artifact.
  `npm run bundle:budget` fails the build when the dashboard's first-load JavaScript or a lazy chunk
  grows past its recorded gzip limit. Playwright moves from 1.63 to 1.64.
- **Design tokens and a shared Panel for the React dashboard (UI-02):** spacing, type, motion,
  layer and focus-ring tokens in `themes/brand.css` (The Veil sets only its own slower
  `--ease-mist`), and a small component set in `web/src/ui`: `Panel` with six states (ready,
  loading, empty, error, bridge down, gated), `Card`, `Section`, `Stat`, `Pill`, `Button`,
  `IconButton`, `EmptyState`, `ErrorState`, `Skeleton` and `QueryState`, which turns a TanStack
  Query result into the right state so no panel writes its own "Loading…" and "Couldn't load".
  Drawers, panes over the page and every ported panel now use them. Nothing changes on screen (the
  screenshot tests stay at zero diffs) and the old page is untouched. The dashboard README has a
  "Building a panel" section for the next ports.
- **Storybook for the React dashboard (UI-03):** every `ui/` component, every shared component
  (drawer, pane, confirm window, toasts, the moment views, the menu and the picker) and every
  ported panel now has stories in every state it can be in, with made-up data and no bridge: loaded,
  empty, loading, failed, bridge down, GM Actions off, long names, eight characters, the Veil theme
  and a phone width. `npm run storybook` runs it, with the theme and the mist in the toolbar and
  the same stylesheets as the real page; `npm run build-storybook` builds the static site, which
  the wiki workflow publishes under `/storybook/`. It is a dev dependency of the dashboard package
  only, so the app build, the Docker image and the bundle budget do not change. The screenshot
  tests photograph every story too (one extra Playwright project, `stories`, which reads
  Storybook's `index.json`) and run axe on each, in the same `dashboard-visual` CI job. The
  dashboard README has a "Stories" section for the next ports.
- **Radix set for the React dashboard (UI-04):** the dashboard now takes Radix from the single
  `radix-ui` package instead of three `@radix-ui/react-*` ones, and `web/src/ui` gets styled
  `Tooltip`, `Tabs` and `Popover` on the design tokens (they follow The Veil and respect reduced
  motion). The three icon-only buttons (the "?" after a pane's title and the close buttons of
  drawers and panes) now show a tooltip on hover and when you Tab to them; Escape closes the
  tooltip first and leaves the focus where it was. Their names for screen readers and the test kit
  are unchanged. The screenshot tests stay at zero diffs.
- **Screen readers keep hearing "Loading…" (React dashboard):** a panel's body is no longer marked
  busy while it loads, because a busy parent can make a screen reader hold back the "Loading…"
  message inside it.
- **Standing conditions are a status, not an alert:** when the bridge is down or a switch is off,
  the panel now says so politely instead of interrupting. A real error is still an alert.
- Tests now cover the "Close (Esc)" tip on a drawer's close button and the roles inside a list.
- **Screen readers hear a panel change state (React dashboard):** "Loading…" is now a polite
  status message and a failure (an error, the bridge being down, a switch being off) an alert, so
  a screen reader says when a panel starts loading or fails. A panel's body is marked busy while
  it loads, and loading bars keep their "Loading…" text for screen readers. In a list the role sits
  inside the row, so the list keeps its items. Nothing changes on screen.
- **Close buttons no longer say "Close" twice:** the tooltip on the close buttons of drawers and
  panes now reads "Close (Esc)", so a screen reader hears the name and the shortcut instead of the
  same word twice. An icon button now needs a tip that adds to its name.
- **Version tracker follow-ups (I-127):** the online lookups now close the reply body after an error, redirect or oversize answer. A module whose newest release needs a newer Foundry than the installed one shows "(needs Foundry X)" beside "Update available". The private-address guard also refuses `::7f00:1`, `64:ff9b::`, `.lan`, `.home.arpa`, `fritz.box`, `198.18.0.0/15` and multicast.

### Docs

- **`.env.example` explains `DASHBOARD_ALLOWED_HOSTS` for a Tailscale name or a LAN address:** the dashboard refuses any other name with 421 `host-not-allowed`, so the example now shows the full Tailscale name and a LAN address, and says the short name needs its own entry.
- **Fewer "Allow" clicks in Claude Desktop:** the connect guide now has a short step that sets both tool groups of each Foundry connector to Always allow (the plan and confirm is the guard for writes), and says how to go back to Needs approval. The GM guides now name the connector switch as + then Connectors. Claude Desktop keeps this choice in the account, so the installer cannot preset it.
- **GM guides match the React dashboard:** the status lights, world line, Pause/Tone/Model, Features cards, AI commentary and storage banner are marked "old dashboard only"; the checklists and troubleshooting now point at the Pre-flight line and the "Connection lost" mark; the `/legacy/` note says "until after session 1" and lists what is only there.
- **GM guide, find-it-in-Advanced pass:** the dashboard page says which panels sit under Advanced,
  explains the Before / During / After views and the Versions entry, and the other GM pages name
  Foundry's own Combat Tracker where the skull is meant.
- **README, dashboard reference and runtime test plan:** no combat controls the strip lacks, and
  the AI commentary is marked as old-dashboard-only.
- **Foundry GM coach skill (D-097):** `npm run gm-coach` builds `foundry-gm-coach.zip`, a skill
  for the GM's own Claude account (it works on the free plan): the verified Foundry 14 / dnd5e 6
  reference pages (without their automation and test-server parts) and the GM and player guides,
  with instructions to answer from those pages first, say when it uses general knowledge, never
  search the web, and say when unsure. CI tests it and keeps the zip as a download. A new GM page,
  "Your GM coach in Claude", says how to add it, how to ask, and the Claude Project fallback.
- **Prep and expectations:** a new GM page on what to prepare for a session, the expectations talk
  with the players, the ability score talk and a session 0 agenda the GM can change. The GM coach
  skill opens it for prep and planning questions, asks a few questions first, offers options and
  leaves the choices to the GM, and answers in the GM's language (Danish keeps English game terms).
- **Prepare session 0:** on the table's server steps 2 and 3 are now a check, since a Pi stage set
  the player creation settings (D-113). The ability score step says to tick only the agreed method.
- **Make your character:** why a table may prefer the standard array, our table keeps to the 2024
  Player's Handbook, and a line on knowing your own character.
- **Game night runbook (GM, D-097):** one page for the night: the game is Foundry and keeps going
  when Claude, the dashboard or the recording fail (D-077); what to do when Foundry does not load,
  a player cannot connect, it is slow, or the server is down (plan B from last night's backup on
  the admin's PC; its technical steps follow with the plan B rehearsal); when to call for help.
- **Claude Free or Pro (GM):** what works on the free plan (skills, projects, the desktop app),
  where its five-hour limit shows and how to stretch it, what Pro adds, and what is still unclear
  (the local connection on Free, to be tested on the GM's PC), with Anthropic's pages as sources,
  checked 2026-10-08.
- **Prepare session 0:** two small additions from the player-guide run: ask players to reload after you
  change Actor Studio settings, and add a Spellbook to each wizard by hand (the Player's Handbook
  module's wizard starting equipment has none).
- **Pictures in the character guides:** "Make your character" and "Prepare session 0" show each
  step with screenshots from the local test server (no licensed text readable), and their wording
  now matches what Actor Studio and Foundry show: the settings category and pack names, the reload
  after saving sources, the welcome window, and species listed once per lineage.
- **Character guide, species and steps:** "Make your character" tells players what to do when the
  species list shows plain "Elf" three times (Actor Studio builds without the lineage label fix),
  and its step count example matches the picture.
- **Character guide, species picture:** the Species step shows "Elf, High" as the list names it
  (Actor Studio with the lineage label fix, now on the Pi), so the plain "Elf" fallback sentence is
  gone.
- **Join the game walkthrough:** `docs/player/join.md` is now the real step-by-step page for players:
  the Cloudflare Access email code, Foundry's join page, leaving and switching user, the read-only
  player page, Discord, and a longer "if it doesn't work" table, with three pictures. The "Walkthrough
  to come" note is gone. The real domain stays out of the public page; the GM sends the address.
- **After each session, removing a player's data:** the GM passes the request on to whoever set
  up the tool; the steps name the Pi's bridge service, and the Obsidian notes catch up by
  themselves when the bridge writes the GM vault, so the export command is only for an
  immediate rebuild (D-094 R5).
- **Part C guide matches how it was really set up:** `docs/dev/REMOTE-ACCESS.md` uses Cloudflare's
  new "Cloudflare One" menu paths, adds the missing One-time PIN step (Integrations, Identity
  providers), the `http://` in the route's Service URL and the "Validate the Access JWT at the
  tunnel" option (a 403 after the email code means a wrong AUD tag), and runs stage 12 once with the
  public name. `docs/dev/PI-SETUP.md` Part C now describes the token model (set with
  `set-tunnel-token.sh`) instead of "log in once".
- **Part C guide matches what was really set up on 2026-10-14:** no stage 5 rerun for the dashboard,
  the dashboard application also carries the players' policy (players get `/player`), the
  Tailscale-only GM link, instant auth set the same on both applications, removing a player also
  removes `cogm` when the players' policy is shared, the service token secret is shown once (Rotate makes a new one), and a 403 can
  also be a wrong team name. The GM's Obsidian guide explains the Add secret dialog and where the GM
  token comes from, with no password manager.
- **Player users in the real world:** `Ask`, `David` and `Sebastian` exist as Player users without a password, because Cloudflare Access is the lock since the router forward went. The join page and the Part C steps say so instead of telling players to type a password.
- **Player character guide matches a real run:** `docs/player/make-a-character.md`
  now carries the ten snags found when a player built a level-1 character on the test server: the
  Character Name box starts as the player's own name, two windows open at first join, a blank panel
  for about 5 seconds after Complete, the Magic Initiate spell picker (pick "PHB 2024", the
  class filters are locked on for Cleric, Druid and Wizard), only the gold amounts need a click on the
  Equipment tab, a skill picked twice loses a proficiency, wizards get no spellbook, and the cosmetic
  oddities. Two new pictures (the name box, the spell picker). The join page notes the two windows
  and marks the walkthrough as waiting for the game server.
- **Player guides for session 0 (D-097):** "Join the game" (the address, the email code, the
  Foundry login, Discord) and "Make your character" (a level-1 character with Actor Studio from the
  2024 Player's Handbook, step by step, with a check of the finished sheet), tested as a player on
  the Strahd test copy.
- **Prepare session 0 (GM):** the one-time world setup (a user per player, Create Actors for
  players, Actor Studio on the Player's Handbook packs, its spell and equipment steps) and the
  night itself.
- **Recording consent in the player guide:** recordings need each player's written yes, are kept
  until a player asks (D-097 replaces the 14-day delete of D-072), and the path through Discord,
  the Pi and the PC is spelled out.
- **Player character guide:** the alt text of the spell picker picture says "most spells" are listed once per book, as the text above it does.
- **Fixes from the deep review:** the GM's before-session checklist no longer tells Danni to run `npm run dev:cogm`; the player guide says the player page is live behind Cloudflare Access; the join page opens with "phones are for reading, not playing" and "give Danni your email first"; session 0 prep starts with collecting the players' emails; the remote-access docs say a GM's email code also opens Bridge control (D-126).
- **Wiki v1 (D-097):** a MkDocs Material site built from `docs/gm` and `docs/player`, the same
  pages as the dashboard help, with the GM coach zip as a download on its page.
  `npm run wiki:stage` stages the pages (links to the rest of the repo become GitHub links, the
  nav follows each README), and the new Wiki workflow builds it with `--strict` on every docs change and keeps
  the site as the artifact `wiki-site`. Publishing on GitHub Pages waits for the repository
  variable `WIKI_PAGES`.
- **Your first hour as GM:** a new GM page with a set reading order through Foundry's own
  knowledge base for the basics and our pages for the tool.

### Fixes

- **Assistant GM no longer burns CPU:** the headless browser redrew the endless "Game Paused" banner
  animation 60 times a second even with the map canvas off, which kept Chromium's gpu process near
  one core on the Orange Pi. The browser now lets every CSS animation run once and stop (PC test:
  gpu process 15 % down to 0.2 % of a core; the bridge link works as before).
- **Recent Changes no longer fails after a bulk delete:** a day's change journal could grow past
  what Node holds in one string (the test kit deleted 13,000 actors in a day: 550 MB, each delete
  with the actor's data), and `list-changes` and the journal pump then failed ("Invalid string
  length", a 422 on every Recent Changes call). The bridge now reads journal and session files
  line by line, and the history holds at most the journal's size cap
  (`FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB`, 64 MB) of the newest records; when it leaves older ones
  out, the list says from when it is complete and a rewind stops there. A day's journal file
  that grows past the cap keeps its newest half (retention never removed the newest file, so a
  heavy day grew without limit, on the Pi's SD card too). Both caps leave an action out whole,
  never in part, so Undo never puts back only some of a bulk change.
- **Changes window: Undo works on a reveal:** a Tarokka or handout reveal (a change that also wrote the AI Tool's own data) was offered Undo in the Changes window but refused with "undo it with undo-change". The window now asks for the usual confirm and undoes it with the plain undo, which puts the vault back and refuses on a conflict. The refusal that Claude's planned undo still gives for such a change now names the Changes window and the dashboard's Recent Changes as ways to undo it. The test kit's control sweep now requires the window to undo both reveals.
- **Dashboard Recent Changes, Everyone tab:** the same reveal rows now undo with the plain undo (after the tab's confirm) instead of the planned undo's refusal.
- **`get-character-entity` works on dnd5e 6:** the tool now asks the module for the one item or
  effect (a new `getCharacterEntity` query) instead of reading pf2e fields (traits, action
  types) out of the whole character. Items come with their dnd5e details (spell level and school,
  rarity, quantity, equipped, attunement, uses left) and their activities as the sheet shows them
  (activation, range, target, to-hit, save DC, damage), plus the description and the full system
  data. The character resolves as in `get-character` (partial names, a token on the current
  scene first). A module older than the bridge gets a "update the module" hint.
- **`demo:compose` checks the take frame rate up front (#342 round 2 lows):** a take that is not 60 fps, or whose rate cannot be read, now stops the run in `preflight` before the first encode instead of after the earlier chapters are built. New tests cover the chapter id and cut name rules, the repo guard for `--out`, `preflight` and the frame-rate check, and `DEMO-RECORDINGS.md` says that an apostrophe in the output path is a hard stop (pass `--out`).
- **The bridge control port ignores web pages:** a web page in the GM's browser can POST to
  `127.0.0.1:31414` without a preflight, and a JSON line in the body would have run as a tool call
  (review of PR #344, M1). The control channel now closes the connection when the first line is not
  a JSON object, or when a line that is not JSON looks like HTTP. The stdio wrapper, dashboard,
  tunnel ping and test kit all start with a JSON line and are unaffected.
- **A large control reply no longer drops the dashboard's channel:** a single tool result over 1 MB
  (for example `get-play-stats` in a world with a long play log) made the dashboard log "Control
  buffer overflow" and reset the control connection, failing every pending request. The size limit
  now applies only to one unfinished line and is 32 MB, so big replies arrive in many chunks and
  resolve; a line that never ends still resets the connection, and the log now says how large it was.
- **`get-play-stats` works on a very long play log:** with a few hundred thousand records it failed with
  "Maximum call stack size exceeded" (the stats and the Obsidian export spread whole logs into one
  call). They now loop instead.
- **Dead wire-protocol schemas removed:** 11 Zod schemas in `shared/src/protocol.ts` that nothing parsed
  (control request/response, call-tool params, tool result, the Foundry-link frames, bridge-hello and
  module-reply) are gone. The TypeScript types, the frozen strings and the two schemas the code really
  parses (`module-hello`, `module-request`) are unchanged, so the wire does not change.
- **Test mock ids:** the Foundry mock's `randomId` no longer repeats ids for a long type name.
- **dnd5e 6 self-centred spells:** a spell that targets the caster and has an area (Detect Magic,
  Globe of Invulnerability) reads "self" plus its area again, not "area".
- **Compendium search summaries work again:** dnd5e's compendium index holds no spell, weapon
  or armor fields, so `search-compendium` summaries were only "spell from Spells". The module now
  indexes Item packs once with those fields, so summaries show spell level ("Cantrip", "Level
  1") and school, weapon damage, the AC of armor and shields ("AC 16", "AC +2"), rarity and
  price. dnd5e 6 keeps armor as `equipment` with an armor type, so `get-compendium-item` now
  lists the armor type, AC, strength requirement and stealth disadvantage (the old `armor` item
  type matched nothing). The `search-character-items` type and category hints list dnd5e 6 item
  types.
- **Item properties and activities in tool output:** dnd5e 6 keeps item `properties` in a Set
  and `activities` in a Collection, which tool output turned into `{}`. They now come through as
  arrays (weapon properties, stealth disadvantage, each activity's data).
- **dnd5e 6 spells:** the "My character" sheet and the character tools no longer show innate,
  at-will and ritual spells as unprepared; prepared and always-prepared spells read dnd5e 6's
  `method` and `prepared`. Class spell lists group spells by the class that grants them
  (`sourceItem` "class:wizard", subclasses resolved to their class), so they no longer all
  land in "general"; spells from species or feats show under "Other Spells" instead of
  vanishing, and each class entry carries its spell save DC and attack bonus. Subclass
  casters (Eldritch Knight, Arcane Trickster) get their own class entry from the subclass's
  spellcasting. NPC spells read as ready (NPCs never prepare; dnd5e 6 stores their
  feat-granted spells as unprepared).
- **dnd5e 6 resources:** a character's hit die type is read from its class items (it was
  empty for player characters; a multiclass shows "d10/d8"), NPC hit dice read the numeric
  die, and recharge abilities read as "recharge 5-6" from `uses.recovery`.
- **dnd5e 6 cleanups:** the play log drops update paths dnd5e 6 never sends (`uses.value`,
  `hitDiceUsed`), and the creature index stores the biography text instead of dnd5e 6's
  `{value, public}` object, so creature search results carry a text description. The
  description is plain text (no tags or secret blocks), and existing creature indexes
  rebuild once (index version 1.2.0).
- **dnd5e 6 spell targets:** spell results from `get-character` and `search-character-items`
  read dnd5e 6's `target.affects`, so single-target spells show their target again ("3
  creatures" for Bless, "1 creature" for Charm Person, "self" for Shield); area spells keep
  "area" plus the size ("20-ft sphere"), and a counted target inside an area keeps its count.
- **dnd5e 6 cleanups:** dropped reads of fields dnd5e 6 does not have: the creature index's
  old CR, type, size, HP, AC, spellcasting and legendary fallbacks (and the `creature` actor
  type), the character entity lookup in `system.actions`, `attributes.spelldc`, the `armor`
  item type (armor is `equipment`; tools and containers now count as equipment in item
  search) and item-level `system.activation` on stat block features.
- **Two flaky mcp-server tests under load:** the prep digest test no longer gives the prep notes a 200 ms deadline, and the many-notes mirror scan test has its own timeout.
- **During on narrow screens:** below 1080 px an old grid rule from the first Before/During/After
  screen named areas the During cards no longer use, so Recent Changes, Handouts and Party stacked
  on top of each other (at 390 px the Party drawer covered the Recent Changes header). The rule is
  gone; every layout keeps its own order at 390 px, 768 px, 1000 px and desktop widths, and a test
  checks that every During grid rule names each card.
- **Edit guard lows (from the #358 round 2 review):** the shell edit guard no longer denies a script that
  reuses a loop variable name for something else (`for f in [...]`, then `f = tmp path`), and a heredoc
  redirect target is checked against the working directory at its own position on the line, so a
  `cd` after it on the same line no longer counts. Each has a test that fails on the old hook.
- **Item rarity reads as a label in compendium search summaries:** an item's summary says
  "Very Rare" instead of dnd5e's key `veryRare` (all six dnd5e rarities). It also reads the
  `rarities` list that dnd5e 6 source data holds, so world items keep their rarity too.
- **The player page CSP stays on the player page on a well-used NTFS disk:** the dashboard
  recognizes a static file by its id as well as its name, and NTFS ids above 2^53 lost their low
  bits as numbers, so `player.js` could share `player.html`'s id and get its CSP. An id outside the
  exact range is now confirmed with a bigint stat (`static-headers.test.ts` failed 2 tests on one
  PC; CI passed).
- **An apply that was never sent fails at once:** when Foundry is not connected, a guarded change no
  longer waits up to 2 minutes (holding the write lock, so queued changes waited too) and then says
  it "may or may not have been applied". It now says the change was not sent and nothing was
  applied; the plan stays pending.
- **Undo from the Changes window or the dashboard goes through the same undo guard** as the Undo
  tool: session notes whose Recap was revealed or whose pages the GM edited are no longer deleted
  that way. Undoing a put from there also sends the notes back to staged.
- **Session notes get the same journal id on every put:** an earlier put whose answer was lost no
  longer produces a second journal; the next put meets the first one, stops the automatic retries
  and tells the GM to look in the "Session notes" folder.
- **Applying a plan twice says "already applied"** (with the change id) instead of "plan expired".
- **Recorder survives a full disk, a crash and a quick restart:** every recording file now has an
  error handler, so a full disk or a permission error no longer kills the bot; the channel and the
  owner get a message and `/record stop` warns that the recording may be incomplete. A `/record stop`
  then `/record start` in the same minute gets its own folder (`...-discord-2`) instead of
  overwriting the first run's tracks. On startup the bot converts any recording a crashed run left
  raw (no `convert-report.json`, untouched for 10 minutes) and tells the owner.
- **Session notes no longer publish raw scenes as finished:** a scene Claude could not write (PC
  asleep, network drop, not logged in) used to be saved as raw text and never retried, and the
  hollow notes were staged into Foundry. Now it is retried on the next passes (up to 3 runs, then
  accepted raw), the session summary waits until every scene is written, and `session_notes run`
  exits 76 meanwhile. Notes cached raw by an older run are tried again.
- **A killed notes pass no longer blocks the next ones for 6 hours:** `auto.ps1` checks that the
  PID in its lock file is still running.
- **Each run's outcome is written to `notes/status.json`** (done, paused, incomplete, failed or
  waiting for the bridge) by `session_notes run` and by `auto.ps1` for transcription, run and
  publish failures. Showing it on the dashboard is a later item.
- **`speakers.json`, `names.txt`, `timeline.jsonl` and the approval file** are read with a byte
  order mark tolerated, so a file saved by Windows PowerShell 5 or old Notepad no longer crashes the
  run.
- **`get-character` spells and creature type:** `stats.spellcasting.hasSpells` now follows the
  actor's spell items (and real spell slots) instead of the spellcasting ability, which the 2024
  monsters set on every NPC (a Wolf has one) while real casters can have spell items and no ability.
  An unset creature type is left out of `stats` instead of showing as `{}`.
- **Green flakes lows (from the #360 review):** on Windows `npm run green` now prints a first line that says
  which Node the steps run on (`steps on Node 22 (<folder>)`, or that no portable Node 22 was found), and
  the Node 22 pin sets exactly one PATH key even when the parent process hands over both `PATH` and `Path`.
  Two comments in the co-GM dashboard tests and `app.ts` now say that the stream tests rely on the order of
  the snapshot events, and the prefs test comment describes what it really checks.
- **A guarded update that Foundry quietly drops now fails and is undone:** after each update the
  module checks that a token's position and size (x, y, width, height, depth) are what Foundry
  stored. If a constrained move, a hook or a region made Foundry ignore part of it, the change stops with a
  message naming the path, and what did land is put back.
- **Fit tokens to the map's scale (follow-ups to #418):** the size also sets the token's depth; a
  whole-scene fit skips party and encounter actors that have no creature size; a token that is
  already the right size but not locked shows "already 0.25 squares; locks the size"; the
  `plan-token-change` description says "every creature" and that a 2.5 ft scene makes tokens larger.
- **Combat strip on another scene:** Damage, Heal, Condition and Clear on a picked combatant now
  work when the fight runs on another scene than the one being viewed. The module also looks the
  token id up among the combatants of the fight the strip shows (by id only, never by name).
- **Live Feed:** the event list is a keyboard tab stop only when it scrolls.
- **Help pane:** after a link to another guide, keyboard focus stays in the pane instead of
  dropping to the page.
- **Undo leaves no empty objects in the vault files:** undoing a Tarokka link, a reveal or a first
  import no longer leaves an empty `{}` per card or page in `gm/tarokka-config.json`,
  `gm/reveals.json` and the other vault files. Readers treat a missing object like an empty one.
- **Hook test timing:** the guard-shell-edits "100 KB single token" speed test takes the best of three runs, so a busy machine no longer fails it while a really slow hook still does. The denied list also covers `p = p.replace(...)` on a loop variable.
- **Hook timing tests:** the cd-chain check in `guard-shell-edits.test.mjs` and the two speed checks in
  `warn-control-bytes.test.mjs` now take the best of three runs against their caps, through one shared
  `bestMs` helper (`.claude/hooks/best-ms.mjs`), so a busy machine no longer fails them.
- **Assistant GM browser runs at low priority on the Pi (I-098):** the `foundry-ai-tool-gm-browser`
  service now has `Nice=10` and `CPUWeight=20`, so its headless Chromium never competes with
  Foundry's main thread on game night. It takes effect when stage 5 is next rerun on the Pi.
- **Docs:** the dashboard guide no longer says plans can come from Obsidian (that is not built).
- **Bridge link (#184 review lows):** a bad `capabilities` list in a module hello (over 50 entries,
  an entry over 100 characters, or the wrong type) now costs only the capabilities; the hello still
  counts. A non-active socket is served a `module-request` only when its hello names the same world
  as the active link.
- **Change journal test no longer ages out:** the pump tests used the real clock against records dated 2026-10-06, so once that day was 7 days old retention removed the files and 18 tests (and CI on every PR) failed. The tests now give the pump a fixed clock.
- **`use-npc-activity` acts on the token, not the world actor:** on an unlinked token (a boss placed
  from the sidebar) a legendary action or a limited use was spent on the world actor, so the token's
  own pips and the dashboard never changed. The tool now looks for a token on the current scene first
  (by token name or id, or the only token made from the given actor's name or id) and falls back to
  the world actor. Damage, healing and conditions resolve their targets the same way, so an actor id
  from the dashboard's picker now reaches a lone unlinked token there too.
- **`get-character` reads that token too:** after a boss spent a legendary action, the sheet still
  showed the world actor's full pool. It now uses the same rule (a token on the current scene by
  name or id, or the only token made from that actor), so the sheet matches what was spent. Several
  tokens from one actor still read the world actor.
- **A dashboard test no longer depends on the checkout's file ids:** the "Open in Foundry" page
  header test passes on a Windows checkout whose file ids are above 2^53, as it already did on
  Linux and in CI.
- **No console error when ownership is removed or undone:** taking a player's ownership level
  off an actor or page (undoing "give Player OBSERVER", hiding a handout from chosen players) no
  longer logs "ownership: is not a mapping of user IDs and document permission levels" in
  Foundry 14. The module now always replaces the whole ownership map instead of first sending a
  per-key deletion that Foundry 14 rejects; the result is the same as before.
- **Node 22 is the floor everywhere (PB-09):** `engines.node` is `>=22` in the root, dashboard and
  bridge packages (and the LiveKit recorder), the standalone bridge zip says Node 22, the Docker
  image is `node:22-slim`, and the client installer bundles Node 22.23.3 (was 20.12.2). The installer
  build now checks the downloaded Node zip against a pinned SHA-256 and stops on a mismatch. The
  bundled bridge and client are built for the `node22` target, and `@types/node` is the 22 line.
- **Pi scripts lows, round 3 (#354 review):** the second `revert_running` check in stage 15 CONFIRM now has its own container scenario (`confirm-revert-starts`: the revert service starts while CONFIRM stops the timer, no marker); `player-run.mjs` refuses the live world by name and before it makes a temp folder, so a refused run leaves nothing behind; the kit-session teardown notes say "timezone change" instead of "clock step", because `STAMP_EPOCH` fixes DST and timezone changes only.
- **Pi scripts lows, round 4 (from the #355 review):** the `confirm-revert-starts` container scenario
  clears the command log before `CONFIRM=1`, so the "revert timer was stopped" check in
  `ssh-keys-only.test.mjs` can no longer pass on the stop logged by the first run. The player-run
  comment now says the temp folder is made after the refusals that need no browser, and the world
  refusal message is built in one place.
- **A player who opens the dashboard address lands on the player view:** with the player/GM split
  on, a player (a player token, or a Cloudflare Access email outside `GM_EMAILS`) who opened the
  dashboard root or `/next/` got the GM page with nothing in it. Both pages now ask the server for
  the role and send a player to `/player`, taking their player token along. A visitor turned away
  without a token who has a player token saved goes there too. The GM page is unchanged for the GM,
  and a GM whose saved link is stale stays on it: `/api/state` marks a token it does not know
  (`unknownToken`).
- **Pre-flight findings stay open:** when a pre-flight run finished, the drawer redrew the
  "N finding(s)" list closed, so a GM who had opened it saw it snap shut. An opened list now stays
  open across the redraw (a closed one stays closed). Found by the test kit.
- **Python tests in CI (D-109):** a new `python-tests` job runs the 19 test files of the Python tools under `tools/` (narration, session notes, session pipeline, transcriber; 218 tests) on Python 3.12 with pytest, numpy and ffmpeg. No model runs: the model packages are imported lazily and fakes stand in. Every `tools/<name>/` with a `pyproject.toml` and a `tests/` folder is picked up by itself.
- **get-compendium-item shows the same rarity as the search:** the item detail gives the label
  ("Very Rare") from `rarity` or dnd5e 6's `rarities` list instead of the raw key, and a blank
  `rarity` no longer hides a filled `rarities` list (search summary and detail).
- **Secrets on the "My character" sheet:** a secret block with another section inside it no longer
  shows its tail to the player. The module now drops secret elements with everything nested in
  them (any tag with a `secret`, `gm-only` or `gm-note` class, and `secret-block`), plus HTML
  comments (#155 review point 6).
- **Combat strip on a duplicated scene:** Foundry keeps token ids when a scene is copied, so a strip
  pick on scene A could land on the token of a viewed copy. The live plan now refuses an id that is a
  different token in the fight than on the viewed scene, names both scenes, and says to view the
  fight's scene to hit its token, or to name the token to hit the one on the viewed scene.
  (Backlog: strip-pick; #343 review L2)
- **`live:sweep` clean-up noise (#331 round 2 L1, L3):** the clean-up no longer reports a FAIL line when the handout page it wanted to unqueue is already out of the reveal queue, and the coverage test reads the tool lists of `tool-sets.ts` without being cut off by a `]` inside a comment.
- **A Tarokka reveal can no longer publish a card from a reading that was replaced.** If the
  reading changed between planning a reveal and applying it (Claude dealt a new one, or a second
  dashboard tab or the Foundry window imported one), the apply wrote the old card's text to the
  players' journal and marked the position revealed in the new reading. A re-reveal (updating a
  page already shown) had no check at all. The reveal plan now pins the reading it was made for
  and that position's card (a re-import of the same deal can change one card), and the apply
  refuses with "Conflict, nothing was written: tarokka.json current.readingId changed since" (or
  the card's path); plan the reveal again. This covers the dashboard, Claude and the Tarokka window
  in Foundry.
- **Guarded writes can pin vault values (`vaultChecks`).** A plan can name GM vault values it was
  built on. They are checked when the plan is made and again at apply (nothing is written in
  Foundry or the vault when one changed), but they are never written: no line in the confirm
  window or Recent Changes, nothing in the audit entry, nothing for Undo, and a file that is only
  checked is not rewritten (no Obsidian mirror churn).
- **Dashboard theme saves no longer race:** two tabs choosing a theme at the same moment could
  trip over the shared temporary file; saves now run one after another, like the layout choices.
- **Tool counts that cannot drift:** the README table said the core set has 20 tools when it has 22, and two code comments still carried tool counts and sizes from before the catalog shrank. The comments no longer hold numbers, and a new test checks every tool count and size in the README and in the tool-sets reference against the real catalog, so a stale number fails the build.
- **Merge gate lock without hard links:** when hard links are missing, `acquireLock` now copies a moved lock back with an exclusive create and prints the lock-race warning if a third run took the slot, instead of renaming over that run's lock (#385).

### Orange Pi (D-068)

- **GM scripts on the Pi:** `gm-script.sh` runs one GM script (a local file on the Pi) in the
  running world as the Assistant GM, so world changes that need a GM in the browser (a module's
  own import, placing map pins) work without anyone typing the Gamemaster's password. A dry run
  lets only known reads through (an allow list, checked in the page and again on Foundry's socket) and
  lists everything it held back; a real run needs a passed dry run of the same file first. The
  bridge link stays down while a script runs. Every run logs the file, its sha256 and the result
  to the journal and keeps a copy of the script. Nothing over the network can start one. The
  Assistant GM's service mode is unchanged.
- **The remote-command guard closes the older gaps the PR #146 review found:** ssh written another
  way (`bash -c 'ssh ...'`, `/usr/bin/ssh`, `"ssh"`) is checked, and
  `ssh localhost "ssh foundry-pi ..."` no longer passes as a localhost-only command. A command word
  behind a wrapper counts (`sudo -n reboot`, `nohup reboot`, `then reboot`, `timeout 10 reboot`,
  `env A=1 userdel x`). `rm` options after the path count (`rm /srv/data -rf`), which also catches
  `rm --interactive=never -rf /etc` (it passed before). A recursive `chmod`, `chown` or `chgrp` of
  any path outside our own folders asks (`chmod -R 777 /etc/ssh`, `chown -R x /usr/lib`), and
  `/usr/*` is denied like `/usr`. `chmod`, `chown`, `chattr` and `install` on a critical file in
  /etc ask, and writes to /boot ask (`sed -i ... /boot/dietpiEnv.txt`). Network changes ask
  (`ip link set eth0 down`, `ifconfig`, `ifdown`, `nmcli ... off`, `tailscale down` or `logout`),
  and so do SSH and network services stopped through `systemctl stop "ssh"`, `service ssh stop`,
  `/etc/init.d/ssh` or `pkill sshd`. `apt-get -o X=y remove` also asks. Every new check runs in
  linear time (the 50,000-character test has 32 new shapes). The old and new guard were compared on
  about 43,000 commands (hand-written, generated and the new shapes) plus the 38 ssh lines in
  PI-SETUP and the Pi scripts: no decision got looser, and the stage scripts and drill commands
  pass as before.
- **The remote-command guard checks long commands in linear time:** the regexes that re-read the
  rest of a line from every possible start (`rm -rm -rm ...`, runs of newlines, `(`, `;`, `$(` or
  quotes, `sed -i...`, a `cat` with no pipe after it, many `.sh` names) are replaced by scans that
  read each stretch once. A crafted 50,000-character command took up to 36 s before (a hook past its
  timeout lets the command through); now every check takes a few milliseconds, and tests hold it
  under 200 ms.
- **More ways to delete everything are caught:** `cd / && rm -rf *` (a relative delete is resolved
  against an earlier `cd` in the same script), `find / -delete` and `find ... -exec rm` (by start
  path, like `rm`), `xargs rm` (asks), `rm -rf -- /` and `rm -rf --interactive=never ~` (deny now,
  like `rm -rf /`), and paths that only reach / or a system folder after `..`, `//` or `/./`, or
  through a wildcard in the first folder (`/e*c`). Every path of an `rm` is checked, not only the
  first. `rm -rf *`, `.` or `..` with no known folder, and deletes in the home folder (`~/x`), ask.
  A comparison of the old and new guard on about 41,000 commands (the review's hand-written cases
  and generated ones) found no decision that got looser; the stage scripts and the rebuild drill
  commands pass as before.
- **The remote-command guard** (`.claude/hooks/guard-remote-commands.mjs`) lets commands through
  whose only ssh, scp, sftp or rsync target is this machine (`127.0.0.1`, `localhost`, `::1`), so
  stage scripts can be tested against an SSH server in the ARM64 test container; a jump host, a
  proxy, a `HostName` override or any other target keeps the guard on. It also asks now when a
  script keeps the `authorized_keys` path in a variable.
- **Kit session (strahd-kit test run):** a new reviewed Pi script, `kit-session.sh`, sets up the throwaway world
  `strahd-kit` so a player can make a level-1 character in Actor Studio as the passwordless user `Kit Player`
  (`MODE=up`), and afterwards deletes that user and the actors it owns and puts Foundry, `options.json` and the
  Assistant GM browser back (`MODE=down`). It never touches `curse-of-strahd`, keeps copies of the world's settings,
  users and actors, and undoes itself if anything fails. Tests: `scripts/pi/kit-session.test.mjs`, with an ARM64
  container run like stage 13's.
- **Stage 4 turns Tailscale DNS off on the Pi:** a DHCP lease renewal emptied `/etc/resolv.conf`,
  Tailscale rewrote it with no upstream resolver, and from then on every public name failed on the
  Pi (github.com for a stage 5 build, apt, a Discord reconnect for the bot). Stage 4 now runs
  `tailscale set --accept-dns=false`, so the Pi asks the router for names; Tailscale itself, SSH and
  the tailnet shares are unchanged. The Pi needs no tailnet names. Applied by hand on the Pi on
  2026-10-06 with the user's OK.
- **Stage files are readable by the services again:** stage 9's SSH logging wrapper set `umask 077`
  for its log and passed it on to every command, so a stage 5 build on 2026-10-06 came out root-only
  and the bridge (it runs as `foundry`) could not start. `lib.sh` now sets `umask 022` for every
  stage, and the wrapper keeps 077 for its own log and saved scripts only, giving each command the
  session's umask back (checked in an ARM64 Debian container).
- **Stage 9 swaps its wrapper in one rename:** it used to rewrite the wrapper in place while the SSH
  session running the stage was executing it (bash reads a script as it goes), and checked the
  syntax only afterwards. The new wrapper is now written beside it, checked, then renamed over it.
- **Stage 12 also needs Foundry's administrator password (#308 review):** without one, `/setup`
  would be open to anyone past Cloudflare Access. The stage and `gm-passwords.sh` check that
  `Config/admin.txt` is there (the file is never read). The GM check now fails when there is no
  worlds folder, removes its copy of the users databases even when a run is cut off, and copies a
  symlinked users folder instead of opening it in place. The docs say to rerun the check after
  adding worlds or GM users, and explain the "no Gamemaster" refusal.
- **No tunnel while a GM has no password (#273):** stage 12 now checks every world on the Pi first
  and stops, before it installs anything, while any Gamemaster or Assistant GM user has no password
  or a world has no Gamemaster (its next launch would make one with no password). It names the world
  and the user, never a password hash. `gm-passwords.sh` runs the same read-only check on its own.
  On the Pi on 2026-10-10 all four worlds passed.
- **Pi kit follow-ups (after the first live kit session, 2026-10-13):** the health check (`1-health.sh`) warns
  "kit session up since" plus the time while a kit session was never taken down (Foundry would launch `strahd-kit` on game
  night). Stages 11 and 13 now change `options.json` as the `foundry` user through a temp file and a rename, like
  `kit-session.sh`, so root never writes through a folder the foundry user owns. The nightly backup (stage 6) leaves out
  the Kit GM browser profile like the Assistant GM's. The test kit docs now say the Pi target's `host` must be the Pi's
  full Tailscale name (the dashboard answers anything else with HTTP 421) and that the dashboard token file is optional.
  The stage scripts are changed in the repo only; they are deployed on the next reviewed stage run.
- **The kit session gives the kit a GM:** `kit-session.sh MODE=up` also makes the GM user `Kit GM`
  in `strahd-kit` with a generated password (kept in a root-only file on the Pi), enables the bridge
  module there, makes `Kit GM` the bridge user and starts a transient headless browser that joins as
  `Kit GM` and holds the bridge link (the real Assistant GM browser stays stopped, as before).
  `MODE=down` stops that browser, resets the bridge user, deletes `Kit GM` and removes the password
  file and the browser profile. A failed or dropped `MODE=up` puts everything back.
- **Rebuild drill** (`scripts/pi/rebuild-drill.ps1`, section "Rebuild drill" in `docs/dev/PI-SETUP.md`):
  one command rebuilds the Pi in an ARM64 Debian 13 container on this PC, never touching the Pi. It
  reads the newest snapshot of the restic copy in `E:\PiBackup` (read-only, `--no-lock`), runs
  stages 1 to 3, restores the snapshot, runs stages 5 to 8, starts Foundry, the bridge and the
  dashboard from the unit files the stages wrote, and checks the result (about 10 minutes, most of
  it stage 5's build; the timings are in the guide). Stage 4 (Tailscale login) and stage 9 (SSH log)
  need a person and a real Pi and are skipped.
- **`scripts/pi/drill/restore.sh`:** the restore step of a rebuild: the newest snapshot into a
  staging folder, copied into place with the old `foundry` user's owners fixed. The guide's runbook
  for a real rebuild uses it.
- **What the drill found, in the runbook:** restore before stage 6 (otherwise the restored
  `restic-pi.pass` does not open the new repository); the Foundry licence is bound to the host name
  `foundry-pi`; the `foundry` user id can change; the drill leaves out Syncthing's device key so a
  container never runs with the real Pi's identity; a restore on Windows exits 1 over one Chromium
  symlink.
- **Drill and runbook safety:** `restore.sh` stages in `/var/lib/foundry-restore/restored` (override
  with `STAGE_DIR`), removes it on exit even after a failure, and puts stage 9's `ssh-log` folder
  back to root only after the `chown`. The runbook copies the PC repository into
  `/var/lib/foundry-restore` (so the cleanup passes the SSH guard hook), adds stage 9 and
  `ssh-keygen -R` after a reflash. `rebuild-drill.ps1` restores the caller's restic variables, stops
  the container even when a stage fails, and says at the end where the restored secrets are left.
  The drill's check compares the Syncthing device certificate with the restored one.
- **Stage 9, a log of SSH commands** (`scripts/pi/remote/9-ssh-log.sh`): every login with the PC's
  key runs through `/usr/local/sbin/foundry-ssh-log` (a `command=` prefix on the key line;
  `sshd_config` is not touched), which writes one line per command to
  `/var/lib/foundry-ai-tool/ssh-log/ssh-commands.log` and keeps a copy of every `bash -s` script,
  then runs the command unchanged; sftp and interactive logins pass through. It fails open. Root
  only, rotated weekly, 12 weeks kept. The switch arms a 5-minute timer that restores the old key
  file unless a new connection confirms (`CONFIRM=1`); `UNDO=1` removes the prefix again.
- **`set-discord-token.ps1`** sends its script as `bash -s -- no-log`, so the log records the
  command but never its input (the token).
- **Stage 11 follow-ups before the first real push:** `world-refs.mjs` matches secret words only in a
  setting's own name (after the module id), so module names like vtta-tokenizer no longer count; a
  name that is or ends in token or key, or holds credential or private key, always counts, with a
  short safe list (`core.defaultToken`) instead of a pattern. An active ddb-importer gets its own hint
  (switch it off in the world after the import). A failed stage 11 run puts back only what was
  running before it (Foundry, the Assistant GM browser), instead of starting both.
- **Stage 11 and `push-world.ps1` move the Strahd world to the Pi:** `scripts/pi/push-world.ps1` builds
  one checksummed `.tar` of the world, its private modules and the `ddb-images` and `tokenizer` folders
  it uses (found by `scripts/pi/world-refs.mjs`, which scans the world and the module packs for asset
  paths and stops on a missing file, a module that is not in the bundle, or a secret-looking setting)
  and uploads it to the Pi; `scripts/pi/remote/11-world.sh` checks the tar before extracting it,
  installs it, keeps old copies in `prev-<time>`, never replaces an existing campaign world without
  `REPLACE_WORLD=1`, resets a `strahd-kit` test copy, generates a root-only GM password file per
  world and provisions each world like stage 5. ddb-importer, env files and the D&D Beyond cookie
  never travel. Tested in the ARM64 container with a fake world, including crafted bad bundles.
  The PR review added: a secret word (cookie, token, secret, password, key) in a setting name is
  always a problem, whatever `-AllowSettingKeys` says; paths are checked with their exact letter case
  (Windows ignores it, the Pi does not); modules active in the world but not shipped, and a GM user
  with a password, stop the push; both scripts follow the 20 percent free space rule (warn below
  20, stop below 5); stage 11 puts `options.json` back and restarts Foundry when a run fails, and
  copies changed same-name images to `prev-<time>` before the merge.
- **Stage 11 takes a second world (D-118):** `LAUNCH` may name a world that is already installed, so
  the Frostmaiden training world goes in while Foundry keeps launching the campaign. `EXTRA_GM_USER`
  adds a second full GM with its own generated password to the world's env file, once; another name
  already in the file, or one equal to the world's GM or the Assistant GM, stops the run before
  anything changes. The `strahd-kit` test copy is the default only for `curse-of-strahd`: any other
  world must set `KIT_WORLD`. The push-back module check keeps the Pi's copy when the numbers match
  but a pre-release suffix differs (1.2.0 and 1.2.0-rc1), and the summary masks module versions.
  Stage 13 follows the same `KIT_WORLD` rule.
  `push-world.ps1 -PiModules` names modules the Pi already has so a second world does not ship them
  again; stage 11 refuses the bundle if one is missing on the Pi or is also in the bundle.
  Another `WORLD` must also set `LAUNCH` (not empty), `KIT_WORLD` may not be `curse-of-strahd`,
  `strahd-kit` or the `LAUNCH` world, a bundle for any world but `curse-of-strahd` that ships modules
  needs `SHIP_MODULES=1`, an extra GM name with a space at either end is refused, and a failed
  provisioning is retried by a plain rerun (a `world-<id>.pending` marker is written for every world
  of the run and stays until that world's provisioning worked). `push-world.ps1 -PiModules` records each
  module with the PC's version (`pi-modules: id@version`), and stage 11 refuses a bundle when the Pi's
  copy is older than that. The printed push-world command for another world carries
  `KIT_WORLD= LAUNCH=curse-of-strahd`, and `-Modules ''` means no modules.
- **Stage 13 tests in the repo (#232 follow-up):** `scripts/pi/player-creation.test.mjs` checks the
  settings script against a fake `game` (usage-tracking off for every user, a second run changes
  nothing) and runs the stage in an ARM64 container with stand-ins for systemd: the downgrade guard,
  an unreadable `/api/status`, services that were off, and a failed Assistant GM browser start. CI
  runs the container part on the ARM runner (Debian image pinned by digest, one apt retry, a missing
  Docker fails). The settings script now runs its main part through a symlinked path too (it exited
  0 doing nothing), and the scenarios script refuses to run outside a container.
- **Stage 5 drops the dev packages after the build:** `npm prune --omit=dev` removes the compilers,
  test runners, Storybook and linters (#303 alone added about 42 MB) from the Pi's tool build.
  `playwright-core` moves to the root `dependencies`, because the Assistant GM driver and stages 11
  and 13 load it from the build. Older tags that still list it as a dev package keep everything
  (with a warning), and the stage stops before the swap when the build has no `playwright-core`.
- **Stage 5, the tool on the Pi** (`scripts/pi/remote/5-tool.sh`): builds a tag on the Pi
  (default: the newest release tag, see the release-tags entry), copies the module into Foundry from the same build, and runs the bridge, the
  dashboard and a headless Chromium logged in as the Assistant GM user (`assistant-gm.mjs`, role
  Assistant, no canvas) as services. Everything listens on loopback; Tailscale serve shares the
  control port and the dashboard with the tailnet only. `5-check-world.sh` proves the chain in a
  throwaway world `pi-check` (dnd5e, launched by `options.json`, generated passwords in root-only
  files, nothing typed).
- **Stage 6, backups** (`scripts/pi/remote/6-backup.sh`): a nightly restic backup at 04:30 of
  Foundry's data, the tool's storage and its secrets into `/var/lib/foundry-backup/restic` (7 daily
  kept), written as a systemd timer. Foundry stops for the minute or two the backup takes (a trap
  always starts it again); logs, the Assistant GM's browser profile and recordings are left out. The
  repository password is generated on the Pi in a root-only file and never printed.
- **The PC copy** (`scripts/pi/pull-restic.ps1`, task "Foundry Pi restic copy" from
  `register-restic-task.ps1`, daily 12:30 and 15 minutes after logon): copies new Pi snapshots into
  `E:\PiBackup\restic` over SFTP (14 daily, 8 weekly, 12 monthly kept) and once a month checks 10 % of
  the data and test-restores the newest snapshot's worlds. The PC repository's password is generated
  once in `%APPDATA%\foundry-ai-tool`; store a copy in your password manager. No USB drive any more
  (`docs/dev/PI-SETUP.md`).
- **Stage 7, the GM vault and Syncthing** (`scripts/pi/remote/7-vault.sh`): points the bridge's
  Obsidian output at `/var/lib/foundry-ai-tool/obsidian/gm` (`bridge.env` and `dashboard.env`, the
  services restart only when a file changed) and runs Syncthing from Debian as its own service
  (`foundry-ai-tool-syncthing`, user `foundry`, files in `/var/lib/foundry-ai-tool/syncthing`, never
  in Foundry's data folder). UPnP, usage reports and crash reports are off, relays and global
  discovery are on, the web page listens on loopback. The vault folder `foundry-gm-vault` syncs in
  both directions, so the GM's `Prep/` notes reach the Pi's backups. `PEER_ID` and `PEER_NAME` add a
  PC's device and share the folder with it. The Foundry mirror switch stays off.
- **`scripts/pi/setup-syncthing-pc.ps1`:** sets up the receiving PC: a hidden "Syncthing" task at
  logon (it finds the winget `syncthing.exe` at every start, so an upgrade does not break it), the
  same options, the Pi as a device (discovery plus its Tailscale name), the folder at
  `Documents\Obsidian\Foundry GM vault` and the `.stignore`; prints the PC's device ID. `-Remove`
  takes the task away. The Pi runs Syncthing 1.x and a winget PC 2.x (same protocol; the container
  test used 1.x on both sides).
- **Stage 8, the recorder bot** (`scripts/pi/remote/8-recorder.sh`): installs the Discord recorder
  bot from the stage 5 build into `/opt/foundry-ai-tool/discord-bot` (its dependencies pinned to the
  versions that build installed; the previous copy kept for a rollback), checks that discord.js and
  its native part load on the board, makes `/var/lib/foundry-ai-tool/recordings` (2770), writes
  `/etc/foundry-ai-tool/discord-bot.env` from the example when it is missing and installs the
  service from `packages/discord-bot/deploy`. The service stays off until the env file has a token;
  an update stops a running bot first, which closes and converts a recording in progress.
- **`scripts/pi/set-discord-token.ps1`:** asks for the bot token without showing it (and optionally
  the server id), sends it to the Pi on stdin (never on a command line or in a file on the PC),
  replaces only those lines in the env file and starts the bot; it shows only the bot's login line
  from the journal.
- **Plan B push-back, #274 review lows:** stage 11's change check skips the GM named in the
  world's `world-<id>.env` (the one setup provisions), not this run's `GM_USER`. The module version
  compare is a tested helper: `v1.2` and `1.2.0-rc1` read as numbers, and a version that cannot be
  read keeps the Pi's copy with a warning instead of a silent downgrade. PLAN-B.md says the GM and
  Assistant GM user documents are replaced whole.
- **Stage 10, a storage space check** (`scripts/pi/remote/10-space-check.sh`): an hourly systemd timer
  runs `/opt/foundry-ai-tool/space/space-check.sh`, which writes
  `/var/lib/foundry-ai-tool/space/status.json` (free space per filesystem, the jobs that use it, a
  level: low below 20 % free, critical below 5 %) and logs a WARNING or CRITICAL line to the journal.
  `UNDO=1` removes it. The Discord bot and the dashboard read the status file (separate change).
- **The nightly restic backup checks first** (`6-backup.sh`): it runs the checker as its own job,
  records `lastJob`, still runs below 20 %, and is skipped before Foundry stops when space is critical
  (under 5 % free on a disk it uses; no source-size test, since restic stores only changes and the
  repository shares the disk). The call has a 60 second limit and a failing checker only warns. A job
  run changes only `lastJob`, never the disks' levels. Run stage 6 again after stage 10.
- **The PC pulls check space** (`scripts/pi/space-check.ps1`, called at the start of
  `pull-snapshot.ps1` and `pull-restic.ps1`): the backup drive, the Syncthing vault folder and the
  Pi's status (read-only over SSH). Below 20 % free they log a WARNING and show a Windows
  notification naming the disk, the free percentage and GB, and the job; at critical on the
  destination they skip the copy and exit 1. A missing or stale (over 3 hours) Pi status is only a
  warning. `-Test` prints what would be notified.
- **world-refs false alarms (push-world stage 11):** a GM user whose stored password is Foundry 14's
  hash of the empty string (it keeps a hash and `passwordSalt` even with no password) no longer counts
  as having a password; the salt is read but never printed. `nue/defaultscene/*` counts as one of
  Foundry's own files. Strings under a document's `flags.ddb` (D&D Beyond importer metadata such as
  `assets/cos1302.jpg`) are no longer collected. New `--allow-missing a,b*` (and `-AllowMissing` in
  `push-world.ps1`) for a reviewed list of known missing paths: a path that is really missing on disk
  and matches is no problem, is listed and counted in `allowedMissingCount`, and the list is written
  into `MANIFEST.txt`. A `*` needs a root and a folder before it (`modules/*` is refused), a
  wrong-case path stays a problem, and a path in an unknown root is now looked up on disk: one that
  exists (for example under `Data/assets/`) is reported as present but outside the bundle and can
  never be allowed.

### Dashboard (D-080)

- **The README brand is the neutral theme:** Space Grotesk for display text and JetBrains Mono
  for the technical bits (bundled, SIL Open Font License), the hex mark in the header instead of
  the old emoji, the "Foundry AI Tool" wordmark with AI in arcane blue, a faint hex grid under a
  soft blue glow, and the glow on the active tab and layout. The one orange spark stays in the
  mark. The Veil keeps its own fonts and recolours the mark. Applies to the dashboard, `/player`
  and `/me`.

### Security

- **CodeQL findings (first scan, 2026-10-09):** CI runs with a read-only `GITHUB_TOKEN`. Table
  cells in Obsidian notes, the test kit report and the usage log escape a backslash with the pipe,
  so text ending in `\` can no longer split a cell. A character sheet's plain text decodes
  `&amp;` last, so an escaped `&lt;` in a description stays text instead of turning into `<`. The
  tool reference escapes backslashes in descriptions, and now shows their `\"` as written.

### Undo for everything (I-109)

- **A concentration effect stays with the spell that ended it:** when one AI change deletes a
  concentration spell and the next deletes another item on the same actor in the same burst,
  dnd5e's late delete of the concentration effect (and the buffs it held) is filed under the
  change that deleted that spell, read from the effect's own data, so "just this" on either
  change puts back the right things. An effect that names a spell no AI change deleted (the
  cached spell of a deleted wand, or a token whose effect names the base actor's item) still
  goes with the change on that actor.
- **No half undo after a history cap:** when the change history had to leave out an AI change's
  own records (its size cap, a day's cut, or the journal start), or the journal lost them, "just
  this" on that change is refused if it deleted an item or effect, because what dnd5e ended with
  it (concentration, a Bless on another character) would not come back. Other such changes are
  still undone, with a note that what Foundry and dnd5e did with them does not come back.
- **A stream of changes is no longer one endless action:** a browser starts a new change group
  after 30 seconds or 2000 operations even without a pause, so a module or macro that updates a
  document several times a second can no longer hide every later change from that browser once
  a cap drops its group. A guarded AI write is never split from what dnd5e does right after it,
  however long the apply runs.
- **A concentration effect cast from a wand, or named by the base actor's uuid, stays with its
  own change** when a later AI change in the same burst deletes another item on that actor: the
  effect is matched by item id, and a wand's cached spell by the wand it was cast from.
- **No partial action at the history's start:** an action with a record within a few seconds
  after the journal start (retention removed the day before, or Foundry's buffer wrapped) may
  have lost its first records, so it is left out whole and the history says it is complete only
  after it.

### Module

- **The creature index sees pack changes again and rebuilds them in the background** (#283
  lows 1, 3, 4): the index listened to `createDocument`, `updateDocument`, `deleteDocument`,
  `createCompendium` and `deleteCompendium`, hooks Foundry 14 does not have, so a changed Actor
  pack never invalidated it. It now listens to `updateCompendium`. The old invalidation sent a
  `DELETE` for the saved index, which Foundry's server ignores, so a creature change now writes
  its time to a hidden world setting (`creatureIndexDirtyAt`) from every GM browser, and a saved
  index built before that time counts as stale in every browser. Five seconds after the last
  change the bridge GM's browser (with Bridge User "Any GM": the active GM's) builds the index
  again. Creature queries no longer wait for that build: they get the saved index until the new
  one is ready, and only a world with no usable saved index waits. The warm-up at `ready` still
  runs in every GM browser with "Any GM". Still not seen: an edit to a feature or spell inside a
  compendium creature (Foundry fires no `updateCompendium` for it); a later pack change or
  "Rebuild Creature Index" in the Enhanced Index window picks it up. Tests cover the warm-up gates, the
  hook, the stale stamp, stale reads and the background rebuild.
- **Creature queries during an index build (#283 review low 2):** while the Enhanced Creature
  Index builds (the first load after a module update, or after a compendium change; longer than
  the bridge's 10 s on the Pi), list-creatures-by-criteria answers after 8 s that the index is
  building and to try again in a minute, instead of timing out. The build carries on.
  search-compendium with creature filters falls back to its name search meanwhile.
- **The creature index build no longer freezes the GM's browser** (#302 follow-up): a build
  loaded each monster pack with one call, which built every creature at once and froze the bridge
  GM's browser for about 10 seconds per big pack, so a creature query in that time could time out.
  It now loads the creatures in small chunks and lets the browser work in between, and skips pack
  entries that are no creatures. The chunk size adapts to the PC: each chunk aims for a quarter
  second, so a busy PC loads fewer creatures per chunk. Each pack starts with 5 creatures, since
  the first 2024 monsters take far longer to load than the 2014 ones. The progress note shows how
  far a big pack got. A Foundry tab in the background (hidden or minimized) loads in big chunks
  without pausing, since nobody is using it and a background tab runs the pauses far later.
  Also from the #302 review: a query on a world with no saved index can no longer get an empty
  answer when the build ends while it reads the file; a file read that began before a build ended
  no longer replaces the newer index (which cost one extra build); a current index in memory is
  served without reading the file again; and after a failed first build, creature queries use the
  basic search for 60 seconds instead of starting (and failing) a full build each time. The
  warm-up at `ready` and the rebuild after a pack change still build.
- **Creature index: fewer and safer background builds** (#293 delta review 2 lows): after a
  failed build, creature queries serve the saved index and start no new build for 60 seconds, so
  a build that keeps failing (an upload denied, a full disk) no longer runs and shows its error on
  every query. While a build runs, queries serve the index already in memory instead of reading
  and parsing the file again. The `creatureIndexDirtyAt` stamp now only goes up, and a build saves
  the stamp it saw instead of its own start time, so clock differences between GM PCs neither hide
  a creature change nor cause extra builds. The warm-up builds once more when the build it waited
  for turned stale meanwhile. The rebuild 5 seconds after a change is skipped when a build since
  the change (started by a creature query) already has it, so one edit costs one build, not two
  (seen live: two 14-second builds back to back). A new test runs the whole loop (edit, stamp,
  old index served, real rebuild, new index) with no stubbed build.
- **The creature index rebuilds when the world loads, not on the first query:** when the bridge GM's
  world loads and the saved creature index is missing or out of date (a module update changed its
  version, or the monster packs changed), the module rebuilds it in the background with its usual
  progress notes. The first creature search no longer runs into the 10 second query limit on a big
  world (18.8 s measured with seven monster packs). A search during the rebuild waits for that same
  rebuild instead of starting a second one, and so does the "Rebuild Creature Index" button.
- **Enhanced Creature Index window on ApplicationV2 (D-109):** Game Settings, Foundry AI Tool,
  **Configure Enhanced Index** now opens an ApplicationV2 window instead of the v1 FormApplication
  that Foundry 14 deprecates. Same switches and Rebuild button; Save keeps the window open and says
  "settings saved".
- **Compendium search asks for item summary fields only where a name matched:** the first
  search no longer re-indexes every Item pack one by one before matching (on a large licensed
  world it could pass the 10 second query timeout). Names match against each pack's plain index
  first (packs without an index load six at a time); then only the Item packs with a hit get the
  summary fields, all at once, within a 4 second budget: past it the search returns plain results
  and the next search has the summaries. Searches running at once share one fields request per
  pack. A pack whose fields request fails keeps its plain results instead of dropping out, a
  pack that fails to index no longer stops the others, and Foundry's own index check replaces the
  module's cache, so a pack re-indexed by something else gets its fields back. Packs written by
  dnd5e 6 send their `rarities` list too.
- **get-compendium-item keeps an activity's save:** the sanitizer dropped every `save` key, so
  save activities lost their ability and DC. Only an ability entry's legacy `save` is skipped now.
- **get-character-entity:** the item's HTML description goes out once (as `description`, no longer
  also in `system.description.value`), and a name shared by several items on the character is an
  error that lists their ids instead of a silent pick of the first.
- **GM windows, review lows (#403):** a failed redraw of a GM window is logged instead of becoming an
  unhandled rejection; the Combat window's Next/Previous turn buttons re-check the GM-only switch at
  every click; tests now cover hook removal on close and the escaped party text.
- **The Veil on the join page (I-086):** a GM-only "Join page look" button in the module settings
  gives Foundry's join page, the first screen players see, the campaign look: an original mist and
  castle background picture and a lamplit line in The Veil colours at the top of the world
  description (the GM can write the line). Foundry loads no module code or styles on that page
  and cleans the description when it saves it, so the button saves world details instead (the
  same request Edit World uses, no admin password): the background picture and one marked block
  with inline styles only. The GM's description text is kept; "Back to Foundry's look" removes the
  block and The Veil picture. The full stylesheet (fonts, panels, a lamplit Join button) waits for
  I-150.
- **Creature index chunk minimum stays at 5 (#306 low 1):** a minimum of 2 or 3 was measured on the 2024 monsters and did not shorten the longest freeze but made the build about 15% slower, so the comment next to the constant now records the numbers.
- **Scene snapshots in the play log:** `scene` records carry `data.active` (the active scene, or
  a GM preview), `data.players` (the players online) and `data.tokens`: the tokens on that scene,
  folded by world actor (uuid, name, PC or NPC, hidden only when all its tokens are), at most 200
  with visible actors kept first. `user-join` and `user-leave` records carry `data.isGM`; a
  player's `user-join` adds `data.activeSceneId` and the active scene's `data.tokens`. Rolls and
  item use carry `data.whisper` and `data.blind` when set; HP, condition, death save and combat
  turn records carry `data.hidden` when made through a token hidden from players. A GM client
  without a canvas records the active scene (with the players online) at load. Older records lack
  these and still read fine (their sessions list nothing).
- **Scene records name the right scene:** a `scene` record made when the GM activates a scene
  now carries that scene's id; it used to carry the id of the scene the canvas still showed.
- **Place the party on a scaled map:** the `place` action of `plan-party-change` sizes the tokens it creates like `fit-scale` (creature footprint in feet over the scene grid distance), so a party placed on a 40 ft town map is not house-sized. A 5 ft scene is unchanged and Undo still removes exactly the placed tokens.
- **Help button in the module settings (D-108):** Game Settings, Foundry AI Tool, **Open the GM
  guide** opens the GM guides on the wiki in a new browser tab. GM only.
- **`get-modules` is smaller:** manifest urls are only included with `includeManifest: true` (the version tracker asks for them), and a `#fragment` is dropped from them.

### Test kit

- **The kit waits for the creature index:** before it picks monsters, the kit waits (with no time
  limit) for the module's creature index to be current, using the new `ensureCreatureIndex` GM
  action, and logs how long a rebuild took.
- **`dashboard-controls`: the fold-party row passes:** `dash.during.fold-party` failed in the 2026-10-12 full
  run because the layout rows before it leave the During screen on Simple, which has no Party card. The row
  now picks Cards first. Live on test server A: 105 passed, 0 failed, 75 skipped.
- **`foundry-controls` sweep lows (#328 review) closed:** `foundry.changes.filter` now runs after the
  window's own Undo and Redo and also picks the GM from the Show list (only that person's rows, none of the
  AI's), and `foundry.tarokka.open-doc` is a row of its own after the first reveal was undone (it does a
  second reveal and undoes it) instead of a row nested inside `foundry.tarokka.reveal`, so a console error is
  no longer counted for both rows.
- **#279 review lows:** the wait after a new item re-reads the actor's species on every check, so
  a species replaced mid-wait must link too; `createHero` says plainly when gm.mjs did not send
  its `settleCreated` helper instead of failing on `undefined`.
- **The dashboard control sweep checks the combat strip:** `dashboard-controls` starts a combat
  with the kit's legendary monster and a hero (Combat buttons on for the run, both put back
  afterwards), so Boss prompts, the reaction ticks, selecting a combatant and the selection's
  Damage, Condition and Clear buttons are clicked instead of skipped, and must pass.
- **A "Claude" GM in every kit world:** `kit init` also creates a passwordless `Claude` Gamemaster
  in each kit world (kept as test data), so a session can join the kit worlds in the browser pane
  without taking the kit's own `Kit GM`. Init turns off Actor Studio's usage tracking for every kit
  user from the GM page, `Kit Player` included. The foundry-test-env skill lists the kit worlds and
  their users.
- **The combat strip sweep reads Combat buttons from the server:** `dashboard-controls` read the
  setting from the page's label, which says "off" until the dashboard's prefs event lands, so an
  already-on setting could be turned off afterwards. It now reads `/api/state`, waits until the
  page shows Combat buttons on before clicking a combatant, and reports a failed put-back (Combat
  buttons off, ending the boss combat) instead of ignoring it.
- **A species twin is never picked blind:** when the species list has no heading for the pack, or
  the item is a world item with no pack, and two entries show the same label (a 2014 and a 2024
  entry), `choosePick` used to take the first one; it now fails with a clear reason instead. A lone
  label is still taken. A full label ("Elf, High") that is on the list but cannot be placed now
  fails at once instead of falling through to the short label ("Elf").
- **`dashboard-controls` fails clearly on an old dashboard:** a dashboard whose `/api/state` has
  no `prefs` stops the scenario with a message to start it from the same checkout, instead of
  reading the page's label (the fallback #244 left behind).
- **`kit init` provisions only the PC's test Foundry:** `provisionWorld` refuses anything but
  `http://127.0.0.1:30001` on Windows, because its passwordless Kit GM and Claude would be an open
  GM login on a host others can reach. A loopback address is not enough on its own (the Pi's own
  `127.0.0.1:30000` is what its tunnel serves, an SSH forward makes the Pi look local). A remote
  target (the Pi) needs a way to give its GMs passwords first; there is no opt-out. TEST-KIT.md
  also says that an existing lower-role `Claude` is promoted to Gamemaster but keeps any password
  it has.
- **Level-1 character check (G0):** the `player-character-creation` scenario now also checks a
  new character's ability scores (the background's +3 on what the player entered, nothing above
  20), its saving throws (exactly the class's), the skills, tools, weapons, armor and languages the
  class, species and background grant, that no free choice was skipped, and the proficiency bonus.
  The expected values come from the picked items' own Trait advancements, so no book text is
  stored. A wizard without a Spellbook item is reported as a note.
- **The kit checks that the boss pips follow Foundry:** the dashboard control sweep spends a legendary action on the boss in Foundry (the boss's own legendary activity, used the way the table uses it), waits for the Legendary pips on the dashboard to drop by one, puts the pool back and waits for the pips to return. New GM actions `spendLegendary` and `restoreLegendary`; the fake combat state now reports a monster's boss resources too.
- **Tarokka offer dialog covered by the `foundry-controls` sweep:** `module.tarokka.offer-confirm` and
  `module.tarokka.offer-decline` now run instead of being skipped. The sweep lets the GM client see an
  active `tarokka-reading` module with a `secret` setting for the length of the two rows (the real module
  is used when the world has it and has nothing dealt), deals a new reading, and checks that Yes offers it and No says nothing.
- **Sweep review lows (#328) closed:** the player feature-switches row skips when the settings window was
  never read, `playerSettings` always closes its window, an announced console error is excused only inside
  its own row's time window, a skipped row hands its errors to the last step, the handout and Tarokka
  undo choose the new change against the Changes window's own row ids, the roll-card and open-document
  checks compare against what was there before the click, a reveal journal left behind by undo fails the
  Tarokka cleanup, and the row runner and dialog helpers have unit tests.
- **Console errors grouped:** the kit report groups the GM page's console errors by message and place
  (ids and line numbers stripped) with a count, first and last time and the scenarios, marks the known
  ones (Actor Studio's selector error and its 404) and warns about new ones at the top of the report and
  at the end of the run. The raw list stays in `report.json`.
- **The notification error explained and fixed:** the hundreds of `Cannot set properties of null
(setting 'hidden')` page errors in full runs came from chat cards the kit creates and deletes within
  100 ms while Foundry animates them as pop-ups. The kit's GM page no longer shows chat pop-ups, also after the page reloads (confirmed in a live full run: 0 of them, where one run without the reload step logged 8440).
- **A player makes a level-1 character (session 0):** the new scenario `player-character-creation`
  joins the kit world as the kit player in its own browser and builds a level-1 character per class
  in Actor Studio, the way players will at session 0: abilities, species, background, class, the
  advancement questions, the starting equipment and the spells. The GM side then checks the sheet:
  the player owns it, one level of the class, species and background, level-1 hit points, every
  planned item on the sheet, every spell the class gave on its spell list (species and feat spells
  may be off it), no console errors on the player page. It grants the Player role "Create New Actors" (Actor Studio needs it) and turns on Actor
  Studio's starting equipment for the run, and puts both back. Smoke builds a fighter and a wizard,
  full every 2024 class.
- **Actor Studio's Equipment tab driven by the kit:** the gold choices, the equipment choices, the
  item pickers ("any gaming set") and Confirm. Profiles may name `packs.equipment` (the srd profile
  uses `dnd5e.equipment24`); Actor Studio reads its item pickers from that list.
- **`t.joinFoundry(user)`:** a scenario can join the kit world as another user in a separate
  headless Edge; the runner closes it after the scenario.
- **The write flows' put-back reads the list again after each undo:** `dashboard-write-flows`
  undoes the newest change it made, then asks for the list again, up to 50 times. Before, it read
  the list once: when the Redo flow failed, the Just this undo stayed live and hid the older damage,
  so the hero ended with fewer hit points than it started with.
- **Actor Studio fork on the expected list:** the `heroes-studio` scenario ran live on both kit worlds
  against our fork of Actor Studio (2.10.5-aitool.1) and passes with no STUDIO difference and no console
  errors. For that build the expected list (`studio-expected.json`) leaves out the unset Subclass advancement,
  the jQuery selector error, the 404 and the "no slot to spend" feature problem; the slot finding now
  says that the fork fills level 1 slots only.
- **The expected list follows the installed Actor Studio:** `studio-expected.json` still holds the
  upstream 2.10.5 findings; the four the fork fixed carry `fixedIn: "2.10.5-aitool.1"` and are left
  out when the installed module is that build or a later build of the fork. The `heroes-studio`
  scenario and the console groups read the version from the GM page, so one run on upstream 2.10.5
  and one on the fork both pass with no new findings. An unknown version falls back to the upstream
  list and says so.
- **Actor Studio fork 2.10.5-aitool.2 (heroes levelled up in Studio end with full spell slots):** the
  `heroes-studio` scenario ran live on both kit worlds with that build and passes with no STUDIO
  difference, no console errors and no spell slot finding (`licensed` SYSTEM 23 to 13, `srd` 21 to 13).
  The slot entry in `studio-expected.json` carries `fixedIn: "2.10.5-aitool.2"`: still expected on
  upstream 2.10.5 and on aitool.1, a new finding on aitool.2 and later.
- **The undo window clicked for real:** `dashboard-write-flows` has three new flows on the Everyone
  tab of Recent Changes. Two damage changes on one hero: Undo on the older one asks to choose,
  Cancel and Escape change nothing, Just this gives back only its own hit points; Redo asks for
  the destructive tick, Escape and Cancel keep it undone, Confirm takes the hit points again;
  Everything since puts the hero back to before both. The put-back at the end leaves the kept undo
  alone. `dashboard-controls` names these flows for the controls it skips.

### Remote access (D-095)

- **The GM's Claude Desktop reaches the bridge on the Pi:** the Windows client installer has a
  Cloudflare tunnel option. It bundles a pinned `cloudflared`, keeps `cloudflared access tcp`
  running from a logon task (`installer/nsis/tunnel-client.ps1`) and stores the GM's service token
  per Windows user (DPAPI). The bridge's control port stays on loopback on the Pi; it is reached
  only through an Access application of its own.
- **Stage 12** now also checks that the control port answers on loopback and nothing listens beyond it.
- **Tunnel client, three small fixes:** a direct `tunnel-client.ps1 -Action Install` now stops the old
  tunnel before it writes the new `tunnel.json` (a changed host or port no longer leaves the old
  cloudflared running), waits up to about 3 seconds for the old listener to go before it refuses a
  port in use, and the `-NoTask` start quotes its arguments (a user folder with a space works).

### Developer tooling

- **The in-repo project dashboard is gone:** `scripts/dev/project-dashboard` and its npm scripts
  (`project-dashboard`, `project-dashboard:test`, `vault:sync`) are deleted, with its green and CI step.
  The Control Center (Gnuminator/control-center, port 3200) replaces it and runs the same suites in its own CI.
  The test kit's vault note now goes through `scripts/test-kit/lib/vault-push.mjs`, a copy of the Control
  Center's newer vault wrapper.

### Tooling

- **ffmpeg demo recorder raises the scene's window:** with `--recorder ffmpeg`, `Take.scene()` now
  brings the scene's browser window (found by its pinned title) in front of the others, since a
  screen recording shows whatever is on top and Playwright's `bringToFront` does not raise the OS
  window. Without it every recording showed only the last window opened.
- **Demo takes can record with ffmpeg:** `npm run demo:take -- <take> --recorder ffmpeg` records the
  top-left of the primary monitor with ddagrab and NVENC instead of going through OBS, which froze on
  window captures on 2026-10-18. OBS stays the default.
- **`drift:check` builds `shared` from the merged tree:** when the trial merge changes `shared/`, the throwaway
  worktree gets its own workspace links and builds its own `shared`, so a PR is no longer tested against the lane's
  older `shared/dist` (the case where a PR that added a `shared` export is merged under one that predates it).
- **`npm run green` ignores generated test reports:** the markdown lint now skips whatever `.gitignore` skips
  (`playwright-report/`, `test-results/`, `coverage/` and any new report folder), so a green after a failed e2e run
  passes without deleting files by hand.
- **Lane collision lines:** the planner and lane skills describe the Backlog keys `- touches:` and `- depends on:`, which the PM board reads to warn about two lanes on the same path or an item claimed before its dependency merged.
- **`lane:merge --wait-ci`:** `node <main copy of lane-merge.mjs> <PR> --wait-ci` waits in one
  process (up to 30 minutes) until every CI check on the PR's head commit has finished, then runs
  the normal gate unchanged and merges or refuses with the reason. A failed check ends the wait at
  once and is named (exit 3), a changed head refuses with "head moved" (exit 4), a timeout exits 5.
  The planner starts it with `run_in_background` once the review says Merge; lanes stop at "ready to
  merge" (D-122 log, 2026-10-16).

### Security (audit H1, L5)

- **Docker template publishes the Foundry link on loopback only:** `deploy/docker-compose.yml.template` maps `127.0.0.1:31415:31415` instead of `31415:31415`, so the unauthenticated link is no longer open on every host interface. Use the tailnet IP or an SSH tunnel to reach it on purpose. The container still listens on `0.0.0.0` inside (a loopback bind inside the container breaks the published port), now explained in the Dockerfile.
- **Pinned base images:** the Dockerfile uses `node:22.23.3-slim` and compose uses `cloudflared:2026.10.1`, both by digest.

### Developer tools

- **Drift check before "PR ready":** `npm run drift:check` fetches main, merges it into a copy of
  the branch in a throwaway git worktree, and runs there the guards that only fail once another
  lane's PR is on main (lint and em-dash baselines, changelog fragments, usage catalog, version
  sync, docs lint and links, the mcp-server tests with the tool counts, reference and set budgets,
  the module write gate). The lane's own tree is never touched; nothing is committed or pushed. It
  needs a clean tree and names the files when main conflicts.

### Dashboard (D-092, I-107)

- **Three During layouts:** Cards (the default: Live Feed first, Recent Changes, Handouts and
  Party as folding cards at the side), Simple/Full (a short screen, or everything with one
  switch) and Auto (combat brings the turn order and Party forward). Picked with **Layout** on
  the During screen and kept per world on the server, so the choice follows the GM to any
  browser. Every layout adapts to the width: one column on a tablet or a narrow window, the feed
  folded on a phone.
- **Layout trial:** a "Pick your During layout" card on Before (and Advanced, "Try the During
  layouts") shows each layout on the real screen with a small guide in the corner and a sample
  fight for Auto. Never a blocker: skipping keeps Cards. A quiet hint by the switcher shows for
  the first three sessions until a layout is kept or the hint is dismissed.
- **Combat buttons behind Advanced:** Damage / Heal, Condition and Clear in the turn-order strip
  are off by default and switched on under Advanced, "Combat buttons" (dnd5e's chat cards apply
  damage in Foundry; a new GM learns that first). Kept per world.
- **Check states that read apart:** ok is a filled round badge, warn an outlined square, fail a
  filled square; in The Veil, ok is a muted sage green and warn the lamplight gold.

### Development

- **Edit guard for coding sessions:** a PreToolUse hook (`.claude/hooks/guard-shell-edits.mjs`) refuses shell commands that rewrite repo source files (`.ts .tsx .js .mjs .ps1 .sh .json .yml .md`) with `sed -i`, `perl -i`, a python or node `-c`/heredoc script, or a heredoc, `echo` or PowerShell `Set-Content` written onto them, and tells the session to use the Edit or Write tool. Read-only use, commit messages through `git commit -F - <<'EOF'`, and writes outside the repo (scratchpad, `%TEMP%`, the vault) pass. A PostToolUse check (`.claude/hooks/warn-control-bytes.mjs`) warns when an Edit, Write or shell command leaves a source file with more ASCII control bytes than before (a backspace where `\b` was meant). Both are covered by tests that `npm run green` runs.
- **Green flakes fixed at the cause:** `npm run green` on Windows now runs every step on the
  portable Node 22 when it was started under another Node. Node 24.15 on Windows crashed natively
  (exit code 0xC0000409, no message) in 20 to 40 percent of the co-GM dashboard socket test runs,
  which showed as vitest "Channel closed" and as a dead run; the same tests passed 60 of 60 runs
  on Node 22.22.2, with either vitest pool. The 50,000-character timing check of the
  remote-command guard takes the best of three runs instead of one wall-clock sample (the ARM64
  container suite delayed one run to 207 ms against a 200 ms bound), and the co-GM stream tests
  wait for the last event of the connect snapshot instead of a fixed 30 to 60 ms; the narrow-screen e2e layout test polls until the panels have settled (it failed once under ARM64 container load).
- **Lane handover at each milestone:** the `lane` skill asks a lane to keep its vault handover
  note current when green passes, the PR opens and a review says Merge, so a lane that reaches the
  context limit hands over at once instead of rebuilding its state.
- **Typed actor builder (lint zero step 3, actor-builder sweep):** `data-access/actor-builder.ts`
  (NPC creation, attack, aura, save, passive and attack-with-save features, spellcasting,
  compendium spell and feature imports, item and NPC activity use) takes and returns named,
  exported input and result types instead of `any`, and the data-access facade uses them. ESLint
  warnings drop from 4105 to 3603; the file has one left (a deliberate `||`). The dnd5e item
  literals are unchanged and nothing changes on the wire; the one runtime difference is that a
  failed `useItem` keeps the original error as `cause`.
- **Typed actor lookups and character reads (lint zero step 3, sweep 5):** the shared helpers that
  find an actor by id or name (`findActorByIdentifier`, `resolveTargetActor`, the scene token
  lookup) return `Actor` instead of `any`, so their callers drop their casts. `characters.ts`
  (character sheets, item and effect search, spell slots) and `shared.ts` read Foundry and dnd5e
  data through `unknown` and the sheet field helpers. ESLint warnings drop from 3351 to 3143; both
  files have none left. Lookups, search results and sheets keep the same shape.
- **Typed bridge queries (lint zero step 2):** `shared/src/bridge-queries.ts` names the request
  and reply of 18 bridge queries once, for the backend and the module: the guarded write queries,
  the change journal, play and usage records, the journal folder and show-to-players queries, the
  player pages, the export and Library indexes, the character sheet, `getCharacterEntity` and
  `ping`. The module registers those handlers with `bridgeHandlers.on()`, which checks each reply
  against the contract; `FoundryClient.query` returns the typed reply or the module's refusal
  (`{ success: false, error }`). The services share one `unwrapBridgeReply` instead of four local
  copies, and the pumps lose their casts. The queries the `src/tools/` tools send join after the
  G0 lanes merge. Nothing changes on the wire; old modules and bridges still talk to each other.
- **System detection after a refusal:** when the GM gate refused `getWorldInfo` (a client that
  is not the GM's), the bridge cached the world as "not dnd5e" until a restart. It now treats the
  refusal like a failed query and asks again on the next call.
- **Typed Foundry edges (lint zero step 1):** the module's Foundry declarations now type the
  documents it reads instead of `any`: tokens, notes, walls, lights, regions (with their v14
  shapes), playlists, roll tables, rolls and dice terms, the Token placeable, user targets and the
  tokens layer, checked against the Foundry 14.368 source. `actor.system` and `item.system` are
  typed for dnd5e 6 from the installed 6.0.5 data models (`src/systems/dnd5e/system-data.d.ts`),
  so the core declarations stay system-agnostic. Embedded document writes return documents,
  `game.settings.get` returns `unknown`, and `canvas.pan` is declared synchronous as it is in v14.
  No behaviour changes; the warning count drops a little now and much more as the sweeps type
  their locals with these declarations.
- **ESLint 10 with a flat config (D-109, lint zero lane):** `.eslintrc.json` is replaced by
  `eslint.config.mjs` on ESLint 10 and typescript-eslint 8 (the user picked 10 over the 9 in the
  brief). It lints the same files. typescript-eslint 8 is stricter on the same code, so five rules
  that were already errors (unbound-method, no-unnecessary-type-assertion, prefer-optional-chain,
  no-base-to-string, no-duplicate-type-constituents) found 247 new hits; they stay errors and the
  hits are fixed (autofix, then hand-checked optional chains, and explicit primitive checks where
  a value was stringified). In tests, `@vitest/eslint-plugin`'s `unbound-method` replaces the
  typescript-eslint one, since `expect(mock.method)` is not an unbound call. The other new
  findings (stricter nullish checks, return types, preserve-caught-error and a few more) are
  warnings the lint ratchet counts; the baseline goes from 5999 to 6464.
- **Deliberate follow-ups for the lint zero sweep:** `reportUnusedDisableDirectives` is off,
  `no-unused-vars` has `caughtErrors: 'none'`, and the dashboard's React code has only the two
  classic hook rules (rules-of-hooks, exhaustive-deps). Each is switched on once its hits are
  fixed.
- **Typed session events (lint zero step 3, session-events sweep):** the module's play recorder
  hooks (`session-events.ts`: chat, rolls, damage, combat turns, HP and resource changes, effects,
  scene and journal events) read Foundry documents through `unknown` and the `doc-read` helpers
  instead of `any`, and the play-by-play has named types. ESLint warnings drop from 4105 to 3853;
  the file has none left. Recorded events keep the same shape and the same recording conditions.
- **Lint zero, sweep 1 (D-109):** return types and template strings in the module and the server;
  `require-await` is off and `||` stays allowed on strings, numbers and booleans (the lane's call
  after the user left both to it, 2026-10-08); informational module logs go through `log.ts`. No
  behaviour changes. Lint warnings 6464 to 5825.
- **Typed data-access reads (lint zero step 3, first sweep):** the module's scene and token,
  world, journal, chat, ownership and module reads use the typed Foundry declarations from step 1
  instead of `any`, with local result types for their replies. ESLint warnings drop from 5543 to
  4966; these six files have none left. No behaviour changes beyond leaving out an empty `img` key
  on the active scene and `??` in place of `||` on a few object fallbacks.
- **Typed data-access writes (lint zero step 3, second sweep):** the module's combat, rest and
  roll, resources and effects, actor creation, player roll buttons, creature index, world items
  and scene sound files use the typed Foundry declarations instead of `any`, with local types for
  the dnd5e roll and rest methods and result types for their replies. ESLint warnings drop from
  4944 to 4114; these seven files have none left. No behaviour changes: a few `||` became `??`
  only where the value is an object or an array.
- **Bridge contract tidy-up (#262 review):** game system detection logs a GM-gate refusal (a
  non-GM client holds the bridge) at warn instead of error, since it asks again on every call.
- **Lint zero, step 9:** six small rule families are at zero: `preserve-caught-error` (rethrown
  errors keep their `cause`), `prefer-promise-reject-errors`, `only-throw-error`,
  `prefer-nullish-coalescing`, `no-constant-binary-expression` and `no-useless-assignment`. 66
  warnings across 38 files, no behaviour changes. Lint warnings 3121 to 3055.
- **One keep-green command and a merge gate (D-122 phase 2):** `npm run green` runs what CI's
  build-test job runs and prints one line (a test keeps it in step with `ci.yml`);
  `npm run lane:merge -- <PR>` merges only with every check green on the head commit, a review
  note for that commit (Opus for risky paths), a changelog fragment, a clean drift check and room
  in the merge train; a context hook prints one line at the 350k and 400k handover marks;
  `npm run usage:week` reports startup size, tokens per merged PR and cost per weekly percent
  against the D-122 targets.
- **Leaner session start (D-122 phase 1):** new project skills `lane`, `planner` and `pi-work`
  hold the development process that used to load with every session; the start hook prints the
  due items from the private to-do list in one line; `.worktreeinclude` copies the private
  `CLAUDE.md` into new worktrees.
- **The steward's leftovers are gone (D-122 phase 3):** the start hook no longer prints the
  "lanes over 200k context" line (each session's own context hook warns it instead); the old
  in-repo project dashboard drops the lanes table, `--lanes` and the steward's place in the lane
  cap; the `lane` skill's merge command is one `&&` chain that never runs an empty copy of the gate.
- **Dashboard header test on any checkout:** the static-headers test "matches a group by file
  identity" no longer fails where `player.html` has an NTFS file id over 2^53 (its made-up 8.3
  path is now resolved to the real file).
- **Usage report: cost per request, startup and break-even:** `python scripts/dev/usage-report.py`
  takes `--curve` (cost per request by context size and a least-squares fit), `--startup` (what a
  fresh session costs in its first hour), `--breakeven` (how many requests until a handover to a
  fresh session is cheaper, and what cache expiry cost), `--all`, and `--json FILE`. It counts each
  API response once, keeps main thread and subagents apart, and reads only token numbers and
  timestamps from the transcripts. The default report is unchanged.

### Play

- **Fit tokens to the map's scale:** `plan-token-change` has a new action `fit-scale`. On a scene
  whose squares are not 5 ft (town and overland maps are 16 to 200 ft), it sizes each creature
  token so it covers its real footprint (a medium creature is 5 ft, a large one 10 ft, from the
  actor's size), with a floor of 0.25 squares so tokens stay visible. It also locks the token's
  size so dnd5e's Autosize does not set it back. Name tokens, or leave them out for every creature
  on the scene. A 5 ft scene is left alone. Plan, confirm and Undo like any token change.

### Backups and installer (follow-ups to PR #165 and #168)

- **Stale-backup DM, long-broken records:** an unreadable or invalid record file starts its problem
  clock at the earlier of its modified time and now, so a file that has been broken for days alarms
  on time after a bot restart, and a modified time in the future cannot push the alarm out.
- **Stale-backup DM, how to fix an unreadable record:** the DM names the task to run once ("Foundry
  Pi restic copy" or "Foundry Pi snapshot pull"); a successful run writes the record again.
- **Stage 6:** `record-pull.sh` uses `mv -fT` for its atomic rename; an unreachable "not read"
  fallback in the reader is gone.
- **Windows client installer:** when it runs as another account than the signed-in user (for
  example "Run as administrator" with a different admin account), it warns that Claude Desktop will
  not see the new entries and says to run it again as the signed-in user. A warning only: the
  entries are still written.

### Pi (I-145)

- **Game-night watch:** `scripts/gamenight-watch.mjs` checks Foundry every minute from the PC and posts to
  a Discord channel once when Foundry does not answer or is slow, and once when it is back. Posting is opt-in
  (`--post`); the default is a log-only dry run. The Pi is not changed. See "Game-night watch" in
  docs/dev/PI-SETUP.md.

### Module (I-134)

- **Session window, review lows (#412):** an open Session window reads the state again every 15
  seconds, so a start or end made from Claude or the dashboard shows up and the window no longer
  offers a duplicate start; reopening it shows "Loading" instead of the old state; a failed Start or
  End is no longer hidden by a read that was already on its way. A start or end from the window now
  records which GM clicked in the marker line's note.
- **Two more GM windows, behind the same "GM windows" switch (off by default):** "Session" shows
  whether a play session is open and has Start and End buttons (the dashboard's session marker), and
  "Scene" shows the active scene's light, weather and what is playing. The Session window asks the
  bridge through two new module-request tools, `get-play-session` and `mark-play-session`; a mark
  from the window carries only the action (start or end) and a short note, and writes one line to the
  bridge's session log. Needs a bridge from this release to use the Session window.
- **GM windows, shipped off:** a new world setting "AI Tool: GM windows (Combat and Party)" (off by
  default) adds a Combat and a Party button to the GM-only "AI Tool" group in the scene controls.
  Combat shows the turn order, round, hit points, conditions and defeated or hidden marks, with
  Previous and Next turn (Foundry's own combat methods); Party shows each player character's hit
  points, AC, passive Perception, level, conditions and spell slots left. Both read Foundry's data
  on the GM's browser, call no bridge tool and write nothing of their own; players never get the
  buttons.

### Obsidian (I-105)

- **Adventure hub notes:** the mirror writes one note per adventure in
  `AI Tool/Foundry/Adventures/` (a top Foundry folder with journals and scenes). It links every
  note of the adventure and the book's Library note, so each adventure is its own cluster in the
  graph.
- **Graph colours:** the Obsidian plugin has an "Apply AI Tool graph colours" command and button.
  It gives each adventure a colour and the Library grey in the graph view, and keeps your own
  colour groups. Open graph views reload in place with the colours. The mirror itself
  never edits Obsidian's settings.

### Module (I-108 part 1)

- **"AI changes" window inside Foundry:** GMs get an **AI Tool** group in the left toolbar (scene
  controls) with an **AI changes** button. It opens the same list as the dashboard's Recent
  Changes (newest first, 20 and a Show more for 100, diff lines, **Undo** with a confirm), refreshes
  by itself when the AI makes or undoes a change, and works from the GM's own browser even though
  only the Assistant GM browser holds the bridge link: the request is relayed through Foundry's
  GM-only `user.query` to that browser.
- **New link frames `module-request` and `module-reply`** (additive, outside the core frame union):
  the browser that holds the link can ask the backend to run `list-recent-changes` or `undo-change`
  for a GM. The backend accepts them only from the active module socket, only for those tools, with
  at most 20 kB (UTF-8 bytes) of arguments, and runs them through the same dispatch table as the
  control channel. An undo from the window records the GM's name on its audit entry
  (`requestedBy`).
- **The window refreshes when the backend has recorded the change**, not after a timed guess: the
  backend calls the module query `aiChangesUpdated` after every recorded apply or undo.
- **Any GM mode:** a GM browser whose bridge link is not the active one (the bridge serves the
  newest) now asks the browser that holds the active link, and the search carries on past a browser
  that cannot answer.
- **Old bridge, new module:** the bridge sends a `bridge-hello` listing what it supports when a
  module connects; against an older bridge the window says "Update the AI Tool bridge to use this
  window." at once instead of waiting 30 seconds.

### Module (I-108 follow-ups)

- **Any-GM, two tabs of one GM:** the bridge now answers a window request from any open tab whose
  hello says it is a bridge user, not only the active one, so an older tab can no longer win the
  race with an instant "not connected". Tabs with no hello (an old module) or that are not bridge
  users are still refused.
- **"Update the bridge" for the new windows:** the bridge lists `module-request:<tool>` for every
  tool it answers, and the module checks the tool against it. A bridge from the first I-108 build
  (the plain `module-request` only) serves just the AI changes window; the Handouts and Tarokka
  windows say "Update the AI Tool bridge" instead of "Tool not allowed".
- **Who made a change:** a change made from a window in Foundry shows `by NAME` in the AI changes
  window and in the dashboard's Recent Changes, and `gm/audit-log.jsonl` keeps it as an optional
  `requestedBy` (still `v: 1`).
- **Handouts queue changes reach other windows:** queueing or removing a handout (from Claude, the
  dashboard or a window) now refreshes the Handouts windows other GMs have open.
- **Tarokka:** a window request can no longer plan a reveal for a position that is already revealed;
  change it from the dashboard or with Claude.
- **Old modules:** the module now says in its hello that it understands the change signal, and the
  bridge only sends it to a module that does, so an older module no longer logs one failed query
  per recorded change.

### Module (I-108 part 2)

- **"Handouts" window inside Foundry:** the **AI Tool** group in the scene controls gets a
  **Handouts** button (GMs only). The window lists the reveal queue (oldest first, with the scene
  and the players each page is for, and **Remove**), has one **Reveal next** button for the active
  scene with a **Show it now** tick that is unticked every time the window opens and
  after each reveal, and shows who has read which revealed page. Reveal asks you to confirm in a
  Foundry dialog that shows the plan's summary and diff, then applies it; cancel does nothing. The
  window refreshes when the backend records a change and has a Refresh button, and works from the
  GM's own browser through the same relay as the AI changes window.
- **Module requests can now plan and apply a handout reveal, and nothing else:** `MODULE_REQUEST_TOOLS`
  adds `list-revealed-pages`, `plan-page-reveal` and `apply-planned-change`, and the backend narrows
  them (`MODULE_PLANNERS` in `module-requests.ts`). A module request may run `plan-page-reveal` only
  with `reveal-next` or `unqueue`, and may apply only a plan that such a planner made through a
  module request (checked through the guarded-write service, feature included). Adding the Tarokka
  reveal later is one line. An apply from a window records the GM's name on its audit entry
  (`requestedBy`), like an undo does; relayed applies get the 120 second timeout.

### Module (I-108 part 3)

- **"Tarokka" window inside Foundry:** the **AI Tool** group in the scene controls gets a
  **Tarokka** button (GMs only). The window shows the current reading (source, when it was dealt or
  imported, how many are archived) and its five positions. Card names and ids and the GM's notes are
  hidden ("Card hidden") until the **Show cards** tick is on; the tick is unticked whenever the window
  opens or closes and survives a refresh. Each position has **Open Journal / Scene / Actor** buttons
  or "not linked", a "revealed" badge with **Open page**, or "hidden from players". **Reveal...** on an
  unrevealed position opens an inline form (the text the players read, 1 to 5000 characters; an
  optional title; a **Show it now** tick that is unticked every time the form opens). Reveal plans it,
  asks you to confirm in a Foundry dialog that shows the plan's summary and diff, then applies it;
  cancel does nothing. Linking cards and dealing or importing a reading stay in the dashboard or with
  Claude. The window refreshes when the backend records a change and has a Refresh button; typed
  text and ticks stay across those refreshes.
- **Module requests can now plan a Tarokka reveal and read the reading:** `MODULE_REQUEST_TOOLS`
  adds `get-tarokka-reading` and `plan-tarokka-reveal`, and `MODULE_PLANNERS` gets the one line
  `plan-tarokka-reveal` (feature `tarokka`). The apply rule is unchanged: only a plan a module
  planner made through a module request can be applied from a window, and only with `planId`,
  `confirm` and `confirmDestructive`. Linking and importing are still not reachable.
- **Handouts window: "Show it now" no longer unticks itself on a redraw.** A refresh or a change-log
  signal used to clear the tick while you were deciding. It is now kept while the window is open,
  and cleared after each reveal (confirmed, cancelled or failed) and when the window closes.

### Bridge (I-109 part 2)

- **A 7-day history of everyone's changes:** the bridge keeps what players, the GM and the AI changed in Foundry in the GM vault, and Claude can list it with the new `list-changes` tool (who, what and when, newest first; filter by person, thing and AI or human). Undo of players' and the GM's changes comes later. `FOUNDRY_AI_CHANGE_JOURNAL=off` turns the history off.

### Module (I-109)

- **Change journal:** the Foundry module now records every change to actors, items, tokens, scenes, combat, journals and map placeables (who made it, the values before and after) for the coming full undo. Nothing is visible yet.

### Module (I-109 part 4)

- **The "AI changes" window is now "Changes":** it lists everyone's changes (players, the GM and the AI) from the last week, with who made each one, a "Show: All / AI / each person" filter, and **Undo** on any change that can still be undone. The scene-control button is renamed too (its internal name is unchanged).
- **Undo asks the right question:** it plans the undo and shows what will be put back before you confirm. When a later change touched the same thing, the window lists those changes and offers **Just this**, **Everything since** or **Cancel**; under **Advanced** a **Rewind the whole table to here** asks twice (the full list and count, then a button that names the count) before it applies.
- **Redo:** a change that was undone shows "undone by NAME" and gets **Redo** when the undo can itself be taken back.
- **Older bridge:** without `list-changes` the window falls back to the AI-only list and the plain undo, with no filter or Redo.

### Bridge (I-109 part 4)

- **Module requests:** `list-changes` and `plan-undo-changes` join `MODULE_REQUEST_TOOLS`. `plan-undo-changes` is a module planner (feature `change-undo`, any scope, only `id`, `scope` and `rewindTable`), so a window can apply only an undo plan it made itself. The bridge hello lists the two new `module-request:<tool>` capabilities.
- **Undo plans say how many:** `plan-undo-changes` answers with a `count` of the changes the plan undoes.

### Undo for everything (I-109, PR 6)

- **Everyone's changes as daily notes in the GM vault:** when the Obsidian vault is set up, the
  backend writes one note per day, `AI Tool/Everyone/<date>.md`, with every change the players,
  the GM and the AI made in Foundry that day (who, when, the same readable lines as the
  dashboard's Everyone tab), shortly after each change. Read-only: undo stays in the dashboard
  and in Foundry's Changes window. A note edited in Obsidian is left alone; old days are kept.

### Undo for everything (I-109 follow-up lows)

- **Follow-ups stay with their change in a fast burst:** when two AI changes land within one
  burst and Foundry's or dnd5e's follow-up of the first (a combatant gone with its token, the
  dependents of an ended concentration) arrives after the second has started, the history now
  files it under the change that caused it, so "just this" on either change puts back the right
  things. When two AI changes touch one actor in a burst (a condition removed, then a
  concentration spell deleted), each keeps its own follow-ups, and a token deleted, put back and
  deleted again keeps each combatant with the delete that removed it. An AI change whose ops span two history actions keeps all its follow-ups, and
  "everything since" keeps a follow-up's newer value (a combat turn the GM moved afterwards)
  instead of writing the old one back. Undoing the redo of an item delete no longer says the
  ended concentration effect was "already gone" while putting it back.
- **Daily notes (`AI Tool/Everyone/`):** a change the history regroups under a new id on a
  partial day no longer shows twice beside its carried copy (two people who made the same change
  in the same minute stay two lines); a middle dot in a name or summary
  is written as its entity so the line reads back right; a player named "AI" is listed as
  "AI (player)".

### Undo for everything (I-109 follow-ups)

- **Journal files are kept 7 days and capped:** the backend removes `changes-<date>.jsonl` files
  older than the history span once a day, and the oldest ones while the files hold more than
  64 MB in all (`FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB`; the Pi's vault is an SD card). It remembers
  from which day the history is complete: `list-changes` says when the cap removed days inside
  the span, and "Everything since" or a rewind to a change before that day is refused instead
  of silently skipping people's changes. A file that cannot be removed is retried later.
- **Foundry's own follow-ups stay with the AI change:** when the AI deletes a token in combat,
  the combatant Foundry removes (and the turn it moves) no longer show as the GM's own change.
- **The GM browser's journal buffer is capped at 32 MB** besides its 5000 records, and record
  sizes are measured in UTF-8 bytes.
- **Two updates to one document in the same server millisecond** are two records: an update's
  key carries a hash of its values after, so neither is dropped and both can be undone.
- **A GM edit within 300 ms of an AI write** (the bridge in their own browser) is listed and
  undoable as their own change when it touches other things; only the system's own follow-ups
  on the AI's things (Bloodied after an HP change) still belong to the AI change.
- **An undo made in the dashboard** is listed as the GM's ("GM (dashboard)"), not the AI's, and
  no longer falls under the AI filter.
- **Ownership lines name the user** ("ownership for Anna") when the history has seen that user,
  instead of the user id.
- **Redo wording:** "undone together with other changes" appears only when the undo really took
  back several changes (the backend now says how many), not for a one-change undo with two lines.
- **Changes window, filter:** when a full page holds only hidden rows, it says so and points to
  Show more instead of "No changes match this filter".

### Undo for everything (I-109 history lows)

- **dnd5e's dependent deletes stay with the AI change:** when the AI deletes an effect or an
  item (ending concentration), the effects on other actors, the templates, regions and summoned
  tokens dnd5e removes with it no longer show as the GM's own change. Undoing that change puts
  them back too (the plan says how many), and a redo takes them away again: the module deletes
  a dependent before the effect that names it, and in an undo a document dnd5e already removed
  counts as done instead of failing the whole plan (and a later undo of that undo leaves it
  alone, with a "Left alone" line, instead of re-creating it from nothing). What dnd5e changes on the AI's own target
  (Bloodied) is left to dnd5e. Fast consecutive AI changes that land in one burst are now one
  history action each, so a follow-up stays with the change that caused it. The live write
  sweep has the case (an AI-ended concentration, undone and redone).
- **Lost journal records move the history start:** when the GM browser's change buffer wraps
  before the bridge read it, the bridge remembers from when the records are complete again, and
  `list-changes` and a rewind say so (with the time of day) instead of skipping people's changes
  without a word. A GM browser reload while the bridge is down still leaves no trace; the file
  comment says so.

### Bridge (I-109 part 3)

- **Undo for everything:** Claude can now undo anyone's change with the new `plan-undo-changes` tool: just that one (what changed after it stays, amounts such as hit points, uses and currency are adjusted by that change's part), or everything since on the same thing, or a rewind of the whole table. Apply the plan with `apply-planned-change`. Undoing that change again is the redo, and an AI undo can be undone too. What is undone is worked out from the audit log, so a redo brings the original change back; a redo needs the original feature's switch on. A rewind that takes back a deleted token or actor brings it back as it was before, with its items and effects. The new switch "AI Tool: Undo for everything" is on by default.

### Handouts (I-110)

- **Show it now:** a page reveal or a Tarokka reveal can also pop the page up on the players'
  screens through Foundry's own Show Players. The tick **Show it now** sits next to **Reveal next**
  in the Handouts drawer and in the Tarokka **Reveal…** form, and `plan-page-reveal` and
  `plan-tarokka-reveal` take `showNow`. It is off every time unless ticked, it goes only to the
  players the page is revealed to (every player when it is for everyone), and hiding a page never
  shows it. Undo takes back the reveal but cannot close the popup, and the plan says so. If the
  popup fails the reveal still stands and the dashboard says so.

### Obsidian

- **PC stats only for real PCs (I-120, lane D):** the play recorder now notes whether a player
  owns a character (`playerOwned` on a record's actor), and the stats (the `AI Tool/Stats/PCs/`
  notes, the campaign stats note and `get-play-stats`) keep a character only when a player owns
  it. Spare, pregenerated and test-kit characters no longer get a stats note each (the test vault
  had 4,446 of them). Characters in records from before this change stay, since those records do
  not say.
- **Compendium actor links go to the world NPC:** in mirrored page text, a link to a compendium
  actor (any form: `@UUID[Compendium...]`, typeless, legacy `@Compendium[...]`, or one of its
  items) goes to the world NPC's note when a world NPC stands for it: the NPC made from it (its
  compendium, duplicate or core source), else the only world NPC with the compendium actor's
  name (case-insensitive). Ambiguous names keep the Library link. The module resolves this per
  opted-in journal (`actorLinks` in the export index, part of the journal's `sig`), so a world
  copy that appears or goes re-renders the page notes within one reconcile (10 minutes). An NPC
  imported with only `flags.core.sourceId` now shows what it was made from too. Every mirror
  note renders once more (renderer version 9).
- **Adventure hubs link the Campaign Home (I-120 b):** each adventure hub note starts with a link
  to its campaign's `Home.md`, so the graph joins every adventure to the campaign. A new Home has
  an **Adventures** section (a table of the hub notes). A Home that still holds the old template
  untouched is upgraded to the new one on the next export; an edited Home is left alone and
  listed in `AI Tool/_status.md`.
- **Library notes without a book (I-120 c):** a generated note `Library/Books/Without a book.md`
  links every Library note whose entry names no source book, grouped by kind folder, so those
  notes are no longer loose in the graph. It goes to the vault trash once every entry has a book.
- **Library link labels with brackets:** a name with `[` or `]` no longer shows a stray backslash
  in Library links (notes pick it up when they are next rewritten).
- **Who is here:** a scene mirror note in the GM vault lists the scene's tokens under "Who is
  here", each linked to its NPC or PC note and labelled with the token's name, with how many
  tokens share the line, their disposition and whether they are hidden. A `tokens` property counts
  them. The export index carries the tokens folded by actor (never their positions), so adding,
  removing, renaming or hiding a token reaches the note within one reconcile (10 minutes), while
  moving tokens changes nothing. The player vault never reads the export index or mirror notes (a
  test pins it). Every mirror note renders once more (renderer version 8).
- **Pasted Cloudflare header lines work:** Cloudflare's copy buttons copy the header name too
  (`CF-Access-Client-Id: ...`). The plugin now drops a leading `CF-Access-Client-Id:` or
  `CF-Access-Client-Secret:` and the spaces after it from the two service token secrets before it
  sends them.
- **Prep notes, lists at column 0:** a prep note property written as a YAML block list with its
  items at the start of the line (`fvtt_uuid:` then `- Actor.x`) is read like an indented list,
  both for matching `fvtt_uuid` and for the property lines in `get-prep-digest` (#159 review).
- **Plugin through Cloudflare Access (R1, D-094):** the Obsidian plugin can reach a dashboard
  behind Cloudflare Access, such as the one on the Pi. It sends a service token's Client ID and
  Client Secret (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) from Obsidian's secret storage,
  to https addresses only, and the dashboard's GM token for the GM role, so the dashboard needs no
  change. An answer that is not the dashboard's own (Access's login or refusal page) now says to
  check the Access token instead of "HTTP 200". New GM guide `docs/gm/obsidian.md`: what is in
  the vault, where prep goes, and connecting the plugin.
- **Prep note follow-ups (#162 review):** of two session plans for the same game night, the one
  written last is the one Claude reads; the plugin says a new plan's date is today and to change
  it for another game night (also in the template hint and the GM doc); an empty frontmatter
  block before a `---` rule in the body is read right; names like `aux.notes` are made safe on
  Windows.
- **Prep that connects (R2, D-094):** the export writes four prep templates into
  `Prep/Templates/` (NPC, Location, Quest, Session plan, with the properties the prep digest
  reads and a hint in an Obsidian `%%` comment) while that folder is missing, so the GM's edits
  and deletions stay. They work with core Templates, Templater or by hand. The prep digest skips
  `Prep/Templates/` and leaves out `%%` comments. The Obsidian plugin's new **New prep note for
  this** (command and file menu, on a world note) makes `Prep/<kind>/<name>.md` from the
  template with `fvtt_uuid` filled in and a link back, or opens the one already there (found by
  `fvtt_uuid` anywhere under `Prep/`, also after a move or rename). A session plan is always new,
  named `Session <YYYY-MM-DD>` with `date` filled. Names are checked in any letter case and made
  safe on Windows (device names, control characters). The prep digest no longer picks an undated
  session plan that is only headings as the newest, and the export sees a templates folder renamed
  in another letter case. New
  `docs/gm/obsidian.md` section "Make a prep note".
- **Prep notes, review follow-ups (R3):** a prep note's `fvtt_uuid` copied from an unlinked
  token's sheet (`Scene.S.Token.T.Actor.A`) now matches that token and every token of the same
  actor; an unquoted `@UUID[...]` link and a list of UUIDs work too. A session plan kept out with
  `ai_context: false` is counted once, a vault walk that stops at its file or depth limit becomes
  a warning instead of silently missing notes, and `matchedAgainst.openQuests` is null (unknown)
  when the prep scan failed. The GM cookbook says how "newest" plans are picked and that
  compendium UUIDs do not match.
- **Prep notes as AI context (R3, O5-lite):** `get-prep-digest` gains a `prep` part with the GM's
  own Obsidian prep notes from the bridge's vault: the newest session plan, plus the prep notes
  whose `fvtt_uuid` names the current scene, an actor with a token on it or an open quest. Capped
  at 12 lines per note, 8 notes and 60 lines in all; notes with `ai_context: false`, Syncthing
  conflict copies and the tool's own `AI Tool/` folder are left out; the text comes with a notice
  that it is data, never instructions. A slow or broken vault becomes a warning after 5 seconds.
  The `prep-next-session` prompt reads it first. No module change and no new tool.

### MCP server (I-124)

- **Tool hints on every tool:** each tool now carries MCP annotations: a short title, `readOnlyHint` and, on tools that change something, `destructiveHint`. Claude Desktop groups the 59 look-ups and plans as read-only, so the GM can allow them once instead of clicking "allow" on each look-up (the tool-pick test counted 0.6 to 0.8 clicks per request), and it keeps asking before the 27 tools that change something; 8 of them are marked destructive (they can delete or overwrite: `apply-planned-change`, `undo-change`, `use-item`, rests, initiative, journal and world item updates, clearing the error buffer). The `plan-*` tools count as reads: a plan only stages a change, and the apply asks. The table is `tool-hints.ts`; a test fails when a tool has no entry or a tool named like a write is marked read-only. The tool reference shows each tool's kind. Core and prep each grew about 1,500 characters, so their size budgets went up by 2,000.

### Installer (audit L2, L3, L4)

- **The token file is deleted after use:** a silent install with `/TUNNELTOKENFILE=` removes the plain-text file as soon as the encrypted copy is stored (a failed delete prints a warning).
- **Warning for a bridge address that may be on the internet:** `configure-claude.ps1` warns when the address is not loopback, private, Tailscale or a LAN name, and points to the Cloudflare tunnel.
- **Shared install folders are refused:** the tunnel setup stops with exit 2 when the folder holding `tunnel-client.ps1` or `cloudflared.exe` can be changed by anyone besides you, SYSTEM and Administrators, before the logon task is registered.

### Developer tools (D-102)

- **Test kit waits for the species link and cached spells:** dnd5e links a new species item to
  the actor, and adds the cached spells of its Cast activities, with writes it does not await;
  the next advancement manager writes its copy of the actor back whole. The kit started the
  background within about 100 ms of the species, so on a slow run 8 species in `origins-species`
  lost their walking speed and darkvision, and Air Genasi its Shocking Grasp (reported as
  SYSTEM). `createHero` now waits for both after each step and fails the build (as SYSTEM) if
  they never arrive. A player clicking through the forms is far slower than that. The wait lives
  in its own file with unit tests, and resolves spells with the async `fromUuid` so a spell in a
  pack whose index is not loaded is not skipped.
- **Test kit picks the species it plans:** the Actor Studio drop-downs carry no uuid, so the kit
  picked "Elf, High" by its shortened label "Elf" and every elf became a Drow (every gnome the first
  gnome) without a failure. Species, background, class and subclass are now picked from the uuid:
  by the full label when the list shows it (Actor Studio 2.10.5-aitool.4 does), else by the entry's
  position among the pack's entries that shorten the same way, and a count mismatch fails the pick.
  The log line says which group heading matched, or that none did and the whole list was searched.
  `player-character-creation` also fails a character whose species, class or background item does
  not come from the picked uuid (a 2014 and a 2024 Fighter share an identifier), and notes any
  feature or spell name that sits on the sheet twice, with each copy's type and what granted it
  (gear and the copies dnd5e keeps for a Cast activity, such as Favored Enemy's free Hunter's Mark,
  are left out).
- **Start alerts hook:** a project SessionStart hook (`.claude/hooks/start-alerts.mjs`) that
  prints nothing when all is fine and otherwise up to nine short lines: `CLAUDE.md` differs from
  the vault master, who holds the test server lock, lanes at 200k context or more, and a missed or
  paused session-notes run (the last two from the control center).
- **Kit run command:** `npm run kit:run` takes the test server lock, builds, restarts the test
  environment on the kit world, runs the test kit, stops the environment, releases the lock and
  records the result in `<kit home>/last-run.json` and the vault note `Test kit runs.md`. On
  demand, or overnight with `--nightly` (`scripts/test-kit/register-nightly.ps1` registers the
  scheduled task, hidden, no catch-up run in the day). Ctrl+C or a closed console stops the
  current step and still releases the lock; the nightly run takes over a stale kit run lock.

### Process

- **Lane skill:** a lane puts a `Backlog: <id>` line in its PR body, so the live PM board shows the open PR on the lane card.
- **`npm run usage:week` shows the split per model:** a Models line after the targets gives turns
  per model (main thread + subagents) and each model's share of the weighted cost, so a week
  where lanes slip back to Opus shows up (`models` in `--json`).
- **Model routing rules in the lane and planner skills:** every Agent call, Workflow `agent()` call
  and `start_session` (cards and successors too) sets `model`, because an unset model inherits
  the caller's; the Opus review is picked from the PR's file list. Finding: vault D-122.
- **`usage:week` no longer has a startup share target:** the 20% target needed an average turn of
  about 385k with a 77k start, which the 350k/400k hand-over rule forbids (D-122 log, first
  weekly check). The Share column stays as information; the Targets line has four figures. The
  Models test now asserts the exact line, the sort order, an `other` family and a response outside
  the window, and `priceOf` says Mythos is weighted 3.
- **Haiku steps named in the lane and planner skills:** reading long vault notes, CI and test
  logs and summarising review notes go to a Haiku 5.5 subagent with `model` set. Also: a delta
  round on lows is Sonnet for non-risky PRs only, and the weekly check says "more turns than Opus"
  in a window after 2026-10-12.
- **Planner skill:** "Backlog upkeep" now covers the live PM board's lines (`- id:`, `- board:`, `- pi: yes`, `W21` / `item:<id>` blockers), keeping the `Board.md` go / no-go lights true, and triaging the "Captured on the board (triage)" chapter that the board's Capture and Promote fill (D-124).

### Test tools (I-016)

- **`live:sweep` now runs every write tool:** besides the direct-write tools it plans, applies, checks, undoes and checks again the party (pace, rest request, place, add to combat), Tarokka (import, links, reveal, and checks that the reading from before comes back), handout (queue, unqueue, reveal, hide), Obsidian mirror and planned-undo tools, plays and stops a playlist, and runs `use-item` without a click (the clean-up closes its dialog). It turns the party, Tarokka, handout and Obsidian mirror switches on for the run and puts them back. The three `request-*` tools still need the Player user logged in and are skipped with the reason otherwise.
- **Test world helper (test worlds only):** three new modes behind `/api/test/live-sweep` (`switches`, `fixture`, `playlist-state`) and a clean-up that also removes sweep playlists and closes `use-item` dialogs.
- **A failed sweep step no longer leaves guarded changes behind:** if a step fails between an apply and its undo, the clean-up undoes what is left (newest first), unqueues a handout it queued, and checks that the Tarokka reading, its archive and its reveal journal are as before the run. The Tarokka link undo still leaves an empty `{}` per card in `gm/tarokka-config.json` (harmless; Backlog).

### Dev tooling

- **`lane:merge` refuses a review note whose Head line is out of order (#314 L3):** each `## Verdict` needs a `Head reviewed:` line between it and the previous verdict (or the top of the note), and none may follow the last verdict. Before, a verdict written above its own Head line tied to the previous round's sha, so a "Do not merge" could be cleared by a separate Merge note for the new head. The same hole is closed for a sha inside the verdict heading, a Head line with no `## Verdict` (for example a `###` heading), a `Head reviewed:` mentioned in prose (only a line that starts with it counts), two shas before one verdict, and a verdict under a short sha of the PR head. The gate names the note as malformed and says what to fix.
- **`lane:merge` merge-train lock: a stale lock is taken over by rename (#314 L4):** two runs that both saw the same stale lock could both get in, because the second deleted the first run's fresh lock. The lock is now renamed to a name only that run uses (one rename wins, the others retry), and a live lock caught by mistake is put back. A test replays the race (it fails on the old code).
- **Model guard hook:** `.claude/hooks/guard-model.mjs` (a PreToolUse hook on `Agent`, `Task` and `start_session`) refuses a call with no `model`, because an unset model inherits the caller's and an Opus session then starts Opus workers and lanes. `start_session` takes a full model id and refuses a short name such as `sonnet`. Forks, cloud starts, starting an already proposed card and the title-only offer card are exempt. Tests run in CI and `npm run green`.
- **Merge lock and review-note lows:** `lane:merge` now reports a failed link back when it takes over a stale lock (a stderr warning when another run took the slot, the lock moved back where hard links are missing), waits and times out on a persistent takeover error instead of spinning, and a run releases only the lock it wrote (a token in the lock file). The shell-edit guard no longer treats `p = Path(p)` in a loop as a reuse of the loop variable. Doc and test touch-ups for the review-note format and the re-fetch order.
- **`usage:week` target labels read `TARGETS` (#315 round 2 L1):** the text after each figure in the targets line (`<=75k`, `<=18`, `~15`, `~14`) is built from `TARGETS`, so changing a target changes the line. A new test puts every figure exactly on its target (all `ok`) and checks the labels follow a changed `TARGETS`.
- **`lane:merge --wait-ci` lows:** a test now covers the real re-fetch case (`fetched: true`, as every real run has): exactly one `git fetch aitool main`, after the wait. The `gate()` test helper takes `fetched`. Two skill lines in the lane and planner skills are wrapped at 100 characters again.

### Test kit (D-090 lane 2)

- **Module sync on save (D-102):** `sync-module.ps1 -Watch -Session <id>` runs the module's
  TypeScript build in watch mode and copies the module to the test server after every build
  change, only while that session holds the test server lock. Without the lock it says who holds
  it and copies the waiting change once the session holds it; it never takes the lock itself.
- **Test server scripts:** a damaged `pids.started.json` (empty, broken, a list, an entry without
  a pid or a start time) no longer stops `start.ps1` and `stop.ps1`; the bad entries are skipped
  and the service is judged by its port and command line alone (a #192 review low).
- **Failed dashboard requests say which tool and why:** a dashboard API request that answers 400
  or more is recorded as `HTTP <status> <method> <path> <tool>: <error>` (the tool's name and the
  server's error text, never its arguments) instead of the browser's bare "Failed to load
  resource" line, so a failed control row in the report names the tool that refused.
- **Pre-flight findings on a big world:** the `dash.preflight.show-findings` row waits for the
  drawer's own run to end before it opens the findings list (on the licensed world the run ended
  after the click and drew the list again, closed).
- **Dashboard pages in a real browser (slice 4 plumbing):** test kit scenarios can open dashboard and
  player pages in Edge (`t.browser`, also in a separate browser with no login) and attach screenshots
  to the report (`t.attachFile`). Console errors of those pages show in the report with the page they
  came from and are never merged with Foundry errors.
- **Dashboard write flows and the login split in a real browser (slice 4):** two new test kit
  scenarios click the dashboard's write flows (confirm window, Undo, Tarokka, party, handouts, notes,
  player links) and check the login split with random tokens in a fresh browser; the dashboard is
  restarted for the split and put back in the normal mode afterwards.
- **Dashboard control sweep and rendered player check in a real browser (slice 4):** a new test kit
  scenario opens or checks every dashboard and player control of the usage catalog in Edge (a table
  classifies each one; a unit test keeps it complete) and attaches a result row per control and one
  screenshot per drawer, view and During layout; a second scenario checks that the drawn `/player`
  page names no hidden token, canary or true monster name.
- **The write flows switch their own features on (slice 4):** `dashboard-write-flows` turns the
  Tarokka, handouts and party features on for the run and puts them back afterwards, and makes a kit
  party group when the world has none, so no flow is skipped for a switch or a missing group. The page
  the login split opens with no token keeps its expected 401 errors out of the report, and the player
  checks delete their canary token by id.
- **Safer test dashboard restart (slice 4 review):** `scripts/test-env/stop.ps1` stops a recorded pid
  only when it owns that service's port (a stale pid that another process has by now is refused with
  exit code 1 and forgotten); the kit refuses to restart the dashboard from a checkout with no built
  dashboard and leaves a split it did not make alone. A write flow that is refused for a switch the run
  turned on itself now fails instead of skipping; the login split reads the player page once it has
  drawn and checks that the no-token page logs nothing but 401 and failed-resource errors; the control
  sweep fails a row on a console error even when the row was skipped, and the Pick button and the
  player name picker are required rows.
- **The control sweep covers the Everyone tab and the undo window (slice 4 delta review):** the
  I-109 controls (the AI and Everyone tabs, the person filter, the Everyone rows' Undo, Redo and
  lines, and the undo window's Cancel, Just this, Everything since, Advanced, the rewind questions,
  the destructive tick and Escape) are classified; the sweep turns GM Actions on for the run and
  walks the undo window read-only (Apply and Redo stay with the guarded undo checks). `start.ps1`
  records each service's start time in `pids.started.json`, and `stop.ps1` decides from facts
  (`Resolve-StopAction`, table-tested): it stops our node process by its port or its command line
  (not on its port yet), the `cmd.exe` wrapper with our command line and its node child, reports a
  pid another process holds (another start time or command line) as not running, refuses a
  stranger on our port, keeps the pid when it cannot tell, and `reset-demo-world.ps1` stops on a
  refusal instead of copying over an open world. The control sweep sets GM Actions on instead of
  toggling the button.
- **The test kit engine, first slice:** `npm run kit -- all` builds the SRD test world
  `ai-tool-kit-srd` from the dnd5e compendiums (12 level 1 heroes, 11 monsters chosen by rule from
  a CR and type matrix, a walled combat map) and runs five scenarios against the bridge, the module
  and the dashboard: bridge health and catalog, compendium monsters, guarded damage with undo, a
  scripted fight checked against the play log and stats, and the player page spoiler check. Each
  run writes a report as Markdown, JSON and HTML. The kit only writes to its own world and refuses
  the live bridge ports. Licensed scenarios and run reports stay on the PC, never in a repo.
  Details: `docs/dev/TEST-KIT.md`.
- **CI:** the kit's engine tests, a check that every scenario names only real tools, and a full
  build and run against a built-in fake dashboard (no Foundry needed).
- **Every feature on every hero, plus deep checks (slice 2b):** two new scenarios. `heroes-features-use`
  uses every activity of every hero feature that can run without a dialog and checks that it posted a
  chat card, consumed the uses it says it consumes and raised no error; the hero is put back after
  each use. `heroes-features-deep` runs 21 rule checks against class tables of the 2024 SRD (Rage
  damage and resistances, Wild Shape, Channel Divinity, Sneak Attack dice, Bardic Inspiration die,
  Focus and Sorcery points, Pact Magic slots, Action Surge, Lay on Hands, Second Wind, Arcane
  Recovery, Divine Smite, Cunning Action, Extra Attack, superiority dice, Unarmored Defense,
  spell slots, Hit Dice, short and long rest recovery, proficiency bonus). Failures carry the KIT,
  CONTENT or SYSTEM class. Two new GM actions, `inspectFeatures` and `exerciseActor`, have fake
  twins, so `kit all --fake` runs both scenarios in CI.
- **Heroes get the ability scores of their class:** the standard array is placed for the class (15 in
  its primary ability, Constitution 13), so a Bard or a Sorcerer no longer has Charisma 8 and no
  uses of its Charisma features. Actor Studio heroes get the same scores.
- **Known findings per profile:** `heroes-advancement`, `heroes-features-use`, `heroes-multiclass`
  and the origins scenarios count the CONTENT and SYSTEM problems on the profile's known list instead
  of failing on them, and a new problem still fails. An entry must name the problem it covers
  (`what`, with the count where one problem packs several items) and may cap its matches per run
  (`max`); a hero that did not build is never known. The licensed list stays on this PC; the srd list
  in the repo has one entry (the dnd5e 6.0.5 Monk Self-Restoration grant). The report has a "Known
  findings" section.
- **Fewer false failures in the feature checks:** a use that only recovers each turn (Sneak Attack)
  is not expected to spend outside combat, as in dnd5e; a grant named by a short `Item.<id>` uuid is
  looked up in its own pack (a 2024 subclass grants its Unarmed Strike that way); and a CONTENT note
  names the pack the item came from, so a known-list entry can cover one pack's import gaps.
- **Pick coverage (slice 2a):** every pick records what the system offered, and the report's "Picks"
  section lists per class and choice the options no hero picked.
- **Coverage heroes:** at sizes `full` and `long` the kit builds extra heroes (role `coverage`, "Kit
  Fighter 3 cov 1") for play-changing options no hero picked (fighting styles, maneuvers, invocations,
  damage resistances), up to `--coverage-cap` (default 40); `--no-coverage` turns it off.
- **Every class and subclass, leveled and checked (slice 2a):** the kit builds heroes through
  dnd5e's own advancement with no dialogs, from a content profile (`--profile srd` in the repo; a
  licensed profile only on this PC). Smoke: every class at 5. Full: every class at 1, 5, 11 and 17
  plus every subclass at 20, 2024 and remaining legacy versions. Choices rotate through the options
  so the matrix picks each one. The new `heroes-advancement` scenario compares every hero with its
  class and subclass data (granted features, scale values, HP, spell slots, skills, saves) and
  classes each failure as KIT, CONTENT or SYSTEM. One hero belongs to Kit Player, so the player
  page check now covers the player character HP rules. Reports show coverage and build console
  errors.
- **Known findings on the licensed profile:** a profile names the profiles whose known lists count
  for it too (`"knownAlso": ["srd"]` in the licensed profile, because it includes the system's own
  packs), its own entries first; `spells-cast-all` reads the known list like the other scenarios;
  a monster finding ends with the monster's pack and a spell finding with the spell's pack, so an
  entry's `match` can name the pack and the same creature in two packs is told apart.
- **Licensed kit monsters from the imported Monster Manual:** a profile can name the pack its
  build's monster matrix picks from, and one rules version (`"matrixMonsters": {"pack": ...,
"rules": "2024"}`). The local licensed profile uses it, so its kit monsters no longer come from the
  system's SRD copies, whose features name the ids of a Monster Manual module that is not
  installed (31 unresolved links in the licensed world).
- **`strahd-kit` is a kit world:** a throwaway copy of the campaign world (the same name as the
  Pi's test copy), so the Curse of Strahd scenarios (on this PC only) can run against the adventure.
  The campaign world itself is still refused.
- **Known findings in the monster scenarios:** `monsters-matrix`, `monsters-every` and
  `monsters-odd` count the CONTENT and SYSTEM problems on the profile's known list (like the
  heroes and origins scenarios) instead of failing on them, and name the entries in the step
  detail and a `known` attachment; a new problem still fails. A challenge rating 0 creature with
  no items, or whose items carry no activity at all (a mount, a familiar, a summoned servant), is
  no longer a "no items" or "no action to use" problem, and a creature with no type at all no
  longer makes the bridge "disagree" with Foundry. The srd list gains the dnd5e 6.0.5 SRD findings
  of the full run (the Werewolf's and the Unseen Servant's creature type, the Avatar of Death's
  multiattack, the Cloaker's spellcasting ability, the Cloud Giant's Misty Step uses).
- **Every monster, checked (slice 3a):** three new scenarios cover the monster compendium of the
  content profile. `monsters-every` copies each monster into the kit world, uses one action, checks
  the copy against its compendium entry and against what the bridge tool `get-character` says, and
  deletes the copy again. `monsters-matrix` counts the monsters by challenge rating band, creature
  type, size and trait (resistances, immunities, senses, languages, spells, legendary actions,
  lair, movement) and lists the gaps. `monsters-odd` checks the odd mechanics: legendary actions
  (does using one spend the pool the dashboard's Boss pips read?), legendary resistance, lair,
  regeneration, shapechangers, movement modes, recharge rolls, multiattack and spellcasting. Every
  failure is classed KIT, CONTENT or SYSTEM. The `smoke` size samples a few dozen monsters, `full`
  does all of them. Details: `docs/dev/TEST-KIT.md`.
- **Test kit internals:** the GM actions `listMonsters`, `createMonster` and `deleteMonsters`, a
  `recharge` operation and a `changed` list for `exerciseActor`, the scenario context now has
  `t.size`, and the fake compendium has the odd creatures the new scenarios need. The `srd` profile
  lists the legacy `dnd5e.monsters` pack too.
- **Species, backgrounds, feats and multiclass heroes, checked (slice 3c):** four new scenarios.
  `origins-species` applies every species of the content profile to a level 1 hero through the
  system's own advancement and checks size, speed and movement modes, senses, trait grants and
  choices, granted features and their uses against the species' own data. `origins-backgrounds` does
  the same for backgrounds (ability score increases under the 2024 rules, skill and tool
  proficiencies, the origin feat and its grants). `origins-feats` adds every feat, one at a time, to a
  copy of a host hero that meets its prerequisites (origin, general, fighting style and epic boon
  feats); a feat no host can take is listed with the prerequisite that failed. `heroes-multiclass`
  builds twelve multiclass heroes by leveling into a second (and third) class: the 13 in the primary
  ability the kit sets, the reduced proficiencies a further class gives, the combined spell slot table
  with Pact Magic kept apart, hit points, hit dice and the features of every class. Every failure is
  KIT, CONTENT or SYSTEM; known and accepted ones go in `data/origins-expected.json`. `smoke` takes a
  sample, `full` does everything the profile has. Details: `docs/dev/TEST-KIT.md`.
- **Test kit internals:** the GM actions `listOrigins`, `describeOrigin` and `cloneHero`; `createHero`
  can now add items (a feat, a second class at its level) to an existing kit hero, take its own ability
  scores and answer a Size choice; `describeClass` can describe a class as a second class. The fake has
  matching species, backgrounds, feats and multiclass rules, with quirks the tests switch on.
- **Test kit slice 3c, first live run:** the four scenarios pass on the `srd` kit world and have no KIT finding on the licensed one. The run fixed how the kit reads dnd5e 6 species speeds and senses, skips advancements of a higher level than the hero, and allows the proficiencies a chosen feature or the class's subclass adds to a second class. Results and what is left: `docs/dev/TEST-KIT.md`.
- **"Picked items missing" carries its count:** the `heroes-advancement` problem now says how many
  chosen items are missing (`3 picked item(s) missing`), like the missing grants, so a known-list
  entry for one item cannot cover a new one beside it; a list longer than six ends with "...".
- **Every spell cast once, plus 31 deep spell checks (slice 3b):** two new scenarios. `spells-cast-all`
  gives every spell of the profile's spell packs to a suitable caster hero and casts it once at its
  base level with no dialog, no measured template and no summons; each cast is judged (no error, a chat
  card, the slot taken, none for a cantrip, concentration begun) and the hero is put back after it.
  `smoke` casts a repeatable sample of about thirty spells, `full` casts them all. `spells-deep` runs
  31 rule checks on SRD spells: spell attack bonus, save DC, save for half damage, a save that negates
  with a condition, area templates (sphere, cone, line, cube, wall), concentration (begin, replace,
  none), upcasting (dice, targets, healing), healing and temporary hit points, teleport, a reaction
  (Shield), armor and bonus effects, rituals, cantrip damage by character level, Pact Magic, which
  slot is taken, a refused cast, a summon (placed and cleaned up) and a spell scroll. Failures carry the
  KIT, CONTENT or SYSTEM class. Two new GM actions, `listSpells` and `exerciseSpell`, have fake twins,
  so `kit all --fake` runs both scenarios in CI. Scenarios can read `t.size`.
- **Heroes built in Actor Studio (slice 2c):** a new scenario, `heroes-studio`, builds one hero per
  class through the Actor Studio module's own windows (Playwright clicks: the ability scores, species,
  background and class pickers, "Create Character", the level-up window for each level, the Spells tab)
  and compares it with the raw kit hero of the same class, level and choices: class levels, subclass,
  hit points, armor class, ability scores, proficiencies, items and features granted, spell slots,
  scale values, where each item came from and what each advancement holds. A difference is a finding
  of kind KIT, CONTENT, SYSTEM or the new STUDIO (Actor Studio itself). The feature use pass of slice
  2b runs on both heroes, and Actor Studio's own console errors are reported as findings. Four new GM
  actions (`inspectBuild`, `studioPump`, `adoptActor`, `deleteKitActor`) have fake twins; against the
  fake the scenario builds the "Studio" hero with the builder, so `kit all --fake` tests the comparison
  in CI. The `srd` profile now lists `foundryvtt-actor-studio` under `modules` (run `kit init` once).
  A scenario can name console errors it reports itself (`knownConsoleErrors`) and a scenario gets the
  GM page as `t.page` (null against the fake).
  Known findings are listed in `data/studio-expected.json`: they are counted and the scenario passes,
  a new one fails. `kit init` turns off Actor Studio's usage tracking (it posts to its author's server
  by default) and a run never turns it back on.

### Scene mood and music (follow-up to PR #406)

- **One track at a time:** `play` or `switch` on a sequential or shuffle playlist that is already on
  a later track keeps that track instead of starting the first one as a second track.
- **Refused while planning:** soundboard-mode playlists (they cannot play as a whole) and weather
  ids Foundry does not know (the reply lists the valid ones).
- **Undo note:** the `plan-scene-mood` text now says music undo is refused once a playlist has moved
  on to its next track by itself.

### Scene mood and music (I-034, I-129; ships off)

- **`plan-scene-mood` and `list-scene-moods` (play set):** Claude can set a scene's darkness, global
  light, weather and playlist, save a named mood preset on the scene ("Crypt", "Tavern at night"),
  apply it later, and start, stop or switch a playlist ("play the tavern music"). Every change is
  a guarded plan with the usual confirmation, Undo and an entry in Recent Changes, so music can be
  undone too. Off by default: the module setting "AI Tool: Scene mood and music (writes)" must be
  on. `list-scene-moods` shows the presets, the scene's look and the playlists.
- **Module:** new read-only bridge queries `planSceneMood` and `getSceneMoods` and the feature
  switch `scene-mood`. The Play tool set grows to 32 tools and its size budget to 32,000
  characters.

### NPC turn assistant (I-125; ships off)

- **`plan-npc-turn` (play set):** Claude reads the running fight and proposes a monster's turn. Without
  a move it returns the NPC whose turn it is (speed, attacks) and each enemy's distance, AC and hit
  points. With a grid square it checks the move (inside the speed, square free) and plans it as one
  guarded change with the usual confirmation, Undo and an entry in Recent Changes; with an attack and
  a target it also checks the reach after the move. The attack roll stays with `use-npc-activity` and
  the damage with `plan-actor-change` (the result names both), since a roll cannot be undone. One move
  and one attack per call; multiattack, spells and legendary actions come later. Off by default: the
  module setting "AI Tool: NPC turn assistant (writes)" must be on. Distances count whole squares;
  walls and difficult terrain are not checked.
- **Module:** new read-only bridge query `planNpcTurn` and the feature switch `npc-turn`.
- **Tool budget:** the play set's size budget goes from 32,000 to 33,000 characters for this tool.

### Obsidian (O7)

- **Player vaults:** with `FOUNDRY_AI_PLAYER_VAULTS_DIR` set, the co-GM dashboard keeps one
  Obsidian vault per player, holding only what that player may see: the handouts revealed to them
  (recaps in `Recaps/`), their own character, the public session log, and the world's theme. A
  folder is updated in place, file by file, only when something changed, so a Syncthing share of
  it keeps working; every session of the log is kept. Off by default; sharing the folders with the
  players comes later with the Orange Pi setup.

### Obsidian (I-120 follow-ups)

- **An edited Home is a standing note, not a problem:** `AI Tool/_status.md` lists it under "Your
  own notes (kept as you edited them)" instead of "Skipped", it no longer counts as a skipped note,
  and the automatic render no longer warns about it on every export.
- **"Without a book" waits for a complete Library refresh:** an incomplete refresh no longer
  rewrites the note from the rows seen so far, so the list does not shrink until the next run.
- **Spare characters stay out of the party totals:** characters no player owns were already left
  out of the per-PC stats; now they are also left out of the session and campaign party numbers
  (damage taken and dealt, healing, PC downs, the highest roll). A spare character's down still
  shows in its fight. Table counts (all rolls, spells cast) are unchanged.

### Obsidian (I-121)

- **Scene and journal notes link their prep note:** a scene mirror note links its location prep
  note and a journal note its quest prep note (a `prep` property and a "Related notes" Prep link),
  as NPC notes already did, so the link goes both ways. A prep note the GM adds, moves or removes
  later reaches the scene, journal or NPC note at the next vault scan (within 10 minutes), without
  a change in Foundry. Every mirror note renders once more (renderer version 7).

### Obsidian (R4)

- **Seen in, two edge cases:** an NPC no longer counts as seen when the GM changes its HP or
  conditions while it has no token on the active scene (Strahd's sheet edited while he waits in
  the castle), or through its token on a scene the GM only previews. A combat turn now goes by
  the combatant itself: hidden in the combat tracker, its token hidden, or its token on another
  scene. PCs still count without a token (their players see their sheets).
- **Seen in:** NPC and scene notes list the play sessions where they appeared, newest first, each
  linking its session note, and carry a `last_seen` date property. It is built from Foundry ids in
  the play log, never from names, and only while a player is connected: an NPC counts when it
  acted at the table (a roll, item use or chat that was not whispered or blind, damage or healing,
  a condition, a combat turn) or had a visible token on the active scene. GM prep, creating,
  placing or moving tokens, and scenes the GM only previews never count. PCs get no list (their
  stats note covers it). The
  export writes the index to the bridge vault (`gm/obsidian-seen.json`) and the mirror re-renders
  only the notes whose list changed.

### Fixes (Part C lows, round 3)

- **Remote access guide:** step 5 now says "Save the route." right after the route is described, and
  the optional JWT paragraph says "save the route again".
- **Obsidian plugin:** two Cloudflare Access header lines pasted into one field with no newline
  between them are split, so the Id and Secret each get their own value.
- **Windows tunnel installer:** when registering the sign-in task fails under `-NoStart`, the error
  no longer claims the old tunnel was stopped (it was left alone).

### Remote access (Part C)

- **Tunnel installer:** a failing task registration in `tunnel-client.ps1` Install now ends with a plain
  error line that says the old tunnel was stopped and to run Install again; a `-StateDir` that ends in a
  backslash is trimmed so the quoted task and `-NoTask` arguments work.
- **Obsidian plugin:** the Cloudflare Access Id and Secret fields accept both pasted header lines in one
  field, and a Secret line pasted into the Id field sends no Id instead of a wrong one.
- **Docs:** `set-dashboard-access.sh` no longer says stage 5 must be run again; Remote access step 5 says
  to save the route again.

### Pi backups (PB-06)

- **Discord DM when the PC's backup copies go stale:** after each successful run, `pull-restic.ps1`
  and `pull-snapshot.ps1` run one fixed command on the Pi (`record-pull.sh restic|snapshot`, installed
  by stage 6), which writes the Pi's own clock into `/var/lib/foundry-backup-pulls/<kind>.json`
  (root-owned, outside the foundry user's tree; the bot only reads it). The recorder bot reads those files every 15 minutes and DMs the owner when either kind (restic or
  snapshot) is older than 3 days, judged per kind (`FOUNDRY_AI_BACKUP_STALE_DAYS` changes it): one DM
  naming the stale kind or kinds and their age, a reminder at most once a day for each stale kind, one
  "copied again" DM for a kind that recovers while the other keeps its own schedule. A record that
  stays missing (while the other kind is recorded), unreadable or invalid for longer than the limit
  counts as stale too, and a record dated more than a day ahead is invalid; no DM while nothing was
  ever recorded. The first check after a bot start waits 15 minutes, so a restart does not repeat the
  DM. A Pi that cannot be told only logs a WARNING on the PC. Rollout: stage 6, a new tool build (stage 5), stage 8;
  the scheduled tasks need no re-registering. Details: `docs/dev/PI-SETUP.md`, "Stale backup copies".

### Installer (PB-09)

- **The Windows installer is now a Claude Desktop client installer:** it installs only a portable
  Node.js and the bundled MCP client, and no longer ships or installs the Foundry module or a local
  bridge (no Foundry data-folder detection, no module section). Foundry, the bridge and the module
  run on the home server.
- **It asks for the bridge address** (a host name or IP, for example the server's name on your
  private network; port 31414 by default) on its own page, validates it (not empty, no spaces or
  quotes) and remembers it for the next run. Silent install: `/S /HOST=<name or IP> [/PORT=31414]`.
- **The five Claude Desktop entries** (`foundry-mcp`, `-play`, `-prep`, `-build`, `-admin`) are
  written with `MCP_CONTROL_HOST`, `MCP_CONTROL_PORT` and `MCP_NO_SPAWN=1`. Every other entry and
  key is kept, a timestamped backup is made first, and a damaged config file is left alone instead of
  being recreated. Both the classic `%APPDATA%\Claude` file and the Microsoft Store build's copy
  (`%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude`) are written; the classic one is
  created when none exists.
- **Claude Desktop must be closed** (it rewrites its settings when it quits): the installer asks you
  to quit it from the tray icon and retry, waits up to two minutes in a silent install (exit code 3
  if it is still open) and never closes it. Uninstall removes only the five entries.
- The settings file is read and written as UTF-8 without a BOM (Windows PowerShell 5.1 would
  otherwise garble every non-ASCII character), replaced atomically, and only the newest five
  timestamped backups are kept. The classic `%APPDATA%\Claude` file is created only when no
  Microsoft Store Claude Desktop was found. Process detection fails closed and ignores Claude Code.
  The address is a host name, IPv4 address or bracketed IPv6 literal.
- `configure-claude.ps1` takes `-BridgeHost`, `-BridgePort`, `-Uninstall` and `-ConfigPath` (one file,
  for tests). The batch fallback wrapper, the local `start-server.bat` and `test-connection.bat`
  are gone. The installer ships `node.exe` only (not npm or a second copy of node.exe) and uses LZMA
  compression, so it is much smaller.
- Fixed: the version stamp for the Programs list wrote doubled backslashes into the registry key
  path.

### Removed

- **WebRTC connection path (PB-09):** the Foundry module and the bridge now talk over one
  WebSocket (31415) only. The `werift` dependency, the WebRTC signaling port (31416, test 31516),
  the chunk reassembly code and the `FOUNDRY_CONNECTION_TYPE`, `FOUNDRY_STUN_SERVERS` and
  `FOUNDRY_WEBRTC_PORT` settings are gone, which clears the two audit findings tied to `werift`.
  The module setting "Connection Type" is no longer registered; a value still stored in a world
  is ignored and the module always uses the WebSocket. The setting is unregistered rather than kept
  hidden (as PB-03 did for retired settings) because Foundry ignores stored values of unregistered
  module settings; checked live with a stale "webrtc" value. Nothing used WebRTC (Foundry runs on the
  Pi and is reached over Tailscale). Docs, the compose and Docker files and the test-environment
  scripts no longer mention it.

### Orange Pi (#310 L1)

- **Stage 5 builds a tag whose build is pruned of its dev packages** (from `pi-build-2026-10-12`, the merge of PR #319,
  on). Older refs such as `v0.21.0` still work with `TOOL_REF` and keep their dev packages. `rebuild-drill.ps1` uses
  the same default (see the release-tags entry for how the default is chosen).

### Test kit (I-028)

- **The kit can run against the Pi (tools only):** `kit run --target pi --not-game-night` runs the
  scenarios that only call bridge tools against the Orange Pi's throwaway world `strahd-kit`, to
  find out which tools need a canvas that the Pi's no-screen GM browser does not have. It is opt-in
  and never the default, refuses any other command than `run`, any other world, `--fake`, this PC as
  the host and the live bridge ports, and stops unless the Pi's Foundry is launching `strahd-kit`. A guard in front of the dashboard
  client lets a scenario call only the tools it declared, and only read or `plan-*` tools, and
  re-checks the world before each call.
  Host and ports come from a targets file outside the repo (no secret in it). The new scenario
  `canvas-tools-headless` calls ten read or plan tools and logs, per tool, whether it worked or
  failed for want of a canvas; it also runs in a normal local run as the baseline.
- **`fetch-kit-login.ps1`:** copies the kit session's `Kit GM` password to a file on this PC with one
  read-only command, without printing it; `-Remove` deletes it.

### Pi scripts and test kit (pi-lows-2)

- **Kit session teardown cutoff:** `kit-session.sh` now stores `STAMP_EPOCH` (seconds) next to `STAMP` and passes it as `SINCE_EPOCH`, so a daylight-saving change or a timezone change on the Pi cannot move the cutoff for which actors `MODE=down` deletes. An older state file without it falls back to `STAMP`.
- **Stage 15 confirm:** `CONFIRM=1` refuses while the safety revert service is running, instead of saying there is nothing to cancel.
- **Stage 11 asset folders:** refuses a link to a folder anywhere below `ddb-images` or `tokenizer`, not only the top folder.
- **Kit player run:** `player-run.mjs` reads `/api/status` and refuses the live world (or a server with no world) before it opens a browser. A repo folder named `..out` now counts as inside the repo, and the `--out` refusal test no longer depends on the working directory.

### Orange Pi

- **Stage scripts no longer write in the foundry user's folders as root:** `lib.sh` has one helper
  that edits a JSON file as the foundry user (temp file plus rename, mode kept, the foundry user as owner) and one
  that copies a file the same way. Stage 5's check world, stage 11 (`set_world`, the kit world's
  `world.json`), stage 12 (the saved copy of `options.json`, putting it back, the proxy options),
  stage 13 and the kit session use them, so a link left at a temp name or at an asset name is never
  written through. Stage 11's asset merge uses `cp --remove-destination`. Stage 12's backup copy of
  `options.json` is now owned by the foundry user. The temp name is `options.json.foundry-tmp` for
  all of them. The change reaches the Pi on the next run of each stage.
- **Stage 5 checks the new build before it stops anything:** after the prune it loads one module of
  the bridge, the dashboard (including its server-only AI client) and the shared package from the build, so a runtime package the prune
  took away stops the stage with the failing package named, while the services and the old copy
  are untouched.
- **Stage scripts no longer disturb a game night (deep review r37 S1 to S5):** `lib.sh`'s `enable_unit`
  restarts a running service only when its unit file or a listed settings file changed in that run (or with
  `RESTART_UNITS=1`); a rerun that changed nothing leaves Foundry, the bridge, the dashboard, the Assistant GM
  and the tunnel running. Any stage that stops or restarts a service first refuses while players are online
  (Foundry's `/api/status`, the Assistant GM browser counted as one) or a Discord recording runs, and every
  stage refuses without a `dietpi-backup` snapshot that completed today; `FORCE=1` in front of `bash` overrides
  the first two, `NO_SNAPSHOT=1` the snapshot check (for a brand-new Pi). A restart a guard refused still
  happens on the next run, because a file newer than the running service counts as changed.
  Stages 5 and 12 warn when the dashboard player/GM split is off.
- **Safer installs:** stage 2 pins Node (`NODE_VERSION`, default v24.21.0) instead of following
  `latest-v24.x`; stages 2 and 3 unpack next to the old folder and swap, instead of `rm -rf dir/*` first.
- **Backups and sync:** stage 8 adds the recordings folder to dietpi-backup's exclude list (D-126 q26);
  the Syncthing ignore list on the Pi (stage 7) and on the PC (`setup-syncthing-pc.ps1`) adds
  `.obsidian/plugins` and `.obsidian/community-plugins.json` (D-126 q28). All of it reaches the Pi on the
  next run of each stage.

### Orange Pi (#310 and #311 follow-ups)

- **A dev-only import can no longer reach the Pi unnoticed:** `scripts/pi/runtime-imports.test.mjs`
  (a CI step, also in `npm run green`) reads the sources of the bridge, the dashboard server, the Discord
  bot and `shared` with the TypeScript parser and fails when one imports a package that is not a
  `dependencies` entry of its workspace, because stage 5 drops the dev packages. It also checks the
  Pi's browser scripts and that the lock keeps a single copy of `playwright-core`.
- **Stage 5 prunes on a rerun too:** a build of the same ref that still has its dev packages (an
  earlier stage 5, or a ref that moved past the prune) is built once more, pruned; a pruned build
  carries `.tool-pruned` and is left alone. The empty `node_modules/@storybook` folder is removed.
- **Stages 11 and 13 end with the GM password check:** they warn when Foundry has no administrator
  password or a world has a Gamemaster or Assistant GM without one, so a world or GM user added
  after stage 12 is noticed (add `lib-gm-passwords.sh` to the pipe; the stage says so when it is
  missing). The administrator password is under the Configure gear (Application Configuration) and
  reads "Change Password" once set; the docs and messages now say so.
- **Stage 13 container test:** a second run on the same fake Pi (the module install is skipped) and the
  closing GM password check are covered.

### Pi scripts (lows batch)

- **Stage 15 (SSH keys only):** the CONFIRM step checks the live daemon and the drop-in again before it stops the safety timer; a `Match` line written `Keyword=value` is read correctly; a failed reload or a dead sshd rolls back or restarts it and leaves the timer armed when ssh is not active again; the port lookup reads all of `sshd -T` (no SIGPIPE).
- **Stage 5 (tool):** the load check also loads the Discord bot's voice code, fails when the build leaves more than the console handles open, and says "timed out after N seconds" when it times out.
- **Stage 9 (ssh log):** the timer check uses `systemctl is-active --quiet`.
- **Stage 11 (world):** refuses, before anything stops, when `ddb-images` or `tokenizer` in the world data is a link.
- **Kit session:** `MODE=down` deletes only the actors `Kit Player` owns that were made after `up`; older owned actors are kept and listed. The kit refuses nothing new for a normal session, since the actors it makes are all newer.
- **Test kit:** `scripts/test-kit/player-run.mjs` is the player run (a Player builds a level 1 character with the standard array, the kit's sheet checks judge it); output goes to `--out` or a temp folder.
- **Tests:** more container scenarios for stages 11 and 15, and tests for `5-check-world`.

### Orange Pi (D-123)

- **Stage 15, SSH with keys only** (`scripts/pi/remote/15-ssh-keys-only.sh`): before the Cloudflare
  tunnel goes live, the Pi's SSH server stops taking passwords. A drop-in,
  `/etc/ssh/sshd_config.d/00-foundry-keys-only.conf`, sets `PasswordAuthentication no`,
  `KbdInteractiveAuthentication no` and `PermitRootLogin prohibit-password`; the main `sshd_config`
  is not edited. The stage refuses unless root has a valid key that sshd really accepts, the main
  config includes the drop-in folder, ssh is not socket-activated and no `Match` block sets a login
  value; it checks `sshd -t` after writing and `sshd -T` for root from three addresses after that
  (an earlier line that overrides a value rolls the drop-in back and lists the lines that win). Like
  stage 9 it then arms a 5-minute safety timer (it puts the old settings back and starts ssh if it
  is down) unless a new key-only connection confirms (`CONFIRM=1`), reloads ssh (not a restart: open
  sessions stay up), asks the running sshd what it offers and prints the effective values; `UNDO=1`
  removes the drop-in. The console login with the root password still works. A rerun checks the
  safety net: a timer still armed is left armed, a lost one is re-armed, a confirmed drop-in only
  reloads. Tested in the ARM64 container with the real OpenSSH server
  (`scripts/pi/container-test/ssh-keys-only-scenarios.sh`); the command guard's test lists stage 15
  as an "ask". Not yet run on the Pi. The Pi stage command lines in `PI-SETUP.md` are now marked as
  Git Bash (PowerShell's `cat` sent the Pi nothing).

### Orange Pi (D-112, D-113)

- **Stage 13 lets players make level-1 characters in Actor Studio at session 0:**
  `scripts/pi/remote/13-player-creation.sh` installs our Actor Studio fork build (`2.10.5-aitool.4`,
  pinned by version and sha256) and sets the world settings character creation needs. The zip is
  checked against the pinned checksum and listed before anything is extracted (no absolute paths,
  `..` parts, backslashes or links; `module.json` must say the right id and version); the old module
  folder moves to `prev-<time>/modules`, never deleted, and a second run at the same version changes
  nothing. Then, in each world, a headless Chromium joins as the world's GM
  (`scripts/pi/remote/player-creation-settings.mjs`, login from `world-<id>.env`, never printed) and
  sets Foundry's `ACTOR_CREATE` permission for Player and Trusted Player (the roles already there
  stay), Actor Studio's `enableEquipmentSelection`, and its equipment source
  `dnd-players-handbook.equipment`, and turns Actor Studio's per-user `usage-tracking` off for
  every user who has it saved as on; it reads the values back after a reload and fails on any
  mismatch. `options.json` goes back to the world it launched before, and a failed run puts it, the
  old module, Foundry and the Assistant GM browser back. The pinned build is the fork's
  `2.10.5-aitool.4` release, checked against its SHA-256; a pinned `PENDING-RELEASE` (a build
  without a release yet) makes the stage refuse to run without `STUDIO_ZIP` and `STUDIO_SHA256`. Tested in an ARM64 container (download and checksum of `aitool.3` and the
  pinned `aitool.4`, skip on a second run, wrong checksum, `..`, absolute, backslash and symlink
  zips, a failed swap, and the restore path with a faked systemd); the in-browser part ran twice
  against the PC test server's licensed kit world. The stage refuses to stop Foundry while people
  are online or when `/api/status` cannot be read (`FORCE=1` overrides), never replaces a newer
  installed build without `ALLOW_DOWNGRADE=1`, and leaves Foundry and the Assistant GM browser as
  it found them (stopped stays stopped).

### Pi setup (stage 11, round 3 review of PR #294)

- **A kit world is only reset if it is a kit copy of the same world:** stage 11 now marks each kit world it
  makes (`flags["foundry-ai-tool"].kitOf` in `world.json`) and stops before anything changes when
  `KIT_WORLD` names an installed world without that marker for this `WORLD`, so a campaign run can no longer
  overwrite the Frostmaiden training world. The Pi's older `strahd-kit` is accepted for the Strahd campaign
  and gets the marker on its next run. `REPLACE_KIT=1` allows the replacement on purpose.
- **Suffix-only module versions are compared:** `2.10.5-aitool.4` against `2.10.5-aitool.5` now compares the
  counter instead of staying unsure, so an older Pi copy of a `-PiModules` module is refused and a newer one
  is accepted.
- **Clearer messages:** the stage 11 header describes how modules are handled now (a push-back keeps newer Pi
  copies, a second world's modules need `SHIP_MODULES=1`), the older-module refusal says where to update, and
  the `-PiModules` example in `push-world.ps1` uses `-Modules ''`.
- **Old Assistant GM driver is refused:** stage 11 now stops before anything changes when an extra GM is
  involved (`EXTRA_GM_USER`, or a world's env file that names one) and the installed stage 5 driver predates
  the extra GM, which it would silently ignore. Run stage 5 again first.

### Orange Pi (Part C follow-up)

- **`set-dashboard-access.sh`:** whitespace and newlines are now removed from the `--team` value
  like every other answer, so a value with a newline can no longer write an extra line into
  `dashboard-access.env`. The one-time link note and the guide now say the browser's history
  may still list the first visit with the token: open the link in a private window or delete
  that history entry.
- **Stage 11:** the "no Foundry connection in the bridge log" warning was a false alarm (the
  bridge does not log connects). It now looks for an established TCP connection on the bridge's
  Foundry port 31415, still only a warning.

### Orange Pi (Part C, D-075)

- **Stage 12, Cloudflare Tunnel:** `scripts/pi/remote/12-tunnel.sh` installs `cloudflared` from
  Cloudflare's signed apt repository (key pinned by fingerprint) as the service
  `foundry-ai-tool-cloudflared`, in token mode. The tunnel token is read from a root-only file
  through systemd's `LoadCredential`, never from an argument or an environment variable, and the
  unit does not start without it. Optional `FOUNDRY_PUBLIC_HOST` sets Foundry's `hostname`,
  `proxySSL` and `proxyPort` 443. It opens no port and changes no firewall, SSH, network or
  Tailscale setting. `set-tunnel-token.sh` is the helper the user runs in their own SSH session:
  it reads the token without showing it. The dashboard's service (stage 5) now also reads an
  optional `/etc/foundry-ai-tool/dashboard-access.env` for the Cloudflare Access settings, a file
  stage 7 never rewrites, written by `set-dashboard-access.sh` (the user runs it: it validates the
  answers, makes the GM token and shows it once). Nothing was run on the Pi.
- **Docs:** [Remote access](docs/dev/REMOTE-ACCESS.md) has a "Part C" section with plain steps
  (domain, Zero Trust team, tunnel, Access policies for the players and the GM, a service token
  for the GM's Obsidian plugin, testing from a phone, removing a player); the Pi guide lists stage 12.

### Orange Pi (D-097)

- **Plan B push-back, the world goes back to the Pi after the night:** `scripts/plan-b/push-back.ps1`
  builds the bundle from a played Plan B copy (it refuses while Plan B runs and when the copy was
  never played) with `push-world.ps1 -PushBack`: the world keeps the Pi's own Gamemaster password
  (`world-refs.mjs --gm-password-ok`), and `MANIFEST.txt` records the Pi backup Plan B started from.
  Stage 11 takes such a bundle only with `REPLACE_WORLD=1 KIT_WORLD=` and the Pi's world env file,
  and refuses when the Pi's world has a document created or changed after that backup (it lists
  up to five, names only) unless `REPLACE_NEWER=1`. The Pi's old copy goes to `prev-<time>` either
  way. A rerun after a late failure passes the check (documents the same as in the bundle and the
  ones stage 11 provisions do not count), and a module the Pi updated after the backup is kept, never
  downgraded. Runbook: `docs/dev/PLAN-B.md`, "After the night".
- **Plan B, the Pi is down on game night:** `scripts/plan-b/` runs the Curse of Strahd world on
  the admin's PC from the Pi's newest backup copy (`E:\PiBackup\restic`, read without a lock).
  `restore.ps1` restores Foundry's data, the bridge vault, the dashboard state and the Assistant GM
  login into `C:\FoundryPlanB` and installs the Foundry version the world needs; `start.ps1` starts
  Foundry, the bridge, the dashboard and a headless Assistant GM (rehearsal ports by default, the
  Pi's own ports with `-GameNight`, which refuses while the Pi still answers); `check.ps1` says
  whether the world and the module link are up; `stop.ps1 -Clean` refuses to delete a world a
  night was played on until it is back on the Pi; `connectors.ps1` points Claude Desktop's
  connectors at Plan B and back. The spare tunnel (`-Tunnel`, `set-tunnel-token.ps1`) is finished
  once Part C is live. Runbook: `docs/dev/PLAN-B.md`; the GM's side is in the game night runbook.

### Plan B

- **A full rehearsal on this PC (2026-10-12):** restore from the newest Pi backup, start, check, stop and the push-back build ran on the rehearsal ports (30100, 31614, 31615, 3300); restore to a running Plan B took 37 seconds on the second run. The timings and what was not rehearsed are in `docs/dev/PLAN-B.md` ("Rehearsal record").
- **`check.ps1` waits for the Assistant GM:** right after `start.ps1` it used to report the module link as a problem for up to a minute; it now waits up to 90 seconds (`-WaitSeconds`) while the Assistant GM runs.
- **`stop.ps1` no longer warns about a port that is only closing:** it looks for five seconds before saying a port is still in use.

### Developer tools (D-103)

- **Project dashboard, step 1:** `npm run project-dashboard` serves a local developer page on
  `127.0.0.1:3200` (it rejects any other `Host` header) with the lanes table (busy, waiting or stale;
  context amber from 200k and red from 250k; a "do not reuse" badge; minutes until each waiting
  session's cache goes cold; the lane cap count), plan gauges, the test server lock, pull requests
  with their checks and CI on main, and this week's tokens per day. `npm run project-dashboard --
--lanes` prints the lanes table. One scanner reads only whitelisted keys of the Claude Code
  transcripts, incrementally, and writes `snapshot.json` to `~/.foundry-ai-tool/project-dashboard`.
- **Plan meter plugin:** a small Claude Code plugin (`scripts/dev/project-dashboard/plan-meter`)
  writes the 5-hour and weekly plan figures after each turn, since the desktop app's Code tab runs
  no status line.
- **Test server lock (D-101, D-102):** `pwsh scripts/test-env/lock.ps1 take | release | queue |
leave | status` keeps `lock.json` in the test environment's root; `status.ps1` shows the holder.
  `take -Force` takes over from a crashed holder or skips a dead queue head (entries older than 4
  hours are flagged), and a damaged `lock.json` is refused instead of read as free.
- **Project dashboard, step 2:** a versions panel (Foundry, dnd5e and every module on the PC test
  server, on the Orange Pi through one read-only `cat` over SSH, and the newest online, four times
  a day; `npm run project-dashboard -- --versions`), measured Usage rows and a weekly summary that
  the page writes to the vault notes `Usage log (measured).md` and `Usage weekly (measured).md`
  (each PC owns its own section), and a session-notes watchdog (red when a recording has no notes
  within 24 hours, amber when paused on the usage limit).
- **Vault wrapper (D-102):** `npm run vault:sync -- push -m "message" <paths>` pulls with autostash,
  commits only the given paths and pushes. The dashboard uses it hourly at most, and only while
  the rest of the vault is clean and nothing is left unpushed (it waits and warns otherwise); its
  pull never stashes, only fast-forwards.

### Session notes (D-097)

- **Recordings are kept:** the PC's audio is no longer deleted 14 days after approval (D-097
  replaces D-072). The bot's recording notice and the dashboard now say the audio is kept until a
  player asks for theirs to be deleted. `session-notes cleanup` is a manual tool and needs
  `--days N`; `auto.ps1` no longer runs it. The README has the steps for a player who withdraws.

### Release workflow (audit M1, M2, L1)

- **Pinned actions:** every action in `release.yml` is pinned to a full commit SHA with its version in a comment.
- **Pinned NSIS:** the installer build installs NSIS 3.10 from Chocolatey by version and prints `makensis /VERSION`.
- **Checksums:** the release publishes `SHA256SUMS.txt` for the uploaded files.
- **Tag name:** the tag reaches shell steps only through `env:` and must match `vX.Y.Z` (optional `-suffix`); `build-nsis.js` passes it to `makensis` as an argument list.

### Orange Pi (D-126)

- **The Pi builds the newest release tag, not a fixed one:** stage 5 and `rebuild-drill.ps1` pick the newest plain
  `vX.Y.Z` tag on GitHub unless `TOOL_REF` (`-ToolRef`) names another ref, and stop if there is no such tag, if the newest is older than v0.22.0, or if the Pi already runs a newer release tag
  than the one found.
  The release steps are written down in `docs/dev/RELEASING.md`.

### Room setup: Scene Levels, stairs and hazards (I-133, I-122; still off by default)

- **`plan-room-setup` gets three more actions.** `levels` adds Scene Levels (floors with an
  elevation range and an optional background image) to a scene. `stairs` makes a Region with
  Foundry's change-level behavior that joins two or more levels. `hazard` makes a Region with
  difficult terrain, a darkness change, or an existing Active Effect applied while a token is inside.
  Regions can now name the level they belong to. No code behaviors (macros, scripts) are used.
  Same plan, confirm and Undo, and the same switch "AI Tool: Room setup (writes)". Level changes
  show in Recent Changes.

### Room setup tools (I-133; ships off)

- **`plan-room-setup` (build set):** Claude sets up scene parts with Foundry 14 Regions, in grid
  squares counted from the map's top left. `teleport` makes an entry rectangle that moves any token
  entering it to an arrival rectangle, on the same scene or another (optionally both ways, optionally
  asking the player first). `spawn` makes a labelled room rectangle and puts tokens from actors on
  free squares inside it, hidden from players unless asked otherwise (Foundry has no spawn-on-enter
  behavior, so the tokens appear when the plan is applied). The usual plan, confirm and Undo apply;
  Undo removes everything the plan made. Off by default: the module setting "AI Tool: Room setup
  (writes)" must be on. Scene Levels and more region kinds are a follow-up.
- **Module:** new read-only bridge query `planRoomSetup` and the feature switch `room-setup`.

### Rules check (I-126)

- **`check-action` (play set), read-only and off by default:** before an attack, spell or item is
  used, Claude can check whether it looks legal and say why: whose turn it is, what it costs, the
  distance to a target against the range, and the spell slots or uses left. It changes nothing and
  cannot see which actions were already spent this turn. Turn it on with the world setting "AI
  Tool: Rules check".

### Live play (I-112)

- **Scene dressing now shows in Recent Changes with Undo.** Placing an area template, clearing
  templates, changing the darkness or global light, adding or removing a map pin and giving loot
  to a character used to write at once and leave no trace. They are now planned changes like
  damage and conditions: Claude shows the plan, the change is listed in the dashboard's Recent
  Changes, and Undo puts it back (the old balance, the removed item, the old darkness). Removing a
  template or a pin still asks for the second, destructive confirm. They follow the "AI Tool: Live
  play (writes)" switch, and "apply without confirming" covers them too, except when something is
  removed.
- **Six tools replaced by two.** `plan-scene-change` (actions template, clear-templates, mood,
  note, remove-note, loot) replaces `place-measured-template`, `delete-measured-template`,
  `set-scene-mood`, `add-map-note`, `delete-map-note` and `drop-loot`. `play-playlist` plays or
  stops a playlist by name (music was part of `set-scene-mood`; it stays direct, there is nothing
  to undo). The bridge now serves 84 tools; the play set has 29.
- **Loot reports bad item UUIDs** in the plan (`skippedItems`) instead of skipping them quietly,
  and a loot plan lists only the five dnd5e coins.
- **Readable lines in Recent Changes** for darkness, global light, coins and map notes (a map note
  is named by its label).

### Scene restore (Backlog scene-restore-big)

- **Big restores in batches:** a restore over the 200-change plan limit (Castle Ravenloft has 2,091 walls) is planned as a chain. Each plan holds the next 200 changes and says how many are left; apply it and plan again. Every batch is undone on its own.
- **`recentCopyOk`:** skips the "changed under 5 minutes ago" refusal for a hand-made copy of the world. A copy Foundry has open is still refused.

### Plan B (scene restore follow-up; Backlog scene-restore-extract)

- **`extract-scenes.ps1`:** restores only a world's scenes database from the newest backup into a folder of its own (read-only on restic, says how old the snapshot is, prints the folder for `backupPath`). `plan-scene-restore` and PLAN-B.md name it instead of a second `restore.ps1 -Root`.

### Scene restore (I-128; ships off)

- **`plan-scene-restore` (play set):** puts a scene's walls, lights, tiles and tokens back from a
  copy of the world, for a map the GM broke by hand (Undo covers AI changes only). It compares the
  live scene with the backup copy and plans the difference as one guarded change: what is added
  back, removed, moved or changed, with the usual confirmation (deleting needs the second one),
  Undo and an entry in Recent Changes. Tokens keep their current hit points and effects. Off by
  default: the module setting "AI Tool: Scene restore (writes)" must be on. Reads the backup
  with Foundry's own `classic-level`, so nothing new is installed. Design and use in
  `docs/dev/PLAN-B.md`.
- **Module:** new read-only bridge query `getSceneState` and the feature switch `scene-restore`.

### Storage space notices

- **Discord DM from the recorder bot:** every 15 minutes the bot reads the Pi's space check file
  (`/var/lib/foundry-ai-tool/space/status.json`, or `FOUNDRY_AI_SPACE_STATUS`). It DMs the owner once
  when free space gets low or critical (or the check goes stale), reminds at most once a day while
  it stays bad, and sends one "back to normal" DM. The owner is `DISCORD_OWNER_ID` when set,
  otherwise the Discord application's owner (for a team, the team's owner user). A failed DM is logged at most once a day. A missing file says nothing.
- **Dashboard banner:** a GM-only banner (yellow for low, red for critical) from the new
  `GET /api/space` route; players' pages never ask for it. A stale check shows only in Module
  Diagnostics. No banner when there is no status file.
- **Shared reader:** `shared/src/space-status.ts` parses and checks the status file (version 1) and
  never throws; the bot keeps an identical copy, kept equal by a test.

### Tests

- `scripts/pi/space-check.test.mjs` (CI step "Pi space check"): the stage scripts parse, the checker's
  JSON follows the contract, job blocking and `lastJob`, and the PC helper's levels and Pi-status
  handling. The remote command guard test now includes stages numbered 10 and up.
- **Remote command guard** (`.claude/hooks/guard-remote-commands.mjs`): two patterns backtracked
  without end (`ssh host cat file` with no pipe after it, and `rm -rf -rf -rf ...` with no target).
  They are linear now, with tests for those commands and a timing guard; nothing it blocked before
  is allowed now.

### Test kit (D-110)

- **Module control sweep inside Foundry:** a new scenario, `foundry-controls`, opens, clicks and checks every
  control the module adds inside Foundry as the GM and as a player: the AI Tool scene controls, the Changes,
  Handouts and Tarokka windows (with a guarded damage change planned, applied, undone and redone from the
  window), the settings section and its menus, the join page look, the journal status toggle and the roll
  request card. A player must not see or call any of them. The sweep puts back what it changed in cleanups
  that try every put-back, and a row fails on a console error of either page. The GM guide link is read
  without opening a tab. Sizes: smoke, full and long (the scenario adds several minutes to a smoke run).
- **Report numbers:** the scenario attaches `foundry-controls` (one row per control and role),
  `foundry-timings` (milliseconds for opening each window and for the guarded round trip) and
  `foundry-control-classes`. A unit test keeps the table in step with the usage catalog and with the drivers.

### Test environment

- **A second test server for kit runs:** test server B (`C:\FoundryTestB`, Foundry 30002, bridge
  31524 and 31525, dashboard 3101) runs on the same Foundry install and licence as server A, with
  its own data folder, module copy, vault, logs and lock. `npm run kit:run` uses B by default
  (`--server A` for the old behaviour), so a long kit run no longer blocks `live:roundtrip` on A.
  Every test-env script takes `-Server A|B` (default A, or `FOUNDRY_TEST_SERVER`); the ports live
  in `scripts/test-env/servers.json`, read by the scripts and the kit. `server-b.ps1` creates and
  refreshes B from A. The start alerts hook also reports B's lock.
- **Three local test servers (A, B, C):** server C (`C:\FoundryTestC`, Foundry 30003, bridge
  31534/31535, dashboard 3102) joins A and B, all with the same `ai-tool-test` world and package
  versions. Every `scripts/test-env` script takes `-Server A|B|C`; each server has its own lock, so
  a lane takes any free one. `server-b.ps1 -Server C` sets C up from A. Owner-only on localhost.

### MCP server (D-114)

- **Tool wording from the tool-pick test:** every connector's instructions now tell Claude to answer in the language of the latest message (English gets English, Danish gets Danish, not Norwegian or Swedish), and every connector that serves only some of the sets tells Claude to name the set to switch on before looking anything up when a request needs a tool that is not in its list. `roll-initiative-for-npcs` says that "the monsters" are the NPC combatants, not a name, and `plan-actor-change` says it does not level up characters. In the test, wrong-language replies to Danish requests went from 27 of 74 (Haiku) and 21 of 137 (Sonnet) to 0, and switch tests went from 65 to 68 of 68 (Haiku) with no loss in tool pick.

### MCP server (D-109)

- **One size cap for every tool result Claude gets:** a result over 100,000 characters (Claude Desktop handles about 150,000 per call) is cut, with a note that says how much was left out, that the JSON is incomplete, and how to ask for less or a different part, naming the tool's own parameters (`limit`, `since` and the like first). Only the Claude Desktop entries apply it; the dashboard still reads every result in full. Tests cover the guard and the tools whose results grow with the world (chat log, session log, changes, compendium and creature searches, journals).

### TV table viewer (tv-login, G1)

- **`plan-table-viewer` (admin set):** plans a Foundry user for the TV at an in-person session
  (default name "Table"): Player role, no password, owns nothing. A guarded change with the usual
  confirmation, an entry in Recent Changes and Undo (which deletes the user). Refuses when a user
  of that name exists. New feature switch "AI Tool: Table viewer (writes)", on by default.
- **`scripts/tv/start-table-viewer.ps1`:** opens Edge or Chrome full screen on Foundry with its
  own profile folder. `-Setup` once for the first sign-in (the Cloudflare email code). Foundry's
  own login lasts 24 hours, so the script also watches the browser (a debug port on 127.0.0.1
  only) and, whenever Foundry's join page of that game shows, joins as Table by itself. Later
  runs, also after a restart or a new day, go straight to the map. The script stores no secret;
  `-NoAutoJoin` turns the watching off.
- **Docs:** new GM guide "The TV at the table" (`docs/gm/tv-table-viewer.md`).

### Dashboard (I-127)

- **Version tracker (off by default):** a Versions panel in the new dashboard shows what is installed against the newest release for Foundry, dnd5e and each module, and the last test-kit result. Switch it on with "Version tracker" in the Advanced menu; GM only. The newest versions are checked online at most every six hours.
- **Module:** `get-modules` now also lists each module's manifest url.

### Demo videos

- **One compose command for finished videos:** `npm run demo:compose -- <manifest.json>` builds every cut (a master, a day-one cut and the feature clips) at 1440p60 from the take folders (`steps.json` with focus boxes) and the narration tool's output (WAV, `timing.json`). Each step lasts its narration, using speed ramps or a held push-in instead of frozen frames. It adds an eased zoom on the focus boxes, an optional cursor and click ring, ducked music and loudness normalisation to -16 LUFS, cross-fades between chapters, and burned-in captions as a second export (plus SRT, VTT and YouTube chapters). A 540p draft and a still at each step start come first, for review. It replaces the GM video's private `stitch.mjs`; see [DEMO-RECORDINGS.md](docs/dev/DEMO-RECORDINGS.md).

### Demo recordings (GM video polish)

- **Quarter-frame glitch fixed:** `t.shot` no longer calls `page.screenshot` on the window OBS is
  recording (it made the page draw at 1x for a few frames, so the recording showed the picture in
  the top-left quarter of the frame, once per shot). The PNG is cut from the finished video instead.
- **Cursor and click ring:** the demo cursor is now a smoothed blue dot with a ripple ring on every
  click (CSS only).
- **Focus boxes in `steps.json`:** a step records the box (fractions of the frame) and time of the
  last element `humanClick`, `humanHover` (new) or `humanType` worked on, for an automatic zoom in
  the video; `t.focus(locator)` picks the element by hand.

## v0.21.0 (released 2026-10-04): session notes into Foundry, My character, the Obsidian theme and Library by book, the Orange Pi bring-up

**Wire contracts are unchanged** (module id, ports, `foundry-mcp-bridge.*` method names, settings
namespace); a bridge reply's `error` may now carry an optional `code`. The bridge still serves 88
tools. Update the module and the bridge together. This is the first release the Orange Pi builds
from (stage 5).

### Security

- The dashboard verifies Cloudflare Access's signed login token (signature, issuer, audience,
  expiry) and never trusts the plain email header; new settings `CF_ACCESS_TEAM_DOMAIN` and
  `CF_ACCESS_AUD` replace `CF_ACCESS_EMAIL_HEADER` (I-022, closes P-038; PR #97).

### Session notes into Foundry (D-087; PRs #85 to #87)

- **Session notes go into Foundry by themselves:** after a recorded session, the Recap, GM
  summary and Scenes pages (Danish first, English below) land in a GM-only journal in the folder
  "Session notes" as soon as Foundry is open with writes on and the new switch "AI Tool: Session
  notes (writes)" (off by default) is on. Each put is in Recent Changes and the Live Feed with an
  Undo, which refuses once the Recap was revealed or a page was edited. The Recap waits in the
  reveal queue; revealing it (or "Approve without revealing") starts the audio clock.
  `session-notes publish` stages the notes on the bridge (host-only control method
  `session_notes`) and writes `approved.json` back (PR #85).
- The Obsidian mirror renders session-notes journals with their page text without an opt-in, and
  a play session's note links that day's session notes (PR #85).
- **The After view's session notes card (PR #87):** waiting, in Foundry or approved, with Read,
  Approve without revealing, Undo and Put in Foundry; GM only. Dashboard GM routes
  `/api/session-notes` (list, read, put, approve) (PR #85).
- Changed: an apply or undo of a guarded change now answers after its listeners have updated
  their state; control-channel errors may carry a stable `code`. `live:roundtrip` also checks
  session notes (stage, automatic put, undo, manual put) and needs "AI Tool: Session notes
  (writes)" on in the test world (PR #85).
- An apply or undo waits at most 5 seconds for the tool's own follow-up work (such as the session
  notes state) before it answers (PR #86).

### Dashboard

- **My character (I-096; PR #93):** a private read-only character page per player (`/me`) with
  At the table, Paper 2024 and Paper 2014 views and a print layout; each player sees only the
  characters they own. The GM makes, replaces and removes the links under Advanced, Player links.
  Module query `characterSheet` and bridge control method `character_sheet` (read-only, not an
  MCP tool).
- **Place the party here (I-097; PR #91):** puts every party member without a token on the scene
  you are looking at onto the nearest free squares around the centre of your view (or at a token,
  map note or square when Claude places them, `plan-party-change` action `place`), each token at
  its own size; one click with Undo.
- **Help inside the dashboard (I-064; PR #78):** feature cards in the Before view (on or off, what
  each does, when to turn it on), a "?" on every panel that opens the GM guide in a side panel
  (built in, works offline), and a new GM guide page "Features and when to turn them on".
- The "?" stays on the After view's stats and session notes cards (PR #89).
- Demo: takes for the new screens (the turn-order strip's one-click damage, Ready for session and
  feature cards, the After view's stats) (PR #89).
- Docs: the Orange Pi guide is rechecked for bring-up: players reach Foundry through Cloudflare
  Tunnel and Access (D-075), a list of what this PC needs, the licensed-content copy, and NVMe as
  root filesystem with boot from the card (PR #92).
- Demo kit: `--world` for another demo world (`ai-tool-demo-<name>`) and takes kept outside the
  repo (a file path; helpers as `t.lib`); `reset-demo-world.ps1 -World/-Source/-Title` (I-061;
  PR #95).

### Obsidian (I-099, I-100; PR #103)

- **The Library by book:** the Library is sorted by kind, then by book
  (`Library/Spells/Player's Handbook (2024)/`), with `book` and `page` properties, one base and
  one hub note per book (every Library note links its book, so Obsidian's graph groups them), and
  notes about the world follow Foundry's own folders. Notes move once, by rename, and an edited
  note stays put.
- **The vault takes the dashboard's theme:** the Obsidian plugin styles the whole vault in Neutral
  or The Veil (the dashboard's fonts and colours), with a stat block card for `[!statblock]`, a
  locked GM look for `[!secret]`, quiet mirror banners, read-aloud boxes, the session stats as
  cards and the d20 spread as bars. The look keys on each note's `type`, never on folders.
- **One theme per world, both ways:** picking Neutral or The Veil in the plugin's **Theme**
  setting also sets the dashboard's theme, and a pick in the dashboard reaches Obsidian within 30
  seconds. **Off** turns the styling off in that Obsidian only.
- The release zip also carries the theme as two CSS snippets (`snippets/`) for a vault without the
  plugin, such as the player vault, and the fonts' licences (`FONT-LICENSES.txt`).
- **Fewer loose notes in the graph:** an NPC note links the Library monster it was made from
  (the module now exports each actor's `_stats.compendiumSource`), a scene whose own journal is
  unset or gone links the journal named like its folder, and the campaign stats note links every
  session note and PC stats note. Every mirror note re-renders once (render version 6).

### Orange Pi (D-068)

- **Stage scripts for bring-up** (`scripts/pi/remote/`): health check, Node 24, Foundry as a
  service started with `--noupnp`, Tailscale; each safe to run again. Tested in an ARM64 Debian 13
  container with the real Foundry 14 build. The Pi guide gets a section for a UniFi gateway (PR
  #101).
- **The recorder bot runs on the Pi** as a service (`foundry-ai-tool-discord-bot`; checked on
  linux-arm64 with Node 24), and `tools/session-notes/pull.ps1` copies finished recordings from the
  Pi to this PC over SSH with a checksum check (step 0 of `auto.ps1` when `FVTT_PI_HOST` is set);
  `session-notes publish` takes `MCP_CONTROL_HOST` (PR #100).
- The remote command guard blocks the "ask" list too in bypass or auto permission mode, where an
  approval prompt would be answered without the user (seen in the first live test).
- **A safety guard for remote commands:** a Claude Code hook (`.claude/hooks/guard-remote-commands.mjs`)
  checks every command sent over ssh, scp or rsync, including the scripts fed into it. It blocks
  what could make a machine unusable (deleting `/` or a system folder, formatting or overwriting a
  disk, removing root) and asks the user before users and groups, partitions, removing packages,
  reboots, firewall, SSH and network changes. The Pi guide lists the safety rules and the nightly
  system snapshots.
- The guide uses Raspberry Pi Imager instead of balenaEtcher (Etcher's check step crashed on
  Windows); `find-pi.ps1` waits for DietPi's first boot to finish before it records the Pi's SSH key
  (the first boot swaps the SSH server, which changed the key); stage 3 no longer leaves
  `/opt/foundry` readable only by root.
- **Snapshots on this PC:** `scripts/pi/pull-snapshot.ps1` copies the Pi's newest `dietpi-backup`
  snapshot over SSH into `E:\PiBackup` as one `tar.zst` archive (read-only on the Pi, test-read
  before it is kept, 14 daily plus 8 weekly kept, logs), and `scripts/pi/register-snapshot-task.ps1`
  runs it daily and at logon as a hidden scheduled task. The guide has a restore section.

### Module

- **Themed dice (I-085; PR #83):** with Dice So Nice, two dice colour sets match the dashboard
  themes ("AI Tool: The Veil" and "AI Tool: Neutral"); the GM picks the table's default once in
  Dice So Nice's Dice Roles.

### Fixes

- The session log measures HP changes per token: after a reload, or with several tokens of one
  monster, damage is no longer logged against the base actor's or another token's hit points (it
  could show as healing) (PR #79).
- Docker: the image builds again (the runtime install no longer runs the git-hook setup) (PR #80).
- The session log counts damage that hits temp HP ("took 10 damage (10 to temp HP)"); temp HP
  gained or restored by an Undo is not logged as healing (PR #82).
- Session notes whose journal was deleted by hand in Foundry go back to waiting, so "Put in
  Foundry" puts them back (PR #96).
- The After view's "Went down" card also counts heroes who dropped outside a fight
  (`pcDownsByName` in the session stats; PR #98).
- **Snapshot task survives PowerShell updates:** `scripts/pi/register-snapshot-task.ps1` points the
  task at the Store's stable `pwsh.exe` alias in `%LOCALAPPDATA%\Microsoft\WindowsApps` instead of
  the versioned install folder, which moves with every PowerShell update.

### Development

- **Changelog fragments (D-089):** a pull request adds its CHANGELOG entry as its own file in
  `changelog.d/`; `npm run changelog:fold` moves them into "Unreleased" (CI checks them with
  `npm run changelog:check`). No separate upkeep pull requests any more.
- CI runs once per pull request (on `pull_request`, and on pushes to `main`), not twice.
- **Token usage report:** `python scripts/dev/usage-report.py [since]` sums Claude Code usage per
  session from this PC's transcripts (cache reads, writes and output, weighted like API prices), to
  spot sessions whose context grew too large.

### Docs

- The Curse of Strahd plan, the Obsidian plan and the roadmap are marked historical (frozen
  2026-10-04), each with a short note on what changed since they were written.

## v0.20.0 (released 2026-10-03): undo for live play, the write gate, the design pass, pre-flight and prep, the party panel, the Obsidian plugin and library, GM guides

**Wire contracts are unchanged** (module id, ports, `foundry-mcp-bridge.*` method names, settings
namespace). The bridge serves 88 tools (91 in v0.19.0): ten old direct-write tools became three
plan tools with Undo. Update the module and the bridge together; see "Upgrade notes" at the end
of this section.

### Write gate (P-036)

- **"Allow Write Operations" is now a real read-only switch.** Every bridge handler that changes
  the world (actors, items, features, ownership, tokens, scenes, combat, damage, conditions,
  journals, chat and roll messages) is refused while it is off, whoever asks (Claude or the
  dashboard). Before, only some handlers checked it: ownership, token vision and light, adding
  items and features, damage, conditions, combat and chat did not. Reads always work. A test fails
  when a new handler is not classified as write or read (`packages/foundry-module/src/write-gate.ts`).
- Deleting tokens and changing actor ownership now need a GM user (`requiresGM` was declared but
  never read); `setTokenVisionLight`, `createActorFromCompendiumEntry` and `addActorItems` run the
  same permission checks as their neighbours (including the actors-per-request limit).
- Upgrade note: with the switch off, the dashboard's own actions (post to chat, GM Actions) are
  refused as well.

### Pre-flight check (I-068, I-067, I-076; PR #14)

- **Pre-flight check.** New read tool `get-preflight` (prep set, 91 to 92 tools) with a module
  query `getPreflightScan`: Foundry link, module and bridge versions (mismatch banner, PB-10), write
  switches, secrets in world settings (masked), names players can see that match a secret term,
  module conflicts, Obsidian and the play session. The dashboard gets a Pre-flight drawer with the
  automatic checks, GM Actions and /player checks, and hand-ticked items.

### Session prep digest (I-045; PR #22)

- **Prep drawer and `get-prep-digest`.** A new read tool (prep set, 92 to 93 tools) and a "Prep"
  drawer in the dashboard header gather what a GM needs before the next session: last session
  from the bridge vault (scenes in order, fights, deaths, what happened, handouts revealed; it works
  after a Foundry reload), open quests and campaign parts, the GM's "Next session" journal, the
  handout queue, bosses on scenes, the pre-flight result and recent changes. Facts only, no AI
  needed; the prompt `prep-next-session` reads them first. The module adds a read-only query
  `getPrepScan`.

### Cookbook (I-083; PR #21)

- Ready-to-use requests for the GM before, during and after a session, a player cookbook, and a
  test that the docs name only real tools and prompts. The GM cookbook and the dashboard guide
  describe the Prep drawer.
- A recipe to describe a scene from the adventure, from the journals in your world (PR #34).

### Boss prompts and handout reveal queue (I-070, I-039; PR #19)

- **Boss prompts (I-070):** legendary action and resistance pips, a lair reminder and reaction
  ticks in the combat tracker, off by default.
- **Handout reveal queue (I-039):** queue pages per scene, Reveal next in one click, reveal to
  chosen players, and a per-player seen log in the new Handouts drawer.

### Party panel (I-079; PR #27)

- **Party drawer and two tools.** A 🛡 Party drawer in the dashboard header shows the dnd5e 6
  group actor: each member's HP, AC, passive Perception, conditions, exhaustion, hit dice, death
  saves and tokens, the travel pace, and three actions: set the pace, add the party's tokens to
  the encounter (or start one), and post dnd5e's short or long rest request card. New tools
  `get-party` and `plan-party-change` (play set, 93 to 95 tools) and the switch "AI Tool: Party
  (writes)", off by default. Every action goes through plan, confirm and undo; a rest card can be
  undone only while nobody has rested from it.

### Obsidian companion plugin (I-059; PR #31)

- **Obsidian plugin.** A desktop plugin for the GM's vault (`packages/obsidian-plugin`): Open in
  Foundry from a mirror note, live handout status in the status bar, Reveal to players as a plan
  the GM confirms in the dashboard, and the handout reveal queue. It talks only to the dashboard;
  the GM token stays in Obsidian's secret storage. Install with
  `scripts/install-obsidian-plugin.ps1` or the new release zip `foundry-ai-tool-obsidian.zip`.
- The dashboard opens a plan's confirm window from the link `/?plan=<planId>` once GM Actions are
  on.

### Obsidian library (PR #50)

- **Obsidian:** NPC stat blocks, book images and tables in mirror notes, a Library of compendium
  content (`libraryPacks`), and a guard that keeps licensed text out of git.

### Undo for live play (F5, D-082, D-083; PRs #33, #35, #37, #38)

- **`plan-actor-change`** (play set) replaces `apply-damage-and-healing`, `toggle-token-condition`,
  `update-character-resource` and `clear-stale-conditions` (95 to 92 tools): damage, healing,
  temp HP, conditions and resources go through plan, confirm and undo, so every change can be
  undone in Recent Changes. An optional switch "AI Tool: Live play, apply without confirming"
  (off by default) skips the confirm for long fights (D-083).
- Guarded changes: readable diff labels (HP, temp HP, ownership, position and more), removing a
  status effect needs one confirm instead of two, and a second change to the same actor no longer
  blocks the first change's Undo (PR #33).
- **`plan-token-change`** (play set) replaces `move-token`, `update-token`,
  `set-token-vision-light` and `delete-tokens` (92 to 89 tools): token moves, edits and deletes can
  be undone, a deleted token's place in the encounter included (PR #37).
- **`plan-ownership-change`** (admin set) replaces `assign-actor-ownership` and
  `remove-actor-ownership` (89 to 88 tools): ownership changes can be undone, back to the default
  when the player had no entry (PR #38).

### Batch F and fixes (PRs #25, #28 to #30, #40, #42, #67, #74)

- **Actor pickers (I-017; PR #29):** the tool runner's actor pickers show the actor types each
  tool is for (PCs and NPCs, the ones on the current scene first; NPCs for the NPC builders), with
  a Show all actors button.
- **Live write sweep (I-016; PR #28):** `npm run live:sweep` runs every direct-write tool once on
  the local test world and cleans up after itself (a test-world-only helper deletes what it made).
- **Test scripts take `--world` (PR #67):** `live:sweep` and `live:roundtrip` also run on the local
  walkthrough world (`ai-tool-walkthrough`); every other world is still refused.
- Fixed: the live write sweep starts its test combat without `Combat#startCombat`, so a module
  that asks before starting combat (Monk's Combat Details) no longer stalls it (PR #74).
- Fixed: `switch-scene` could leave the GM's view on the previous scene after a quick switch back,
  so scene tools acted on the wrong scene (PR #28).
- Fixed: setting up spellcasting on an NPC left its spell slots at 0 in dnd5e 6; the slot counts
  are now stored as dnd5e keeps them, with the NPC's spellcaster level (PR #30).
- Removed: the Foundry module's own write audit log, which never saved anything in Foundry 14
  (`game.world` has no flags). The guarded-write log in the bridge vault is the audit trail (PR #25).
- Test env: `start.ps1 -World <id>` launches the test server into another world (the
  licensed-content kit world); an unknown world id stops the script before anything starts (PR #40).
- **Docs kept true in CI (F4, I-081; PR #42):** `docs/reference/tools.md` is generated from the
  tool catalog (`npm run docs:tools`) and replaces the stale TOOL_INVENTORY.md; markdownlint
  (`npm run docs:lint`) and an internal link and anchor check (`npm run docs:links`) run in CI;
  external links are checked weekly. Tool descriptions lost their em dashes and two references to
  tools that do not exist.

### GM guides (PRs #44, #51, #70)

- **"When a character dies" (I-050):** marking a death, the death log, Observer access for the old
  sheet, and bringing in a new character, with what the tool can and cannot do at each step; plus
  a cookbook recipe.
- **Prep drawer and `get-prep-digest` (PR #51):** "Deaths" is now "PCs who went down" and "NPCs
  who went down" (dropped to 0 HP; the tool never knows who died). The GM guide "Asking Claude"
  has one table of all feature switches, including "AI Tool: Ownership (writes)".
- **Troubleshooting (PR #70):** players who cannot apply their own effects (dnd5e's "Allow Player
  Effect Application"; for a spell on themselves, they target their own token first), features
  that do nothing on characters carried over from an older world, and D&D Beyond characters
  that import as an empty "New Actor".

### Design pass (D-085; PRs #60, #61, #63, #65, #66, #71, #73, #77)

- **Themes (PR #60):** the dashboard and the players' page get a theme picked once per world by the
  GM: Neutral (the README brand) or The Veil (the Curse of Strahd theme, with self-hosted OFL fonts
  and a per-screen mist setting).
- **First screen (PR #61):** the dashboard follows the evening. Before the session it shows
  Pre-flight and Prep, during it the Live Feed with the party, handouts and recent changes beside
  it, after it tonight's summary; the Tool Runner, the AI co-GM and diagnostics moved into an
  Advanced menu.
- **Ready for session (PB-17, PR #63):** one click in the Before view turns on Allow Write
  Operations, the Handouts, Live play and Party switches and GM Actions; End session turns off
  what it turned on. Dashboard only (bridge control method `session_switches`, never an MCP tool).
- **One click (PB-17, D-086; PRs #65, #66):** the GM's own non-destructive actions from the
  dashboard's purpose-built buttons (the party's pace and rest, Tarokka links and imports) apply at
  once with an Undo toast. A plan typed by hand in the Tool Runner, destructive changes (deletes,
  reveals) and plans from Claude or Obsidian still show the confirm window first. "AI Tool: Live
  play, apply without confirming" now covers only Claude's plans. Ready for session also turns on
  "AI Tool: Tarokka (writes)".
- **Combat strip actions (I-095; PR #71):** Damage and Condition on selected combatants are back
  in the During view's turn-order strip and apply in one click with Undo; initiative, turns and
  saves stay in Foundry; the strip is a slim row again.
- **Tonight's stats (PR #73):** the After view opens with the session's rolls, most damage, the
  highest roll and who went down, a link to the session note and Copy the stats for Discord. The
  bridge's play stats and the Obsidian session note gain the session's highest d20 roll by a hero
  (GM only; the Discord copy leaves it out).
- Stats: the highest roll is named even when dnd5e records no label ("Perception check"), with its
  natural d20 (PR #77).

### Demo recordings (I-082; PRs #53, #57)

- **Demo takes:** `npm run demo:take` resets the demo world, drives Edge with Playwright and records
  60 fps MP4 with OBS (1080p, 1440p or 2160p), with step timings and screenshots;
  `docs/dev/DEMO-RECORDINGS.md`.
- **Demo takes, round 2 (PR #57):** `npm run demo:export` (a 1080p copy, a README clip of 10 MB or
  less, YouTube chapters from steps.json), new takes handout-reveal, preflight and prep (I-095), and
  the table demo takes table-player-attack and table-phone; the demo world gets invented prep
  content and loses the leftover Tarokka journal.

### Voice tools (PRs #24, #26, #43, #45, #46, #48, #68)

- **Session notes (`tools/session-notes`):** the Claude writing step of the session pipeline on the
  subscription (`claude -p`): the transcript cut into scenes, notes in Danish and English with a
  GM-only section, a GM summary and a draft player recap, resumable after a usage limit; audio is
  deleted 14 days after a session is approved. `auto.ps1` runs one pass for a scheduled task.
- **Narration (`tools/narration`):** voiceovers for the GM videos on local voices (Danish and
  English), with captions, chapters, a pronunciation list and a listening check.
- **Narration, Danish voice tuned by ear (PR #43):** English game terms stay English (also in the
  Danish session notes), a pronunciation list (di-end-di for D&D, hitt pojnts for hit points), the
  click and static before each Danish sentence are cut, and only changed sentences are re-trimmed
  from the cached raw voice.
- **Discord bot: `rehearse` (PR #45)** tests the recorder without people: speaker bots play known
  tracks into a voice channel, the recorder's connection is dropped once, and every recorded track
  is lined up with its source (PASS or CHECK). Fixed: the recorder dropped ordinary Opus packets
  that happen to end in 0xFAFA as still-encrypted (about one lost 20 ms per speaker every 20
  minutes).
- Fixed: the transcriber no longer cuts a trailing `_<number>` from user names in our own
  recorder's files (Craig's naming rule applied to them), and rehearsals keep their prepared source
  copies out of the recording folder (PR #46).
- **Session pipeline: glued names are split (PR #48):** "stratser" becomes "Strahd ser" with a
  rules.json spelling; only exact names are fixed automatically, near matches and Danish endings
  stay suggestions, and a near match no longer swallows the neighbouring word ("ogvallaki" was
  "Vallaki", now "og Vallaki").
- **Transcriber falls back (PR #68):** before loading the model on the GPU, a child process tests
  it (one second of silence, stopped after three minutes); when that fails or hangs, the run
  falls back to int8 on the GPU, then the CPU, so an unattended run after a session still
  finishes. Failed attempts are recorded in the transcript JSON.

### Fixes (PRs #15 to #17, #55, #59, #64)

- **Conditions are logged once.** Automated Conditions 5e mirrors dnd5e conditions as a second
  ActiveEffect, so the live feed and the play log showed every toggle twice (P-026). A matching
  second event on the same actor within 1.5 s is dropped.
- **Legendary actions and resistances are logged.** dnd5e 6 stores them as `spent` and derives
  `value`, so neither recorder saw one being spent.
- **create-actor-from-compendium takes up to 50 actors,** the ceiling of the "Max Actors Per
  Request" setting, which still decides (P-062). The tool and the module stopped at 10 before.
- **link-quest-to-npc links for real** (P-040): it adds the NPC to a "Related NPCs" list and reads
  the page back; a link that did not save is an error. Before, it reported success while writing
  nothing. The module's `updateCampaignProgress` handler writes the same flag as the campaign
  dashboard's status toggles instead of only reporting success.
- **Smaller review defects (P-060):** a failed game-system check is no longer cached until
  restart; `drop-loot` refuses negative or fractional coins; placing actors on a scene audits after
  the write, not before.
- README: the intro no longer promises that the GM approves every change (D-077).
- Fixed: queueing a handout page from the dashboard no longer shows "GM Actions are off" or
  "Can't load the plan" (the page was queued anyway) (PR #55).
- Fixed: the dashboard no longer stops when the bridge's pre-flight answer has no checks list (it
  shows an "unknown" check instead); the co-GM model picker lists Opus 5.5, Sonnet 5.5 and Haiku
  4.5 (PR #59).
- Obsidian: a note whose name is taken gets a short hash suffix instead of the end of its id (no
  more "(000000)" on the official PHB's notes); existing notes keep their names (PR #64).

### Upgrade notes

- **Update the Foundry module and the bridge together.** The dashboard and the bridge use module
  queries that older modules do not have (Ready for session, the party, pre-flight and prep);
  the pre-flight check shows a banner when the versions differ.
- **Ten tools are gone, replaced by plan tools with Undo:** `apply-damage-and-healing`,
  `toggle-token-condition`, `update-character-resource` and `clear-stale-conditions` by
  `plan-actor-change`; `move-token`, `update-token`, `set-token-vision-light` and `delete-tokens`
  by `plan-token-change` (play set); `assign-actor-ownership` and `remove-actor-ownership` by
  `plan-ownership-change` (admin set). Saved prompts or notes that name the old tools need the
  new names; Claude finds the new tools by itself.
- **"Allow Write Operations" off now refuses every write**, the dashboard's own actions (post to
  chat, GM Actions) included. "Ready for session" in the dashboard's Before view turns on what an
  evening needs, and End session turns it off again.
- **New feature switches:** "AI Tool: Live play (writes)" and "AI Tool: Ownership (writes)" are
  on by default; "AI Tool: Party (writes)" and "AI Tool: Live play, apply without confirming" are
  off. The GM guide page Asking Claude has one table of all switches.
- The Claude Desktop entries (tool sets) are unchanged; re-run the installer, or replace the
  bridge files, to update the bridge.
- New release asset: `foundry-ai-tool-obsidian.zip`, the optional Obsidian companion plugin
  (`scripts/install-obsidian-plugin.ps1`).

## v0.19.0 (released 2026-09-30): M0 foundations + M1 Tarokka + M2 spoiler-safe player view + M3 Foundry 14 / dnd5e 6 pass (Curse of Strahd) + Obsidian O4 mirrors + tool sets

Groundwork from `docs/design/CURSE-OF-STRAHD-PLAN.md` step 0. **Wire contracts are unchanged** (module id,
ports, `foundry-mcp-bridge.*` method names, settings namespace). Two defaults change behaviour; see
"Upgrade notes".

### Repo tidy

- **One version number and one release workflow.** The root `package.json` is the only version;
  `npm run version:sync` stamps it everywhere and `version:check` runs in CI. `release.yml` is the
  only release workflow (tags `v*`: verify, module zip with a per-tag `module.json`, bridge zip,
  Windows installer). The old step that posted to the original author's foundryvtt.com package is
  gone.
- **Em-dash guard.** `npm run emdash:ratchet` fails when em dashes rise (`docs/history` excluded).
- Removed `test-bench/`, an unused macro and stray build output; `validate-manifest.js` moved to
  `scripts/`; `.gitattributes`; refreshed `.env.example` and `claude_desktop_config.example.json`.
- `CLAUDE.md` is no longer tracked (private project instructions).

### Gaps closed before v0.19.0

- **"Allow Write Operations" now covers vault-only changes.** Changes that live only in the bridge
  vault (Tarokka data, the Obsidian mirror settings) and their undos are refused while the switch
  is off, like changes in Foundry. The module reports the switch with the feature list; a module
  older than 0.19.0 does not, and the bridge then allows as before. Undoing a vault-only change now
  needs Foundry connected, like applying one.
- **Post to chat is always a whisper.** The dashboard knew only the GMs who were logged in; with none
  it posted Co-GM notes as public chat. Now it always whispers, and the module sends it to every GM
  user (or refuses) when no name is given.
- **Removing a player's data.** `npm run vault -- forget-user <world> <user> [--chat-only]
[--dry-run]` removes one Foundry user's play-log records (rolls, changes, chat text) and usage
  records from the bridge vault; then `npm run obsidian -- export` rebuilds the notes. It refuses
  while a bridge runs. The player and GM guides describe it.
- Module: the unused `lang/en.json` (settings that no longer exist) and its manifest entry are gone;
  a Discord library wheel committed by mistake is removed and `*.whl` is ignored. The release zip
  was installed through Foundry's own Install Module on the test server: `module.json` at the root,
  version 0.19.0.

### Tool sets (PB-12)

- **The 91 tools come in five sets:** core (20, look-ups and plan/apply/undo), play (37), prep (18),
  build (7) and admin (9). Each set is its own Claude Desktop entry (`foundry-mcp`,
  `foundry-mcp-play`, `-prep`, `-build`, `-admin`) with its own switch in the **Search and tools**
  menu, so a chat carries only the definitions it needs: core alone is about 12,800 characters,
  core with prep about 30,000, all 91 about 88,000. `FOUNDRY_AI_TOOL_SETS` picks an entry's sets;
  without it an entry serves every tool. The dashboard always has every tool.
- Prompts show next to their set (`rules-question`, `npc-improv` in core; the other four in prep).
  Each entry tells Claude which sets are off, so Claude names the switch instead of guessing.
- The installer writes all five entries and copies the `env` of an existing `foundry-mcp` entry
  into each; the uninstaller removes them all. A backend spawned by a second wrapper exits when
  another holds the lock instead of idling.
- Tests: every tool is in exactly one set, sets stay within a size budget, prompts use only their
  set and core, and `docs/reference/TOOL-SETS.md` matches the code.

### Link reliability (before the Orange Pi)

- **One bridge user.** A world setting picks which GM's browser holds the bridge link ("Any GM" by
  default). The bridge keeps every GM connection and switches to another when the active one
  drops, instead of going dark until someone reloads.
- **Reconnect forever.** The module retries every 1 s, doubling up to 30 s, with no attempt limit,
  and no longer writes connection timestamps into the world every 30 s.
- **The dashboard says when Foundry is gone.** A banner appears when Foundry has not been connected
  for 2 minutes; the bridge logs `link-down` after 5 minutes and `link-up` when it is back.
- **Slow writes keep their undo.** Guarded writes wait up to 120 s, then ask Foundry what happened,
  so a write that landed late still gets its audit entry and undo. Dashboard GM actions wait up to
  5 minutes without dropping the control channel.
- **No silent empty bridge.** Claude Desktop's server reads `MCP_CONTROL_HOST`, `MCP_CONTROL_PORT`
  and `MCP_NO_SPAWN`, and never starts a local backend for a bridge elsewhere.
- **CI on every branch**, plus an ARM job (the Pi is ARM). `npm run live:roundtrip` runs a scripted
  write and undo against the test server; `scripts/backup/backup-bridge-vault.ps1` makes weekly
  bridge-vault backups.

### Security

- **Bridge handlers are no longer in Foundry's `CONFIG.queries`.** Foundry relays queries from any
  user holding "Query Users" (Player by default) to the GM's client, so a player could call any bridge
  handler (including writes such as ownership changes) from the browser console. Handlers now live in a
  module-private table only the bridge connection dispatches from. The only `CONFIG.queries` entries
  left are GM-to-GM helpers on Foundry 14.352+ that check the sender is a GM.
- **`allowNonGmAccess` is off by default and no longer locked.**
- **Loopback by default.** The Foundry link (WebSocket 31415, WebRTC signaling 31416) and the co-GM
  dashboard listen on `127.0.0.1`. `FOUNDRY_LINK_HOST` / `DASHBOARD_HOST` open them to other
  interfaces; the dashboard refuses a non-loopback address without `GM_DASHBOARD_TOKEN`.
- **GM-only rolls stay GM-only on Foundry 14.** v14 renamed roll modes (`public`, `gm`, `blind`,
  `self`) and dnd5e 6 hands its roll mode on unmapped, so the old names fell back to the user's
  default (public): `roll-saving-throws` (whispered by default), `use-npc-activity` (which ignored
  `isPublic`) and private player roll buttons posted in public chat. The bridge now uses the running
  Foundry's own mode names. Also, whispered and blind damage rolls no longer appear as public
  `damage-roll` events in the `/player` feed.
- **The player view is built by projection, never by redaction.** Everything a player receives is
  copied from an allowlist or generated from a fixed template, using what players can see in
  Foundry: hidden tokens and their combatants never appear, a token whose name players cannot see
  is "Unknown creature", a scene shows its navigation name (else "Current scene"), enemies show
  only standard conditions and no HP numbers, GM-only rolls, GM changes, diagnostics and AI
  commentary never reach it. New endpoints `/api/player/state` and `/api/player/stream` always
  project, even when a GM token is presented; the player role on `/api/state` and `/api/stream`
  gets the same projection. The player page runs under a strict Content Security Policy.
- **Whisper guard**: "Post to chat" refuses text that names a dealt Tarokka card (a whisper's text
  reaches every player's browser); the GM page asks before posting anyway.
- **"Open in Foundry" links need a click and the GM token.** `GET /open?uuid=` only serves a static
  confirm page (it never calls the bridge, so link previews and scanners change nothing);
  `POST /api/open` opens the document on a GM's screen and takes the token from the `X-CoGM-Token`
  header only (never `?token=` or a cookie), requires `X-CoGM-Request: open`, refuses cross-site
  requests, checks the uuid and allows 10 opens per 10 s. The page runs under a strict CSP and is
  never framed.
- **The player page's CSP applies on every URL that reaches it** (before, `/player%2Ehtml` or
  `/x/../player.html` served it without the policy).
- **Host allowlist against DNS rebinding.** The dashboard answers only requests whose `Host` is
  `localhost`, `127.0.0.1`, `[::1]`, the specific `DASHBOARD_HOST`, or a name in the new
  `DASHBOARD_ALLOWED_HOSTS`; others get 421 `host-not-allowed`.

### Features

- **Guarded writes** (plan → confirm with diff → apply → undo), the one way new features change game
  state: tools `get-planned-change`, `apply-planned-change`, `list-recent-changes`, `undo-change`.
  Every feature has its own switch in the module settings (default off); applies are confirmed,
  conflict-checked (nothing is written if a document changed since the plan), logged to the GM feed
  and audited; undo refuses to overwrite later edits.
- **Bridge vault**: GM-only data kept on the backend host, outside Foundry world data (which every
  client receives). `FOUNDRY_AI_DATA_DIR`; backups with `npm run vault -- export|import`.
- **Persistent session event log** in the vault (`sessions/<date>.jsonl`), so the history survives a
  Foundry reload. `FOUNDRY_AI_EVENT_LOG=off` disables it.
- **`open-in-foundry`**: open a journal page, scene or actor on a GM's Foundry screen.
- **Dashboard**: the confirm dialog shows a planned change's diff; new Recent Changes pane with Undo.
- **Foundry v14 / dnd5e 6.0 adapter** (feature-detected), and 2014/2024 rules tags on actors and items
  the bridge writes (`get-character` shows them).

- **Tarokka (Curse of Strahd)**, off until you enable "AI Tool: Tarokka (writes)" in the module settings:
  deal a reading with the built-in roll or import the one dealt in the `tarokka-reading` module (the
  dealing GM is asked whether to offer it); the reading is kept GM-only in the bridge vault, previous
  readings are archived; link each card to a journal page, scene or actor (search helper, "Open" in
  Foundry); reveal a card by publishing only the text you write as a page players can read. Tools
  `get-tarokka-reading`, `plan-tarokka-import`, `suggest-tarokka-links`, `plan-tarokka-links`,
  `plan-tarokka-reveal`; dashboard 🃏 Tarokka drawer (card names hidden until "Show cards").
- **Pickers in the tool runner**: every tool parameter that names something (actor, token, scene,
  journal page, item, combatant, pack, plan, change, Tarokka card, ...) gets "Pick…", a filterable
  list of what exists now; typing still works. New read tool `list-ref-choices`. MCP clients get the
  schemas without the picker annotations.
- **Obsidian notes** (`npm run obsidian -- export [<worldId>] [--vault <dir>]`): a one-way, GM-only
  render of the bridge vault into an Obsidian vault under `Campaigns/<worldId>/AI Tool/`: one note
  per play session, the change history by month (from the new append-only `gm/audit-log.jsonl`),
  the current and archived Tarokka readings (cards in collapsed callouts) and a `Spread.canvas`,
  three Bases tables and `_status.md`. With `FOUNDRY_AI_OBSIDIAN_DIR` set, the backend re-renders a
  few seconds after each logged event, applied or undone change and session marker. A note you
  edit in Obsidian is never overwritten (listed in `_status.md` instead); notes the tool no longer
  produces go to the vault's `.trash/`; the campaign `Home.md` and `Prep/` are created once and
  never rewritten. Text from the game is written so the Templater plugin cannot run it.
- **Play sessions**: tools `mark-play-session` and `get-play-session` (they write only the bridge's
  own session log) and a Start/End session control in the dashboard header; session notes follow
  these markers, else a 3-hour gap. The dashboard links to the Obsidian notes (GM only;
  `OBSIDIAN_VAULT_NAME`, else the folder name of `FOUNDRY_AI_OBSIDIAN_DIR`).
- **Play log and stats**: the GM's client records what happens in play (HP, rolls,
  item use, rests, combat, scenes, users; `sessions/<date>.play.jsonl`, `FOUNDRY_AI_PLAY_LOG=off`
  disables it), and session notes, `AI Tool/Stats/` and the read tool `get-play-stats` summarise it.
  Damage and healing applied from a chat card's Apply button are credited to that roll exactly;
  other HP changes only to a roll from the last 10 s whose total fits (full, half, double, or cut
  short at 0 HP / max HP). The feed's damage events use the same rule; combat stats list every
  combatant.
- **Dice rolls in the feed with a breakdown**, e.g. "Wolf 1, Bite attack: 1d20 (15) +2 STR +2
  proficiency = 19". Players see public rolls without the target AC/DC and outcome (unless dnd5e's
  "challenge visibility" shows them to everyone) and under the name they know the roller by; the GM
  feed and session notes show the full line. Whispered, blind and self rolls are GM-only `gm-roll`
  events.
- **Handouts on the player page**, off until you enable "AI Tool: Handouts (writes)": reveal a
  journal page to players (it also becomes readable in Foundry, raised to Observer; its previous
  ownership is restored when you hide it again). The page must be in a journal players can open;
  secret sections, inline rolls, scripts and links to pages that are not revealed are removed
  before a player sees it. Tools `plan-page-reveal`, `list-revealed-pages`,
  `get-player-visibility`, `get-player-handouts`, `check-secret-terms`; the player page has a
  Handouts section.
- **A reveal copies a handout out of a GM-only journal.** When the page sits in a journal players
  cannot open (an imported adventure's chapter journals), `plan-page-reveal` copies it into a
  player journal "Handouts" (created on first use) instead of refusing; secret blocks, embeds and
  link targets are left out of the copy, and the source journal is never changed. Revealing the
  same page again updates the copy; hiding it deletes the copy. `copy: true` or `false` forces
  either way. One guarded plan, with undo.
- **Ready-made prompts in Claude Desktop** (the "+" menu of the server): `prep-next-session`,
  `rules-question`, `session-recap` (GM or players), `npc-improv`, `encounter-check`,
  `reveal-handout`. Each tells Claude which tools to use and never applies a change without the
  GM's confirmation.
- **Obsidian mirror of the Foundry world** (live-tested 2026-09-29; `docs/design/OBSIDIAN-PLAN.md` "As
  built", O4) (off until you turn it on with `plan-obsidian-mirror`
  and the switch "AI Tool: Obsidian mirror (writes)"; needs `FOUNDRY_AI_OBSIDIAN_DIR`): one note per
  PC, NPC, scene, journal (an index of its pages) and story item under
  `Campaigns/<world>/AI Tool/Foundry/`, kept up to date every 10 s (`FOUNDRY_AI_MIRROR_POLL_MS`);
  page text only for journals or journal folders you opt in, converted to Markdown with `@UUID`
  links rewritten to links between the notes (compendium links open in Foundry, GM secrets in a
  collapsed callout). Properties include `player_access` and `player_visible` (what players can
  open in Foundry; a GM aid, never used for the player page). A document renamed in Foundry keeps
  its note's file name (the new name becomes the title and an alias); a deleted one goes to the
  vault's `.trash/`; a note you edited is never overwritten and is listed in
  `AI Tool/Foundry/_status.md`. Six new Bases tables. Every note has an **Open in Foundry** link
  (`FOUNDRY_AI_OPEN_BASE`, default `http://localhost:3000`: the address you open the dashboard at).
  Tools `get-obsidian-mirror` and `plan-obsidian-mirror`; module query `getExportIndex` (GM client
  only, not callable by players).

### Fixes

- The dashboard found the Obsidian vault name only from a path in the host's own style: a Windows
  path on Linux (CI, the Orange Pi) broke it. Both separators work now.
- `scripts/live-read-sweep.mjs` defaulted to the live dashboard (port 3000); it now defaults to the
  test dashboard (3100).
- The backend no longer crashes when a control-channel client disconnects abruptly (ECONNRESET).
- `search-compendium` ignored a CR 0 filter.
- The co-GM dashboard answered malformed or oversized request bodies with Express's default error
  page, which showed the stack trace and local file paths to any caller; it now returns short JSON
  errors and logs the details server-side.
- Compendium copies with a custom name kept the source's prototype token name; the token is now named
  after the copy.
- `place-measured-template` / `delete-measured-template` work on Foundry 14 again: templates are
  Regions there (on the current level, always visible, not blocking movement), and `all` removes only
  the tool's own, never a region you drew.
- Foundry 14 and dnd5e 6 compatibility pass (M3): conditions go through dnd5e's own toggle (condition
  effects, exhaustion levels); effect changes, durations and images read the v14 shapes; scene
  backgrounds come from Scene Levels; new tokens, map notes and templates land on the current level;
  `set-scene-mood` changes darkness on a scene with the darkness lock on; NPCs are created in the
  dnd5e 6 shape (AC override, movement speeds, source); `use-item` passes its options the way dnd5e 4+
  reads them.
- Creature search: `hasSpells` and `hasLegendaryActions` were true for every creature; size filters
  accept `medium` and dnd5e's `med` alike; the creature list shows real sizes, CRs and types.
- A whisper whose targets could not be found, in a world with no GM user, was posted publicly; it now
  goes to the sender (or is refused).
- Journal pages last edited in the Markdown editor kept their old Markdown after an update.
- `get-module-manifest` lost authors and dependencies; weapon properties `rel` and `sil` gave a false
  warning; the "max actors per request" setting could not go above 10 without stopping the bridge;
  secret token disposition is shown as "secret".

### Removed

- **ComfyUI map generation and its tools.** The `generate-map`, `check-map-status` and `cancel-map-job`
  tools are gone (91 tools remain; `list-scenes` and `switch-scene` stay, now in the scene tools).
  The ComfyUI client and service, the job queue, the module's map-generation settings menu, status
  banners, scene import and its query handlers (`generate-map`, `check-map-status`, `cancel-map-job`,
  `upload-generated-map`), the `map-job` picker kind and the `axios` dependency are removed. The
  Windows installer no longer offers the ComfyUI component (GPU page, model downloads, 7-Zip and
  inetc plugins), and the D&D Battlemaps model notice is dropped from the license files.
  Stored `mapGenAutoStart` / `mapGenQuality` module settings are ignored. The `COMFYUI_*` environment
  variables and `FOUNDRY_DATA_PATH` do nothing now; `npm run setup-comfyui` is gone.

### Changed

- New GM guides in `docs/gm/` (getting started, the dashboard, asking Claude, before and after a
  session, never and only if, troubleshooting) and a player guide in `docs/player/`; the README
  describes the tool as it is now.
- The module now requires **Foundry 14** (manifest minimum raised from 13). Supported: Foundry 14 with
  dnd5e 6; dnd5e 5.3 data is still read, but live testing is on dnd5e 6.
- Docs reorganized by audience: `docs/gm/`, `docs/player/`, `docs/dev/`, `docs/reference/`, current
  plans in `docs/design/`, finished plans and logs in `docs/history/` (see `docs/README.md`).
  `CLAUDE.md` is shorter; its progress log moved to `docs/history/PROGRESS.md`.
- New: `docs/dev/PI-SETUP.md` with `scripts/pi/prepare-sd.ps1` and `scripts/pi/find-pi.ps1` for the
  Orange Pi 5 Pro (DietPi, first boot configured from Windows, SSH key access).

### Build / CI

- Foundry v9 typings replaced by hand-written v14 declarations (drops 200+ dev packages and both
  "critical" dev advisories). `npm audit`: 2 advisories in shipped code (`ip`, `werift`), 12 in total.
- Lint ratchet in CI (`npm run lint:ratchet`): warnings may only go down.
- CI runs on Node 22 and Node 24 (Foundry 14 requires Node 24, which the Orange Pi will run).
- `package-lock.json` has `resolved`/`integrity` for every registry package.
- Development: a local Foundry test environment (`scripts/test-env/*.ps1`, skills `foundry-test-env`,
  `foundry-ai-tool`, `foundry-core-ui`). The module reads its default bridge port from the manifest
  flag `flags.foundry-mcp-bridge.defaultServerPort` (released manifests have none);
  `FOUNDRY_WEBRTC_PORT` sets the WebRTC signaling port (default 31416).

### Upgrade notes

- Update the module and the bridge together: an older module does not report "Allow Write
  Operations", so a new bridge cannot enforce it on vault-only changes.
- Claude Desktop: re-run the installer, or copy the five entries from
  `claude_desktop_config.example.json`, to get the tool sets. An existing single `foundry-mcp`
  entry keeps serving all 91 tools. Put `env` settings (for example `FOUNDRY_AI_OBSIDIAN_DIR`) in
  every entry.
- Map generation is gone. A ComfyUI folder that an older Windows installer put next to the server
  stays on disk after upgrading; the uninstaller removes it, or delete it by hand.
- If your Foundry runs in a browser on **another machine** than the bridge, set
  `FOUNDRY_LINK_HOST=0.0.0.0` (the Docker image and compose template already do).
- If you exposed the dashboard on your network, set `DASHBOARD_HOST` and `GM_DASHBOARD_TOKEN`.
- Worlds that relied on the old locked-on `allowNonGmAccess` need it switched on again (or, better,
  an Assistant GM user for a headless client).
- `/api/state` for the player role now returns the player projection (`status`, `world`, `scene`,
  `combat`, `events`, `handouts`) instead of the redacted GM state. With `PLAYER_DASHBOARD_TOKEN`
  set, open `/player?token=...` once more after upgrading: the player page keeps its token under
  its own key now, apart from the GM page's.
- The dashboard has a new dependency, `htmlparser2` (10.x, runs on the bundled Node 20).
- If you open the dashboard under a hostname (a tunnel, a LAN name), add it to
  `DASHBOARD_ALLOWED_HOSTS` (comma-separated); otherwise it answers 421 `host-not-allowed`.
- For the Obsidian mirror's "Open in Foundry" links, set `FOUNDRY_AI_OPEN_BASE` on the bridge to the
  address you open the dashboard at when it is not `http://localhost:3000`. The bridge now also
  depends on `htmlparser2` (10.x).
- The enhanced creature index rebuilds itself once after upgrading (about 16 s for the core packs);
  the first creature search during that rebuild can time out. Try again a few seconds later.

## v0.18.0 (2026-06-17) — Roll-init for selected combatants

### Features

- **Roll initiative for selected combatants from the co-GM dashboard.** The combat selection bar gains
  a **Roll init** button: pick any combatants (click a row to toggle — non-contiguous selection like
  1, 3, 5 works with plain clicks, no modifier key needed) and roll _separate_ initiative for exactly
  those. Backed by a new optional `combatantIds` parameter on the `roll-initiative-for-npcs` tool,
  which rolls for a specific set and overrides `scope`. The existing scope buttons — **NPCs / All /
  Missing** — are unchanged.

### Build / CI

- Bumped the CI/release workflows from Node 20 to **Node 22** (build toolchain only; the shipped
  runtime still targets Node 18).

## v0.17.0 (2026-06-17) — Non-GM access + internal cleanup

Adds an opt-in for non-GM users to run the bridge, plus a large internal code-quality pass and the
fixes from a full code review. **Wire contracts are unchanged** — module id, ports, query prefix, and
the settings namespace are all the same, so existing installs update in place.

### Features

- **Allow non-GM users to run the bridge.** New `allowNonGmAccess` world setting: when enabled, any
  logged-in user (not just the Gamemaster) can start and use the bridge — both the connect/start gate
  and the per-query gate honor it. Shipped **locked on** (visible but greyed-out in the module config)
  for now. **Security note:** this turns any user's browser into an AI control surface; it's intended
  for single-user / personal worlds — keep the bridge GM-only before sharing a world publicly.

### Fixes

- **Tool-dispatch hardening.** The control-channel `call_tool` router is now a null-prototype map, so a
  tool name matching an inherited `Object.prototype` key (`toString`, `constructor`, …) can no longer
  slip past the "unknown tool" guard.
- **ComfyUI service start() races.** The process handle is snapshotted after the readiness probe (no
  more `pid` null-deref mis-reporting a brief start as a failure), and the status stays consistent on a
  failed start.

### Internal (no behavior change for existing GM installs)

- Large "trim the hedges" cleanup: removed the map-generation temp-file debug logging and other dead
  code; folded ~80 repetitive query handlers onto a single `withGmGate` wrapper (−800 lines in
  `queries.ts`); and decomposed `backend.ts` (1,479 → ~680 lines) by extracting a unit-tested
  `ComfyUIService` and a unit-tested table-driven tool router. **~1,200 net lines removed; ~1,957
  tests** across the four workspaces.

## v0.16.1 (2026-06-15) — Dependency-security patch

Patches the shipping network/runtime dependencies ahead of the Phase 6 remote-access work. **No behavior
changes for existing installs** — the Foundry module id and all wire contracts are unchanged.

### Security / dependency fixes

- **werift 0.17.7 → 0.23.0** (the WebRTC stack for the HTTPS/remote Foundry link) — clears the `uuid`
  bounds-check advisory. The only breaking dependency bump; **validated live** against a real Foundry
  world (Foundry 14, HTTPS) over the WebRTC DataChannel.
- **@modelcontextprotocol/sdk 1.7 → 1.29** (DNS-rebinding / ReDoS), **axios 1.6 → 1.18** (SSRF / ReDoS),
  **ws 8.14 → 8.21**, plus `body-parser`, `path-to-regexp`, and the dashboard's **express 4.19 → 4.22** —
  all in-range and behavior-preserving.
- Removed an unused `socket.io-client` dependency from the Foundry module.
- Production-only `npm audit`: **15 → 3** advisories (the remaining 3 are a single upstream-unpatched
  `ip` advisory inside the WebRTC ICE stack, with no fix available).

### Build / CI

- Bumped `actions/setup-node` to `20.19` across the release workflows (clears EBADENGINE; the shipped
  runtime still targets Node 18).

## v0.16.0 (2026-06-15) — First release as **Foundry AI Tool**

This is the first release under the project's new identity. **Foundry AI Tool** is an MCP server +
Foundry VTT module (plus an original co-GM dashboard) that gives AI models live access to a Foundry
game. It began as a fork of [adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp)
(MIT) and has since been detached into its own standalone project, trimmed to **Windows + D&D 5e**, and
reimplemented behind stable contracts. See [CREDITS.md](CREDITS.md) for upstream attribution.

### No breaking changes for existing installs

The Foundry module **id is unchanged** (`foundry-mcp-bridge`), as are the socket channel, settings
namespace, and query method names — so an existing install keeps working and upgrades in place. The
only thing that moved is the **home repository**: releases now come from
[Gnuminator/Foundry-VTT-MCP-Ai-Tool](https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool), not the
old `Gnuminator/Foundry-VTT-MCP` fork. To receive updates from the new repo, reinstall once from the new
manifest — see **Migrating from the old repo** below.

### New identity & project structure

- Renamed to **Foundry AI Tool**; standalone repository (no longer a GitHub fork), clean history, new
  README/CREDITS/LICENSE attribution.
- npm scope is now `@gnuminator/*` (`@gnuminator/shared`, `@gnuminator/mcp-server`,
  `@gnuminator/foundry-module`, `@gnuminator/cogm-dashboard`).
- Authored `docs/dev/ARCHITECTURE.md` describing the system from first principles (the MCP tool surface, the
  Foundry-link socket bridge, the JSON-lines control channel, the D&D 5e system adapter, the job queue,
  GM-gating, and the standalone co-GM dashboard).

### Scope trim — Windows + D&D 5e only

- **Removed non-D&D system adapters** — PF2e, DSA5 (Das Schwarze Auge 5), WFRP4e, and Cosmere RPG, along
  with their system-specific tools (e.g. the DSA5 archetype character creator) and registry
  registrations. The **D&D 5e** adapter remains cleanly behind the system-registry abstraction.
- **Removed macOS support** (Windows-targeted: NSIS installer + standalone server ZIP).

### Reimplementation behind stable contracts

- Reimplemented the `shared` types/schemas/constants and codified both wire protocols
  (control-channel + Foundry-link frames) in `shared/src/protocol.ts`, with the frozen wire identifiers
  preserved byte-for-byte and a parity/contract-guard test suite wired into CI.
- Migrated the control-channel endpoints (dashboard client, stdio wrapper, backend control server) onto
  the shared protocol contract; deduped the WebRTC chunking constants to a single canonical source.
- Shrank and cleaned the Foundry module's `data-access` layer (stripped all non-D&D remnants + dead
  code).
- Brought the MCP tool layer and the D&D 5e adapter under comprehensive test coverage — **1078 tests
  total** (mcp-server 1017, shared 49, foundry-module 12) — as a parity net.

### Co-GM dashboard

- The original co-GM control surface (live session feed + GM control panel: combat panel, generic tool
  runner, backend proxy, confirm-gated writes) ships as `packages/cogm-dashboard` — original work, not
  derived from upstream.

### Tooling

- Single canonical release workflow (`build-complete-release.yml`): Windows NSIS installer + standalone
  MCP server ZIP + Foundry module ZIP + GitHub Release + Foundry package-registry update, on tag push.
- CI runs build + the three unit suites + schema smoke test + manifest validation on every push.

### Migrating from the old repo

If you have a previous version installed from `Gnuminator/Foundry-VTT-MCP`, your module keeps working —
but Foundry checks the **old** repo for updates, because that URL is baked into the installed manifest.
To switch to the new repo so future updates come from here, see
[docs/history/MIGRATION.md](docs/history/MIGRATION.md) for the one-time reinstall steps. No data migration is required.

---

## Historical releases (pre-detach upstream lineage)

> ⚠️ The entries below predate the detach, the rename to **Foundry AI Tool**, and the **D&D 5e-only**
> trim. They describe the upstream-derived fork and reference systems that have since been **removed**
> (PF2e, DSA5, WFRP4e, Cosmere RPG) and macOS support that is no longer included. They are kept for
> historical lineage only — see the v0.16.0 entry above for what the current release actually contains.

## v0.8.2 (2026-06-07)

### New Features

- **D&D 5e NPC Creation Suite** (PR #41 by @LManfre)
  - `dnd5e-create-npc` — build a full NPC stat block from scratch (abilities, saves, skills, senses, AC/HP, CR)
  - `dnd5e-add-feature` — one tool with modes: `passive`, `save`, `attack`, `attack-with-save`, `aura`, `spellcasting`, `spells`
  - `dnd5e-add-features-from-compendium` — bulk-import features/spells from compendium packs
  - Targets the dnd5e activities data model (4.x/5.x)

- **WFRP4e (Warhammer Fantasy Roleplay 4e) System Support** (PR #53 by @nyoung)
  - Character extraction: 10 characteristics, wounds, fate/fortune, resilience/resolve, corruption, career/species/class, skills, and arcane/divine spellcasting
  - `get-character` / `list-characters` / `search-character-items` now work on WFRP4e worlds

### Fixes

- **macOS installer** (PR #54): the Claude Desktop config is now merged rather than overwritten, preserving any other configured MCP servers; more robust logged-in-user detection; postinstall scripts no longer abort on a non-critical failure; additional Foundry data-dir locations probed
- **Node 26 install failure** (Issue #51, reported by @frankyh75): removed the unused `better-sqlite3` dependency, which failed to build against Node 26's V8 ABI

---

## v0.6.2 (2025-12-03)

### New Features

- **Spellcasting Data Extraction** (Issue #14)
  - `get-character` now returns full spellcasting entries with spell lists
  - PF2e: Spellcasting entries with traditions, DC, attack, slots, prepared/expended status
  - D&D 5e: Class-based spellcasting with spell slots and prepared spells
  - DSA5: Zauber (spells), Liturgien, Zeremonien, Rituale with AsP/KaP tracking
  - **Spell Targeting Info**: Each spell now includes `range`, `target`, and `area` fields
    - D&D 5e: Range (Self/Touch/60 ft), target type (1 creature/self/area), area template
    - PF2e: Range, descriptive target, area type (emanation/cone/burst)
    - DSA5: Reichweite, Zielkategorie, Wirkungsbereich

- **Use Item Tool** (`use-item`)
  - Cast spells, use abilities, activate features, consume items
  - Works across systems: D&D 5e, PF2e, DSA5
  - Supports spell upcasting (D&D 5e)
  - Proper resource consumption (spell slots, charges, consumables)
  - GM-only with character targeting
  - **Target Selection**: Specify targets by name or use `["self"]` to target caster
    - Example: "Have Clark cast Magic Missile on the Goblin"
    - Example: "Have Vitch use a healing potion on himself"
    - Targets set via Foundry's targeting system before item use

- **Search Character Items Tool** (`search-character-items`)
  - Token-efficient item search within a character's inventory
  - Filter by type (weapon, spell, feat, equipment, etc.)
  - Filter by category (items, spells, features, all)
  - Text search across item names and descriptions
  - Returns compact results without full descriptions

---

## v0.6.1 (2025-12-03)

### New Features

- **DSA5 System Support** (PR #12 by @frankyh75)
  - Full SystemAdapter implementation for Das Schwarze Auge 5
  - Supports all 8 Eigenschaften (MU/KL/IN/CH/FF/GE/KO/KK)
  - LeP, AsP, KaP resource tracking
  - DSA5-specific filters: level, species, culture, size, hasSpells
  - DSA5IndexBuilder for creature compendium indexing
  - DSA5 character creation from archetypes

- **Token Manipulation Tools** (PR #13)
  - `move-token` - Move tokens with optional animation
  - `update-token` - Update visibility, disposition, size, rotation, elevation
  - `delete-tokens` - Bulk token deletion
  - `get-token-details` - Detailed token info with linked actor data
  - `toggle-token-condition` - Apply/remove status effects (prone, poisoned, etc.)
  - `get-available-conditions` - List system-specific status effects

- **Character API Optimization** (PR #9)
  - Lazy-loading: `get-character` now returns minimal item metadata (no descriptions)
  - New `get-character-entity` tool for on-demand full entity details
  - Removed 20-item limit - now returns ALL items
  - ~37% token reduction per character
  - PF2e: traits, rarity, level, actionType
  - D&D 5e: attunement status

### Improvements

- **Documentation** (PR #8)
  - Clarified search-compendium limitations (name-only search, heuristic filters)
  - Directed users to list-creatures-by-criteria for accurate filtering

---

## v0.4.17 (2025-09-09)

- Wrapper/backend architecture: convert MCP entry to a thin stdio wrapper that proxies to a singleton backend over `127.0.0.1:31414`.
- Backend singleton + lock: backend binds Foundry connector on `31415` and creates `%TEMP%\foundry-mcp-backend.lock`.
- Startup race fix: resolves Claude Desktop duplicate-start race by keeping wrappers alive and ensuring only one backend owns ports.
- Runtime stability: backend now bundled (`dist/backend.bundle.cjs`) and preferred by wrapper for reliable startup in installer environments.
- Shared package now emits JS + d.ts, ensuring runtime availability for both dev and installer.
- Logging: wrapper writes to `%TEMP%\foundry-mcp-server\wrapper.log`; backend logs to `%TEMP%\foundry-mcp-server\mcp-server.log`.
- Installer: enhanced staging to include full server `dist`, bundled wrapper `index.cjs`, bundled backend, and `node_modules/@foundry-mcp/shared`.
- Build scripts: added root convenience scripts (`build:release`, `bundle:server`, `installer:stage`); NSIS script accepts `--skip-download` and `--skip-nsis` for staging-only runs.

Notes

- No changes needed for CI; existing workflows continue to build bundles and the installer.
- Foundry MCP Bridge port remains `31415`. Control channel is `31414` (internal wrapper↔backend only).
