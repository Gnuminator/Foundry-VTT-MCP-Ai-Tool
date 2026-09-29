---
name: foundry-ai-tool
description: Use and test this repo's own product on the local test server - the MCP bridge tools (calling them through the co-GM dashboard API), guarded writes (plan / apply / undo, feature switches, conflicts), the co-GM dashboard (tool runner with pickers, Recent Changes, Tarokka drawer, /player view, player/GM split), the bridge vault and the session log - and run the M0+M1 smoke checklist, the M2 player-view checks and the Obsidian O4 mirror checks (notes, links, /open route). Use before calling an AI Tool feature done, when reproducing a tool bug, or when checking what players can see. Needs the environment from foundry-test-env; Foundry's own UI is in foundry-core-ui.
---

# Foundry AI Tool: tools, dashboard, smoke test

The environment (Foundry 14 on 30001, test bridge 31514-31516, dashboard 3100, vault
`C:\FoundryTest\vault`) comes from the `foundry-test-env` skill; start it first. Foundry's own
screens are in `foundry-core-ui`. Never the live bridge (31414-31416), never `mcp__foundry-mcp__*`.

## Calling tools

Through the test dashboard's REST API. In local mode (no `GM_DASHBOARD_TOKEN`) every caller is GM.
From the PowerShell tool (curl.exe quoting breaks JSON there):

```
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/tool -ContentType 'application/json' `
  -Body (@{ name = 'get-world-info'; args = @{} } | ConvertTo-Json -Depth 10)
```

The answer is `{ok, name, mutates, result}`; a tool error is HTTP 422 `{ok:false, error}`
(PowerShell throws: read `$_.ErrorDetails.Message`, or use `Invoke-WebRequest -SkipHttpErrorCheck`).

- Reads (`get-/list-/search-/measure-/plan-/suggest-` and a few more) need nothing else.
- Writes need GM Actions on: `POST /api/control {"action":"set-gm-actions","value":true}`. The
  switch lives in the dashboard's memory: **a dashboard restart turns it off again.**
- Writes need `"confirm": true` in the body, destructive ones also `"confirmDestructive": true`
  (412 `confirm-required` / `confirm-destructive-required` otherwise). For `apply-planned-change`
  and `undo-change` the flags come from the body only, never from `args`.
- With the player/GM split on (`GM_DASHBOARD_TOKEN` set when starting the dashboard), send the GM
  token as header `X-CoGM-Token`; without it `/api/tool` answers 403 `gm-required`. Don't put the
  token in a URL; to use the dashboard UI in the browser pane, run it in local mode.

## Guarded writes

Features plan with read-only `plan-*` tools; one generic `apply-planned-change` applies a plan;
`list-recent-changes` and `undo-change` follow. Plans live 15 minutes in the backend's memory
(a bridge restart drops them).

- In Foundry: "Allow Write Operations" (default on) and the feature's own switch, e.g. "AI Tool:
  Tarokka (writes)" (default off): Settings tab, Game Settings, category "Foundry AI Tool".
- Switch off: apply is refused for vault-only, mixed and Foundry-only plans ("The "tarokka"
  feature is switched off"). Undo does not need the feature switch.
- Conflict: anything that changed between plan and apply (a vault path or a document field)
  refuses the whole apply ("Conflict, nothing was written: ..."); check that nothing changed.
- Destructive plans (deletes, Tarokka reveals, page reveals and hides) need the second
  confirmation.

## Dashboard (http://localhost:3100)

- Header: GM Actions switch, **Tools** (tool runner), **Tarokka** drawer (GM only).
- Tool runner: search, then a form built from the tool's schema. Parameters that name something
  have **Pick…**: a filterable list of what exists now (tokens of the current scene with
  disposition, hidden flag and position; actors; journals; compendium entries by search; plans;
  changes; ...). Multi-select for list parameters; typing by hand still works. A red
  "same name ×N" means the tool matches by name and several share it. Candidates come from the
  read tool `list-ref-choices` (`{kind, filter?, parent?, query?}`), usable through the API too.
- Writes open a confirm modal (with the plan's diff for `apply-planned-change`); destructive ones
  need the "I understand" checkbox. The modal fades in: screenshot after ~1 s.
- Recent Changes pane: applied changes with **Undo**. Live Feed: session events and `gm-change`
  entries. Module Diagnostics: the GM client's captured console errors (kept in the browser's
  localStorage across reloads, so older entries from other sessions or users can show up).
- `/player`: the player page. It reads `/api/player/state` and `/api/player/stream`, which always
  project (M2), in local mode too and whatever token is presented. With the split on, the player
  role on `/api/state` and `/api/stream` gets the same projection; in local mode those two are GM
  data.

## Vault and session log

`C:\FoundryTest\vault\<worldId>\`: `gm\audit.json` (every apply and undo, with before values),
`gm\tarokka.json`, `gm\tarokka-config.json`, `gm\reveals.json`, `sessions\<date>.jsonl` (the
backend's copy of the session events, written only when there are events) and
`sessions\pump-state.json`. GM-only; never shown to players.

## Smoke checklist (M0 + M1)

Last full pass: 2026-09-28, all green (see CLAUDE.md). For each item record evidence.

1. Bridge connects (notification "MCP Bridge connected successfully"); `get-world-info` returns
   `ai-tool-test`.
2. Query lockdown: join as `Player` in a second tab on `http://127.0.0.1:30001` (separate cookies;
   open it with `tabs_create` + `navigate`, not `preview_start`). In its console,
   `await game.users.activeGM.query('foundry-mcp-bridge.getWorldInfo', {})` fails "not
   registered"; `foundry-mcp-bridge.gm.tarokkaReading` fails "helper queries are GM-only".
