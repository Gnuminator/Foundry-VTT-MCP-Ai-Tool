# Usage log (I-084, lane 3, 2026-09-30)

Which controls of the dashboard, the `/player` page and the Foundry module people use, and which
they never use. Local only (bridge vault), GM Obsidian vault only. Contract: `shared/src/usage.ts`.

## Events

`UsageEvent` (see the contract): `kind` is `view` (with visible `durationMs`), `action`, `tool`
(dashboard tool runner, `outcome`, `code`), `shortcut` or `error` (`code` only). `name` is a fixed
control name: `dash.*`, `tool.<tool-name>`, `player.*`, `module.*`. Never typed text, tool
arguments, setting values, document ids or error messages. `sanitizeUsageEvent` drops every other
field.

## Paths

- **Dashboard and `/player`:** `public/usage.js` (loaded by both pages) sends batches every 15 s, at
  50 events, or on `pagehide` (`sendBeacon` with `?token=`). `POST /api/usage` (GM: `requireGm`, the
  server sets `surface: dashboard`, `who.role: gm`) and `POST /api/player/usage` (any resolved role;
  the server forces `surface: player`, `player.*` names, no `tool` kind; the claimed `userId` must be a
  known non-GM user, else `who` is unknown). No read route for players. The dashboard forwards to the
  bridge with the control method `record_usage` (`{events}` → `{accepted, dropped}`); an old backend
  answers "Unknown method" and the dashboard logs one warning and drops the batch. The stdio wrapper
  never forwards `record_usage`, so Claude's tool list (91) and context are unchanged.
- **Player name pick:** `GET /api/player/names` lists non-GM users (union of non-GM `activeUsers`
  from `get-world-info` seen since the dashboard started). `player.js` asks once, stores the pick in
  `localStorage` (`cogm_player_who`), and shows a "not you?" link.
- **Foundry module:** `usage-recorder.ts` (like `play-recorder.ts`): a 2,000-record buffer on the GM
  client, `clientId` per page load, `seq`. Every client batches its own events every 10 s over
  `game.socket.emit('module.foundry-mcp-bridge', {type: 'usageEvents', userId, events})`; the GM
  client's socket handler (in `main.ts`) sanitizes them and sets `who` from `game.users`. Socket emits
  do not return to the sender, so a GM's own events go straight into its buffer. The GM-gated query
  `foundry-mcp-bridge.getUsageRecords` returns them in the `PlayRecordsResponse` shape.
- **Bridge:** `usage-pump.ts` polls the module (cursor file like the play-log pump); `usage-log.ts`
  (`UsageLog.append(worldId, events)`) owns per-date dedupe by `key` and appends to
  `<dataDir>/<worldId>/sessions/<local-date>.usage.jsonl`, then triggers the Obsidian render. Events
  wait in memory (at most 5,000) while no world is known. `FOUNDRY_AI_USAGE_LOG=off` turns it off.

## Obsidian note

`AI Tool/Usage/Dashboard usage.md` in the GM vault (`obsidian/render-usage.ts`, model in
`stats/usage.ts`, loaded in `export.ts`, linked from `Stats/Campaign.md`): period and totals; most
used (top 20, uses, people); never used (catalogue minus names seen, by surface; tools never run);
per person (views, time on view, actions, tools, top 3); per session (`[[<date> S<NN>]]`, events
assigned by the play session's start and end); errors by name and code; unknown names.

## Catalogue

`scripts/usage-catalog.mjs` scans `data-track="..."` and literal `track*('...')` calls in
`packages/cogm-dashboard/public/*.{html,js}` and `trackUsage(kind, '...')` in
`packages/foundry-module/src/**/*.ts`, and writes `shared/src/usage-catalog.generated.ts`.
`npm run usage:catalog`; `--check` in CI fails on a stale file or a non-literal name.
`USAGE_ALIASES` in the contract maps renamed controls to their new names.

## Module controls instrumented first

Roll buttons on chat cards (`data-access/player-rolls.ts`), the Tarokka offer confirm and decline
(`tarokka.ts`), the enhanced-index settings menu (`settings.ts`), settings saved (the setting key
only, never the value), status toggles (`campaign-hooks.ts`), module error notifications.

## Live test

On the test server: GM dashboard actions, a tool run, a failing tool, the Tarokka drawer, a
shortcut; `/player` name pick and "not you?"; as Player in Foundry a roll button; as Claude the
module settings menu. Then: the day's `.usage.jsonl` has GM and player `who`, no typed text or
argument values, no duplicates after F5; `POST /api/usage` with the player token is 403 and no read
route exists; the MCP schema smoke test still lists 91 tools; the Obsidian note shows every section;
with `FOUNDRY_AI_USAGE_LOG=off` nothing is written.
