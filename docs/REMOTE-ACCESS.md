# Remote Access — Operational Setup Guide

> **Status: scaffold / not deployed.** This document describes the target remote-access
> topology for Phase 6 and provides step-by-step instructions you fill in when you have
> the infrastructure in hand. Every account ID, domain, UUID, email address, and secret
> is a `<PLACEHOLDER>` you replace. Nothing in this guide has been executed against live
> infrastructure.
>
> For the big-picture roadmap that Phase 6 fits into, see `docs/PHASE6-DESIGN.md`
> (written in parallel). For the existing Windows-local deployment, see `docs/DEPLOYMENT.md`
> and `deploy/windows/`.

---

## 1. Target network topology

The goal is to let you (the GM) and optionally co-GMs reach the co-GM dashboard from
anywhere, without exposing your home IP address and without port-forwarding.

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  HOSTED FOUNDRY VTT  (e.g. The Forge, Molten-Hosting, or a VPS)    │
  │  - foundry-mcp-bridge module loaded (dial-out, outbound)            │
  │  - served over HTTPS → uses WebRTC transport (31416 signaling)       │
  │  - served over HTTP  → uses WebSocket transport (31415)              │
  └─────────────────┬───────────────────────────────────────────────────┘
                    │  outbound: module dials the bridge host
                    │  WebSocket  ws://<BRIDGE_HOST>:31415/foundry-mcp
                    │  WebRTC     http://<BRIDGE_HOST>:31416/webrtc-offer (POST)
                    ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  ALWAYS-ON HOST  (Raspberry Pi, cheap VPS, spare PC)                │
  │                                                                      │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │  mcp-server backend  (standalone.ts / npm run bridge:standalone) │
  │  │  - control channel  127.0.0.1:31414  (loopback only)         │   │
  │  │  - Foundry link WS  0.0.0.0:31415  (or host-specific bind)  │   │
  │  │  - Foundry link WebRTC signaling  0.0.0.0:31416              │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  │                │                                                     │
  │                │  loopback TCP 31414  (never exposed externally)     │
  │                ▼                                                     │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │  cogm-dashboard server  (npm run start:cogm)                 │   │
  │  │  - HTTP + SSE  127.0.0.1:3000  (fronted by cloudflared)      │   │
  │  │  - owns ANTHROPIC_API_KEY (never leaves this process)        │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  │                │                                                     │
  │                │  http://localhost:3000                              │
  │                ▼                                                     │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │  cloudflared  (Cloudflare Tunnel daemon)                      │   │
  │  │  - proxies localhost:3000 → Cloudflare edge                  │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  └─────────────────────────────────────────────────────────────────────┘
                    │  encrypted QUIC/TLS tunnel (no inbound port opened)
                    ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  CLOUDFLARE EDGE                                                     │
  │  - Cloudflare Access application → email allow-list enforced here    │
  │  - Terminates user TLS; decrypts; forwards to tunnel                 │
  │  - Injects  cf-access-authenticated-user-email  header              │
  └───────┬────────────────────────────────────────────────────────────┘
          │  HTTPS  https://cogm.<YOUR_DOMAIN>
          ├──────────────────────────────────────────────────────────────►  You (GM browser)
          └──────────────────────────────────────────────────────────────►  Co-GM browser
