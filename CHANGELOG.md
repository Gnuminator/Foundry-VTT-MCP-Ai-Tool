# Changelog

## Unreleased — M0 foundations + M1 Tarokka + M2 spoiler-safe player view + M3 Foundry 14 / dnd5e 6 pass (Curse of Strahd) + Obsidian O4 mirrors

Groundwork from `docs/CURSE-OF-STRAHD-PLAN.md` step 0. **Wire contracts are unchanged** (module id,
ports, `foundry-mcp-bridge.*` method names, settings namespace). Two defaults change behaviour; see
"Upgrade notes".

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
- **Obsidian mirror of the Foundry world** (live-tested 2026-09-29; `docs/OBSIDIAN-PLAN.md` "As
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

### Build / CI

- Foundry v9 typings replaced by hand-written v14 declarations (drops 200+ dev packages and both
  "critical" dev advisories). `npm audit`: 2 advisories in shipped code (`ip`, `werift`), 12 in total.
- Lint ratchet in CI (`npm run lint:ratchet`): warnings may only go down.
- `package-lock.json` has `resolved`/`integrity` for every registry package.
- ComfyUI never starts by itself unless `COMFYUI_AUTOSTART=true`.
- Development: a local Foundry test environment (`scripts/test-env/*.ps1`, skills `foundry-test-env`,
  `foundry-ai-tool`, `foundry-core-ui`). The module reads its default bridge port from the manifest
  flag `flags.foundry-mcp-bridge.defaultServerPort` (released manifests have none);
  `FOUNDRY_WEBRTC_PORT` sets the WebRTC signaling port (default 31416).

### Upgrade notes

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
- Authored `docs/ARCHITECTURE.md` describing the system from first principles (the MCP tool surface, the
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
[docs/MIGRATION.md](docs/MIGRATION.md) for the one-time reinstall steps. No data migration is required.

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
