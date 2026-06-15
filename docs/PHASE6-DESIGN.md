# Phase 6 Design — Standalone Bridge + Remote Access + Player/GM Split

> **Framework, not deployment.** This document captures the Phase 6 target architecture,
> what has been built or templated, every "plug your infra in here" seam, and the setup
> checklist to run when the hosting infrastructure (Cloudflare account + VPS/Pi + hosted
> Foundry) is actually in hand. For the step-by-step cloudflared walkthrough, see
> `docs/REMOTE-ACCESS.md` (the companion tutorial, templated this session).

---

## 1. Goal

Make the Foundry AI Tool usable by you **and** your GM from anywhere, without leaving a PC
running and without exposing any home IP address or credentials to the internet. Concretely:

- The bridge (MCP backend) runs on an always-on host (Raspberry Pi or cheap VPS) and is
  decoupled from Claude Desktop entirely — it is a long-lived supervised process, not
  something Claude Desktop spawns.
- The co-GM dashboard is the only surface reachable from the internet, and it is fronted by
  **Cloudflare Tunnel + Cloudflare Access** (email allow-list) so only you and your GM can
  reach it. No port-forwarding, no public home IP.
- The player/GM role split is enforced **server-side** in the dashboard's SSE stream and REST
  layer: a player sees public combat order and a filtered event feed; the GM sees everything
  plus the write surface. Filtering is not done in CSS; it cannot be bypassed by a hostile
  browser.
- The Anthropic API key and GM token never leave the server.

---

## 2. Target Architecture

```
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  Hosted Foundry VTT (Forge / VPS)                                            │
  │  foundry-mcp-bridge module (dials OUT to the bridge host)                    │
  └──────────────────────┬───────────────────────────────────────────────────────┘
                         │ WebSocket ws://bridge-host:31415/foundry-mcp
                         │   — or —
                         │ WebRTC offer POST http://bridge-host:31416/webrtc-offer
                         ▼
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  Always-on host (Pi / VPS) — loopback-only except for the Foundry link       │
  │                                                                              │
  │  ┌──────────────────────────────────────────────────────┐                   │
  │  │  mcp-server backend (standalone.js)                   │                   │
  │  │  control channel  127.0.0.1:31414  (JSON-lines TCP)   │                   │
  │  │  Foundry link     :31415 WS  /  :31416 WebRTC          │                   │
  │  └──────────────────┬───────────────────────────────────┘                   │
  │                     │ JSON-lines TCP (loopback)                              │
  │  ┌──────────────────▼───────────────────────────────────┐                   │
  │  │  cogm-dashboard (server.ts)                           │                   │
  │  │  HTTP + SSE  127.0.0.1:3000  (dashboard + /player)   │                   │
  │  │  Anthropic API key — server side only                │                   │
  │  └──────────────────┬───────────────────────────────────┘                   │
  │                     │ only port 3000 is tunneled                             │
  │  ┌──────────────────▼───────────────────────────────────┐                   │
  │  │  cloudflared (Cloudflare Tunnel)                      │                   │
  │  │  routes cogm.yourdomain → http://localhost:3000       │                   │
  └──┴──────────────────┬───────────────────────────────────┴───────────────────┘
                        │ TLS, Cloudflare edge
  ┌─────────────────────▼───────────────────────────────────────────────────────┐
  │  Cloudflare Access (email allow-list)                                        │
  │  Injects  cf-access-authenticated-user-email  on every request               │
  └──────────┬──────────────────────┬────────────────────────────────────────────┘
             │  GM email matches    │  Any other authenticated user
             ▼                     ▼
  ┌──────────────────┐   ┌──────────────────────────────────┐
  │  GM browser      │   │  Player browser (or GM on /player)│
  │  / (full view)   │   │  /player  (read-only view)        │
  │  role = 'gm'     │   │  role = 'player'                  │
  └──────────────────┘   └──────────────────────────────────┘
```

The control channel (31414), Foundry WebSocket link (31415), and WebRTC signaling (31416)
all stay **loopback-only** on the host. The tunnel exposes **only port 3000**. Claude
Desktop (if still used) connects to the bridge's control channel on 31414 exactly as
before — it can coexist with the standalone process, but should not bind the same port at
the same time (both would race for the singleton lock; see the lock note in §4).

For the internals of each component — query dispatch, control-channel protocol, Foundry
link transports, GM-gating, the job queue, the co-GM AI layer — see `docs/ARCHITECTURE.md`.
This document focuses on the _topology seams_, not the per-component internals.