```

### What stays on loopback, always

| Port  | What                        | Why it must NOT be exposed externally     |
| ----- | --------------------------- | ----------------------------------------- |
| 31414 | MCP control channel         | Trusted JSON-lines; no auth on the wire   |
| 3000  | Dashboard HTTP (pre-tunnel) | cloudflared proxies this; Access gates it |

### What the Foundry module dials (outbound from the hosted Foundry host)

| Port  | Protocol           | Notes                                       |
| ----- | ------------------ | ------------------------------------------- |
| 31415 | WebSocket          | Used when Foundry is served over plain HTTP |
| 31416 | HTTP POST (WebRTC) | Used when Foundry is served over HTTPS      |

These ports must be reachable from the Foundry host's IP to the bridge host's IP (firewall
rules, VPS security group, etc.). They are **not** fronted by Cloudflare Tunnel — the
tunnel only fronts the dashboard (port 3000).

---

## 2. Environment variables that make each hop config-driven

All variables have sane defaults for the local-only case (today). Setting them configures
the remote-hosting topology.

### Bridge / backend (`packages/mcp-server/src/backend.ts` + `config.ts`)

| Variable                  | Default        | What it controls                                                                                                       |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `MCP_CONTROL_HOST`        | `127.0.0.1`    | Bind host for the control channel (31414). Keep loopback — always.                                                     |
| `MCP_CONTROL_PORT`        | `31414`        | Port for the control channel. Change if running two backends side-by-side.                                             |
| `MCP_FOUNDRY_LINK`        | _(enabled)_    | Set to `off` to run backend as control-only (no Foundry connector).                                                    |
| `FOUNDRY_HOST`            | `localhost`    | **Not used by the bridge itself.** Was legacy; the module dials the bridge, not the other way round. (See note below.) |
| `FOUNDRY_PORT`            | `31415`        | WebSocket listen port for the Foundry connector.                                                                       |
| `FOUNDRY_NAMESPACE`       | `/foundry-mcp` | WebSocket path prefix.                                                                                                 |
| `FOUNDRY_CONNECTION_TYPE` | `auto`         | `auto` \| `websocket` \| `webrtc`. `auto` picks WebSocket unless disabled.                                             |
| `FOUNDRY_STUN_SERVERS`    | Google STUN x2 | Comma-separated STUN URLs for WebRTC ICE. Override to use your own.                                                    |
| `FOUNDRY_REMOTE_MODE`     | `false`        | Set `true` when bridge and Foundry are on different machines (disables local-path map delivery).                       |
| `FOUNDRY_DATA_PATH`       | _(unset)_      | Custom path for generated maps in remote mode.                                                                         |
| `LOG_LEVEL`               | `warn`         | `error` \| `warn` \| `info` \| `debug`                                                                                 |

> **Note on `FOUNDRY_HOST`:** The Foundry module dials OUT to the bridge, not the reverse.
> The bridge does not need to know the Foundry host's address. What matters is that the
> bridge's 31415 / 31416 ports are reachable from where Foundry is running.

### Dashboard (`packages/cogm-dashboard/src/config.ts`)

| Variable                       | Default                              | What it controls                                                             |
| ------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------- |
| `PORT`                         | `3000`                               | HTTP port the dashboard binds. Cloudflare Tunnel proxies this.               |
| `MCP_CONTROL_HOST`             | `127.0.0.1`                          | Where the dashboard connects for the control channel.                        |
| `MCP_CONTROL_PORT`             | `31414`                              | Control channel port (must match the backend).                               |
| `ANTHROPIC_API_KEY`            | _(unset — AI disabled if empty)_     | Anthropic API key. **Server-side only. Never reaches browser.**              |
| `ANTHROPIC_MODEL`              | `claude-opus-4-8`                    | Claude model used for co-GM commentary.                                      |
| `GM_DASHBOARD_TOKEN`           | _(unset)_                            | Shared secret that grants GM role. Setting this enables the GM/player split. |
| `PLAYER_DASHBOARD_TOKEN`       | _(unset)_                            | Optional token required to view the player page.                             |
| `GM_EMAILS`                    | _(unset)_                            | Comma-separated email addresses that map to GM role (via Cloudflare Access). |
| `CF_ACCESS_EMAIL_HEADER`       | `cf-access-authenticated-user-email` | Request header Cloudflare Access injects with the authed email.              |
| `PLAYER_SHOW_ENEMY_CONDITIONS` | `true`                               | Let player view see status conditions on enemy combatants.                   |
| `PLAYER_SHOW_ENEMY_HP_BANDS`   | `false`                              | Let player view see coarse HP bands (e.g. "bloodied") on enemies.            |
| `LOG_LEVEL`                    | `info`                               | Dashboard server log verbosity.                                              |

### Auth / role mapping summary

The split is **opt-in**. With no `GM_DASHBOARD_TOKEN` and no `GM_EMAILS`, every request is
treated as GM (today's single-user localhost mode). As soon as either is set, the split
activates and unauthenticated callers land on the read-only `/player` view.

When Cloudflare Access is in front:

1. Cloudflare Access verifies the user's identity (e.g. Google / GitHub OAuth, or a One-Time
   PIN to their email).
2. On success Cloudflare injects the header `cf-access-authenticated-user-email: user@example.com`
   into every request reaching the tunnel.
3. The dashboard reads that header (configured by `CF_ACCESS_EMAIL_HEADER`) and checks the
   email against `GM_EMAILS` (lowercased, comma-separated list). Match → GM role.
4. `GM_DASHBOARD_TOKEN` is an alternative / additional credential: present it as a
   `X-GM-Token` header, `?gm_token=` query parameter, or `gm_token` cookie → GM role.

---

## 3. Cloudflare Tunnel + Access setup

> **Prerequisites:** A domain managed on Cloudflare (its NS must point to Cloudflare). A
> Cloudflare account. `cloudflared` installed on the always-on host. Replace all
> `<PLACEHOLDER>` values with your real data.

### 3.1 Install cloudflared on the host

```bash
# Linux (Debian/Ubuntu) — replace with the correct package for your host OS.
# See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
curl -L --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

