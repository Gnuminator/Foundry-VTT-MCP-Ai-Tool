# Remote Access — Operational Setup Guide

> **Status: scaffold / not deployed.** This document describes the target remote-access
> topology for Phase 6 and provides step-by-step instructions you fill in when you have
> the infrastructure in hand. Every account ID, domain, UUID, email address, and secret
> is a `<PLACEHOLDER>` you replace. Nothing in this guide has been executed against live
> infrastructure.
>
> For the big-picture roadmap that Phase 6 fits into, see `docs/history/PHASE6-DESIGN.md`
> (written in parallel). For the existing Windows-local deployment, see `docs/dev/DEPLOYMENT.md`
> and `deploy/windows/`.

---

## Part C: players and the GM reach the Orange Pi through Cloudflare

This is the real plan for the Orange Pi (decision D-075). It replaces sections 3 and 5 below for the
Pi: the tunnel is a **remotely managed tunnel**, so the Pi holds only a token and every hostname and
every login rule lives in the Cloudflare dashboard. Nothing is opened on your router, and the
players install nothing: they open a web address and confirm their email with a code about once a
month.

What goes through the tunnel, and nothing else:

| Public name     | Goes to on the Pi           | Who gets in                                     |
| --------------- | --------------------------- | ----------------------------------------------- |
| `play.<domain>` | Foundry, `localhost:30000`  | The players, the GM and you (Cloudflare Access) |
| `cogm.<domain>` | Dashboard, `localhost:3000` | The GM and you only                             |

The bridge ports (31414 to 31416), SSH, Syncthing and the Assistant GM browser are never published.
Tailscale stays for your own admin access. Foundry's own login (a user per player, as today) still
applies behind Access: Access decides who may reach the page, Foundry decides who they are.

Pick the names yourself; `play` and `cogm` are examples. Below, `<domain>` is your domain.

### What you do

1. **Domain.** In the Cloudflare dashboard (`dash.cloudflare.com`) buy a domain under Domain
   Registration, or add one you own and point its nameservers at Cloudflare as the page tells you.
2. **Team.** Open Zero Trust (`one.dash.cloudflare.com`) and pick a team name when asked. The free
   plan covers up to 50 people. Cloudflare may ask for a payment method even for the free plan;
   that is yours to enter.
3. **Tunnel.** Zero Trust, Networks, Connectors (or Tunnels), Create a tunnel, type `Cloudflared`,
   name it `foundry-pi`. On the next page pick Debian and 64-bit ARM. **Do not run the command it
   shows.** It contains the token (the long text after `install`). Leave the page open: you copy the
   token in step 8. Never paste the token into a chat, a file in the repo or the vault.
4. **Who may open Foundry (do this before the name exists).** Zero Trust, Access controls,
   Applications, Add an application, Self-hosted. Name `Foundry players`, domain `play.<domain>`,
   session duration 30 days. Add a policy named `Players`: action Allow, include Emails, then the
   email of each player, the GM and you. Under login methods keep only One-time PIN. Save. Players
   will get a code by email the first time and about once a month after.
5. **The Foundry name.** Back in the tunnel, Published application routes (or Public hostname),
   add: subdomain `play`, your domain, service type `HTTP`, URL `localhost:30000`. Leave every
   option under Additional settings as it is (WebSockets work by default); in particular **never
   set "HTTP Host Header"**, because the dashboard's host check (a `421` for names it does not
   know) is what keeps an unconfigured name closed. Save the tunnel.
6. **Pi: install the tunnel (Claude, with your OK).** Claude takes a `dietpi-backup 1` snapshot, then
   runs stage 12 (`12-tunnel.sh`, see [Orange Pi setup](PI-SETUP.md)). It installs Cloudflare's
   `cloudflared` from Cloudflare's own signed package source and sets it up as a service that stays
   off until the token is there.
7. **Pi: Foundry's public name (Claude, with your OK).** Claude runs the stage again with
   `FOUNDRY_PUBLIC_HOST=play.<domain>`. That sets three Foundry options so invitation links and
   audio and video use the public name: `hostname` = `play.<domain>`, `proxySSL` = true,
   `proxyPort` = 443. Foundry restarts for a moment.
