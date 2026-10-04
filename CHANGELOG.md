# Changelog

## Unreleased

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

### Obsidian (I-100; PR #103)

- **The Library by book:** the Library is sorted by kind, then by book
  (`Library/Spells/Player's Handbook (2024)/`), with `book` and `page` properties, one base and
  one hub note per book (every Library note links its book, so Obsidian's graph groups them), and
  notes about the world follow Foundry's own folders. Notes move once, by rename, and an edited
  note stays put.

### Orange Pi (D-068; PRs #100, #101)

- **Stage scripts for bring-up** (`scripts/pi/remote/`): health check, Node 24, Foundry as a
  service started with `--noupnp`, Tailscale; each safe to run again. Tested in an ARM64 Debian 13
  container with the real Foundry 14 build. The Pi guide gets a section for a UniFi gateway (PR
  #101).
- **The recorder bot runs on the Pi** as a service (`foundry-ai-tool-discord-bot`; checked on
  linux-arm64 with Node 24), and `tools/session-notes/pull.ps1` copies finished recordings from the
  Pi to this PC over SSH with a checksum check (step 0 of `auto.ps1` when `FVTT_PI_HOST` is set);
  `session-notes publish` takes `MCP_CONTROL_HOST` (PR #100).

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