### 3.2 Authenticate cloudflared to your Cloudflare account

```bash
cloudflared tunnel login
# Opens a browser. Select <YOUR_DOMAIN> (the domain you want the tunnel under).
# A cert.pem is saved to ~/.cloudflared/cert.pem — this authorises tunnel creation.
```

### 3.3 Create the tunnel

```bash
cloudflared tunnel create cogm
# Output includes:
#   Tunnel credentials written to ~/.cloudflared/<TUNNEL_UUID>.json
#   Created tunnel cogm with id <TUNNEL_UUID>
#
# Note both the UUID and the credentials file path — you need them in step 3.4.
```

### 3.4 Write the tunnel config file

Place this at `~/.cloudflared/config.yml` (or wherever `cloudflared` looks by default,
or pass `--config` explicitly). A ready-to-fill template is at
`deploy/cloudflare/config.yml.template` in this repo.

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /home/<YOUR_USER>/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: cogm.<YOUR_DOMAIN>
    service: http://localhost:3000
  - service: http_status:404
```

### 3.5 Route the hostname to the tunnel

```bash
# Creates a CNAME cogm.<YOUR_DOMAIN> → <TUNNEL_UUID>.cfargotunnel.com in your Cloudflare DNS.
cloudflared tunnel route dns cogm cogm.<YOUR_DOMAIN>
```

### 3.6 Run the tunnel

For a quick test:

```bash
cloudflared tunnel run cogm
```

For always-on (systemd example):

```bash
sudo cloudflared service install
# Installs cloudflared as a system service that auto-restarts.
# Edit /etc/systemd/system/cloudflared.service if you need to point at a non-default config path.
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

### 3.7 Add a Cloudflare Access application

This is what prevents anyone with the URL from reaching your dashboard.

In the Cloudflare Zero Trust dashboard (`one.dash.cloudflare.com`):

1. **Access → Applications → Add an application → Self-hosted**
2. Application name: `Co-GM Dashboard` (or anything)
3. Application domain: `cogm.<YOUR_DOMAIN>` (must match the tunnel hostname)
4. Session duration: pick something sane — e.g. 24 hours
5. **Add a policy** named e.g. `GM allow-list`:
   - Action: Allow
   - Include rule: `Emails` → add every email address that should have access
     (your address + any co-GM addresses; see also `deploy/cloudflare/access-policy.md`)
6. Save.