8. **Pi: the token (you, in your own SSH session).** Claude never types or sees it. In PowerShell on
   this PC, from the repo folder:

   ```powershell
   scp scripts\pi\remote\set-tunnel-token.sh foundry-pi:/tmp/set-tunnel-token.sh
   ssh -t foundry-pi bash /tmp/set-tunnel-token.sh
   ```

   It asks for the token without showing it. Copy it from the Cloudflare tunnel page (or the whole
   install command, it picks out the token) and paste, then Enter. It saves the token in a file only
   root can read and starts the tunnel; it ends with "connected to Cloudflare". In the Cloudflare
   dashboard the tunnel now says Healthy.

9. **Test from a phone off Wi-Fi.** Switch the phone to mobile data and open `https://play.<domain>`.
   Expected: a Cloudflare page asking for an email; an address not on the policy gets no code; an
   address on it gets a code by email, then Foundry's login page. Then check that Foundry loads and
   a token can be moved, which proves WebSockets work. Test with one player's real address before
   telling the others.
10. **The dashboard, for the GM (later). The order matters: Access first, the name last.** The
    dashboard checks Cloudflare's signed login token (idea I-022, built) and, once it is set up
    with GM emails, shows everyone else the read-only player view. Until the Access application
    exists that view would be open to the internet, so: 1. In Cloudflare create the Access application `Foundry dashboard` for `cogm.<domain>` with
    one Allow policy that includes only the GM's and your email (a shorter list than the
    players'). Save, open it and copy its **Application Audience (AUD) Tag**. Do not add the
    `cogm` route yet. 2. Tell Claude your team name (`<team>.cloudflareaccess.com`), the AUD tag, the GM's and your
    emails, and the Pi's Tailscale name. With your OK Claude writes
    `/etc/foundry-ai-tool/dashboard-access.env` (root, group `foundry`, 0640) with
    `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `GM_EMAILS`, `DASHBOARD_ALLOWED_HOSTS` and
    `GM_DASHBOARD_TOKEN` (generated on the Pi, never printed), runs stage 5 again once (the build
    is skipped; it only adds this file to the dashboard's service) and restarts the dashboard.
    Why a file of its own: stage 7 rewrites `dashboard.env` whole, which would drop these lines,
    and `dashboard-access.env` is read after it and never rewritten. The service's own
    `DASHBOARD_ALLOWED_HOSTS` is replaced by this file's value, so it must list **both** names,
    `<tailscale name>,cogm.<domain>`, or the GM's Tailscale address would answer `421`. 3. Over Tailscale the GM has no Cloudflare login, so with the split on he would see the player
    view. `GM_DASHBOARD_TOKEN` fixes that: once, open
    `http://<tailscale name>:3000/?token=<the token>` in his browser; the dashboard remembers it
    there. You read the token with `ssh foundry-pi grep GM_DASHBOARD_TOKEN
/etc/foundry-ai-tool/dashboard-access.env` and pass it on yourself; keep it out of the repo
    and the vault. 4. Only now add the name: tunnel, Published application routes, subdomain `cogm`, `HTTP`,
    `localhost:3000` (again no "HTTP Host Header"). Test: `https://cogm.<domain>` must ask for a
    Cloudflare login, and only the listed emails reach the dashboard as GM.
11. **Service token for the GM's Obsidian plugin (D-094).** Zero Trust, Access controls, Service
    credentials, Service Tokens, Create. Name it `obsidian-gm-plugin`, duration 1 year. Copy the
    Client ID and Client Secret now; the secret is shown once. On the `Foundry dashboard`
    application add a second policy named `Obsidian plugin` with action **Service Auth** and
    include Service Token, that token. Do not add it to the `Foundry players` application: it must
    reach the dashboard name only. The Client ID and Secret go into the plugin's settings on the
    GM's PC (the plugin change that sends them comes in a later Obsidian PR), never into the vault
    or the repo. It expires after one year (Cloudflare emails a warning first); to revoke it earlier,
    delete it under Service Tokens or remove the `Obsidian plugin` policy. **Known gap:** the
    dashboard decides the GM role from the email in Cloudflare's signed token only, and a service
    token's login carries no email, so the plugin will reach the dashboard but get the player view.
    A dashboard change that maps the service token's client ID to the GM role is still needed; it
    comes with the Obsidian R1 work (D-094) and is not part of stage 12.

