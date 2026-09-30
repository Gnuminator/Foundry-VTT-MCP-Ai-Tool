# Link reliability (lane 1, 2026-09-30)

Fixes the push-back blockers PB-01 (small part), PB-02, PB-03, PB-04, PB-06 (PC part), PB-07 and
PB-24 before the tool moves to the Orange Pi. Answers and reasoning: vault
`Dev/Foundry AI Tool/Questions/Push-backs/`.

Contracts (locked, in `shared/`): `ModuleHelloFrame` (`protocol.ts`) and `GuardedApplyOutcome`
(`guarded-write.ts`).

## PB-02: one bridge user

Today every GM browser dials the bridge. The backend keeps the first socket and ignores the rest;
when that first one closes, the others stay connected but are never used, so the link reads as
down until someone reloads.

- **Module:** a world setting `bridgeUserId` (String, default `''`, shown in the module settings as
  a choice of the world's GM users plus "Any GM (first to connect)"). When it is set, only that
  user's browser starts the link; other GMs skip it silently (one console line). When it is empty,
  every GM connects as today. Right after the link opens, the module sends a `module-hello` frame.
- **Backend (`foundry-connector.ts`):** keep every open module socket. The active one is chosen in
  this order: the socket whose hello says `isBridgeUser: true`, else the newest open socket. When
  the active socket closes, promote the best remaining open socket instead of going dark. Queries
  pending on the closed socket are still rejected. `getConnectionInfo()` adds `userName`,
  `moduleVersion`, `sockets` (count). Hello frames from older modules never arrive; that must work.

## PB-03: reconnect forever, no world writes

- **Module `socket-bridge.ts`:** no attempt limit. Backoff 1 s, 2 s, 4 s ... capped at 30 s, plus
  up to 20 % random jitter. One reconnect timer at most (error and close both fire on a failed
  connect today). The cap and "forever" hold for WebSocket and WebRTC.
- **Module `main.ts`:**
  - `start()` must never leave an old `SocketBridge` running: reuse the existing one (call its
    `connect()`) or `disconnect()` it before creating a new one. Today `canvasReady` and the
    settings-close hook create a second bridge with its own reconnect timer.
  - The heartbeat no longer restarts the bridge (the socket bridge owns reconnecting) and never
    turns `autoReconnectEnabled` off.
  - Connection state and last activity live in memory only. Remove the `setSetting` calls for
    `lastConnectionState`, `lastActivity` and `lastMCPServerNotification` (keep the registrations so
    old worlds load; mark them deprecated in a comment). The "MCP server not found" notice is
    throttled in memory (once per 10 minutes per browser).
  - `autoReconnectEnabled` still means something: when off, the socket bridge does not reconnect
    after a drop (manual reconnect from the settings panel).
- **Cost:** a reconnect is one local TCP attempt at most every 30 s. No AI, no API, no world writes.
- **Telling the user:** the backend tracks `linkDownSince` (ISO time, null while connected) and logs
  one warning when the link has been down 5 minutes and one info line when it is back
  (`link-down` / `link-up`, the hook the Discord bot will use later). The dashboard status carries
  `foundryDownSince`; `public/app.js` shows a banner above the panels when Foundry has been
  unreachable for 2 minutes or more: "Foundry is not connected to the bridge since HH:MM. Open
  Foundry in the bridge user's browser, or reload that tab."

## PB-04: slow writes keep their undo

- **Backend `foundry-connector.ts`:** `query(method, data, options?: { timeoutMs?: number })`,
  default 10 s as today. Callers that write pass a longer timeout.
- **Backend `guarded-write/service.ts`:** `executeInFoundry` uses 120 s. When the apply query fails
  with a timeout or "Connection closed", call `foundry-mcp-bridge.guardedApplyOutcome` every 5 s for
  up to 120 s (also across a reconnect):
  - `applied`: use `result` as if the apply had answered (so the audit entry and undo are written);
  - `failed`: throw its error;
  - `in-progress`: keep asking;
  - `unknown`, or still nothing after 120 s: throw "The change may or may not have been applied in
    Foundry (no answer within N s). Check Foundry before planning it again." and log it as an error.
- **Module `data-access/guarded-write.ts`:** remember the last `GUARDED_OUTCOME_MEMORY` (50) applies
  in a module-level Map keyed by changeId: `in-progress` when `applyGuardedOps` starts, then
  `applied` with the result or `failed` with the message. New handler
  `foundry-mcp-bridge.guardedApplyOutcome` in `queries.ts`, GM-gated like the other guarded handlers.

## PB-01 (small part): a bridge address and no silent spawn

`packages/mcp-server/src/index.ts` (the Claude Desktop wrapper) reads `MCP_CONTROL_HOST` (default
`127.0.0.1`) and `MCP_CONTROL_PORT` (default 31414), the names the backend already uses, plus
`MCP_NO_SPAWN=1`. It never spawns a backend when `MCP_NO_SPAWN=1` or when the host is not a loopback
address. Then a missing bridge gives every tool call this error: "The Foundry AI Tool bridge is not
reachable at HOST:PORT. Start it (or check the address) and try again." `list_tools` returns an
empty list as today. Documented in `docs/dev/` and in `.env.example` when lane 2 lands.

## PB-07: CI on every branch

`.github/workflows/ci.yml`: `push` on all branches (`branches: ['**']`), `pull_request` to main, plus a
job `build-test-arm` on `ubuntu-24.04-arm` with Node 24 (free for public repos). Concurrency group
per ref so a new push cancels the old run.

## PB-24: scripted live round trip

`scripts/live-roundtrip.mjs` against the local test server only (dashboard 3100, test bridge 31514):
refuses any other port. Through the dashboard's tool API it plans a harmless guarded change with an
existing guarded tool (for example a handout reveal of a test journal page; the script creates what
it needs in the test world and cleans it up), confirms it, checks it through a read tool, undoes
it, checks it is gone, and prints a pass/fail line per step. Exit code 0 only when every step passed. Merges of lanes that
touch the link or guarded writes need it green. It needs the test environment running
(`scripts/test-env/start.ps1`); the script says so when it cannot reach it.

## PB-06 (PC part): weekly bridge-vault backup

`scripts/backup/backup-bridge-vault.ps1`: zips the bridge vault folder into
`%USERPROFILE%\Documents\Foundry AI Tool backups\bridge-vault-YYYY-MM-DD.zip`, keeps the newest 8,
and `-Register` creates a Windows scheduled task (weekly, "run as soon as possible after a missed
start") under the current user. It reads the vault path the same way the backend does. It never
runs `-Register` by itself.