3. Guarded write: `plan-tarokka-import {"source":"builtin-roll"}`, `get-planned-change`, apply
   (refused without confirm; flags in `args` do not count), `list-recent-changes`, `undo-change`
   (destructive class). After undoing the first import, `get-tarokka-reading` says no reading.
4. Same through the dashboard UI: Tarokka drawer, New reading, confirm modal, Recent Changes, undo.
5. Switch off: apply refused for a links plan, a reveal plan and a Foundry-only re-reveal; undo
   still works. Switch back on.
6. Conflict: plan, change the same target (vault: apply a second plan on the same path; Foundry:
   edit the page in its sheet), apply the first: refused, vault hashes and page unchanged.
7. Reveal: `plan-tarokka-reveal` + apply (destructive). As Player, the "Tarokka reading" journal
   shows only the typed text; no card names or ids anywhere in the Player client's data.
8. `/player` has no card data: scan HTML, `player.js`, `/api/state` and a few seconds of
   `/api/stream` for the vault's card names and ids, in local mode and with the split on.
9. Session log: `gm-change` events in `sessions\<date>.jsonl` without card names.
10. Pickers: `list-ref-choices` for token, actor, module (with and without `includeSystem`),
    plan, change, skill; in the UI, pick a pack and an entry for `create-actor-from-compendium`.

## Player view checks (M2)

Last full pass: 2026-09-28 (see `docs/design/CURSE-OF-STRAHD-PLAN.md` "M2 as built"). The proof is the
canary suite (`packages/cogm-dashboard/src/player/canary.test.ts`); this pass checks the real
Foundry data behind it.

Setup:

- Start with the split on: generate a throwaway token into a scratchpad file and set
  `GM_DASHBOARD_TOKEN` from it **in the same PowerShell call** as `start.ps1` (or
  `start.ps1 -Only dashboard`); every restart needs it again, and GM Actions go off on restart.
  Keep the token out of commands you echo, URLs and chat. `/api/health` shows `splitEnabled`.
- First check the module loaded: Foundry's console must have no "Failed to resolve module
  specifier" error, and `get-world-info` must answer.
- Test data (GM console, revert afterwards): the scene's `navName`; a disguised token (rename
  `Wolf 1`, display mode Hover = 30); a hidden token (`Wolf 2`, its combatant NOT hidden); combat
  with all tokens; core statuses (`toggleStatusEffect`) plus one custom effect with its own status
  id.

Checks:

1. `/api/player/state` and the `/player` page: scene = `navName` ("Current scene" without one);
   tracker names = PC name, the disguise, "Unknown creature" for a name players cannot see, the
   hidden token absent; core conditions only; HP numbers for the PC only.
2. Feed: roll initiative (`game.combat.rollAll()`), an attack from the disguised token, one from
   the world actor's sheet (its chat alias is the true name), a GM-mode roll (`{rollMode: 'gm'}`),
   damage to the disguise and the PC. Expect the disguise's name on its lines (never the true
   name), no line for a creature players cannot name, no GM roll, "was hit." without numbers for
   NPCs, numbers for the PC.