From this point, visiting `https://cogm.<YOUR_DOMAIN>` shows a Cloudflare login page.
After authentication Cloudflare injects `cf-access-authenticated-user-email` into every
proxied request. The dashboard reads that header and grants GM role if the email is in
`GM_EMAILS`.

See `deploy/cloudflare/access-policy.md` for the exact email-to-role mapping and how it
pairs with `GM_EMAILS` / `CF_ACCESS_EMAIL_HEADER`.

---

## 4. WebSocket / WebRTC handshake across a real network + TURN seam

### How the Foundry module picks its transport

The module auto-selects in `socket-bridge.ts`:

- **Foundry on HTTP** → `ws://` WebSocket to port 31415 (simple, direct).
- **Foundry on HTTPS** → WebRTC DataChannel via the signaling endpoint at port 31416.
  The browser can POST a WebRTC offer from an HTTPS page to an HTTP endpoint **on
  `localhost`** due to the browser's localhost exception, but it **cannot** do so to an
  arbitrary remote host (mixed-content block). This means: if Foundry is hosted (HTTPS)
  and the bridge is remote, you need the bridge's 31416 signaling endpoint to also be
  reachable over HTTPS — either put it behind a reverse-proxy with a cert, or use a
  tunnel.

Override with `FOUNDRY_CONNECTION_TYPE=websocket|webrtc` if auto doesn't do what you want.

### Port reachability for remote Foundry

| Foundry served over | Transport used | Bridge port that must be reachable from Foundry's server/browser |
| ------------------- | -------------- | ---------------------------------------------------------------- |
| HTTP                | WebSocket      | 31415 (TCP) from the Foundry host                                |
| HTTPS               | WebRTC         | 31416 (TCP/HTTPS) from the Foundry browser client's origin       |

Your always-on host's firewall / VPS security group must allow inbound TCP on 31415 and/or
31416 from the Foundry server's IP range (or from the internet if the source IPs vary).

### STUN servers (used for WebRTC ICE)

Default: two Google STUN servers (`stun.l.google.com:19302`, `stun1.l.google.com:19302`).
These help the WebRTC peers discover their public addresses. For most topologies (bridge on
a VPS with a public IP, Foundry on a hosted service) STUN is sufficient.

Override: `FOUNDRY_STUN_SERVERS=stun:your-stun-server.example.com:3478,stun:backup.example.com:3478`

### TURN server seam (future)

If the bridge sits behind a strict NAT or the WebRTC ICE negotiation fails (peers cannot
discover a path via STUN alone), a **TURN relay** is needed. werift (the WebRTC library
used here) supports TURN, but the config schema has the TURN section intentionally
commented out — it is a seam for the next phase of hardening.

```ts
// packages/mcp-server/src/config.ts — the commented seam:
// turnServers: z.array(z.object({
//   urls: z.string(),
//   username: z.string().optional(),
//   credential: z.string().optional()
// })).optional()
```

