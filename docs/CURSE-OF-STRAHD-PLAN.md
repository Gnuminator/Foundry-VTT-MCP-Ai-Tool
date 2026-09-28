# Curse of Strahd extension: architecture review + implementation plan

Status: **M0 and M1 (Tarokka) DONE on 2026-09-28, awaiting the GM's live test and go-ahead for M2.** Section 9 answered
(defaults). What was built, and where it differs from this plan, is in "M0 as built" at the top of
section 3.
Written 2026-09-27 on branch `claude/amazing-bardeen-q1x1q6` (base `a80b330`, v0.18.0). Same day: all
**[verify]** items re-checked against the official Foundry docs (none left open), setup-session additions
added to 0.4 and 0.7, questions 10 to 13 added.

Campaign target: Curse of Strahd on Foundry VTT v14, dnd5e 5.3.x now and 6.0.x soon, 2024 rules (2024 PHB,
2025 Monster Manual, official "Ravenloft: The Horrors Within" module, plus Xanathar's and Tasha's).

Decisions already made by the GM:

- ComfyUI map generation is **dropped for now** (the target host is an Orange Pi 5 Pro). Do not build on
  it. Removing it is a separate cleanup step; ask before deleting code.
- Target host: **Orange Pi 5 Pro** (ARM64) running the standalone backend, the headless Foundry client
  and the dashboard. Only the dashboard is exposed, behind authentication.
- Development happens primarily in a local working copy on the GM's PC (see the handover prompt).
- Every new write: off by default, confirmed, logged to the event feed, reversible where practical.
- No copyrighted adventure text in the repo. Read content from the world or installed modules at runtime.
- Later, not now: Obsidian integration and Discord voice recording (Craig) with voice-to-text (section 10).

Legend: **[verified]** = read in source, typings, official docs/release notes or a primary issue;
**[partly verified]** = consistent secondary evidence (community notes checked against installed builds),
no official page yet; **[verify]** = still to confirm. The first review could not reach foundryvtt.com and
foundryvtt.wiki; on **2026-09-27** every open **[verify]** item was re-checked against the official v14
release notes (14.349 to 14.368, latest stable 14.368 of 2026-09-16), the v14 API docs (built from 14.365),
the public package manifests and the GitHub issue tracker. No v14 server source is public, so statements
about server behaviour rest on the 13.351 source plus the absence of any change in the v12 to v14 notes.

---

## 1. Current architecture (verified against the code)

Three processes plus a shared package (npm workspaces):

| Part                                | Where                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundry module `foundry-mcp-bridge` | `packages/foundry-module/src` | Runs in the GM's browser. `main.ts` registers settings, ~80 query handlers and session-event hooks. `socket-bridge.ts` dials out to the backend (WS 31415, or WebRTC via 31416 on HTTPS) and dispatches each `mcp-query` by looking up `CONFIG.queries[method]`. Handlers live in `queries.ts` (thin `withGmGate` wrapper) and delegate to the `data-access.ts` facade and `data-access/*.ts` domains. `session-events.ts` keeps in-memory rolling buffers (chat 200, events 1000). |
| MCP server                          | `packages/mcp-server/src`     | `index.ts` stdio wrapper spawns `backend.ts`: control channel (TCP JSON-lines, 127.0.0.1:31414), tool classes, Foundry connector, ComfyUI job queue (dropped).                                                                                                                                                                                                                                                                                                                      |
| Co-GM dashboard                     | `packages/cogm-dashboard`     | Express + SSE + vanilla JS. Polls `get-recent-events`, `get-combat-state`, `get-module-errors`; per-role SSE redactors; `/api/tool` proxy; `/player` read-only view; Anthropic streaming commentary.                                                                                                                                                                                                                                                                                |
| `shared`                            | `shared/src`                  | Protocol types and constants (runtime Zod schemas exist but are unused).                                                                                                                                                                                                                                                                                                                                                                                                            |

Baseline at `a80b330`: typecheck, lint and build green in CI (Node 22); **1,959 tests pass** (shared 49,
foundry-module 791, mcp-server 1090, cogm-dashboard 29).

### 1.1 How a tool is registered (the pattern new tools follow)

1. Tool class in `packages/mcp-server/src/tools/<domain>.ts`: `getToolDefinitions()` returns JSON-schema
   definitions; `handleX(args)` validates with Zod and calls
   `foundryClient.query('foundry-mcp-bridge.<method>', params)`.
2. Construct it in `backend.ts`, spread its definitions into `allTools`, add routes in `tool-router.ts`
   (`ToolRouterDeps` + the null-prototype name-to-handler map).
3. Module side: handler in `queries.ts` wrapped by `withGmGate(prefix, body)`, registered in
   `registerHandlers()`, logic in a `data-access/<domain>.ts` class exposed through `FoundryDataAccess`.
4. Dashboard: nothing to register. The tool runner discovers tools via `list_tools`; `public/app.js`
   `CATEGORY_RULES` picks the category by regex; `server.ts` `classifyTool()` decides read
   (`get-|list-|search-|measure-` prefixes plus `READ_TOOLS_EXTRA`), write, or destructive
   (`DESTRUCTIVE_TOOLS`).
5. Tests: tool classes use a mocked `FoundryClient.query`; module domains use the in-repo Foundry mock
   (`src/test-support/foundry-mock`: flags, journals, scenes, tokens, combats, users, packs).

### 1.2 The dnd5e adapter

`packages/mcp-server/src/systems/` holds `SystemAdapter`, `SystemRegistry` and `DnD5eAdapter`. It covers
only Node-side concerns: compendium creature filters, a data-path map, CR, stat extraction, formatting. It
is **not version-aware** (no dnd5e or core version check anywhere in the repo). Most dnd5e knowledge lives
unabstracted in the Foundry module: `data-access/actor-builder.ts`, `combat.ts`, `resources-effects.ts`,
`scenes-tokens.ts`, `scene-fx.ts`, `player-rolls.ts`, `creature-index.ts`, `characters.ts`,
`session-events.ts`. Version handling therefore needs a new **Foundry-side** adapter (step 0.4).

### 1.3 GM gating and confirmation as implemented today

- Module: `onReady` returns early unless the user is GM or `allowNonGmAccess` is on; `withGmGate` allows
  `game.user.isGM || allowNonGmAccess`. `allowNonGmAccess` is registered **default ON and force-locked**
  in the settings UI (`settings.ts:257`, `:418`, commit `83b7f85`).
- Module writes: `permissionManager.checkWritePermission()` only checks `allowWriteOperations`
  (**default ON**) and bulk limits. `requiresConfirmation` is computed but never enforced; `requiresGM` is
  never read. Several writes skip the check (`setActorOwnership`, `createActorFromCompendiumEntry`,
  `addActorItems`, `setTokenVisionLight`, every `scene-fx` write including `setSceneMood`).
- Dashboard: the only real "off by default + confirm" gate. GM Actions switch (in-memory, starts off),
  `confirm` for writes, `confirmDestructive` for the destructive set, enforced server-side in `/api/tool`.
- MCP path (Claude Desktop): no server-side confirmation; only Claude Desktop's own tool-approval prompt.
- Audit: `shared.auditLog()` calls `game.world.setFlag(...)` only if it exists. `World` extends
  `BaseWorld` / `BasePackage` / `DataModel`, not `Document`, and has no `setFlag`, `getFlag` or `update` in
  v13 or v14, so the call is skipped and **nothing persists** **[verified, v14 API docs]**. Writes are not
  logged to the event feed.

So "everything that changes game state is off by default and requires confirmation" is true for the
dashboard only. The new features make it true on every path (step 0.2).

---

## 2. Findings that shape the plan

### 2.1 What Foundry itself sends to player clients