3. Canary scan: `/api/player/state`, `/api/state` and a few seconds of `/api/player/stream` and
   `/api/stream` without a token, `/player`, `player.js` (its `es.onerror` is not a hit), in both
   modes; also `/api/player/state` WITH the GM token (still projected). Canaries: true names, the
   true scene name, the custom effect, the world id, GM user names, card names and ids, the token.
4. Handouts: a journal at ownership None with a text page (a `section.secret`, a `@UUID` link to a
   second page, an inline roll, an `onerror` image). Turn on "AI Tool: Handouts (writes)" (feature
   off: apply refused). `plan-page-reveal` reveal: refused while no player can open the journal.
   Set the journal to Observer and its pages to None, reveal again, apply (destructive): the
   Handouts section shows the page without the secret, the link (label too), the roll or the
   handler; as `Player` (second origin), the journal is listed and the page opens. Hide (also
   destructive): ownership back, the entry gone from `gm\reveals.json`, the page gone in both
   places. `undo-change` works on either.
5. Whisper guard: with a reading in the vault (`plan-tarokka-import` builtin-roll, Tarokka switch
   on), `POST /api/post-chat` with a card name in a sentence (any case) answers 409
   `secret-terms`; with `allowSecrets: true` it posts; plain text posts; without the GM token 403.
   The GM page's confirm prompt is only on AI commentary cards (needs `ANTHROPIC_API_KEY`), and
   `app.js` is an ES module, so its functions cannot be called from the console.

Gotchas: Foundry's page cannot `fetch` the dashboard (no CORS), so read player state from
PowerShell. Foundry itself gives players every non-hidden combatant's name; `/player` is stricter.
Cleanup: undo the Tarokka import, delete the test journal and combat, revert token names, display
modes, hidden flags, statuses, HP and `navName`, switch both features off, **Return to Setup**,
`stop.ps1`.

## Obsidian checks (O2)

