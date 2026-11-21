# Remote Access scaffold (sections 1, 3 to 6), kept as history

> **History, 2026-11-21.** This was sections 1 and 3 to 6 of `docs/dev/REMOTE-ACCESS.md`, the older
> scaffold for a locally managed Cloudflare tunnel on a hosted Foundry. It was never run against
> live infrastructure and Part C of the live guide replaced it (decision D-075). Section 6's
> checklist logs `cloudflared` in on the host, which the Pi never does. The matching template is
> `deploy/cloudflare/config.yml.template`. Section 2 (the settings tables) stayed in the live guide
> as "Settings reference". Every account ID, domain, UUID, email address and secret below is a
> `<PLACEHOLDER>`.

## 1. Target network topology

The goal is to let you (the GM) and optionally co-GMs reach the dashboard from
anywhere, without exposing your home IP address and without port-forwarding.

```text
  ┌─────────────────────────────────────────────────────────────────────┐
  │  HOSTED FOUNDRY VTT  (e.g. The Forge, Molten-Hosting, or a VPS)    │
  │  - foundry-mcp-bridge module loaded (dial-out, outbound)            │
  │  - uses the WebSocket transport (31415)                              │
  └─────────────────┬───────────────────────────────────────────────────┘
                    │  outbound: module dials the bridge host
                    │  WebSocket  ws://<BRIDGE_HOST>:31415/foundry-mcp
                    ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  ALWAYS-ON HOST  (Raspberry Pi, cheap VPS, spare PC)                │
  │                                                                      │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │  mcp-server backend  (standalone.ts / npm run bridge:standalone) │
  │  │  - control channel  127.0.0.1:31414  (loopback only)         │   │
  │  │  - Foundry link WS  :31415  (FOUNDRY_LINK_HOST=0.0.0.0)     │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  │                │                                                     │
  │                │  loopback TCP 31414  (never exposed externally)     │
  │                ▼                                                     │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │  cogm-dashboard server  (npm run start:cogm)                 │   │
  │  │  - HTTP + SSE  127.0.0.1:3000  (fronted by cloudflared)      │   │
  │  │  - makes no Anthropic API calls                              │   │
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

| Port  | Protocol  | Notes                                          |
| ----- | --------- | ---------------------------------------------- |
| 31415 | WebSocket | The Foundry link (the module dials the bridge) |

This port must be reachable from the Foundry host's IP to the bridge host's IP (firewall
rules, VPS security group, etc.). It is **not** fronted by Cloudflare Tunnel: the
tunnel only fronts the dashboard (port 3000).

---

## 3. Cloudflare Tunnel + Access setup

> **Prerequisites:** A domain managed on Cloudflare (its NS must point to Cloudflare). A
> Cloudflare account. `cloudflared` installed on the always-on host. Replace all
> `<PLACEHOLDER>` values with your real data.

### 3.1 Install cloudflared on the host

```bash
# Linux (Debian/Ubuntu): replace with the correct package for your host OS.
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
# A cert.pem is saved to ~/.cloudflared/cert.pem. This authorises tunnel creation.
```

### 3.3 Create the tunnel

```bash
cloudflared tunnel create cogm
# Output includes:
#   Tunnel credentials written to ~/.cloudflared/<TUNNEL_UUID>.json
#   Created tunnel cogm with id <TUNNEL_UUID>
#
# Note both the UUID and the credentials file path, as you need them in step 3.4.
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
4. Session duration: pick something sane, e.g. 24 hours
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

## 4. The WebSocket link across a real network

The Foundry module always dials the bridge over a plain `ws://` WebSocket to port 31415
(a WebRTC alternative existed earlier and was removed in PB-09; the old `connectionType`
world setting is ignored if it is still stored in a world).

A browser on an HTTPS page cannot open an insecure `ws://` to a remote host (mixed-content
block). On the Pi this does not arise: the module link is held by the Assistant GM browser
there, which loads `http://127.0.0.1:30000` and dials the bridge on loopback (browsers also
allow `ws://` to loopback from HTTPS pages). If a browser on an HTTPS page ever has to reach a
remote bridge, put the bridge's 31415 behind a TLS reverse proxy or tunnel and point the module
at it.

### Port reachability for remote Foundry

Never open 31415 to the internet: the Foundry link has no login. Reach it over the tailnet
(publish it on the host's tailnet IP) or an SSH tunnel to the bridge host. In Docker, published
ports skip ufw, so the mapping itself must be `127.0.0.1:31415:31415` or `<tailnet IP>:31415:31415`.

---

## 5. "Plug your infra in here": seams list

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
| 6   | Bridge host firewall rules | Keep 31415 off the internet: tailnet IP or SSH tunnel only        |
| 7   | `FOUNDRY_REMOTE_MODE=true` | Set in backend env when bridge and Foundry are different machines |

---

## 6. Setup checklist

Work through this list top-to-bottom when you're ready to go remote.

### Host prep

- [ ] Always-on host is running (Pi/VPS/spare PC). Node 24+ installed.
- [ ] Repo cloned or release build extracted on the host.
- [ ] `npm run build` (or use the release build) so `dist/` artifacts exist.
- [ ] Decide on process management: Docker Compose (see `deploy/docker-compose.yml.template`)
      or direct systemd/NSSM services.

### Backend (bridge)

- [ ] Create a `.env` or populate environment:
  - [ ] `MCP_CONTROL_HOST=127.0.0.1` (keep loopback)
  - [ ] `MCP_CONTROL_PORT=31414`
  - [ ] `FOUNDRY_REMOTE_MODE=true`
  - [ ] `LOG_LEVEL=info`
- [ ] Start the bridge: `npm run bridge:standalone` (or via service/Docker).
- [ ] Verify the control channel is up (ping on 127.0.0.1:31414 returns `{"ok":true}`).

### Dashboard

- [ ] Populate environment:
  - [ ] `PORT=3000`
  - [ ] `MCP_CONTROL_HOST=127.0.0.1`
  - [ ] `MCP_CONTROL_PORT=31414`
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
- [ ] Test login with each GM email and confirm role-assignment in the dashboard.
- [ ] Confirm non-listed email gets the player view (or is blocked if no player token is set).

### Foundry module

- [ ] Bridge's 31415 is reachable from the Foundry host over the tailnet or an SSH tunnel, not the open internet.
- [ ] Foundry module settings: bridge host = `<BRIDGE_HOST_IP_OR_HOSTNAME>`, port = `31415`.
- [ ] Module shows "Connected" in the Foundry UI.
- [ ] Dashboard shows Foundry reachable.