### Removing a player

Zero Trust, Access controls, Applications, `Foundry players`, Policies, edit `Players`, delete the
person's email, Save. Their old login stays valid until its 30 days run out, so also open Zero
Trust, Team and resources (or Users), find them and choose Revoke. They can no longer reach
Foundry. Their Foundry user in the world stays until the GM removes it in Foundry.

### If something goes wrong

- **Stop the tunnel:** `ssh foundry-pi systemctl stop foundry-ai-tool-cloudflared` (Foundry and the
  home network are unaffected; the public names then show a Cloudflare error). Or pause the tunnel
  in the Cloudflare dashboard.
- **Change the token** (after Refresh token on the tunnel page): run step 8 again.
- **A Cloudflare 502** on a name: the tunnel is up but the thing behind it is not. Foundry:
  `systemctl status foundry`; dashboard: `systemctl status foundry-ai-tool-dashboard`.
- Stage 12 prints each check (service active, a connection to Cloudflare, nothing listening except
  the tunnel's own status port on loopback) and can be run again at any time.

---

## 1. Target network topology

The goal is to let you (the GM) and optionally co-GMs reach the dashboard from
anywhere, without exposing your home IP address and without port-forwarding.

```text
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
  │  │  - Foundry link WS  :31415  (FOUNDRY_LINK_HOST=0.0.0.0)     │   │
  │  │  - Foundry link WebRTC signaling  :31416  (same setting)     │   │
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
  │  - Sends a signed login token (Cf-Access-Jwt-Assertion)            │
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

| Variable                  | Default        | What it controls                                                                                                                          |
| ------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_CONTROL_HOST`        | `127.0.0.1`    | Bind host for the control channel (31414). Keep loopback — always.                                                                        |
| `MCP_CONTROL_PORT`        | `31414`        | Port for the control channel. Change if running two backends side-by-side.                                                                |
| `MCP_FOUNDRY_LINK`        | _(enabled)_    | Set to `off` to run backend as control-only (no Foundry connector).                                                                       |
| `FOUNDRY_LINK_HOST`       | `127.0.0.1`    | Interface for the Foundry link (31415 WS, 31416 WebRTC signaling). Set `0.0.0.0` only when the GM's browser is on another machine.        |
| `FOUNDRY_AI_DATA_DIR`     | platform dir   | Bridge vault (GM-only data, audit log, session log). Default `%APPDATA%\foundry-ai-tool\vault` or `~/.local/share/foundry-ai-tool/vault`. |
| `FOUNDRY_AI_EVENT_LOG`    | _(on)_         | `off` disables the persistent session event log (`sessions/<date>.jsonl`).                                                                |
| `FOUNDRY_AI_USAGE_LOG`    | _(on)_         | `off` disables the usage log (`sessions/<date>.usage.jsonl`: which dashboard, player-page and module controls get used).                  |
| `FOUNDRY_HOST`            | `localhost`    | **Not used by the bridge itself.** Was legacy; the module dials the bridge, not the other way round. (See note below.)                    |
| `FOUNDRY_PORT`            | `31415`        | WebSocket listen port for the Foundry connector.                                                                                          |
| `FOUNDRY_NAMESPACE`       | `/foundry-mcp` | WebSocket path prefix.                                                                                                                    |
| `FOUNDRY_CONNECTION_TYPE` | `auto`         | `auto` \| `websocket` \| `webrtc`. `auto` picks WebSocket unless disabled.                                                                |
| `FOUNDRY_STUN_SERVERS`    | Google STUN x2 | Comma-separated STUN URLs for WebRTC ICE. Override to use your own.                                                                       |
| `FOUNDRY_REMOTE_MODE`     | `false`        | Set `true` when bridge and Foundry are on different machines. Logged at startup only; it changes no behaviour.                            |
| `LOG_LEVEL`               | `warn`         | `error` \| `warn` \| `info` \| `debug`                                                                                                    |

> **Note on `FOUNDRY_HOST`:** The Foundry module dials OUT to the bridge, not the reverse.
> The bridge does not need to know the Foundry host's address. What matters is that the
> bridge's 31415 / 31416 ports are reachable from where Foundry is running.

### Dashboard (`packages/cogm-dashboard/src/config.ts`)

| Variable                       | Default                          | What it controls                                                                      |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------- |
| `PORT`                         | `3000`                           | HTTP port the dashboard binds. Cloudflare Tunnel proxies this.                        |
| `DASHBOARD_HOST`               | `127.0.0.1`                      | Listen address. Any non-loopback value is refused without `GM_DASHBOARD_TOKEN`.       |
| `DASHBOARD_ALLOWED_HOSTS`      | _(unset)_                        | Extra host names it answers to, e.g. the tunnel's public name (Host check).           |
| `MCP_CONTROL_HOST`             | `127.0.0.1`                      | Where the dashboard connects for the control channel.                                 |
| `MCP_CONTROL_PORT`             | `31414`                          | Control channel port (must match the backend).                                        |
| `ANTHROPIC_API_KEY`            | _(unset — AI disabled if empty)_ | Anthropic API key. **Server-side only. Never reaches browser.**                       |
| `ANTHROPIC_MODEL`              | `claude-opus-5-5`                | Claude model used for AI commentary.                                                  |
| `GM_DASHBOARD_TOKEN`           | _(unset)_                        | Shared secret that grants GM role. Setting this enables the GM/player split.          |
| `PLAYER_DASHBOARD_TOKEN`       | _(unset)_                        | Optional token required to view the player page.                                      |
| `GM_EMAILS`                    | _(unset)_                        | Comma-separated email addresses that map to GM role (via Cloudflare Access).          |
| `CF_ACCESS_TEAM_DOMAIN`        | _(unset)_                        | `<team>.cloudflareaccess.com`; with `CF_ACCESS_AUD`, turns on the Access token check. |
| `PLAYER_SHOW_ENEMY_CONDITIONS` | `true`                           | Let player view see status conditions on enemy combatants.                            |
| `PLAYER_SHOW_ENEMY_HP_BANDS`   | `false`                          | Let player view see coarse HP bands (e.g. "bloodied") on enemies.                     |
| `LOG_LEVEL`                    | `info`                           | Dashboard server log verbosity.                                                       |

### Host check (DNS rebinding guard)

The dashboard answers only requests whose `Host` header names it. Everything else gets
`421` with `{"code": "host-not-allowed"}`, on every path, in both modes (split on or off),
before any auth. This stops a DNS rebinding page (an attacker's host name that resolves to
127.0.0.1) from driving the GM endpoints; such a request always carries the attacker's
host name.

Allowed by default, on any port: `localhost`, `127.0.0.1`, `[::1]`, and the host name of
`DASHBOARD_HOST` when it is one specific address (not `0.0.0.0` or `::`).

`DASHBOARD_ALLOWED_HOSTS` adds more: comma-separated host names, IPv4 addresses or
`[IPv6]` addresses, each optionally with `:port`.

- An entry without a port allows any port; `name:port` allows only that port. Browsers
  leave out the default port, so a `Host` without a port counts as port 80 or 443.
- Names compare case-insensitively and otherwise exactly: no wildcards, no subdomains, and
  a trailing dot is not stripped (`localhost.` is refused unless listed as written).
- An invalid entry is ignored with a startup warning that names its position, not its text.
- One `Host` header only: none, two, or a malformed one (user info, a list, a zone id) is
  refused.

Behind a tunnel or a reverse proxy, the `Host` header carries the public name
(cloudflared forwards it unchanged), so that name must be listed:
`DASHBOARD_ALLOWED_HOSTS=cogm.<YOUR_DOMAIN>`. Do the same for a LAN address or name you
browse to (`DASHBOARD_ALLOWED_HOSTS=192.168.1.20,pi.local`), and for the origin in the
bridge's `FOUNDRY_AI_OPEN_BASE` when the Obsidian "Open in Foundry" links point anywhere
but localhost. Do not rewrite the `Host` at the proxy instead (cloudflared
`httpHostHeader`): the `/open` confirm page compares its `Origin` with the `Host` and would
refuse to open anything.

### Auth / role mapping summary

The split is **opt-in**. With no `GM_DASHBOARD_TOKEN` and no `GM_EMAILS`, every request is
treated as GM (today's single-user localhost mode). As soon as either is set, the split
activates and unauthenticated callers land on the read-only `/player` view.

When Cloudflare Access is in front:

1. Cloudflare Access verifies the user's identity (e.g. Google / GitHub OAuth, or a One-Time
   PIN to their email).
2. On success Cloudflare sends a signed login token (`Cf-Access-Jwt-Assertion`) with every
   request reaching the tunnel.
3. The dashboard checks the token (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`: signature,
   issuer, audience, expiry) and compares its email against `GM_EMAILS` (lowercased,
   comma-separated list). Match → GM role. The plain email header is never trusted (I-022).
4. `GM_DASHBOARD_TOKEN` is an alternative / additional credential: present it as a
   `X-CoGM-Token` header, `?token=` query parameter, or `cogm_token` cookie → GM role.

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

cloudflared forwards the public name in the `Host` header, and the dashboard refuses host
names it does not know (section 2, "Host check"). Set
`DASHBOARD_ALLOWED_HOSTS=cogm.<YOUR_DOMAIN>` in the dashboard's environment, or every
request through the tunnel gets `421 host-not-allowed`.

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
2. Application name: `Foundry AI Tool` (or anything)
3. Application domain: `cogm.<YOUR_DOMAIN>` (must match the tunnel hostname)
4. Session duration: pick something sane — e.g. 24 hours
5. **Add a policy** named e.g. `GM allow-list`:
   - Action: Allow
   - Include rule: `Emails` → add every email address that should have access
     (your address + any co-GM addresses; see also `deploy/cloudflare/access-policy.md`)
6. Save.

From this point, visiting `https://cogm.<YOUR_DOMAIN>` shows a Cloudflare login page.
After authentication Cloudflare sends a signed login token with every proxied request. The
dashboard checks it and grants the GM role if its email is in `GM_EMAILS`.

See `deploy/cloudflare/access-policy.md` for the exact email-to-role mapping and how it
pairs with `GM_EMAILS`, `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.

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
| 3a  | `DASHBOARD_ALLOWED_HOSTS`  | `DASHBOARD_ALLOWED_HOSTS=cogm.<YOUR_DOMAIN>` in the dashboard env |
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
  - [ ] `CF_ACCESS_TEAM_DOMAIN=<YOUR_TEAM>.cloudflareaccess.com` and `CF_ACCESS_AUD=<the application's AUD tag>` (both needed for `GM_EMAILS` to work)
  - [ ] `DASHBOARD_ALLOWED_HOSTS=cogm.<YOUR_DOMAIN>` (the tunnel's public name; without it the tunnel gets `421 host-not-allowed`)
- [ ] Start the dashboard: `npm run start:cogm` (or via service/Docker).
- [ ] Confirm it serves on `http://localhost:3000`.

### Cloudflare Tunnel

- [ ] `cloudflared` installed on the host.
- [ ] `cloudflared tunnel login` completed.
- [ ] `cloudflared tunnel create cogm` → note `<TUNNEL_UUID>`.
- [ ] `deploy/cloudflare/config.yml.template` filled in → saved as `~/.cloudflared/config.yml`.
- [ ] `cloudflared tunnel route dns cogm cogm.<YOUR_DOMAIN>`.
- [ ] Tunnel running (`cloudflared tunnel run cogm` or installed as service).
- [ ] `https://cogm.<YOUR_DOMAIN>` reaches the dashboard login page (a `421 host-not-allowed`
      JSON answer means `DASHBOARD_ALLOWED_HOSTS` does not list `cogm.<YOUR_DOMAIN>`).

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