### "Where the bridge lives" evolution

| Stage                      | Bridge lives                         | Dashboard lives | Remote access              |
| -------------------------- | ------------------------------------ | --------------- | -------------------------- |
| Phase 5 (today)            | Claude Desktop spawns it             | your PC         | localhost only             |
| Phase 6-A (built)          | standalone process (`standalone.js`) | same PC or Pi   | localhost or tunneled      |
| Phase 6 target (templated) | Pi/VPS supervised process            | same Pi/VPS     | Cloudflare Tunnel + Access |

---

## 3. Status Table

| Piece                                                                                                                                                                                                                                                  | Status                                                | Where                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dep-security prereq** — werift 0.17→0.23, ws, axios, MCP-SDK bumps                                                                                                                                                                                   | **BUILT** (v0.16.1 queued, pending live werift smoke) | `docs/DEPENDENCY-PATCH-SMOKE-TEST.md` — user-driven checklist                                                                                                      |
| **2-A — Standalone bridge** — `standalone.ts` entrypoint, `standalone-config.ts`, `control-ping.ts`; env seams in `backend.ts`; npm scripts; Windows scaffold; CI smoke                                                                                | **BUILT**                                             | `packages/mcp-server/src/standalone.ts`, `standalone-config.ts`, `control-ping.ts`; `backend.ts` ll. 61–77; `deploy/windows/`; `scripts/standalone-smoke-test.mjs` |
| **2-B — Player/GM server-side split** — `auth.ts` role resolution, `redact.ts` filtering, `sse.ts` role-aware broadcast, `server.ts` `requireGm` middleware + role-filtered routes, `config.ts` auth/playerView config; unit tests + integration smoke | **BUILT**                                             | `packages/cogm-dashboard/src/{auth,redact,sse,server,config}.ts`; `src/{auth,redact}.test.ts`; `public/player.{html,js}`; `scripts/cogm-split-smoke-test.mjs`      |
| **2-C — Remote-access templates** — Cloudflare Tunnel config, Dockerfile, compose, deploy/VPS notes                                                                                                                                                    | **TEMPLATED**                                         | `docs/REMOTE-ACCESS.md`; `deploy/` (see that doc for detail)                                                                                                       |
| **2-D — This design/roadmap document**                                                                                                                                                                                                                 | **BUILT**                                             | `docs/PHASE6-DESIGN.md` (this file)                                                                                                                                |

> **"Templated"** means the scaffold and documentation exist but the actual infrastructure
> (Cloudflare account wired, VPS provisioned, hosted Foundry reachable) has not been
> stood up. The code paths are fully functional; the missing piece is the hosting
> environment.

---

## 4. Infra Seams Inventory

Every "plug your infra in here" point, with the default that makes things work locally today.

### Bridge / backend (`packages/mcp-server`)

| Env var                   | What it controls                                                                                                                                                                                                                                                          | Default                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `MCP_CONTROL_HOST`        | Control-channel TCP bind host                                                                                                                                                                                                                                             | `127.0.0.1` (loopback)                 |
| `MCP_CONTROL_PORT`        | Control-channel TCP bind port                                                                                                                                                                                                                                             | `31414`                                |
| `MCP_FOUNDRY_LINK`        | Set to `off` to disable the Foundry connector (31415/31416) and ComfyUI — control channel only. Used by the standalone smoke test and for testing against a mock bridge.                                                                                                  | _(unset = full backend)_               |
| `FOUNDRY_HOST`            | Hostname or IP the backend's WebSocket/WebRTC server advertises (the address the Foundry module dials). On localhost this is implicit; on a remote host the module must reach this address.                                                                               | `localhost` (from `config.ts`)         |
| `FOUNDRY_PORT`            | Port the WebSocket Foundry connector listens on.                                                                                                                                                                                                                          | `31415`                                |
| `FOUNDRY_CONNECTION_TYPE` | Force `websocket`, `webrtc`, or `auto` (auto-selects by page security). Override to `webrtc` to smoke-test the werift path without HTTPS.                                                                                                                                 | `auto`                                 |
| `FOUNDRY_STUN_SERVERS`    | Comma-separated STUN/TURN URIs for WebRTC ICE. Default uses Google's public STUN. **Across-NAT WebRTC needs a TURN server here** (see §5).                                                                                                                                | `stun:stun.l.google.com:19302`         |
| **Lock file**             | Port-scoped singleton lock: `foundry-mcp-backend.lock` (default port 31414) or `foundry-mcp-backend-<PORT>.lock` (alternate ports). Lives in `os.tmpdir()`. The Claude Desktop-spawned backend and the standalone process must **not** bind the same port simultaneously. | `os.tmpdir()/foundry-mcp-backend.lock` |