**[verified in the 13.351 source; partly verified for v14]**. The login payload contains every User,
Actor, Cards, Combat, Folder, Item, JournalEntry (with all pages and flags), Macro, Playlist, RollTable,
Scene (with hidden tokens, tiles, drawings, notes and flags), ChatMessage (including GM whispers and blind
rolls) and Setting, plus every active compendium index, with no per-user filtering; every later document
change is broadcast to all sockets. Hiding is client-side only (sidebar filters, `visible` checks, canvas
rendering). Every world or user setting reaches every client. Hidden compendia are not private either
(index sent, `get` unchecked). Only the User password fields are stripped. For v14 there is no public
server source, but none of the release notes from 12.313 to 14.368 adds server-side per-user filtering: the
v14 visibility changes (`RegionDocument#hidden` in 14.360, Blind message-mode display fixes, #13902) are
client-side, and the 14.361 security fix concerns serving HTML files. So GM-only journals, unowned NPC
actors, hidden tokens/notes/tiles, whispers and blind rolls, and world settings still reach every client on
v14. Relevant issues: foundryvtt#836 (GM-only fields, open), #2672 (the server only validates writes),
#5302, #5660 (chat lazy-loading, performance only), #6928.

Consequences for this plan:

- A GM-only journal, actor flags, scene flags and world settings are **hidden in the UI only**. A player
  who opens the browser console can read them.
- GM whispers (including the dashboard's "whisper to chat") reach every client; only the display is hidden.
- The tarokka-reading module keeps its full reading in the GM's localStorage for exactly this reason.
- Truly secret data must live **outside Foundry world data** (section 3, step 0.3).

### 2.2 Cross-user query execution (new, not in the July review)

**[verified]** Every bridge handler is registered in Foundry's `CONFIG.queries`. The core `QUERY_USER`
permission defaults to the Player role; the server checks only that the sender holds `QUERY_USER` and that
the recipient exists, then relays the query with no allowlist of query names (13.351 source; the v14 notes
describe no change); the GM client runs whatever handler is registered. In v13 the handler receives only
`(queryData, {timeout})`. Since **14.352** the sender is passed to the handler (release notes 14.352,
foundryvtt#13418 **[verified]**) as `handler(queryData, {timeout, user})`, where `user` is the requesting
User document **[partly verified]**: the official API pages for `User#query` and `CONFIG.queries` and the
14.366 typings still show only `{timeout}`, but FXMaster 8.4.1 and several v14 systems read `context.user`
and report checking it on 14.364 to 14.367. Handlers must therefore treat a missing `user` as "reject". Our
handlers ignore the sender and test `game.user.isGM`, which is always true on the GM's client.

Impact: a player can call any bridge handler on the GM's client from the console, including writes such as
`setActorOwnership` (grant themselves OWNER), `deleteTokens`, journal updates, and reads of GM-client
memory (session buffers). This works regardless of `allowNonGmAccess`.

Check on your world, as a player in the console (read-only, harmless):
`await game.users.activeGM.query('foundry-mcp-bridge.getWorldInfo', {})`. If it returns world info, the
hole is open. Interim mitigation until M0 ships: in Game Settings > Configure Permissions (User
Management), raise the minimum role of **"Query Users"** ("Allow users with this role to query other
users."; key `PERMISSION.QueryUser`) above Player. The key, the Player default and the fact that Assistant
GM and GM always hold it (`requiredRoles: [3, 4]` since 14.349, #13296) are **[verified]** in the v14
`CONST.USER_PERMISSIONS` docs; the English label text comes from copies of core `en.json` **[partly
verified]**. The permission also exists in v13 (since the V13 API development builds, #11235). Raising it
may disable other modules' player-to-GM queries (for example FXMaster's particle-background sync); the
headless Assistant GM client keeps it either way.

### 2.3 Player view and dashboard leaks

1. `redactEventForPlayer` (`redact.ts:141`) forwards `description`, `actorName` and `actorId` verbatim.
   `session-events.ts` builds "X took 14 damage", "X spent 1 of legact (3 → 2)", "X gained 'Charmed by
   ...'" for every actor, including hidden and never-seen NPCs.
2. `scene-change` uses `scene.name`, not the player-facing `navName`.
3. Combatant names are the true names, not what players see on the token (disguises, "???" names). Enemy
   `conditions` are raw effect names, so custom GM effect names leak.
4. `/player` shares the `cogm_token` localStorage key and cookie with the GM page, and the server takes the
   role from the credential. The player page opened in a GM-authenticated browser (for example
   screen-shared to the table) receives the full GM stream.
5. The dashboard binds all interfaces while the split is opt-in (no token configured means every caller is
   GM), and the Cloudflare email header is trusted without JWT verification (`auth.ts:74`, `server.ts:585`).
6. "Whisper to chat" posts AI text as a GM whisper, which reaches every client (see 2.1).
7. Minor: `/api/health` is unauthenticated (status booleans only); the static GM UI files are served to
   anyone (no data, but they reveal the tool surface).

### 2.4 dnd5e 6.0 and Foundry v14 impact

**[verified in dnd5e source at release-5.3.3 and 6.0.5, the v14 release notes and API docs, and GitHub
issues]**. dnd5e 6.0.5 requires Foundry 14.367+; 5.3.3 supports 13.347 to 14. Latest stable Foundry v14 is
14.368 (2026-09-16). Several items come from **Foundry v14 core**, so they already affect you on dnd5e
5.3.x. Core builds: 14.349 `-=`/`==` keys deprecated for `_del`/`_replace` (work until v16, #13090),
`temporary: true` removed, `ActiveEffect#icon`/`#label` removed (#13436); 14.352 change `mode` becomes
string `type` (#13566), `origin` a UUID field (#13214), change `phase` (#13426), MeasuredTemplate removed
(#13089); 14.353 changes move to `system.changes` (#13740), duration becomes `{value, units, expiry}` plus
`start` (#13332), Scene Levels; 14.355 `CONFIG.ChatMessage.modes` replaces `CONST.DICE_ROLL_MODES` (old API
works until v16, #8856); 14.368 a `darknessLevel` update on a scene with `darknessLock` must also send
`darknessLock` (#14718).

| Code                                                                                                              | Touchpoint                                        | Impact                                                                                                                   | Fix                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `scenes-tokens.ts:525-529`, `resources-effects.ts:31-41, 93-95`                                                   | `CONFIG.statusEffects.find/.map`                  | dnd5e 6.0 replaces the array with an object keyed by id: TypeError                                                       | `Array.isArray(se) ? se : Object.values(se)`                                                                      |
| `scenes-tokens.ts:535, 570-579`                                                                                   | raw condition effect `{name, icon, statuses}`     | 6.0 conditions are `type: 'condition'` with `system.type` (and `system.level`); no `icon` field in the v14 schema        | `actor.toggleStatusEffect(id, {active, levels})` (both versions)                                                  |
| `resources-effects.ts:487-491`                                                                                    | `effect.changes[].mode`                           | v14 core: `system.changes[]` with string `type`                                                                          | `(e.system?.changes ?? e.changes)`, `c.type ?? c.mode`                                                            |
| `resources-effects.ts:504-509, 530-532`; `characters.ts:308-320`                                                  | effect `duration.rounds/turns/...`                | v14: `value/units/expiry/expired`                                                                                        | read `units/value`, use `expired`                                                                                 |
| `characters.ts:312`; `compendium.ts:600`; `resources-effects.ts:499`                                              | `effect.icon`                                     | removed in v14                                                                                                           | `img`                                                                                                             |
| `session-events.ts:402-404, 448`                                                                                  | `flags.dnd5e.roll.type/...`                       | 6.0 moves roll kind to ChatMessage `type` and deletes the flags: damage detection degrades                               | `message.type === 'damage' \|\| flags...`                                                                         |
| `shared.ts:336-339`; `combat.ts:404`; `player-rolls.ts:211-216, 363`                                              | `CONST.DICE_ROLL_MODES`, `'gmroll'`               | deprecated in v14 (`CONFIG.ChatMessage.modes`)                                                                           | map when the new config exists                                                                                    |
| `scene-fx.ts:123-168` (tools `place-measured-template`, `delete-measured-template`)                               | MeasuredTemplate create/delete                    | **broken on v14 today**: the MeasuredTemplate document type was removed in 14.352 (#13089; old data migrates to Regions) | create a Region with `shapes`, `levels`, `restriction`, `visibility` (as dnd5e 6.0 `template-placement.mjs` does) |
| `scenes-tokens.ts:106`                                                                                            | `_source.background`                              | v14 Scene has no `background`/`foreground`/`backgroundColor`; they live on each Level (`background.src`, 14.353)         | read `scene.levels.get(scene.initialLevel).background.src`                                                        |
| `actor-creation.ts:433`; `scene-fx.ts:301`                                                                        | Token/Note creation                               | v14 Token `level` (one Level id, default `defaultLevel0000`); Note/Wall/Tile/Region/Light `levels` (set, empty = all)    | pass `canvas.level.id` explicitly (as dnd5e 6.0 does)                                                             |
| `actor-builder.ts:498, 515-532, 545`                                                                              | `ac.calc/flat`, `movement.walk`, `details.source` | migrated in 6.0                                                                                                          | write `ac.override`, `movement.speeds.*`, `system.source`                                                         |
| everything else (hp, death saves, spells, resources, currency, cr/type/size, ac.value, applyDamage, rests, rolls) | reads and APIs                                    | unchanged                                                                                                                | none                                                                                                              |

Pre-existing bugs found along the way: `creature-index.ts:520-535` (`hasSpells`/`hasLegendaryActions`
always true), `filters.ts:34` (size `'medium'` vs stored `'med'`), `player-rolls.ts:363` (`'whisper'` is
not a roll mode), `actor-builder.ts:141-156` (flat `use()` options ignored), `resources-effects.ts:404`
(`flags.dnd5e.item.name` never set).

Recommendation **[verified]**: two independent feature switches, not version compares: Foundry core
generation 14 (feature-detect `foundry.data.ActiveEffectTypeDataModel`) and dnd5e 6 (feature-detect
`game.system.documentTypes.ActiveEffect.condition`).

### 2.5 Third-party modules (details in appendix A)

- **Tarokka:** `tarokka-reading` 1.0.3 runs on v14; `sdnd-tarokka` 13.5.0 is capped at Foundry 13 and
  dnd5e 5.x and leaks card identity through tile flags and public chat. A third module, `tarokka`
  (gmredvelvet-rgb, 1.0.3, verified 14, GitHub only) **[verified, A.1]** stores the whole dealt hand,
  including DM text, in a world setting that every client receives, and ships adventure text in its source:
  support it read-only at most, and never copy its text.
- **Calendaria 1.4.2** (Foundry 14 only; requires `3ds-atlas`): API at `CALENDARIA.api` after
  `calendaria.ready`; automatic darkness sync would break the Barovia rule unless disabled per scene.
- **FXMaster 8.4.1:** `FXMASTER.api.effects` with fixed `apiMacro_*` ids (Calendaria's weather bridge
  deletes `apiPreset_*` rows).
- **DDB-Importer:** 7.5.5 needs dnd5e 6.0.3+ (a 5.3 world runs 7.4.x); tags CoS monsters
  `system.source.rules = '2014'`; offers only an import-time 2014 to 2024 swap (Patreon), no post-hoc
  converter.
- **Official content [verified, A.3]:** `dnd-monster-manual` 1.4.0 (packs `actors, features, content,
tables`), `dnd-players-handbook` 2.2.0, `dnd-ravenloft-horrors-within` 1.0.1 (WotC, released around
  2026-06-16, Foundry 13+ / verified 14, dnd5e 5.3+: 17 Darklords incl. Strahd, 60+ creatures, 4 species,
  Dark Gift feats; packs `book, options, bastions, items, tables, actors, fallback-actors, scenes,
adventures`). The rules value inside the Ravenloft actor pack is not public (read it at runtime).
- **DAE** v14 line 14.0.14 (dnd5e 6 line is WIP); **AC5e** main line for dnd5e 6.0 to 6.1, `legacy-v5` line
  for 5.3.

---

## 3. Step 0: foundations (milestone M0, before feature 1)

### M0 as built (2026-09-28, branch `claude/amazing-bardeen-q1x1q6`)

All of 0.1 to 0.7 is implemented and green (typecheck, lint ratchet, build, tests: module 914,
mcp-server 1169, shared 49, dashboard 39 = 2,171). Differences from the text below:

- **0.2 design change: plans, confirmation and the audit log live in the backend, not the
  module.** Keeping previous values in Foundry would put them in world data every client
  receives (2.1). The module only snapshots (`snapshotGuardedOps`) and executes
  (`applyGuardedOps`), re-checking GM, "Allow Write Operations", the feature switch (apply only)
  and that every target still matches the plan-time snapshot (a conflict writes nothing); a
  failing op rolls back the earlier ones. The backend (`packages/mcp-server/src/guarded-write/`)
  keeps plans in memory (15 min, capped at 100), builds the diff, requires `confirm` (+
  `confirmDestructive` when a plan deletes), refuses a plan made for another world and writes
  the audit entry to the vault. **Undo** = the backend builds inverse ops from the audit entry
  (update → restore `before`, absent → unset; create → delete; delete → create with `keepId`
  from the stored data) with the recorded `after` state as the expected state, so a document
  changed since reports a conflict instead of being clobbered. Undo needs "Allow Write
  Operations" but not the feature switch. Vault-only plans use `vault-set` / `vault-delete` ops,
  gated by the feature switch read from Foundry (refused when Foundry is unreachable).
- **Tools shipped in M0:** `get-planned-change`, `list-recent-changes`, `apply-planned-change`,
  `undo-change`, `open-in-foundry`. **`get-player-visibility` moved to M2** (it belongs with the
  projection work).
- **0.3:** the vault also holds `sessions/pump-state.json` (event-pump cursor). CLI:
  `npm run vault -- path|worlds|list|export|import`.
- **0.7:** the dashboard binds `DASHBOARD_HOST` (default `127.0.0.1`) and refuses a non-loopback
  bind without `GM_DASHBOARD_TOKEN`; the Foundry link binds `FOUNDRY_LINK_HOST` (default
  `127.0.0.1`); ComfyUI auto-start needs `COMFYUI_AUTOSTART=true`; the lockfile now has
  `resolved`/`integrity` for every registry entry (268 were missing after the typings removal;
  `npm ls --all` identical before and after a clean `npm ci`).
- **Found along the way:** the backend crashed on an abrupt control-client disconnect
  (ECONNRESET with no socket `error` listener); fixed. `npm audit`: 2 advisories in shipped
  code (`ip`, `werift`), 12 in total, none critical.
- **Still open (not M0):** the module-socket `requestMessageUpdate` trusts a client-supplied
  `userId` (roll attribution); roll/message modes adapter and moving the table 2.4 call sites
  behind the adapter (M3); werift 0.24 on its own branch, merged after the GM's live smoke test.

### 0.1 Close the cross-user query hole

- Keep the wire method names (`foundry-mcp-bridge.*`, frozen contract) but move the ~80 handlers out of
  `CONFIG.queries` into a private `Map` owned by `QueryHandlers`; `socket-bridge.ts` `handleMCPQuery`
  dispatches from that map. `unregisterHandlers` and `getRegisteredMethods` read the map.
- The only `CONFIG.queries` entries we register are narrow GM-to-GM helpers (Tarokka fetch, "open this
  document on my screen"). Registered only on core generation 14+, and each rejects unless
  `context.user?.isGM` and `game.users.get(context.user.id) === context.user` (a missing `user` means
  reject, since the sender argument is not yet in the official API docs); payload fields validated.
- `allowNonGmAccess`: default OFF and unlocked (**GM decision, section 9**). Recommended identity for the
  headless client on the Orange Pi: a dedicated Assistant GM user.
- Tests: no `foundry-mcp-bridge.*` bridge handler in `CONFIG.queries` after init; bridge dispatch still
  reaches every handler (adapt `queries.test.ts` / `socket-bridge.test.ts`); helper queries reject
  non-GM and missing senders.

### 0.2 Guarded-write framework (shared by features 1, 3 to 8)

- Module `data-access/guarded-write.ts`:
  - `plan(feature, summary, ops)` computes a human-readable diff, stores the plan in memory (TTL 15
    minutes) with a hash of the before-state, returns `{planId, risk: 'write'|'destructive', diff}`.
  - `apply(planId, {confirm: true, confirmDestructive?})` re-checks GM, `allowWriteOperations`, the
    feature's own enable setting (**every new one defaults OFF**) and that the before-state is unchanged;
    captures `before`, writes, records an audit entry with previous values, and logs a GM-only `gm-change`
    session event so it shows in the dashboard feed. Destructive plans need `confirmDestructive`.
  - `undo(changeId, {confirm: true})` restores `before` unless the document changed since (then it reports
    a conflict instead of clobbering).
- MCP: each feature gets read-only `plan-*` tools; there is **one** generic write tool
  `apply-planned-change`, plus `undo-change` (destructive class) and `list-recent-changes` (read).
  `classifyTool` learns the `plan-` and `suggest-` read prefixes; the confirm modal renders the diff and
  shows the destructive checkbox when `risk` says so.
- Plans whose data is secret (Tarokka, attention) are planned and applied in the backend vault (0.3), not
  in Foundry.

### 0.3 Bridge vault: secrets outside Foundry

- `packages/mcp-server/src/vault/`: a JSON store on the backend host, one directory per world id
  (`<dataDir>/<worldId>/gm/*.json`), atomic writes, `schema` per file, bounded audit ring with previous
  values, export/import for backups (the vault is not part of the Foundry world backup). `dataDir` is
  configurable (a mounted volume on the Orange Pi).
- Only the backend reads or writes it. Exposed through GM-gated tools (dashboard `/api/tool` is GM-only;
  Claude Desktop is the GM). Never sent to players.
- Optional per-feature **GM-only journal mirror** for convenience inside Foundry, **off by default**,
  clearly labelled as "hidden in the UI only, readable from a player's console" (section 2.1).
- "Open in my Foundry": a button that asks the GM's own Foundry client (targeted GM-to-GM query from 0.1)
  to open a linked journal page, scene or actor sheet, so links work without storing secrets in Foundry.
- Folder layout chosen so a later Obsidian integration can render or sync it (section 10).

### 0.4 Foundry-side version adapter

- `packages/foundry-module/src/systems/`: `core.ts` (generation 14 features: effect shape, durations,
  roll modes, Regions vs templates, levels) and `dnd5e/` (`status-effects.ts`, `effects.ts`,
  `chat-roll-kind.ts`, `rules-version.ts`, 6.0 write paths). Feature detection only.
- New features use only this layer; M3 moves the existing call sites in table 2.4 behind it. Every shim is
  tested against 5.3/v13-shaped and 6.0/v14-shaped fixtures.
- **Typings (setup-session addition 4).** The module compiles against Foundry **v9** types
  (`@league-of-foundry-developers/foundry-vtt-types` ^9.280.0 through the tsconfig `types` entry). They
  pull in more than 200 packages, including both "critical" dev advisories (handlebars, socket.io-parser).
  Without them there are 121 type errors, mostly about 15 missing globals (`Actor`, `ChatMessage`,
  `CONST`, `foundry`, `User`, `canvas`, `$`/`JQuery`, `Item`, `Folder`, `Roll`, `JournalEntry`,
  `FormApplication`, ...). Replace the package with hand-written v14 interfaces in
  `packages/foundry-module/types/` that declare only what the module uses, typed to the v14 shapes. The
  adapter's typed accessors are also where the `no-unsafe-*` lint count in `src` goes down (0.7).

### 0.5 Rules-version tagging

- `tagRulesVersion(doc, '2014' | '2024', source)` writes `flags.foundry-mcp-bridge.rules = {version,
source, at}`. Source of truth order: actor-level `system.source.rules` (item-level values from DDB are
  unreliable), DDB `flags.ddbimporter.sourceId` (< 145 means 2014), GM input. Never write
  `flags.ddbimporter.*` (DDB reads its own `is2014/is2024` there). Keep `system.source.rules` equal to the
  installed stat block (dnd5e renders from it). Every new write that touches an actor or item calls the
  helper; read tools surface it.

### 0.6 Backend event pump and persistent event log

- The backend polls `getRecentEvents` itself (same cursor logic as the dashboard feed) and appends to
  `<dataDir>/<worldId>/sessions/<date>.jsonl`. Feeds the attention engine (feature 3) and the recap
  (feature 7) even when the dashboard is closed. The Foundry-side buffer is in-memory and lost on reload.

### 0.7 Housekeeping in the same milestone (reduces risk on the Pi)

- ComfyUI: disable backend auto-start now; full removal as a separate, confirmed cleanup.
- Dashboard: bind 127.0.0.1 unless auth is configured; refuse a non-loopback bind without a GM token.
- Foundry link: bind the WebSocket server (31415) and WebRTC signaling (31416) to loopback by default,
  with an explicit opt-in for other hosts (July review B1/H1, `foundry-connector.ts:84, :164`). On the Orange
  Pi everything except the dashboard is loopback anyway.

Additions from the local setup session (2026-09-27, Windows, Node 22.22.2 / npm 10.9.7):

- **Lockfile integrity (addition 1).** 519 of the 1,020 registry entries in `package-lock.json` have no
  `resolved`/`integrity`, so `npm ci` looks each one up on the registry and cannot check those downloads
  against the lockfile. Fill both fields from the registry for the exact locked versions (script, no version
  changes); check that `npm ci` and `npm ls --all` give the same tree before and after.
- **Test script (addition 2).** `packages/mcp-server`: `"test": "vitest"` becomes `"vitest run"`
  (`test:watch` already exists). Until then `npm test` waits in watch mode in an interactive terminal.
- **npm audit (addition 3).** Shipped code has 10 advisories (high: fast-uri, ip-address, werift-ice, ip,
  werift; moderate: express, body-parser, qs, hono, @hono/node-server). `npm audit fix` without `--force`
  clears all but `ip` and `werift`; update the audit numbers in `CLAUDE.md` (done: 2 advisories in
  shipped code, 12 in total, none critical). werift 0.24.x is a breaking bump
  on the WebRTC path: separate change, gated on the GM's live smoke test
  (`docs/DEPENDENCY-PATCH-SMOKE-TEST.md`). The other 24 advisories are dev-only; the two "critical" ones
  leave with the v9 typings (0.4).
- **Lint (addition 5).** 12,129 warnings (8,142 in `src`, 3,987 in tests and mocks); 96% are the `any` rules
  (`no-unsafe-*`, `no-explicit-any`) on untyped Foundry data. No one-by-one fixes. Turn the `any` rules off
  for `*.test.ts` and `test-support/**`; add a CI ratchet (committed per-rule baseline, CI fails when a count
  rises, an update command lowers it), because CI runs lint with `--quiet` and nothing stops growth today;
  review the 84 `prefer-nullish-coalescing` and 11 `restrict-template-expressions` warnings for real bugs
  (the env-var defaults in `mcp-server/src/config.ts` are fine). The `src` count drops as the adapter gets
  typed (0.4).
- **`Claude.md` to `CLAUDE.md` (addition 6).** Claude Code looks for `CLAUDE.md`, so cloud sessions on Linux
  do not load the file; Windows ignores the case. GM decision (section 9). Done in `7af2368`.
- **Done (addition 7).** `e4558d7` stopped tracking the upstream author's `.claude/settings.local.json`,
  which pre-approved broad commands (`node:*`, `npm run:*`, `powershell:*`, `nc localhost 31414`, ...), and
  gitignored it.
- **Not in M0:** vitest 3 to 5, esbuild 0.19 to 0.28, ESLint 8 to 9 (dev-only; ESLint 8 is end-of-life).

---

## 4. Features

### Feature 1: Tarokka integration (M1)

**M1 as built (2026-09-28).** Per the answer to question 13 (no Tarokka module installed), M1 ships the
built-in roll and the `tarokka-reading` provider. The `sdnd-tarokka` (v13 legacy) and gmredvelvet
`tarokka` providers and the optional GM-only journal mirror are **not built** (add on request).

- Module (`packages/foundry-module/src/tarokka.ts`, read-only): `tarokka-reading` 1.x provider (client
  `secret`/`plan`, world `cardOverrides`, names via `TAROKKA.Cards.<id>`), gated on an active 1.x install.
  Bridge handlers `getTarokkaReading` (local deal, else a pending offer, else with `userId` the given GM's
  client) and `searchLinkCandidates`. GM-to-GM helper queries `gm.tarokkaReading` and
  `gm.offerTarokkaReading` (sender-checked, payload-validated, 14.352+). On `clientSettingChanged` for
  `tarokka-reading.secret`, when the `tarokka` feature switch is on, the dealing GM is asked once per
  reading whether to offer it; the offer is kept in memory on every active GM client until imported.
- Feature switch "AI Tool: Tarokka (writes)" (`feature.tarokka.enabled`, default off).
- Backend (`packages/mcp-server/src/tarokka/`): deck ids verified against tarokka-reading 1.0.3
  `deck.js` (40 common `<suit>-<1..9|master>`, 14 crowns); crypto roll (3 distinct common, 2 distinct
  high); vault files `gm/tarokka.json` (`current`, `archive.<readingId>`, `revealJournal`),
  `gm/tarokka-config.json` (link table `links.<position>.<cardId>`, `cardNames.<cardId>`),
  `gm/reveals.json` (`pages.<pageId>`, the allowlist M2 uses). Default names are plain ("Seven of
  Swords"); overrides and the provider's names win.
- Tools: `get-tarokka-reading`, `plan-tarokka-import` (`auto | builtin-roll | tarokka-reading`, `userId`),
  `suggest-tarokka-links`, `plan-tarokka-links` (per position and card; `clear` is destructive),
  `plan-tarokka-reveal`, all applied with `apply-planned-change`.
- Reveal: a page with only the GM's text in a journal players can observe (created on first use with
  `ownership.default = OBSERVER`; later reveals add pages, a re-reveal edits the page), recorded in
  `reveals.json` and marked revealed, **in one change**: the guarded-write service now accepts mixed plans
  (Foundry ops + vault ops, vault conflicts checked first, Foundry part rolled back if the vault write
  fails) and a `risk: 'destructive'` override.
- Dashboard: GM-only Tarokka drawer (positions, card names veiled until "Show cards", GM notes, link
  status with "Open" buttons via `open-in-foundry`, revealed flags, import/roll, link search, reveal form),
  each action via plan then confirm-with-diff.
- Canary tests: nothing sent to Foundry (except the read requests) contains card ids, names, GM notes or
  links, only the GM's reveal text; change summaries never contain them; the player role gets 403 on the
  Tarokka tools (split smoke test).

- Providers in `data-access/tarokka.ts` (module side, read-only):
  - `tarokka-reading` (live, v14): read client setting `tarokka-reading.secret` (`{id, broadcast,
cards[5], stages[5]}`) plus `plan` (GM notes) and world `cardOverrides`; names via
    `game.i18n.localize('TAROKKA.Cards.<id>')` at runtime. Order: tome, symbol, sword, ally, enemy
    (Strahd's lair). Detect with core `clientSettingChanged` on key `tarokka-reading.secret`. Internal keys,
    so gate on module version 1.x.
  - `sdnd-tarokka` (legacy, read-only): parse the five slot tiles (Monk's Active Tiles `runmacro` args) or
    the "Tarokka Reading" Cards pile of a chosen scene; for worlds carried over from v13.
  - `tarokka` (gmredvelvet-rgb, optional, read-only): card ids and slots from the world setting
    `tarokka.gameState` (appendix A.1); text fields never read. The module already sends the reading to
    every client, so the tool warns instead of promising secrecy.
  - built-in fallback roll: 3 distinct common + 2 distinct high cards, crypto RNG, neutral TR-compatible
    ids (`swords-7`, `raven`); display names from the GM's mapping table or a world Cards deck.
- Flow: the reading exists only in the dealing GM's browser. Our module there detects the deal, asks "Save
  this reading to the AI Tool vault?" (GM-only dialog), and sends it to the bridge client through the
  authenticated GM-to-GM query; the backend stores it in the vault (`tarokka.json`: `{schema, source,
readingId, readAt, positions: {tome, holySymbol, sunsword, ally, strahdLocation}: {cardId, cardName,
gmNote, links: {journalPageUuid?, sceneUuid?, actorUuid?}, revealed}}`). On demand, the backend can
  request it the same way (`plan-tarokka-import`).
- Links: GM-editable mapping (card id to journal page, scene, actor UUID). A link helper searches the
  world's imported Curse of Strahd journals at runtime and proposes candidates; the GM confirms. No card
  meanings or locations in the repo.
- Optional GM-only journal mirror (off by default, see 0.3).
- Reveal: `plan-tarokka-reveal` creates or updates a separate player-observable page containing only what
  the GM chooses (GM-typed prophecy text) and adds it to the reveal allowlist. Destructive class (second
  confirm), because a reveal cannot be taken back at the table.
- Idempotence: `readingId` (TR) or tile ids (SD); a new reading archives the previous one in the vault.
- Tools: `get-tarokka-reading`, `plan-tarokka-import` (`source: auto | tarokka-reading | sdnd-legacy |
builtin-roll`), `plan-tarokka-links`, `plan-tarokka-reveal`, then `apply-planned-change`.
- Dashboard: GM "Tarokka" card (positions, link status, revealed flags, "open in my Foundry" buttons).
- Tests: provider parsing against fixtures shaped like each module's stored data, version gating, vault
  round trip, reveal allowlist, canary test that card names and locations never reach a player payload.

### Feature 2: spoiler-safe /player (M2)

Principle: player payloads are built by **projection** (copy an allowlisted set of fields) from GM data plus
a visibility context, never by deleting known-bad fields from a GM object.

- Module: `getPlayerVisibility` (`get-player-visibility`), computed on the GM client for the non-GM users:
  player-owned actor ids; active scene id and player-facing name (`navName`, else a generic label); tokens
  players can see on the active scene with the name they see (token `displayName` mode respected, else
  "Unknown creature").
- Module: session events get a `visibility` block at creation (subject pc/npc, token visible, player-facing
  name).
- Dashboard `player-projection.ts` replaces the event half of `redact.ts`: default-deny event types;
  subject must be a PC or a visible token; text regenerated from fixed templates with the player-facing
  name; no numbers for non-PCs; `details` never copied. Combat names from the visibility context; enemy
  conditions only from core status ids.
- Dedicated `/api/player/state` and `/api/player/stream` that **always** project, whatever credential is
  presented (a GM token authorizes, never upgrades); separate localStorage key.
- Handouts: revealed pages = vault allowlist AND observable by a player per Foundry ownership; HTML
  sanitized server-side (drop `section.secret`, links to unrevealed documents, inline rolls, scripts).
- "Whisper to chat" gets a guard: block or warn when the text matches vault canary terms (whispers reach
  every client).
- Tools: `list-revealed-pages`, `plan-page-reveal` (reveal or hide).
- Tests (the proof): a canary suite seeds GM state with unique strings (Tarokka card and location,
  attention score, watcher names, hidden token name, disguised NPC true name, GM notes, `section.secret`
  block, AI commentary, audit entries) and asserts none appear in `/api/player/state`, any SSE frame on the
  player stream, `/player` HTML and JS, or the player recap. Plus projection tests per event type (unknown
  types dropped), `getPlayerVisibility` tests (hidden tokens, displayName modes, ownership combinations),
  and the 0.1 regression tests.

### Feature 3: Strahd attention / spy network (M4)

- Vault `attention.json`: `regions` (`{id, name, score, sceneUuids[], exposure:
'open'|'sheltered'|'interior'}`), `watchers` (`{id, name, kind: wolves|bats|ravens|vistani|keepers|spy|
custom, regionId, actorUuid?, reportsTo: strahd|party|neutral, active}`), `scale` (`min, max,
thresholds[{at, label, suggestions[]}]`), `rules` (event-to-delta table), `pending`. All names and numbers
  are GM data. Ravens and the Keepers of the Feather can lower attention.
- Engine: pure TypeScript in the backend, fed by the event pump (0.6):
  `evaluate(event, context, config) -> ProposedDelta[]`. Context: region of the active scene, sky state,
  watchers present. Example rules (config, not code): combat in an open scene +1, spell of level 3+ outdoors
  +1, entering a flagged scene +N, long rest in the open +1, night x1.5, full moon multiplier, interior x0.5,
  ravens present -1.
- Sky state **[verified]**: module read handler `getCalendarState` wraps `CALENDARIA.api` (available after
  the `calendaria.ready` hook): `getCurrentDateTime()` vs `getSunrise()/getSunset()` for night,
  `isMoonFull(moon)` (position band 0.5 to 0.625), `getMoonPhase(i)` (returns null for moons hidden from
  players), `getCurrentWeather()`. Do not use `isDaytime()` blindly (true when no calendar is loaded). The
  bundled Barovian calendar has one moon ("Luna", 28-day cycle, full at phase index 4). Hooks
  `calendaria.dateTimeChange` and `calendaria.moonPhaseChange` become GM-only session events. Without
  Calendaria: `game.time.worldTime` with a configured day length, no moon, and "time unknown" never
  counts as day.
- Proposed deltas land in `pending`; applying is a GM action (approve one or all, one confirmation);
  optional "auto-apply attention deltas" setting, default OFF.
- Threshold crossings produce **suggestion cards only** (dashboard + AI context). Nothing is triggered in the
  game by this feature.
- Tools: `get-strahd-attention`, `plan-attention-change`, `plan-attention-config`,
  `suggest-strahd-reaction`. Dashboard: GM-only "Attention" panel; canary-tested out of player payloads.

### Feature 4: NPC attitudes and relationships (M5)

- Flag `flags.foundry-mcp-bridge.attitude` on NPC actors as requested: `{schema: 1, attitude:
'hostile'|'indifferent'|'friendly' (2024 influence scale, configurable), score?: -5..+5, settlement,
tags[], relationships: [{targetUuid, kind, note}], updatedAt}`. Actor flags are readable from a player's
  console (2.1), so secret notes default to the vault keyed by actor UUID (**GM decision**).
- Undo history in the audit ring, not on the actor.
- Tools: `list-npc-attitudes` (filter by settlement or scene), `get-npc-attitude`, `plan-npc-attitude`.
- Dashboard: GM "NPCs" panel grouped by settlement (Village of Barovia, Vallaki, Krezk, ...).
- AI context: attitudes and relationship one-liners for NPCs whose tokens are on the active scene plus the
  few most recently mentioned, capped (about 12 lines) in the volatile user turn; never in player payloads.
  The static prompt's condition reference becomes rules-version aware (it is 2014-only today).
- Existing module to consider: Monk's Enhanced Journal relationships (v14) store per-entry relationships
  with a revealable secret field; read-only import is possible later.

### Feature 5: mood presets per scene (M6)

- Presets are GM-editable data: `{id, label, lighting: {darkness, globalLight}, calendaria:
{darknessSync: 'disabled'|'default', brightnessMultiplier?}, fxmaster: {effects: [{kind, id, type,
options}]}, playlist: {name, action}, sunlight: false}`. Starter presets: Barovian day, dusk, night, full
  moon, castle interior, Mists.
- **Barovia rule, enforced in validation (not only in the starter data):** reject any preset that sets
  darkness below a configurable floor for "day", enables bright global illumination, adds bright light
  sources, uses FXMaster `bloom` or its sunlight presets, or sets a brightening Calendaria weather type
  (`luminous-sky`, `ley-surge`, `arcane-winds`). Scene flag `flags.foundry-mcp-bridge.mood = {presetId,
sunlight: false}` for other automation to read.
- Calendaria **[verified]**: its darkness sync (off by default, recalculates every game minute when on)
  would overwrite preset darkness; with the Barovian calendar's 0.9 brightness multiplier noon darkness is
  about 0.1. Presets set `flags.calendaria.darknessSync = 'disabled'` on the scene (or a
  `brightnessMultiplier` of 0.5, which floors darkness at 0.55) and record the old value for undo.
- FXMaster **[verified]**: `FXMASTER.api.effects.play({effects, scene})` / `effects.stop(ids, {scene})`
  with fixed ids `apiMacro_<name>_p|_f` (Calendaria's weather bridge removes `apiPreset_*` rows). Particles
  such as `clouds`, `fog`, `bats`, `crows`, `rats`; filters such as `color`, `fog`, `lightning`,
  `oldfilm`. Night bats via `darknessActivation*` options. Option values are rescaled internally, so capture
  real values with FXMaster's "save as macro". All calls are GM-only (scene updates), so they run on the
  bridge client.
- Core **[verified, v14 API `SceneEnvironmentData` + 14.368 notes]**: `environment.darknessLevel` and
  `environment.globalLight.enabled` are unchanged in v14 (`setSceneMood` already writes them). Dim versus
  bright global light is `environment.globalLight.bright` (boolean, default `false` = dim); the global light
  only shows while darkness is inside `globalLight.darkness.{min, max}`. Barovia validation therefore rejects
  `globalLight.enabled && globalLight.bright`. Since 14.368 a scene with `environment.darknessLock` needs
  `darknessLock` sent together with any `darknessLevel` update. (The API typedef mislabels the lock field
  `darknessLevelLock`; the real field is `darknessLock`.)
- Missing modules skip that part of the preset and say so in the plan diff.
- Undo: previous scene environment, Calendaria scene flags, FXMaster rows and playlist state in the audit
  entry.
- Tools: `list-mood-presets`, `plan-mood-preset`, `plan-mood-preset-config`. Dashboard: one-click preset
  bar, each click opens the confirm modal with the diff.

### Feature 6: 2014 to 2025 stat block converter (M7)

- Detect legacy CoS actors **[verified]**: NPCs with `flags.ddbimporter.id` and actor-level
  `system.source.rules === '2014'` (fallback `flags.ddbimporter.sourceId < 145`; CoS is sourceId 6), on
  scenes whose `flags.ddb.bookCode` matches `/^cos$/i`.
- Bespoke NPCs (manual review, never auto-swapped): `system.source.book === 'CoS'` or a
  `flags.ddbimporter.sources[].sourceId === 6`, the GM's review list (seeded with the names you gave:
  Strahd, Rahadin, Baba Lysaga, the Abbot, ...), tokens whose `delta.name` differs from the actor.
  Strahd's Ravenloft: The Horrors Within stat block is offered only for manual review.
- Candidates: index `dnd-monster-manual.actors`, fall back to `dnd5e.actors24`; match `system.identifier`,
  then the name with " (Legacy)" stripped, then the GM rename table (ships empty), then fuzzy suggestions
  (same type, CR within 1) that the GM confirms into the table. Target must have `system.source.rules ===
'2024'` (check premium packs with `getIndex({fields: ['system.source.rules', 'system.identifier']})`).
- Swap **[verified pattern]**: update the existing world Actor in place (as DDB's own refresh does: keep
  `_id`, folder, sort, ownership; replace `system`, items, effects, stat parts of `prototypeToken`), so every
  token and `@UUID[Actor.id]` link keeps working. DDB journals mostly link `@Compendium[<DDB pack>...]`,
  which a world swap does not touch. Unlinked tokens: list those whose `delta` holds 2014 stats and reset
  only stat deltas (position, disposition, hidden, elevation, name untouched). Full `toObject()` backup in
  the vault before apply; undo restores it.
- Detach from DDB updates: DDB's "Update World Monsters" re-syncs by name + `flags.ddbimporter.id`, which
  would revert a swap. The plan moves that id into our flags (v14 `_del`) and records it for undo
  (**GM decision**). Alternative outside this tool: DDB's import-time "Replace legacy monsters with latest
  versions" (Patreon).
- Tools: `list-legacy-statblocks`, `plan-statblock-swaps` (per-actor preview with candidate, confidence,
  affected tokens, review reasons), `plan-statblock-mapping`. Dashboard: converter table with per-row
  approve.

### Feature 7: session recap (M8)

- Source: the backend event log (0.6) plus journal changes (existing `journal-created/updated` events and
  snapshot diffs of watched journals at session start and end).
- GM recap: Anthropic call on the dashboard with GM context, stored in the vault (optional GM-only journal
  mirror) after confirmation.
- Player recap: generated only from the **player projection** of the event log plus revealed pages, so the
  model never sees secrets; a deterministic canary scan against vault terms blocks publishing on any hit;
  published only on explicit request (plan/apply) as a player-observable page.
- Tools: `get-session-digest` (`audience: gm | player`) so Claude Desktop can write recaps itself;
  `plan-session-recap` to publish. Later: add a voice transcript as a source (section 10).

### Feature 8: dread / fear tracker (M9)

- Flag `flags.foundry-mcp-bridge.dread = {schema: 1, value, max?}` on PCs (visible to the owning player,
  which is intended); thresholds `[{id, at, label, effect: {name, statuses?, changes?}}]` in the vault,
  shipped empty with one neutral example.
- Crossing a threshold proposes an effect (plan), applied only on confirmation **[verified]**: our own
  effect with a random `_id` (not `toggleStatusEffect`, so removing it never clears a frightened status from
  another source); tag `flags.foundry-mcp-bridge.dread = {thresholdId}`; replace instead of stacking; leave
  `origin` unset (AC5e then applies frightened disadvantage without needing sight of a source; requires
  AC5e's `automateStatuses` setting); optional `flags.dae.stackable: 'noneName'` when DAE is active.
- Payload per version through the adapter:
  - v13 / 5.3: `{name, img, statuses?, changes: [{key: 'system.abilities.wis.bonuses.save', mode: 2,
value: '-1'}], duration: {rounds}}`.
  - v14 / 6.0: `{name, img, type: 'base', statuses?, system: {changes: [{key:
'system.abilities.wis.save.roll.bonus', type: 'add', value: '-1', phase: 'initial'}]}, duration:
{value, units: 'rounds'}}`. v14 core still migrates the legacy shape and dnd5e 6.0 shims old bonus keys,
    but write the native shape.
- Tools: `get-dread`, `plan-dread-change`, `plan-dread-config`. Dashboard: small dread strip per PC.
- Existing modules to consider instead of our own counter: `custom-dnd5e` counters, `stresspoints-rest`,
  dnd5e's optional Sanity score.

---

## 5. Data model

| Where                                  | Key                                                                                                                                                                                                                          | Visibility                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Bridge vault (backend host, per world) | `tarokka.json`, `attention.json`, `reveals.json`, `npc-secrets.json`, `recaps/`, `audit.json`, `backups/`, feature configs (`mood-presets.json`, `statblock-map.json`, `review-list.json`, `dread.json`), `sessions/*.jsonl` | GM only, never in Foundry                          |
| NPC Actor                              | `flags.foundry-mcp-bridge.attitude`                                                                                                                                                                                          | Foundry UI hides it from players; console-readable |
| PC Actor                               | `flags.foundry-mcp-bridge.dread`                                                                                                                                                                                             | owner + GM                                         |
| Any touched Actor/Item                 | `flags.foundry-mcp-bridge.rules = {version, source, at}`                                                                                                                                                                     | as the document                                    |
| Converted Actor                        | `flags.foundry-mcp-bridge.converted = {fromName, fromSource, ddbId?, backupRef, at}`                                                                                                                                         | as the document                                    |
| Scene                                  | `flags.foundry-mcp-bridge.mood = {presetId, sunlight: false, at}`                                                                                                                                                            | not secret                                         |
| ActiveEffect (dread)                   | `flags.foundry-mcp-bridge.dread = {thresholdId}`                                                                                                                                                                             | as the actor                                       |
| Optional mirror                        | GM-only journal "Foundry AI Tool (GM mirror)"                                                                                                                                                                                | UI-hidden only                                     |

Every structure carries `schema` for migrations. Scene-to-region mapping for attention lives in the vault
(region names could spoil).

## 6. New MCP tools

| Milestone | Read (`get-/list-/plan-/suggest-`)                                                                  | Write                                               |
| --------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| M0        | `list-recent-changes`, `get-planned-change`, `open-in-foundry`                                      | `apply-planned-change`, `undo-change` (destructive) |
| M1        | `get-tarokka-reading`, `plan-tarokka-import`, `plan-tarokka-links`, `plan-tarokka-reveal`           | via apply                                           |
| M2        | `list-revealed-pages`, `plan-page-reveal`, `get-player-visibility`                                  | via apply                                           |
| M4        | `get-strahd-attention`, `plan-attention-change`, `plan-attention-config`, `suggest-strahd-reaction` | via apply                                           |
| M5        | `list-npc-attitudes`, `get-npc-attitude`, `plan-npc-attitude`                                       | via apply                                           |
| M6        | `list-mood-presets`, `plan-mood-preset`, `plan-mood-preset-config`                                  | via apply                                           |
| M7        | `list-legacy-statblocks`, `plan-statblock-swaps`, `plan-statblock-mapping`                          | via apply                                           |
| M8        | `get-session-digest`, `plan-session-recap`                                                          | via apply                                           |
| M9        | `get-dread`, `plan-dread-change`, `plan-dread-config`                                               | via apply                                           |

New GM dashboard panels: Recent changes (with undo), Tarokka, Attention, NPCs, Mood bar, Converter, Recap,
Dread strip. New player view sections: Handouts (revealed pages), published recap.

## 7. Build order and milestones

Each milestone ends green (`npm run typecheck && npm run lint && npm run build` + all tests), is committed
and pushed, and is summarized before the next starts.

1. **M0** step 0 (0.1 to 0.7). **Done 2026-09-28** (see "M0 as built", section 3).
2. **M1** feature 1 (Tarokka). **Done 2026-09-28** (see "M1 as built", feature 1).
3. **M2** feature 2 (projection, player endpoints, reveal allowlist, canary suite).
4. **M3** Foundry v14 + dnd5e 6.0 compatibility pass for existing tools (table 2.4 + pre-existing bugs).
   Some items are v14-core and affect you already. Templates are confirmed broken on v14 (MeasuredTemplate
   removed in 14.352), so `place-measured-template` and `delete-measured-template` fail today; M0 makes them
   return a clear "not available on Foundry 14 yet" error through the adapter, M3 ports them to Regions
   (question 11).
5. **M4** feature 3, **M5** feature 4, **M6** feature 5, **M7** feature 6, **M8** feature 7, **M9** feature 8.

## 8. Risks

1. Secrets and GM-level writes reachable through `CONFIG.queries` and `allowNonGmAccess` until M0 lands.
   Nothing secret is stored before that; use the interim `QUERY_USER` mitigation if players are connected.
2. Foundry sends all world data to every client (2.1): anything in Foundry is UI-hidden, not secret. The
   vault is off-Foundry; mirrors are opt-in and labelled.
3. Third-party internals: tarokka-reading has no public API (internal setting keys); FXMaster 8.x and
   Calendaria 1.x move fast. Each integration sits behind a provider with version gating and fixture tests;
   failure degrades to "not available", never a crash.
4. Foundry v14 + dnd5e 6.0 changes: all effect, template and condition work goes through the adapter, tested
   against both shapes.
5. Stat block swap is the riskiest write: in-place update, vault backup, per-actor apply, undo, full token
   list in the preview, DDB re-sync detach.
6. AI leakage: player recap built only from projected data; canary scan blocks publishing; whisper guard.
7. Copyright: no adventure text in the repo; mapping tables ship empty.
8. Headless client identity on the Orange Pi (Assistant GM recommended); tarokka-reading data lives only in
   the dealing GM's browser; the vault needs its own backups.
9. MCP confirmation is Claude Desktop's approval prompt plus plan ids; the human confirmation that is
   independent of the client is the dashboard modal.

## 9. Open questions for the GM (recommended default in bold)

1. `allowNonGmAccess`: **default OFF + unlocked**; the Orange Pi headless client logs in as a dedicated
   **Assistant GM** user. Or keep it on for a reason not visible in the code?
2. Secret storage: **bridge vault off-Foundry by default, GM-only journal mirror opt-in per feature**, or
   journals by default accepting console visibility?
3. NPC notes: **attitude values in actor flags (as requested), secret notes in the vault**, or everything in
   actor flags?
4. Tarokka capture: **dialog in your Foundry client on deal + on demand from dashboard/MCP**, or on demand
   only?
5. Attitude scale: **2024 three-step (hostile/indifferent/friendly) plus optional -5..+5 score**, or five
   steps?
6. Attention deltas: **queue for approval (auto-apply setting off)**, or auto-apply once enabled?
7. Converter: **rename table ships empty + fuzzy suggestions**, or seed a small generic 2014 to 2025 rename
   list? And **detach converted actors from DDB re-sync (recorded for undo)**, or leave DDB flags alone?
8. Dread thresholds: **ship empty + one neutral example**, or a default ladder?
9. ComfyUI: **disable auto-start in M0, remove in a separate confirmed cleanup**, or remove in M0?
10. Rename `Claude.md` to `CLAUDE.md` so Linux cloud sessions load it: **yes, in M0** (a two-step `git mv`
    because Windows ignores case), or keep the name?
11. Measured templates (removed in Foundry 14.352, so the two template tools fail today): **clear error in
    M0, Region port in M3**, or pull the Region port into M0?
12. werift 0.24 (breaking, WebRTC path only): **separate commit on its own branch after M0, merged only
    after your live smoke test**, or defer? (On the Orange Pi the headless client can use plain WebSocket on
    loopback, so WebRTC may not be needed there at all.)
13. Tarokka module for M1: **`tarokka-reading`** (v14, keeps the reading in the dealing GM's browser),
    `tarokka` by gmredvelvet-rgb (sends the reading and DM text to every client; read-only support at most),
    or `sdnd-tarokka` (v13 only; legacy read-only)? Which one is installed in your world?

**Answers (GM, 2026-09-27):** all recommended defaults (questions 1 to 12). Question 13: no Tarokka module
is installed, so M1 leads with the built-in roll and supports `tarokka-reading` as an optional provider.

## 10. Later (recorded, not planned yet)

- **Obsidian integration**: use Obsidian as the GM's note app over the same data, with GM/player separation
  (for example a GM vault folder and a player-safe folder fed only through the feature 2 projection). The
  bridge vault layout (0.3) is chosen to make this possible. To research then: existing Foundry-Obsidian
  modules, Obsidian's plugin APIs, sync model on the Orange Pi.
- **Discord voice recording (Craig) + voice-to-text**: transcripts as an extra recap source (feature 7) and
  AI context. Prior art to look at then: `Txpple/fvtt-app-sessionscribe` **[verified 2026-09-27]** (MIT,
  created 2026-09-23): an MCP server plus a Claude Code skill that turns a Craig recording, the Foundry chat
  log, combat stats and party sheets into a speaker-labelled transcript, player recap, GM notes and combat
  log; speech-to-text is local faster-whisper per speaker track (default `large-v3-turbo`, CUDA or CPU
  int8); Foundry access through its sibling `Txpple/fvtt-mcp-dnd5e`, a headless Chromium client logged in
  as an Assistant GM user (the same identity model as 0.1); whispers are withheld from the public
  transcript. Speech-to-text on an Orange Pi 5 Pro is a separate feasibility question.

---

## Appendix A: verified third-party facts

### A.1 Tarokka modules

tarokka-reading (Stphn-Wrn) at `0736fe9`, tag v1.0.3; sdnd-tarokka (matthewbstroud) at `83fd756`, tag
v13.5.0. Deck ids, `POSITIONS` and the
`secret`/`plan` shapes re-read from tarokka-reading v1.0.3 `src/deck.js`, `src/reading.js` and `src/state.js`
on 2026-09-28 **[verified]**.

- tarokka-reading manifest: id `tarokka-reading`, 1.0.3, compatibility min 11 / verified 14, no system or
  module relationships, entry `src/main.js`, no packs (`module.json:2-21`).
- Settings (`main.js:15-45`): `secret` (client; `{id, broadcast, cards:[5], stages:[5 x
hidden|placed|revealed]}`; `main.js:31-37`, `state.js:32-39`); `reading` (world; `{id, broadcast,
positions:[{cardId|null, placed, revealed}]}`, cardId only for revealed cards while broadcasting;
  `reading.js:54-70`); `plan` (client; `[{cardId|null, note}] x5`; `reading.js:11-13`); `cardOverrides`
  (world; `{[id]: {name?, image?}}`; `customization.js:64-82`).
- Positions `tome, symbol, sword, ally, enemy` (`reading.js:3-9`); `enemy` is labelled Strahd's lair
  (`lang/en.json:18`). Card ids `swords|stars|coins|glyphs-1..9|master` plus crowns such as `artifact,
beast, broken-one, dark-lord` (`deck.js:1-15`). Name: override or `TAROKKA.Cards.<id>` (`cards.js:17-19`).
- No `.api`, no hooks fired, no sockets (`main.js:12-63`). Players sync through the world setting only.
  Nothing shared before "Show to players", then only revealed card ids. No chat, journals, Cards or tiles.
  No adventure text (`README.md:69`).
- Detection: core `clientSettingChanged(key, value, options)` (typings `hooks.d.mts:1218-1225`), key
  `tarokka-reading.secret`; fires on deal, place, flip, broadcast, only in the dealing GM's browser. Reading
  complete when all stages are `revealed` (`reading.js:99-112`).
- v14: runs (verified 14) but uses deprecated AppV1 `Application`/`FormApplication` (removal slated for
  v16). "New reading" overwrites the old one with no history (`reading-app.js:131-139`).
- sdnd-tarokka: compatibility 13/13/13, dnd5e 5.0.0 to 5.x; requires lib-wrapper, monks-active-tiles,
  socketlib, stroud-dnd-helpers (`module.json:8-70`). Stores readings as world Cards ("Tarokka Reading"
  pile) and five Monk's Active Tiles whose flags carry the card name and front image
  (`tarokka.js:449-485, 500-571`); slots `TomeOfStrahd, SymbolOfRavenkind, SunSword, StrahdEnemy (ally),
Strahd (location)`. Hardcodes adventure text in unexported constants (`tarokka.js:66-359`); reveal posts
  public chat. On v14: `CONST.CHAT_MESSAGE_TYPES.OOC` is gone, so `readHand` throws; removed global
  `randomID()`; Tile `z/overhead/roof` shims removed.
- `tarokka` (gmredvelvet-rgb) **[verified 2026-09-27]**, repo `gmredvelvet-rgb/tarokka-foundryvtt`, MIT,
  tag v1.0.3 (`eb950f9`, 2026-07-26). Not listed on foundryvtt.com or the Forge (manifest install from
  GitHub only). Manifest: id `tarokka`, compatibility min 12 / verified 14, `esmodules`
  `dist/tarokka.js`, `socket: true`, no relationships, no packs.
  - Storage: one world setting `tarokka.gameState` (`config: false`; `src/foundry/state.ts:11-17`) holding
    `{started, cards[], lastUpdated, settings}`. At deal time each card object is copied in full into that
    setting, including its DM text (`src/lib/TarokkaDeck.ts:16-19`, `state.ts:49-56`), so every client
    receives the reading; the face image is in every player's DOM, only rotated out of view
    (`src/components/Card.tsx:84-88`). No flags, documents, chat or localStorage.
  - API `game.modules.get('tarokka').api = {open}` (`src/main.ts:16-19`); no custom hooks (it listens to
    core `updateSetting`); socket messages carry only a card-tilt effect (`src/foundry/socket.ts:4-46`).
  - Slots 0-4: `tome, ravenkind, sunsword` (common deck), `ally, strahd` (high deck); a hand is 3 common
    - 2 high cards; card ids are kebab-case slugs (40 common, 14 high).
  - Ships adventure text (card meanings, prophecies, locations, ally names) in
    `src/constants/tarokkaCards.ts`, ported from an unlicensed upstream. Consequence for feature 1: at most a
    read-only provider that reads card ids and slots from the world setting (detect via `updateSetting` on
    `tarokka.gameState`); never read or copy its text fields; tell the GM that this module already exposes
    the reading to players.

### A.2 Calendaria and FXMaster

Calendaria at `841f73f` (1.4.2); FXMaster at `13a8cf2` (8.4.1).

- Calendaria manifest: id `calendaria`, Foundry min 14 / verified 14.367, requires `3ds-atlas`
  (`module.json:12-48`). API `globalThis.CALENDARIA.api` created in `init` (`scripts/api.mjs:2569-2578`); data
  initializes in `ready`, then hook `calendaria.ready` `{api, calendar, version}` (`calendaria.mjs:114-169`).
  Not on `game.modules.get('calendaria').api`.
- Functions: `getCurrentDateTime()` (month/day from 1; `api.mjs:201-207`), `advanceTime`, `setDateTime`,
  `advanceTimeToPreset('sunset')` (`:228-287, :1536-1577`), `getMoonPhase(i)` -> `{name (i18n key), position,
phaseIndex}`, null for moons hidden from players (`:455-459`), `isMoonFull(moon)` (position 0.5 to 0.625;
  `moon-utils.mjs:56-59`), `getSunrise()/getSunset()` (`:609-626`), `isDaytime()` (true with no calendar;
  `:1510-1513`), `getCurrentSeason()`, `getCurrentWeather()/setWeather(id)` (`:1645, :1705`),
  `createNote({...})` (`:868-910`). Time and weather changes are GM/Assistant only; reads unchecked
  (`permissions.mjs:4-35`).
- Hooks: `calendaria.dateTimeChange {previous, current, diff, worldTime}` (`time-tracker.mjs:97-107`);
  `calendaria.sunrise/sunset/midday/midnight` only when time moves forward; `calendaria.moonPhaseChange
{moons:[...]}` (`:319-348`); `calendaria.weatherChange` (`weather-manager.mjs:566`); reacts to core
  `updateWorldTime` (`hooks.mjs:100`).
- Darkness sync (`time/darkness.mjs`): writes `environment.darknessLevel` (and base/dark colours with
  ambience sync), never global light; darkness = 1 - (1 - base) x scene multiplier x zone multiplier, base 0 at
  noon and 1 at midnight, plus a weather penalty; the primary GM recalculates every game minute; all sync
  settings default off (`settings-handler.mjs:418-489`). Scene flags `flags.calendaria.darknessSync`
  (`default|enabled|disabled`), `brightnessMultiplier`, `weatherFxOverride` (`constants.mjs:233-250`);
  `disabled` stops all Calendaria lighting writes to that scene. Barovian calendar ships with Calendaria:
  one moon "Luna", 28-day cycle, full at phase index 4 (`calendars/barovian.json:363-398`), climate
  brightness 0.9 (`:492`). Brightening weather types: `luminous-sky`, `ley-surge`, `arcane-winds`.
  Calendaria's FXMaster bridge calls `presets.switch()/stop()`, removing every `apiPreset_*` row but not
  `apiMacro_*` rows (`integrations/fxmaster.mjs:77-202`).
- FXMaster manifest: id `fxmaster`, 8.4.1, Foundry min 13 / verified 14 / max 14, no dependencies. API on
  `game.modules.get('fxmaster').api` and `FXMASTER.api` (init; `src/api.js:2148-2213`):
  `presets.play/stop/toggle/switch/list/listActive` (options `color, speed, density, aboveDarkness,
darknessActivationMin/Max, levels, scene`), `effects.play({effects, scene})` -> ids,
  `effects.stop(ids, {scene})`, `stopSceneEffects({scene})`; chosen ids `apiMacro_<name>_p|_f`
  (`:679-685`). Legacy `FXMASTER.filters.*` and hook `fxmaster.switchParticleEffect` still work. GM-only in
  practice (writes via `scene.update`). Storage: `flags.fxmaster.effects`, `flags.fxmaster.filters`,
  `flags.fxmaster.stack`; v14 levels in each effect's `options.levels`. Particles include `bats, crows,
clouds, fog, rain, snow, embers, rats, spiders`; filters `bloom, color, fog, lightning, oldfilm,
predator, screenShake, underwater`; avoid `bloom` and the sunlight presets. Region behaviors
  `particleEffectsRegion, filterEffectsRegion, suppressSceneFilters, suppressSceneParticles`. Docs drift:
  README omits `aboveDarkness`, `tokenTrails`, `skipFading`, and understates that `switch` removes all
  `apiPreset_*` rows.

### A.3 DDB-Importer, official content, dnd5e packs

DDB-Importer at `1b37b61` (7.5.5, needs dnd5e 6.0.3+; a 5.3 world runs 7.4.x, re-check there).

- Monster flags: `flags.ddbimporter.{id, entityTypeId, creatureGroupId, creatureFlags, version, isLegacy,
sources, compendiumId, sourceId, sourceCategory}` and `flags.monsterMunch.*`
  (`parser/DDBMonster.ts:269-288`); sourceId 6 = CoS, 5 = MM 2014, 147 = MM 2024, 232 = Ravenloft: The
  Horrors Within. No unique-NPC flag. Actor `_id` = namedIDStub(name, ddbId); `system.identifier` = name
  slug.
- `system.source`: `{book, page, custom, license}` from the highest sourceId; `rules` = "2014" when
  sourceId < 145, else "2024" (`parser/monster/source.ts:9-55`). Feature items copy source from an obsolete
  path, so only actor-level rules are reliable. dnd5e `SourceField` (`source-field.mjs:14-24`): `book,
page, custom, license, revision, rules`; `rules` is a free string defaulting from the world
  `rulesVersion` (modern -> "2024").
- Tokens/scenes/journals: `flags.ddbActorFlags`, `tokenLinkId`, `compendiumActorId`,
  `flags.ddbimporter.{source, ddbEntityId, metaTokenId}`; journals `flags.ddb.{ddbId, bookCode, slug,
contentChunkId, ...}`; scenes `flags.ddb.*` + `flags.ddbimporter.bookCode` (case varies). Tokens are
  unlinked, `actorId` = world actor; zip imports carry `delta.system/name/items/img`. Journal monster links
  become `@Compendium[<DDB pack>.<_id>]`; only zip imports with `adventure-policy-journal-world-actors`
  write `@UUID[Actor.<id>]` (`CompendiumLinkReplacer.ts:48-107`).
- Existing replace features: import-time only, setting `adventure-policy-use2024-monsters` ("Replace
  legacy monsters with latest versions? (Patreon only)"), mapping from a DDB proxy endpoint; the
  `MonsterReplacer` is not on the API. `updateWorldMonsters()` refreshes world NPCs by name +
  `flags.ddbimporter.id` (`muncher/tools.ts:70-110`) and would revert a swap; its in-place pattern keeps
  `_id`, folder, sort, ownership (`tools.ts:16-68`).
- API: `globalThis.DDBImporter` === module api (`api.ts:363-372`): `updateWorldMonsters()`,
  `DDBSelectiveMonsterUpdate`, `parse.monsters(ids)`, `lib.DDBMonsterFactory`, `lib.DDBMonster(...,
{forceRulesVersion})`, `lib.DDBAdventure.AdventureImport(bookId, {..., use2024monsters})`,
  `generateAdventureConfig({full})`, `lib.NameMatcher`.
- Official content **[verified 2026-09-27 against the public manifests on r2.foundryvtt.com]**:
  - `dnd-monster-manual` 1.4.0: Foundry min 13 / verified 14, dnd5e min 5.3.3; packs `content`
    (JournalEntry), `actors` (Actor), `features` (Item), `tables` (RollTable); no Adventure pack; ids like
    `mmVampire0000000`.
  - `dnd-players-handbook` 2.2.0: Foundry 13 / 14, dnd5e min 5.1.9; packs `content, classes, origins,
feats, spells, equipment, tables, actors`.
  - dnd5e `module/module-registration.mjs:129-151` (`moduleRedirects`, identical in release-5.3.3 and
    6.0.5) maps the MM packs to `actors24/content24/monsterfeatures24/tables24` and the PHB packs to their
    `*24` SRD packs. New in 6.0.x: `json/official-content.json` sets `disabledSources`
    (`actors24, monsterfeatures24` for MM) so the SRD copies are hidden when the book is installed.
  - `dnd-ravenloft-horrors-within` 1.0.1 (`protected: true`): Foundry min 13 / verified 14, dnd5e min 5.3;
    no module dependencies; packs `book` (JournalEntry), `options`, `bastions`, `items` (Item), `tables`
    (RollTable), `actors` ("Bestiary") and `fallback-actors` ("Adventure Bestiary") (Actor), `scenes`
    (Scene), `adventures` (Adventure). dnd5e lists it only by name in `official-content.json` ("expanded")
    and has no redirects for it.
  - Rules values inside premium packs are not public: `system.source.rules` is baked into the pack data
    (dnd5e `source-field.mjs` only defaults it from the world `rulesVersion`). Read it at runtime with
    `getIndex({fields: ['system.source.rules', 'system.identifier']})` (feature 6 already does this).
- dnd5e packs: `dnd5e.monsters` (SRD 5.1, all 337 NPCs "2014"), `dnd5e.actors24` (SRD 5.2, all 380 NPCs
  "2024"). No built-in legacy-to-modern map; world setting `rulesVersion` (modern|legacy).

### A.4 DAE, Automated Conditions 5e, dnd5e statuses

- DAE (id `dae`): default branch v13 = 13.0.29 (Foundry 13, dnd5e 5.0 to 5.3.99); branch `v14` = 14.0.14
  (Foundry 14.365+); branch `dnd6` = 14.6.0, WIP, requires dnd5e 6.0+. `DAE` global ===
  `game.modules.get('dae').api` (`dae.ts:210-211`). `flags.dae.stackable` values `none, noneName,
noneNameOnly, multi, count, countDeleteDecrement` (`lib/stackingPolicy.ts:25,85`). `flags.dae.showIcon`
  deprecated (core `showIcon`); special durations migrate to core `duration.expiry` on v14. Not needed for
  plain `createEmbeddedDocuments`. Unverified: `applyActiveEffects` on the API object, full special-duration
  list.
- AC5e (id `automated-conditions-5e`): main 14.603.2 = Foundry 14.367+, dnd5e 6.0.0 to 6.1; `legacy-v5`
  14.533.19.3 = dnd5e 5.3.0 to 6.0.0. Detects conditions from core `actor.statuses` (`setpieces.mjs:581`,
  needs world setting `automateStatuses`). Frightened without an `origin` always gives disadvantage on
  attacks and checks; with an origin it requires sight of the origin's token (`setpieces.mjs:1056-1064`).
  Reads change keys containing `ac5e`/`automated-conditions-5e` from `effect.system.changes`.
- dnd5e statuses (6.0.5 vs release-5.3.3): static `_id = staticID('dnd5e' + id)` in both;
  `CONFIG.statusEffects` array in 5.3.3 (`dnd5e.mjs:430`) vs object keyed by id in 6.0 (`dnd5e.mjs:446-467`);
  6.0 `_fromStatusEffect` forces `type: 'condition'` (`active-effect.mjs:281-306`); `toggleStatusEffect`
  gains `options.levels` (`actor.mjs:3583-3598`). Exhaustion 5.3.3: `system.attributes.exhaustion` +
  `flags.dnd5e.exhaustionLevel`; 6.0: level on the condition's `system.level`, attribute derived, updates
  still synced. `system.abilities.<a>.bonuses.save` redirects to `...save.roll.bonus` in 6.0
  (`active-effect.mjs:18, 515-528`). dnd5e does not automate frightened itself (AC5e does). In 6.0 effect
  origins move to `system.origin.*`.

### A.5 Foundry core facts used by this plan

- Query handler signature: v13 `(queryData, {timeout})`, sender looked up but not passed
  (13.351 `client/documents/collections/users.mjs:199-211`); the 13.351 server only checks `QUERY_USER`
  and that the recipient exists, strips options to `{timeout}` and stamps its own sender id. Sender passed
  since 14.352 (release notes, foundryvtt#13418) **[verified]** as `{timeout, user}` with a User document
  **[partly verified]**; the v14 API docs and typings 14.366.0 still show the old signature.
- `QUERY_USER` **[verified, v14 API]**: `{defaultRole: PLAYER, label: 'PERMISSION.QueryUser', hint:
'PERMISSION.QueryUserHint', requiredRoles: [ASSISTANT, GAMEMASTER]}` (requiredRoles since 14.349,
  #13296); English label "Query Users" **[partly verified]**.
- `game.world` is a `World` package (`DataModel`), not a Document: no `setFlag`/`getFlag`/`update`
  **[verified, v14 API]**.
- Setting scopes: client, world, user; world and user settings reach every client; `restricted` exists only
  on `registerMenu`.
- v14 scene lighting fields unchanged (`environment.darknessLevel`, `darknessLock`, `cycle`, `base`,
  `dark`, `globalLight.{enabled, bright, alpha, color, coloration, luminosity, saturation, contrast, shadows,
darkness.{min,max}}`) **[verified]**.
- Scene Levels **[verified, 14.353/14.354/14.359/14.368 notes + API]**: `Scene#levels` (embedded Level
  documents) and `Scene#initialLevel` (default the first Level); Level holds `background {src, tint,
alphaThreshold, color}`, `foreground`, `fog`, `elevation {bottom, top}`, `textures`, `visibility.levels`;
  Token `level` (one id, default `defaultLevel0000` = `BaseScene.metadata.defaultLevelId`, the
  auto-created first level **[partly verified]**); Note/Wall/Tile/Region/AmbientLight/AmbientSound/Drawing
  `levels` (set of ids, empty = every level **[partly verified]**). Set them explicitly.
- MeasuredTemplate removed in 14.352 (#13089; 14.356/14.359 notes); templates are Regions created with
  `scene.createEmbeddedDocuments('Region', [...])` (`shapes` of type circle/cone/line/rectangle/ring/
  emanation), Region-layer template mode (#13508), `RegionLayer#placeRegion(s)` (#13536, 14.357); template
  regions default to always visible (14.360, #14166) **[verified]**.
- `-=key` deletions give way to `_del` (old keys work until v16); `temporary: true` creates removed; jQuery
  still shipped.

---

## Appendix B: further feature ideas (ranked by value vs effort)

Module coverage was checked against each module's released manifest on GitHub/GitLab (foundryvtt.com was
blocked). "v14" = verified for Foundry 14.

| Rank | Idea                                                                                                                                                                                                   | Effort | Existing module coverage                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Safety tools to AI guardrails**: read lines and veils from the table's safety module and inject them into the co-GM's system prompt; an X-card tap pauses auto-commentary and flags the GM.          | S/M    | `consent-form` 3.2.2 (v14.365; lines/veils, X-card, pause) and `safety-and-communication` 1.0.0 (v14; X/N/O cards) cover the table side; none feeds an AI. `safety-tools` is max v13. |
| 2    | **Handout and image reveal queue**: pre-stage handouts per scene, reveal to chosen players in one click, add them to the /player allowlist, keep a per-player "seen" log.                              | S      | `share-media` 3.14.3 (v14, has a JS API), Monk's Enhanced Journal 14.01, `niks-show-and-tell` (v14) do the sharing; nothing keeps a seen log or feeds a server-filtered view.         |
| 3    | **NPC improv cards**: for NPCs on the active scene, the co-GM drafts voice, mannerism, want and secret from the actor biography plus attitude data (GM-only), within lines and veils.                  | S      | `intelligent-npcs` 1.14.1 and `npc-narrator` (v14) do NPC chat, not GM-facing cards tied to attitudes.                                                                                |
| 4    | **Moon and calendar cues**: surface Calendaria notes, moon phases and upcoming dates in the dashboard and AI context (night, full moon, festival dates you entered).                                   | S      | Calendaria covers notes and moons; integration only.                                                                                                                                  |
| 5    | **Ireena and companion panel**: where Ireena is, her attitude, Strahd's interest (attention), risk suggestions, relationships.                                                                         | S      | none specific.                                                                                                                                                                        |
| 6    | **Horror pacing meter**: time since the last scare, combat, social beat or rest from the event feed; suggests a tension beat (sound sting, light flicker, a private whisper) when the table goes flat. | S/M    | `tension-pool-2` (v14, visible dice pool), `fxbus`, Sequencer provide effects; none measures pacing from live data.                                                                   |
| 7    | **Strahd letters and invitations**: the co-GM drafts letters in Strahd's voice from your bullet points (never adventure text); preview, then publish as a handout; GM-only log of what was sent.       | M      | no NPC-letter module on v14 (`console`, `lame-messenger` are chat styles; `ephemera` unconfirmed).                                                                                    |
| 8    | **Session prep digest**: GM-only prep checklist from the recap, attention hot spots, upcoming calendar events, attitude shifts, unrevealed Tarokka positions near the party's route.                   | M      | `campaign-builder` 1.10.6 (v14.365) supports manual planning; nothing builds prep from live data.                                                                                     |
| 9    | **Private visions (Dark Powers)**: one action sends one player an image, a sound and a screen distortion, logged in the vault; avoids text whispers, which reach every client.                         | M      | `perceived-reality` 1.1.0 (v14, per-player perception), Sequencer `.forUsers()`, `share-media`; no one-action combination.                                                            |
| 10   | **Dark Gifts tracker**: each PC's Dark Gift feats from the official Ravenloft module, their drawbacks and triggers, GM notes, AI reminders when a trigger appears in the feed.                         | M      | the official module provides the feats; no tracker for triggers.                                                                                                                      |
| 11   | **Strahd social visit planner**: schedule appearances keyed to attention thresholds and calendar dates (dinner invitation = letter + scene prep + mood preset + NPC cards).                            | M      | none.                                                                                                                                                                                 |
| 12   | **Conditional encounters for Barovian nights**: your own RollTables filtered by time, weather, region and attention; preview, then place tokens with existing tools.                                   | M      | core RollTables, `roll-table-importer`, `gm-only-tables` (v14); `better-rolltables` is max v12; nothing conditional on v14.                                                           |
| 13   | **Death and replacement characters**: death log (cause, session), next-PC queue with Barovia-native hooks, ownership transfer with existing tools, onboarding handout.                                 | M      | `party-overview`, `blind-death-saves` (v14); no replacement or graveyard module.                                                                                                      |
| 14   | **Travel and the Mists**: travel legs between locations with `travel-pace` estimates, calendar advance on confirm, conditional encounter roll, Mists mood preset, attention for night travel.          | L      | `travel-pace` 5.3.1 (v14.367), `morelord-journeys` (v14.368), `expedition-tracker`; nothing handles the Mists or links travel, calendar, weather and encounters.                      |

Ideas recorded by the GM for later: Obsidian integration and Craig voice recording + voice-to-text
(section 10).
