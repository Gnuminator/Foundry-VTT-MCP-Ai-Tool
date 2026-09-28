---
name: foundry-ai-tool
description: Use and test this repo's own product on the local test server - the MCP bridge tools (calling them through the co-GM dashboard API), guarded writes (plan / apply / undo, feature switches, conflicts), the co-GM dashboard (tool runner with pickers, Recent Changes, Tarokka drawer, /player view, player/GM split), the bridge vault and the session log - and run the M0+M1 smoke checklist. Use before calling an AI Tool feature done, when reproducing a tool bug, or when checking what players can see. Needs the environment from foundry-test-env; Foundry's own UI is in foundry-core-ui.
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
- Destructive plans (deletes, Tarokka reveals) need the second confirmation.

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
- `/player`: the player page. Only with the split on is it served as the player role; in local
  mode it is GM data.

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

Clean up afterwards when the change is not wanted in the test world (undo from Recent Changes,
switch features back off if the test needs them off).