**CLI flags** (passed to `standalone.js`, equivalent to setting the env vars above):

| Flag             | Effect                      |
| ---------------- | --------------------------- |
| `--host <addr>`  | Sets `MCP_CONTROL_HOST`     |
| `--port <n>`     | Sets `MCP_CONTROL_PORT`     |
| `--control-only` | Sets `MCP_FOUNDRY_LINK=off` |

### Dashboard (`packages/cogm-dashboard`)

| Env var                        | What it controls                                                                                                                                                                                                    | Default                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `PORT`                         | Dashboard HTTP listen port                                                                                                                                                                                          | `3000`                                     |
| `MCP_CONTROL_HOST`             | Bridge control-channel host the dashboard dials                                                                                                                                                                     | `127.0.0.1`                                |
| `MCP_CONTROL_PORT`             | Bridge control-channel port the dashboard dials                                                                                                                                                                     | `31414`                                    |
| `ANTHROPIC_API_KEY`            | Anthropic API key. **Server-side only — never reaches the browser.** Empty = AI disabled, feed still runs.                                                                                                          | _(unset)_                                  |
| `GM_DASHBOARD_TOKEN`           | Shared GM secret. Setting this (and/or `GM_EMAILS`) **enables the player/GM split**. Present the token via `X-CoGM-Token` header, `?token=` query, or `cogm_token` cookie to claim GM role.                         | _(unset = split disabled, everyone is GM)_ |
| `PLAYER_DASHBOARD_TOKEN`       | Optional token players must present to reach the `/player` view. If unset, the player view is open to any user the outer gate (Cloudflare Access) lets through.                                                     | _(unset = player view open)_               |
| `GM_EMAILS`                    | Comma-separated email addresses. When a Cloudflare Access request carries a matching `cf-access-authenticated-user-email` header, that user gets GM role without needing the token. Enables the split if non-empty. | _(unset)_                                  |
| `CF_ACCESS_EMAIL_HEADER`       | Header name Cloudflare Access injects. Change if your Access policy uses a non-default header.                                                                                                                      | `cf-access-authenticated-user-email`       |
| `PLAYER_SHOW_ENEMY_CONDITIONS` | Whether the player view shows status conditions on enemy/NPC combatants.                                                                                                                                            | `true`                                     |
| `PLAYER_SHOW_ENEMY_HP_BANDS`   | Whether the player view shows a coarse HP band (healthy/bloodied/critical/down) on enemies — never exact numbers.                                                                                                   | `false`                                    |
| `ANTHROPIC_MODEL`              | Claude model used by the co-GM.                                                                                                                                                                                     | `claude-opus-4-8`                          |
| `LOG_LEVEL`                    | `debug` / `info` / `warn` / `error`                                                                                                                                                                                 | `info`                                     |

### Remote-access infrastructure

| Seam                            | What it is                                                                                                                                                                                                                                                                                                                                                                                       | Where configured                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `cloudflared` config file       | Routes `cogm.yourdomain → http://localhost:3000`. Created by `cloudflared tunnel create cogm` + `cloudflared tunnel route dns`.                                                                                                                                                                                                                                                                  | `~/.cloudflared/config.yml` (or the path you pass `--config`)  |
| Cloudflare Access policy        | Email allow-list (you + your GM). Injects the authenticated email into every proxied request.                                                                                                                                                                                                                                                                                                    | Cloudflare dashboard → Access → Applications                   |
| Dockerfile                      | Builds the dashboard + bridge into a container image. **Infra-dependent** — fill in the base image / build paths when provisioning.                                                                                                                                                                                                                                                              | `deploy/Dockerfile` (templated)                                |
| Docker Compose                  | Wires the bridge + dashboard + cloudflared containers together with env injection.                                                                                                                                                                                                                                                                                                               | `deploy/docker-compose.yml.template` (templated)               |
| Windows service                 | NSSM or Task Scheduler scaffold to keep `standalone.js` alive unattended on a Windows PC.                                                                                                                                                                                                                                                                                                        | `deploy/windows/install-service.md`                            |
| Foundry module's bridge address | The Foundry module's **"Websocket Server Host"** (`serverHost`) and **"Server Port"** (`serverPort`) settings, plus the **Connection Type** selector (Auto / WebRTC / WebSocket). Note `serverHost`'s hint: it is "Not used for Remote Connections" — remote/HTTPS Foundry uses WebRTC (the offer POST to `:31416`), so the connection-type + WebRTC path govern remote reach, not `serverHost`. | Foundry → Game Settings → Module Settings → foundry-mcp-bridge |