When you need it: provision a TURN server (e.g. coturn on a VPS, or a managed service
like Twilio's Network Traversal Service), then uncomment and wire `FOUNDRY_TURN_SERVERS`
into the config and the werift peer constructor. That change is deferred and marked as a
known seam here.

---

## 5. "Plug your infra in here" — seams list

These are the exact points you touch when you have a real host/domain. Nothing else needs
changing.

| #   | Seam                       | Where to plug in                                                  |
| --- | -------------------------- | ----------------------------------------------------------------- |
| 1   | `<TUNNEL_UUID>`            | `deploy/cloudflare/config.yml.template` → tunnel: field           |
| 2   | `<TUNNEL_UUID>.json` path  | `deploy/cloudflare/config.yml.template` → credentials-file        |
| 3   | `cogm.<YOUR_DOMAIN>`       | Cloudflare DNS + Access application + tunnel route dns            |
| 4   | GM email allow-list        | `GM_EMAILS=you@example.com,cogm@example.com` in env/.env          |
| 5   | `GM_DASHBOARD_TOKEN`       | A random secret (e.g. `openssl rand -hex 32`) in env/.env         |
| 6   | `ANTHROPIC_API_KEY`        | Runtime secret / Docker secret / systemd EnvironmentFile          |
| 7   | Bridge host firewall rules | Open 31415 TCP (WS) and/or 31416 TCP (WebRTC signaling)           |
| 8   | `FOUNDRY_REMOTE_MODE=true` | Set in backend env when bridge and Foundry are different machines |
| 9   | TURN server (if needed)    | Uncomment `turnServers` in config.ts; set env var                 |

---

## 6. Setup checklist

Work through this list top-to-bottom when you're ready to go remote.

### Host prep

- [ ] Always-on host is running (Pi/VPS/spare PC). Node 18+ installed.
- [ ] Repo cloned or release build extracted on the host.
- [ ] `npm run build` (or use the release build) so `dist/` artifacts exist.
- [ ] Decide on process management: Docker Compose (see `deploy/docker-compose.yml.template`)
      or direct systemd/NSSM services.

### Backend (bridge)

- [ ] Create a `.env` or populate environment:
  - [ ] `MCP_CONTROL_HOST=127.0.0.1` (keep loopback)
  - [ ] `MCP_CONTROL_PORT=31414`
  - [ ] `FOUNDRY_REMOTE_MODE=true`
  - [ ] `FOUNDRY_STUN_SERVERS=<stun-url>,<stun-url>` (optional override)
  - [ ] `FOUNDRY_CONNECTION_TYPE=websocket|webrtc|auto` (match your Foundry setup)
  - [ ] `LOG_LEVEL=info`
- [ ] Start the bridge: `npm run bridge:standalone` (or via service/Docker).
- [ ] Verify the control channel is up (ping on 127.0.0.1:31414 returns `{"ok":true}`).

### Dashboard

- [ ] Populate environment:
  - [ ] `PORT=3000`
  - [ ] `MCP_CONTROL_HOST=127.0.0.1`
  - [ ] `MCP_CONTROL_PORT=31414`
  - [ ] `ANTHROPIC_API_KEY=<your-key>`
  - [ ] `GM_EMAILS=<your-email>,<cogm-email>` (comma-separated)
  - [ ] `GM_DASHBOARD_TOKEN=<random-secret>` (optional additional auth factor)
  - [ ] `PLAYER_DASHBOARD_TOKEN=<random-secret>` (if you want a gated player view)
  - [ ] `CF_ACCESS_EMAIL_HEADER=cf-access-authenticated-user-email` (default; only change if you reconfigured Access)
- [ ] Start the dashboard: `npm run start:cogm` (or via service/Docker).
- [ ] Confirm it serves on `http://localhost:3000`.

### Cloudflare Tunnel

- [ ] `cloudflared` installed on the host.
- [ ] `cloudflared tunnel login` completed.
- [ ] `cloudflared tunnel create cogm` → note `<TUNNEL_UUID>`.
- [ ] `deploy/cloudflare/config.yml.template` filled in → saved as `~/.cloudflared/config.yml`.
- [ ] `cloudflared tunnel route dns cogm cogm.<YOUR_DOMAIN>`.
- [ ] Tunnel running (`cloudflared tunnel run cogm` or installed as service).
- [ ] `https://cogm.<YOUR_DOMAIN>` reaches the dashboard login page.

### Cloudflare Access

- [ ] Access application created for `cogm.<YOUR_DOMAIN>`.
- [ ] Email allow-list policy created. Every GM email added.
- [ ] Test login with each GM email — confirm role-assignment in the dashboard.
- [ ] Confirm non-listed email gets the player view (or is blocked if no player token is set).

### Foundry module

- [ ] Bridge's 31415 and/or 31416 are reachable from the Foundry host (firewall rules).
- [ ] Foundry module settings: bridge host = `<BRIDGE_HOST_IP_OR_HOSTNAME>`, port = `31415`
      (or 31416 for WebRTC).
- [ ] Module shows "Connected" in the Foundry UI.
- [ ] Dashboard shows Foundry reachable.