The test bridge renders into the throwaway vault `C:\FoundryTest\obsidian` (`ObsidianDir` in
`scripts/test-env/config.ps1`; never the GM's vault). Notes land in
`Campaigns\ai-tool-test\AI Tool\` a few seconds after a change.

1. Dashboard header: **Start session**, expect "Session since HH:MM" and a new
   `AI Tool\Sessions\<date> S<NN>.md` (`started_by: marker`); **End session** closes it
   (`ended_by: marker`). `get-play-session` via the API agrees.
2. A game event (e.g. `apply-damage-and-healing` 1 damage with GM Actions on, then off again) shows
   up in the open session note within ~10 s.
3. Edit a generated note by hand, then run
   `FOUNDRY_AI_DATA_DIR=C:\FoundryTest\vault node packages/mcp-server/dist/obsidian-cli.js export ai-tool-test --vault C:\FoundryTest\obsidian`:
   the note is untouched and listed under "Skipped" in `AI Tool\_status.md`.
4. With the split on (`GM_DASHBOARD_TOKEN` set when starting the dashboard): `/api/state` and
   `/api/stream` without the token carry no `obsidian` data and no world id; `mark-play-session`
   answers 403.
5. No generated file contains a literal `<%` (Templater tags from game text are written `&lt;%`).

Clean up afterwards when the change is not wanted in the test world (undo from Recent Changes,
switch features back off if the test needs them off).

## Play log checks (O3)

The recorder runs on the GM client only and writes through the backend pump; its copy lands in the
vault a few seconds after each event. `FOUNDRY_AI_PLAY_LOG=off` disables the pump for a run that
should not be logged.

1. Set up a fight: a PC token and one or more NPC tokens on a scene, start combat.
2. Roll a mix of rolls covering each Foundry v14 message mode: public, GM (`gm`, the old
   "gmroll"), blind and self; a hand roll's dnd5e message config takes
   `{ rollMode: 'public' | 'gm' | 'blind' | 'self' }`.
3. Exact-credit check: target a token, roll damage, click **Apply** on the chat card.
4. Also apply at least one HP change with no matching roll (e.g. `apply-damage-and-healing` from
   the dashboard) to see the "no source" path, and one that fits a fresh roll but was not applied
   from its card, to see the "guess" path.
5. Run `manage-rest` once for a rest that produces no chat card, to exercise the
   `dnd5e.restCompleted` fallback.
6. `advance-combat-turn` through a round or two, then end combat.
7. Check the play log, `C:\FoundryTest\vault\ai-tool-test\sessions\<date>.play.jsonl`: each
   record's `kind` and `userName`; for hp records, `source` (`source.exact: true` only for the
   Apply-button record from step 3, not for the guess from step 4); `combat-start`/`combat-end`
   carry `data.roster`.
8. Check the session events, `sessions\<date>.jsonl`: public rolls are `roll`/`damage-roll` events
   with a player-safe `description` and `details.breakdown` for the GM's full line; the GM/blind/
   self rolls from step 2 are `gm-roll` events instead.
9. `/player` with the split on (see "Calling tools" above): the feed shows only the public
   `roll`/`damage-roll` descriptions, no `details`, and none of the `gm-roll` events.
10. Once the Obsidian render catches up, check the session note's stats properties and roll
    breakdowns under
    `C:\FoundryTest\obsidian\Campaigns\ai-tool-test\AI Tool\Sessions\<date> S<NN>.md`.

## Obsidian mirror checks (O4)

Last full pass: 2026-09-29, all green (`docs/design/OBSIDIAN-PLAN.md` "As built", O4). Gotchas from that
pass:

- Deletes need a reconcile: reload the Foundry page (a new client) and wait about 20 s, or wait for
  the 10-minute reconcile.
- From PowerShell, call the dashboard at `127.0.0.1`, not `localhost`: `localhost` tries IPv6 first
  and adds about 2 s per request, so 11 opens never fit in the rate limit's 10 s.
- The test bridge logs nothing to a file unless `LOG_FILE_PATH` is set; use `get-obsidian-mirror`
  (`status.lastError`, `skipped`, `errors`) and `Foundry\_status.md` instead.
- Hand-made test data needs its own cleanup list (ids in a scratchpad file); a PC created by script
  has `hp_max: 0` unless HP is set.

The mirror writes Foundry notes into the throwaway vault `C:\FoundryTest\obsidian` (never the GM's
vault) under `Campaigns\ai-tool-test\AI Tool\Foundry\`. It needs `FOUNDRY_AI_OBSIDIAN_DIR` (set by
`start.ps1`), the switch "AI Tool: Obsidian mirror (writes)" (module settings, default off) and the
mirror settings `enabled: true`. `start.ps1` sets `FOUNDRY_AI_OPEN_BASE=http://localhost:3100`.

1. `get-obsidian-mirror`: `enabled: false`, `vaultDirSet: true`, `openBase` as above.
2. Switch the feature on (GM console: `game.settings.set('foundry-mcp-bridge',
'feature.obsidian-mirror.enabled', true)`), then `plan-obsidian-mirror {"enabled": true,
"textFolderIds": ["<test journal folder id>"]}` and `apply-planned-change` (GM Actions on,
   `confirm: true`). With the switch off the apply is refused.
3. Within ~10 s: notes in `PCs\`, `NPCs\`, `Scenes\`, `Journals\`, `Items\`, the six bases in
   `AI Tool\Bases\`, `AI Tool\Foundry\_status.md`. Test Hero is `type: pc` (`player: Player`), Wolf
   `type: npc` with `player_name: "Unknown creature"` when its prototype token hides the name; a
   scene without `navName` has the "Players see the true name" warning.
4. Opted-in journal: page notes in `Journals\<journal>\`; `@UUID` links became relative links to
   the notes, a compendium link points at `/open?uuid=`, `section.secret` is a collapsed
   `[!secret]-` callout, `[[/r ...]]` is inline code, `javascript:` links are plain text, no `<%`.
   A journal that is not opted in has an index note only: its page text appears nowhere in the vault.
5. Rename an actor in Foundry: same file, new H1, `name` and `aliases`. Delete a journal: its
   notes move to the vault `.trash\`. Edit a mirror note by hand: it is skipped and listed in
   `Foundry\_status.md`. Raise a page and its journal to Observer for Player: `player_visible: true`
   within one poll.
6. `/open` (split on): `GET /open?uuid=...` is 200 for anyone and never calls the bridge;
   `POST /api/open` without a token 401, with the player token 403, `?token=` alone 401, without
   `X-CoGM-Request: open` 403, with the GM token 200 (the sheet opens on a GM client), the 11th
   within 10 s 429. An `OPTIONS` preflight from `app://obsidian.md` gets no
   `Access-Control-Allow-Origin` (the P1 plugin adds that later).
7. Cleanup: `plan-obsidian-mirror {"enabled": false}` + apply (or undo), switch the feature off,
   delete the test journals and items, revert renames, and empty the throwaway vault's
   `Campaigns\ai-tool-test\AI Tool\Foundry\` if the next test should start fresh.