### Wire identifiers — frozen, do not rename without a migration plan

| Identifier          | Value                       | Spoken between                                   |
| ------------------- | --------------------------- | ------------------------------------------------ |
| Module id           | `foundry-mcp-bridge`        | Foundry's module system, update checks           |
| Socket channel      | `module.foundry-mcp-bridge` | Foundry game socket (syncing player roll state)  |
| Settings namespace  | `foundry-mcp-bridge`        | Foundry settings API                             |
| Query method prefix | `foundry-mcp-bridge.*`      | Bridge control channel → Foundry module dispatch |

---

## 5. Known Gaps / Future Work

### WebRTC across NAT — TURN server required

When Foundry is served over HTTPS (the browser can't open `ws://` from an HTTPS page), the
module uses WebRTC: it POSTs a WebRTC offer to `http://bridge-host:31416/webrtc-offer`,
receives an answer, and brings up an encrypted peer DataChannel. This works reliably when the
bridge and Foundry are on the **same LAN or both reachable without NAT traversal** (e.g. both
on a VPS).

However, when the bridge is on a Pi behind a home router and Foundry is on a hosted service
(Forge), or vice versa, **ICE candidates can't traverse NAT without a TURN server**. The
`FOUNDRY_STUN_SERVERS` env var accepts `turn:` URIs (e.g.
`turn:your-turn.example.com:3478?transport=udp`), but no TURN server is provisioned or
documented. This is the one WebRTC gap that survives the Phase 6 infra bringup. Options:

- Use a self-hosted TURN server (`coturn`) on the same VPS as the bridge.
- Use a managed TURN service (Twilio Network Traversal Service, Metered, etc.).
- Avoid the gap entirely: run Foundry over HTTP on localhost so the module uses WebSocket
  (`31415`) and never needs WebRTC at all. (The Forge uses HTTPS — this gap becomes real.)

### Combatant `hidden` flag — bridge surface, not yet fine-grained per-event

The redaction layer in `redact.ts` checks `c.hidden === true` on combatants and drops them
from the player view. The `hidden` field is now **surfaced by the bridge** (the Foundry module
includes it in the combat-state payload). However, whether a given combat event (damage, death,
etc.) should be suppressed if it involves a hidden combatant is not yet handled at the event
level — `redactEventForPlayer` applies only a type-allowlist, not a combatant-visibility check.
Finer per-event visibility (hide "hidden assassin took 12 damage" from players) is a small
bridge seam: it needs event payloads to carry the combatant's `hidden` flag so the dashboard
can filter them. Deferred; not blocking.

### Mobile / tablet — deferred per priority rule

The player view (`/player`) inherits whatever responsive CSS the dashboard ships with, but no
investment has been made in mobile/tablet layout. Per the priority rule in `docs/DETACH-PLAN.md`:
**mobile/tablet comes only after desktop v1 is done.** Don't build it in parallel.

---

## 6. Setup Checklist

An ordered, checkbox list to execute when the hosting infrastructure is actually available.
This is the "everything is ready, make it real" path. For detailed cloudflared steps, see
`docs/REMOTE-ACCESS.md`.

### Pre-flight

- [ ] **Run the dep-patch live smoke test** (`docs/DEPENDENCY-PATCH-SMOKE-TEST.md`) if you
      haven't yet. The werift 0.23 bump is the one shipping-runtime change still pending a
      WebRTC live confirm. Clear this before putting the bridge on the internet.
- [ ] Confirm you have a Cloudflare account with a domain managed there, a VPS or Pi you can
      SSH into, and your Foundry instance URL (Forge URL or self-hosted VPS address).

### 1. Provision the always-on host

- [ ] SSH into the Pi/VPS. Install Node 18+ (`node --version`) and `npm`.
- [ ] Clone the repo (or copy the built dist/): `git clone https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git`.
- [ ] Build: `npm ci && npm run build:release` (or transfer a pre-built dist from your PC).
- [ ] Verify the standalone smoke passes on the host: `node scripts/standalone-smoke-test.mjs`.

### 2. Configure and start the bridge

- [ ] Set env vars for your Foundry host (create a `.env` or export in the service file):
  ```
  MCP_CONTROL_HOST=127.0.0.1    # keep loopback
  MCP_CONTROL_PORT=31414
  FOUNDRY_HOST=<bridge-host-ip-or-hostname>   # what the Foundry module dials
  FOUNDRY_PORT=31415
  FOUNDRY_CONNECTION_TYPE=auto
  ```
- [ ] Start the bridge: `npm run bridge:standalone` (runs `node packages/mcp-server/dist/standalone.js`).
      Confirm: `✓ control channel ready on 127.0.0.1:31414` in the log.
- [ ] **For unattended operation:** install as a Windows service (see `deploy/windows/install-service.md`)
      or as a systemd unit on Linux (see `docs/REMOTE-ACCESS.md`).

### 3. Configure and start the dashboard

- [ ] Create a `.env` (or equivalent secrets) for the dashboard:
  ```
  PORT=3000
  MCP_CONTROL_HOST=127.0.0.1
  MCP_CONTROL_PORT=31414
  ANTHROPIC_API_KEY=<your-key>
  GM_DASHBOARD_TOKEN=<strong-random-secret>   # enables the split
  GM_EMAILS=you@example.com,gm@example.com    # maps CF Access emails to GM role
  ```
- [ ] Start the dashboard: `npm run start:cogm` (runs `node packages/cogm-dashboard/dist/server.js`).
      Confirm: `Co-GM dashboard listening on http://localhost:3000` with `playerGmSplit: enabled`.

### 4. Install cloudflared and create the tunnel

- [ ] Follow `docs/REMOTE-ACCESS.md` §1–3 for the full cloudflared bringup. Summary:
  - `cloudflared tunnel login` (authorize your Cloudflare account).
  - `cloudflared tunnel create cogm` → note the tunnel UUID.
  - Edit `~/.cloudflared/config.yml` to route `cogm.yourdomain → http://localhost:3000`.
  - `cloudflared tunnel run cogm` (or install as a service).
- [ ] Confirm: `curl https://cogm.yourdomain/api/health` returns `{"ok":true,...}`.

### 5. Add Cloudflare Access policy

- [ ] In the Cloudflare dashboard: Zero Trust → Access → Applications → Add Application.
      Set the hostname to `cogm.yourdomain`. Add an "Allow" policy: "Emails" include
      `you@example.com`, `gm@example.com` (match `GM_EMAILS`). Any other authenticated user
      lands on the player view (unauthenticated users are blocked).
- [ ] Confirm: open `https://cogm.yourdomain` in a browser — the Access login gate appears.
      Log in with your GM email → dashboard GM view. Log in with the GM's email → GM view.
      Log in with any other email → player view (or 403 if `PLAYER_DASHBOARD_TOKEN` is set).

### 6. Point the Foundry module at the bridge

- [ ] In Foundry (as GM): Game Settings → Module Settings → **Foundry MCP Bridge**.
      Set **Connection Type** (Auto, or WebRTC for an HTTPS/remote Foundry), the **Server Port**
      (`serverPort`, default `31415`), and — for the WebSocket/localhost path — the **Websocket
      Server Host** (`serverHost`). For a remote HTTPS Foundry the WebRTC path is used (serverHost
      is not consulted); if the bridge is across NAT, configure `FOUNDRY_STUN_SERVERS` with a TURN
      URI first — see §5.)
- [ ] Enable/reconnect the bridge. Confirm the module log shows **Connected**.

### 7. End-to-end live checks

- [ ] **Dep-patch smoke** (if not done in pre-flight): Claude Desktop loads the tool list
      (MCP SDK ok), module connects (ws or webrtc), a read returns live data.
- [ ] **Player/GM split live check:**
  - GM browser at `https://cogm.yourdomain/` → sees combat tracker with exact enemy HP,
    module errors panel, GM Actions surface, world title with GM names.
  - A second browser (player email) at `https://cogm.yourdomain/player` → sees public
    combat order (enemy HP null, hidden combatants absent), public event feed (details
    stripped), no errors panel, no GM controls.
  - Unauthenticated request: `curl https://cogm.yourdomain/api/tool -X POST` → 401/403.
- [ ] **Tool round-trip:** from the GM dashboard, run a read tool (e.g. "Get World Info") via
      GM Actions and confirm it returns live Foundry data.
- [ ] **Dashboard resilience:** stop and restart the bridge process; confirm the dashboard
      reconnects (control channel cycling) and the GM view recovers without a page reload.
