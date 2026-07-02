# Remote Access Plan — everything-on-the-Pi hosting for a remote GM + players

> **Status: design + feasibility spike. Nothing here is built yet.** This is the "propose before
> building" deliverable for the *Remote hosting for the GM* session locked in
> [ROADMAP.md](ROADMAP.md#remote-hosting-for-the-gm--target-architecture-session-2). It supersedes
> the cross-host framing in [PHASE6-DESIGN.md](PHASE6-DESIGN.md) and [REMOTE-ACCESS.md](REMOTE-ACCESS.md)
> for the new **everything-on-one-box** topology; those two docs remain the reference for the
> Cloudflare/tunnel mechanics, which are reused unchanged.
>
> The goal: a remote GM (not on my LAN) + a few player friends use the co-GM dashboard securely,
> **with the PC never required anywhere.** Foundry stays on molten-hosting; a Raspberry Pi (or a
> fallback box) runs the whole AI/bridge/dashboard stack 24/7.

**Confirmed inputs (2026-07).** Box: **Orange Pi 5 Pro — Rockchip RK3588S (4×A76 + 4×A55, Mali-G610),
16 GB LPDDR5.** Exposure: **no domain wanted — reach it "by IP."** Foundry user: **a dedicated
GM-level user will be created** on the molten-hosted world. These are folded in below; the one
remaining assumption is that molten serves the world over HTTPS (standard) — see
[§10](#10-answered-inputs--the-one-open-assumption).

---

## Table of contents

1. [Executive summary + verdict](#1-executive-summary--verdict)
2. [Step 0 — feasibility spike: can a Pi run a headless Foundry client 24/7?](#2-step-0--feasibility-spike-can-a-pi-run-a-headless-foundry-client-247)
3. [Target architecture (everything on the Pi)](#3-target-architecture-everything-on-the-pi)
4. [The headless bridge client — design](#4-the-headless-bridge-client--design)
5. [Transport: should we drop the WebRTC path (31416)?](#5-transport-should-we-drop-the-webrtc-path-31416)
6. [Exposure: Cloudflare Tunnel vs reverse-proxy vs Tailscale](#6-exposure-cloudflare-tunnel-vs-reverse-proxy-vs-tailscale)
7. [Authentication — require + harden (do not rebuild)](#7-authentication--require--harden-do-not-rebuild)
8. [Code changes this plan implies](#8-code-changes-this-plan-implies)
9. [Phased rollout](#9-phased-rollout)
10. [Answered inputs + the one open assumption](#10-answered-inputs--the-one-open-assumption)
11. [Sources](#11-sources)

---

## 1. Executive summary + verdict

**It is feasible, and the risky part is smaller than the roadmap feared — *if* we run the headless
Foundry client with its canvas disabled.**

The roadmap's stated fear was Foundry's PixiJS/**WebGL** canvas inside headless Chromium on ARM. That
fear is real: **SwiftShader's software-WebGL path is currently disabled on ARM in Chromium**
([Chromium docs](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md)), so
the naive "software-WebGL headless Chromium" approach the roadmap describes **does not work on a Pi**.

But the bridge module **does not need the rendered canvas**. It operates on Foundry *documents*
(actors, items, journals, chat, combat) and a socket — all available once the game reaches `ready`.
Foundry ships a client-side **"Disable Canvas"** setting (`core.noCanvas`) whose entire purpose is to
"bypass rendering of the game canvas but still allow the remaining functionality to fully function"
([foundryvtt#4518](https://github.com/foundryvtt/foundryvtt/issues/4518),
[Game Settings](https://foundryvtt.com/article/settings/)). Turning it on for the bridge's browser
profile means **no WebGL context is ever created**, which sidesteps the ARM blocker entirely and turns
the "heavy GPU workload" into an ordinary DOM+JS tab.

**Verdict for the Orange Pi 5 Pro (RK3588S, 16 GB): ✅ Go — comfortably.**

| Box | noCanvas headless bridge 24/7 | Note |
| --- | --- | --- |
| **Orange Pi 5 Pro — RK3588S, 16 GB** *(your box)* | ✅ **Comfortable** | 16 GB erases the memory concern; the A76 cores boot the world far faster than a Pi. ARM-WebGL is irrelevant because we run noCanvas. |
| *(Reference)* Pi 5 / 8 GB | ✅ Comfortable | — |
| *(Reference)* Pi 4 / 4 GB | 🟡 Tight but plausible | Would need discipline; your box is well above this. |
| **Fallback: mini-PC / small x86 VPS / HA Green** | ✅ Easiest of all | Only if the spike surprises us — architecture is identical, only the box changes. On x86 even full-canvas headless works (SwiftShader-WebGL is available there). |

The RK3588S is ARM64, so the SwiftShader-WebGL-disabled caveat (§2.1) still applies — which is exactly
why we run **noCanvas** and never create a WebGL context. (The Mali-G610 has open Panfrost/Panthor GL
ES drivers, so a *headed*-under-Xvfb hardware-WebGL path exists as a last resort, but we don't need it.)
The rest of the stack — standalone MCP backend, co-GM dashboard (Node + Anthropic API), and the
exposure daemon — all run fine on ARM64.

**Exposure recommendation (no domain): Tailscale on the Orange Pi.** Since you don't want a domain,
Cloudflare Tunnel + Access is out (it needs a domain on Cloudflare). "Reach it by IP" is safe **only if
the IP is encrypted** — a raw public IP + port-forward would carry your GM token in plaintext over the
internet. Tailscale gives you a **stable, WireGuard-encrypted `100.x` IP with no domain, no TLS certs,
and zero open router ports:**
- **Primary — Tailscale Serve (private tailnet):** you + the GM + player friends install the Tailscale
  client once and you approve their devices; everyone browses to `http://100.x.y.z:3000` (or the
  MagicDNS name). The tailnet is end-to-end encrypted, so plain HTTP is fine and there is **no public
  surface at all.** Most secure; the only cost is a one-time client install per person.
- **Alternative — Tailscale Funnel (public URL, no client for players):** exposes the dashboard at a
  public `https://<name>.ts.net` with **automatic valid TLS and no domain** (ports 443/8443/10000)
  ([Funnel docs](https://tailscale.com/docs/features/tailscale-funnel)). Players just open a URL — no
  install — but there's no built-in identity gate, so the dashboard's own hardened token auth (§7) is
  the *only* gate. Pick this only if the client-install friction is a dealbreaker.

Both are free at this scale. If you ever want a real public hostname without paying for a domain, the
fallback is a **free DuckDNS subdomain + Caddy + Let's Encrypt + one port-forward** — but that reopens
a router port and makes you the attack surface, so it's third choice. Full comparison in [§6](#6-exposure-cloudflare-tunnel-vs-reverse-proxy-vs-tailscale).

**Auth:** the token/email split in `cogm-dashboard/src/auth.ts` already exists — this plan **requires**
it (fail-closed off-localhost), adds **rate-limit + lockout**, and only trusts the Cloudflare-Access
email header **when actually behind Access**. No new auth framework.

---

## 2. Step 0 — feasibility spike: can a Pi run a headless Foundry client 24/7?

### 2.1 The core risk, precisely stated

Foundry's tabletop is a **PixiJS/WebGL** canvas. Headless Chromium renders WebGL through **SwiftShader**
(software GL). Two independent findings make the naive path fail on a Pi:

- **SwiftShader WebGL is disabled on ARM.** Chromium's own docs: headless uses SwiftShader by default,
  but "SwiftShader's support for WebGL is currently disabled on ARM pending resolution of an
  outstanding issue"
  ([swiftshader.md](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md),
  [issues.chromium.org/40277080](https://issues.chromium.org/issues/40277080)). So
  `--use-gl=swiftshader` gives you no WebGL on a Pi.
- **Headless has no display stack to hardware-accelerate.** The Pi 5's VideoCore VII *does* support
  GL ES 3.1 / WebGL2 via Mesa V3D, but that only helps a **headed** browser with a real (or virtual,
  Xvfb) display; a true-headless server "sees no gain from GPU acceleration"
  ([pidiylab](https://pidiylab.com/raspberry-pi-5-gpu-acceleration-desktop/),
  [RPi forums](https://forums.raspberrypi.com/viewtopic.php?t=378489)). Getting hardware WebGL
  headless means Xvfb + `--use-angle=gles` + the V3D driver — doable but fiddly and heavy.

### 2.2 The escape hatch that changes the verdict: `noCanvas`

The bridge module never reads pixels. It reads/writes **documents** and rides a socket. Confirmed
against the module source:

- The connection is established in Foundry's **`ready`** hook (`main.ts` — "Socket listener will be
  registered in the 'ready' hook"), which fires regardless of canvas.
- The only canvas coupling found in `packages/foundry-module/src`:
  - `main.ts:682` — a **`canvasReady`** hook used as a *secondary* reconnect nudge (not the primary
    connect).
  - `data-access/scenes-tokens.ts` — a handful of canvas-dependent operations (`canvas.pan`,
    grid-distance measurement) that **already guard** on `typeof canvas === 'undefined'`
    (`scenes-tokens.ts:163`).
  - `data-access/scene-fx.ts` — scene visual-FX writes.

Foundry's **"Disable Canvas"** client setting (`core.noCanvas`) bypasses canvas rendering while the
rest of the app "fully functions." Because it's **client-scoped**, we enable it *only* for the bridge
browser's profile — **the real players keep their canvas on.** With it enabled the bridge browser
never creates a WebGL context, so §2.1 is moot.

**What degrades (and why it's acceptable):** the ~half-dozen canvas-coupled *write* tools
(`place-measured-template`, `set-token-vision-light`, `set-scene-mood`/scene-fx, canvas pan, true-hex
distance) will no-op or return a graceful error on the bridge client. Everything document-level —
create/modify actors & NPCs, apply damage/healing, saves, initiative, rest, loot-as-items, journals,
quests, chat, combat tracking, diagnostics — works normally, because those are document mutations the
molten-hosting **server** persists and broadcasts to the players' real (canvas-on) browsers. Follow-up
(not a blocker): audit those tools to operate on documents directly (e.g. `scene.createEmbeddedDocuments('MeasuredTemplate', …)`)
so even they work canvas-less. Tracked in [§8](#8-code-changes-this-plan-implies).

### 2.3 Memory + process footprint

With `noCanvas`, the bridge tab is a normal Chromium page holding Foundry's document collections in
JS. Ballpark for one Foundry world tab: **~250–500 MB** resident (browser + renderer + the game's
in-memory documents), plus ~150 MB for Chromium's base processes. The Node backend + dashboard add
~150–250 MB. Total steady-state **≈ 0.8–1.2 GB**, which is why 4 GB is the practical floor and 8 GB is
comfortable. Long-run stability: schedule a **nightly browser recycle** (kill + relaunch the page) to
shrug off any renderer memory creep; the supervisor + module auto-reconnect make this invisible.

### 2.4 Toolchain gotcha: no bundled Chromium on ARM

Puppeteer/Playwright **do not ship an ARM Chromium build**
([puppeteer#7740](https://github.com/puppeteer/puppeteer/issues/7740)). On ARM64 you must use the
**system** browser: install Chromium, then `puppeteer-core` with
`executablePath: '/usr/bin/chromium'` and `args: ['--no-sandbox','--disable-setuid-sandbox']`.
(On x86/Docker the bundled build works, so a mini-PC/VPS avoids this entirely.) Recommendation:
**`puppeteer-core` + system Chromium** — lightest, and the well-trodden ARM path.

**Orange-Pi-specific note:** the Orange Pi 5 Pro runs Ubuntu-rockchip 24.04 / Armbian / Orange Pi OS,
all of which have Chromium available. On Ubuntu 24.04, `chromium` is packaged as a **snap**, which is
awkward for a fixed `executablePath` under a service — prefer a **`.deb` Chromium** (Debian/Armbian
`chromium` package, or the Rockchip-optimized build) so the binary path is stable for the supervisor.
Hardware acceleration isn't needed (noCanvas), so a plain Chromium is fine.

### 2.5 The spike to actually run (before building anything else)

A ~1-day, throwaway validation on the real box. **Pass criteria: the module shows "Connected" and a
read returns live world data, sustained for 24 h under a nightly recycle, RSS stable.**

```bash
# On the Pi (Raspberry Pi OS 64-bit):
sudo apt update && sudo apt install -y chromium-browser
node -v            # need 18+
# minimal puppeteer-core script (scratch, not committed):
#   1. launch system chromium headless, persistent --user-data-dir
#   2. pre-seed core.noCanvas=true in the profile (see §4.3), navigate to the
#      molten-hosting world URL, submit the dedicated bridge GM login
#   3. wait for `game.ready === true`; assert `ui.notifications` up, canvas disabled
#   4. leave it running; every N hours page.reload(); watch `free -m` + RSS
```

If the spike **fails** on the chosen Pi (won't stay logged in, RSS climbs unbounded, or the world
won't reach `ready` without canvas): fall back to a **mini-PC / small x86 VPS / HA Green**. The
architecture in §3 is unchanged — only the box moves — and on x86 both the memory pressure and the
ARM-WebGL question disappear.

---

## 3. Target architecture (everything on the Pi)

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  molten-hosting (remote)  —  Foundry VTT world over HTTPS            │
  │  players' real browsers connect here directly (canvas ON)           │
  └───────────────▲───────────────────────────────────────┬──────────────┘
                  │ players (unchanged)                    │ HTTPS page load
                  │                                        │ (bridge GM login)
                  │                          ┌─────────────▼──────────────┐
                  │                          │  THE PI  (or fallback box)  │
                  │                          │                             │
                  │   ┌──────────────────────┴───────────────────────┐    │
                  │   │  Headless Chromium (puppeteer-core)           │    │
                  │   │  - logged in as dedicated GM "AI Bridge"      │    │
                  │   │  - core.noCanvas = true (no WebGL)            │    │
                  │   │  - runs foundry-mcp-bridge module             │    │
                  │   └──────────────────────┬───────────────────────┘    │
                  │        module dials the LOCAL backend over loopback:   │
                  │        ws://127.0.0.1:31415  (or webrtc→127.0.0.1:31416)│
                  │   ┌──────────────────────▼───────────────────────┐    │
                  │   │  standalone MCP backend (standalone.js)       │    │
                  │   │  control 127.0.0.1:31414 · link :31415/:31416 │    │
                  │   │  ALL loopback-only                            │    │
                  │   └──────────────────────┬───────────────────────┘    │
                  │           loopback TCP 31414                           │
                  │   ┌──────────────────────▼───────────────────────┐    │
                  │   │  co-GM dashboard (server.js)                  │    │
                  │   │  127.0.0.1:3000 · owns ANTHROPIC_API_KEY      │    │
                  │   │  GM/player split enforced server-side         │    │
                  │   └──────────────────────┬───────────────────────┘    │
                  │   ┌──────────────────────▼───────────────────────┐    │
                  │   │  tailscaled  →  only :3000 leaves the box     │    │
                  │   │  Serve (private) or Funnel (public *.ts.net)  │    │
                  │   └──────────────────────┬───────────────────────┘    │
                  └──────────────────────────┼────────────────────────────┘
                                             │ WireGuard, no open router port
                            ┌────────────────▼─────────────────┐
                            │  Tailscale (encrypted mesh)       │
                            └───────┬───────────────────┬───────┘
                    GM token/device │                   │  player (token or device)
                     http://100.x:3000  (or ts.net URL)   .../player
                            ▼                            ▼
                     remote GM browser            player-friend browsers
```

**What changed vs. PHASE6-DESIGN.** There, Foundry dialed the bridge **across hosts** — which is why
31415/31416 had to be exposed and WebRTC needed STUN/TURN across NAT. Here the module's browser lives
**on the Pi next to the backend**, so 31414/31415/31416 are **loopback-only** and the whole
cross-host/NAT/TURN problem (PHASE6-DESIGN §5) **dissolves**. Only the dashboard (:3000) is ever
exposed, and only through the tunnel. The PC is required nowhere: Claude Desktop is now **optional**
(the dashboard is the AI surface, calling the Anthropic API directly).

---

## 4. The headless bridge client — design

### 4.1 Which browser driver

**`puppeteer-core` + system Chromium** (§2.4). Puppeteer is the lighter dependency and the documented
Pi path; Playwright works too but its value-add (cross-browser, richer autowait) is irrelevant for one
long-lived Chromium tab. A tiny new supervised process — call it the **bridge-client** — owns the
browser lifecycle. It is *not* part of the frozen wire contract and can live in a new
`packages/mcp-server/src/bridge-client/` or a small `deploy/` script; it talks to nothing but the
molten-hosting URL (out) and is otherwise headless glue.

### 4.2 Which Foundry user (GM-level, confirmed required)

The bridge **requires GM-level access.** `queries.ts`/`validateGMAccess` today allows
`game.user.isGM || allowNonGmAccess()`; once we flip `allowNonGmAccess` to **false** (the security fix,
§7/§8), the *only* way through the gate is a genuine GM user. So the headless session must log in as a
**Gamemaster-role user**.

**Recommendation: a dedicated GM user** (e.g. name `AI Bridge`) rather than sharing your primary GM
login. Reasons: (a) a clean, separate audit trail for AI-originated changes; (b) it avoids fighting
your human GM for the same session when you both need to be "the GM"; (c) you can revoke it
independently. Foundry supports multiple Gamemaster/Assistant users, and the bridge's write path is
governed by the module's own permission tiers, so a second GM user is safe. **(Confirmed: a dedicated
GM-level user will be created — see [§10](#10-answered-inputs--the-one-open-assumption).)**

`allowNonGmAccess` posture for this topology: **default false, unlocked** (matches code-review B2). We
do not need non-GM access because the bridge logs in as a GM. The old "locked ON" hack
(`settings.ts:257` + `lockNonGmAccessSetting`) was for a single-user localhost world and is unsafe the
moment anything is reachable off-box.

### 4.3 Login + secrets + noCanvas seeding

- **Secrets on the host, never in source.** Store `FOUNDRY_URL`, `FOUNDRY_BRIDGE_USER`,
  `FOUNDRY_BRIDGE_PASSWORD` in a **gitignored `.env`** / systemd `EnvironmentFile` / Docker secret.
  Never commit them; never log them. (`.env` is already gitignored — verify the bridge-client reads
  from env only.)
- **Login flow.** molten-hosting serves a standard Foundry login (world join → player pick → password).
  The bridge-client automates: navigate → select the bridge GM user → type the password from env →
  submit → wait for `game.ready`.
- **Seeding `noCanvas` before first canvas init (chicken-and-egg).** `core.noCanvas` is a client
  setting stored in the browser. Two robust options: (a) use a **persistent `--user-data-dir`** and set
  it **once** interactively/first-run, then reuse the profile forever; or (b) inject it pre-navigation
  with Puppeteer `page.evaluateOnNewDocument(() => localStorage.setItem(...))` keyed to Foundry's
  client-settings storage. Option (a) is simplest and least brittle across Foundry versions —
  recommend it; document the one-time setup in `deploy/`.

### 4.4 Auto-reconnect + supervision

Three layers, defense-in-depth:

1. **In-page (module).** The module already reconnects on `ready`; note the `canvasReady` reconnect
   nudge (`main.ts:682`) won't fire in noCanvas mode, so add a lightweight in-page watchdog or rely on
   the module's `ready`-time connect + backend keepalive. (Small code note in §8.)
2. **Browser-level (bridge-client).** Detect logout / world-restart / page crash (`page` `close`/
   `error`, or `game.ready` going false) → re-login. Exponential backoff. Nightly scheduled recycle
   (§2.3).
3. **Process-level (supervisor).** `systemd` unit with `Restart=always` (or Docker
   `restart: unless-stopped`) for each of: bridge-client, standalone backend, dashboard, cloudflared.
   On a Foundry **update** the world briefly drops — layers 2+3 bring it back automatically.

### 4.5 Delivery on the box

Two equivalent options; pick per taste:

- **systemd units** (4 services) — most transparent on a Pi; easy `journalctl` logs.
- **Docker Compose** — extend `deploy/docker-compose.yml.template` with a **new `bridge-client`
  service** (the current Dockerfile deliberately excludes a browser — §8). Needs the ARM
  `chromium-browser` in the image and `--no-sandbox`.

---

## 5. Transport: should we drop the WebRTC path (31416)?

**Short answer: keep it for the spike; dropping it is a *possible* later simplification, not a
freebie — and the reason is subtle.**

The roadmap assumed "plain WebSocket over loopback should suffice." It *almost* does, but for one
browser-security detail:

- The molten-hosting Foundry page is **HTTPS**. A script in an HTTPS page opening
  **`ws://127.0.0.1:31415`** is precisely the **mixed-content case browsers have historically
  blocked/left ambiguous** — unlike plain `http://` fetches to loopback, which Chrome 53+ treats as
  secure ([Chromium 40386732](https://issues.chromium.org/issues/40386732),
  [MDN mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)). That is
  *exactly why* the module auto-selects **WebRTC** on HTTPS pages today: it POSTs an offer to
  `http://127.0.0.1:31416/webrtc-offer` (an HTTP request, which the loopback exception **does** allow)
  and brings up a DataChannel.
- So on the molten (HTTPS) world, the out-of-the-box transport is WebRTC — and because both peers are
  now on **loopback**, ICE finds a host candidate on `127.0.0.1` immediately: **no STUN, no TURN, no
  NAT traversal.** The single surviving WebRTC gap from PHASE6-DESIGN §5 is gone.

**Two clean end states:**

- **(A) Keep WebRTC (recommended for bring-up).** Zero code change; already works HTTPS-page→loopback;
  no STUN/TURN. Just make its signaling server bind **loopback** (§8, currently `0.0.0.0:31416`).
- **(B) Force WebSocket and retire 31416 (optional hardening).** *We control the headless browser*, so
  we can launch Chromium with `--unsafely-treat-insecure-origin-as-secure=http://127.0.0.1:31415`
  (and/or `--allow-running-insecure-content`), which makes `ws://` from the HTTPS page work. Then set
  `FOUNDRY_CONNECTION_TYPE=websocket` and we can delete the WebRTC signaling server and the werift
  dependency — a real attack-surface + dependency reduction (werift also carried the residual `ip`
  advisory noted in Claude.md). This is attractive **once the spike proves the client**, but it's a
  browser-flag bet worth validating, not a blind delete.

**Recommendation:** ship (A) to get live, then evaluate (B) as a follow-up simplification with its own
smoke test. Do **not** rip out 31416 before the client is proven.

---

## 6. Exposure: Cloudflare Tunnel vs reverse-proxy vs Tailscale

**Your constraint — no domain — is the deciding factor.** Cloudflare Tunnel + Access needs a domain
whose nameservers live on Cloudflare, so it's out unless you buy one. That leaves the no-domain
options, all of which keep everything but :3000 on loopback:

| Dimension | **Tailscale Serve** (private tailnet) | **Tailscale Funnel** (public `*.ts.net`) | DuckDNS + Caddy + port-forward | ~~Cloudflare Tunnel + Access~~ |
| --- | --- | --- | --- | --- |
| Needs a domain | **No** | **No** (free `*.ts.net`) | No (free DuckDNS subdomain) | **Yes** — disqualified |
| Open router ports | **None** | **None** | One (443) — your home IP is a target | None |
| Public attack surface | **None** (private mesh) | Public URL, app-auth only | Public port, you patch it | (n/a) |
| TLS | Not needed (WireGuard-encrypted; plain HTTP ok) | **Automatic valid cert** on `*.ts.net` | Let's Encrypt (DNS challenge), you renew | Edge |
| Player onboarding | **Install client once + you approve device** | **Just open a URL** | Just a URL | (n/a) |
| Identity gate | The tailnet (only approved devices) **+** dashboard token | **Dashboard token only** | Dashboard token only | (n/a) |
| Cost | Free | Free | Free | Domain ~$10/yr |
| Runs on Orange Pi ARM64 | ✅ | ✅ | ✅ | ✅ |
| Main downside | Client install per player | No built-in identity gate — leans entirely on §7 auth | You are the attack surface + patching | Needs a domain |

**Recommendation: Tailscale Serve (private tailnet) as the primary; Tailscale Funnel if client-install
friction is a dealbreaker.**

- **Serve** is the most secure by a wide margin: there is **no public surface at all**, the `100.x` IP
  is stable and WireGuard-encrypted end-to-end (so plain `http://100.x.y.z:3000` is safe — no TLS to
  manage), and the tailnet membership is a real outer gate *in front of* the dashboard's own GM/player
  token split (defense-in-depth). For "a few player friends," a one-time Tailscale install + a device
  approval from you is a modest ask and matches your "reach it by IP" instinct exactly — the IP is just
  a Tailscale IP.
- **Funnel** trades that outer gate for zero player-side install: it publishes the dashboard at
  `https://<name>.ts.net` with automatic valid TLS and **no domain**, on port 443
  ([Funnel docs](https://tailscale.com/docs/features/tailscale-funnel)). Because Funnel has no identity
  layer, the **hardened dashboard auth in §7 becomes the sole gate** — which is exactly why the
  rate-limit/lockout + strong-random-token + fail-closed work there is non-negotiable if you choose
  this. Still no open router ports.

DuckDNS + Caddy + Let's Encrypt + one port-forward is the only way to get a *public hostname you fully
own the path to* without paying for a domain, but it reopens a router port and puts you on the hook for
patching and renewal — third choice.

**Setup (Tailscale):** install on the Orange Pi (`curl -fsSL https://tailscale.com/install.sh | sh`;
`sudo tailscale up`), then either:
- **Serve:** `sudo tailscale serve --bg 3000` → the dashboard is reachable at the Pi's tailnet
  name/IP for every approved device. Add each player from the Tailscale admin console.
- **Funnel:** `sudo tailscale funnel --bg 3000` → public `https://<name>.ts.net`. (Enable Funnel for
  the node in the admin console first.)

The dashboard still binds **loopback** (`127.0.0.1:3000`); Tailscale is what forwards to it, so nothing
about the on-Pi loopback topology changes. The Cloudflare walkthroughs in
[REMOTE-ACCESS.md §3](REMOTE-ACCESS.md) / [PHASE6-DESIGN §6](PHASE6-DESIGN.md) remain on file if you
ever decide a domain is worth the ~$10/yr for the email-allow-list gate.

---

## 7. Authentication — require + harden (do not rebuild)

The split already exists in `cogm-dashboard/src/auth.ts` (constant-time token compare +
Cloudflare-Access email path) with config in `config.ts` (`GM_DASHBOARD_TOKEN`,
`PLAYER_DASHBOARD_TOKEN`, `GM_EMAILS`, `CF_ACCESS_EMAIL_HEADER`; token header `x-cogm-token`, query
`token`, cookie `cogm_token`). Confirmed exact names — do not rename. Harden it:

1. **Fail-closed off-localhost (required).** Today the split is **opt-in**: with no token/email set,
   `resolveRole` returns `'gm'` for everyone (`auth.ts:70`). That's fine bound to loopback, catastrophic
   if reachable otherwise. **Change:** when the dashboard is bound to anything other than loopback (or a
   new `REQUIRE_AUTH=true`/`trust proxy` signal is set), a missing GM credential must **refuse to
   start** (or force every request to `player`/401) — never silently grant GM. See §8.
2. **Strong random tokens.** Generate with `openssl rand -hex 32`. Never a human-chosen string; never a
   default baked in source; store in the gitignored `.env`/secret only. Document this; consider a
   startup check that rejects short/empty GM tokens when auth is required.
3. **Rate-limit + lockout on the token check.** Add a small per-IP limiter around the GM-token path
   (e.g. N failures → exponential backoff / temporary lockout) so a leaked URL can't be brute-forced.
   Applies to the `requireGm` middleware and the token compare.
4. **Never log tokens.** Audit the dashboard log lines around auth to ensure the presented token / GM
   secret / CF email are never emitted (even at `debug`). The constant-time compare already avoids
   timing leaks; keep it.
5. **Trust the CF-Access email header only behind Access.** `auth.ts:74` reads
   `cf-access-authenticated-user-email` verbatim. In the **Tailscale** topology chosen here there is no
   Cloudflare Access in front, so this header must be **ignored entirely** unless a real Access
   deployment is later added — otherwise anyone reaching :3000 could forge it. **Change:** only honor
   the header when an explicit `CF_ACCESS_ENABLED`/`trust proxy` signal says we're actually behind
   Access (ideally validating the `Cf-Access-Jwt-Assertion` JWT against the team's keys); default
   **off**. Binding :3000 to **loopback** (item 3) is the topological backstop that makes the header
   unreachable-by-forgery regardless.

Net (Tailscale topology): the **outer gate** is the mesh itself — with **Serve**, only Tailscale-
approved devices can even reach :3000, and the dashboard's GM/player token split is the inner layer;
with **Funnel**, there is no outer gate, so the hardened token auth here is the *sole* gate and items
2–4 (strong random token, rate-limit/lockout, no logging) are mandatory, not optional. Either way, the
GM token/email is generated with `openssl rand -hex 32`, lives only in the gitignored `.env`, and never
reaches a player (server-side redaction, `redact.ts`).

---

## 8. Code changes this plan implies

Grouped by "must ship before exposure" vs "supporting the topology" vs "follow-up." File:line anchors
are from HEAD at time of writing. Each is a small, independently-committable, keep-it-green unit.

### A. Security — must land before anything is reachable off the Pi (overlaps code-review B1/B2/H1/H2/H5)

1. **Loopback-by-default binds, explicit opt-in for `0.0.0.0`.** Introduce a single
   `FOUNDRY_BIND_HOST` (default `127.0.0.1`) and thread it through:
   - `packages/mcp-server/src/foundry-connector.ts:84` — WebRTC signaling `listen(31416, '0.0.0.0')`
     → bind `FOUNDRY_BIND_HOST`. Also drop the wildcard `Access-Control-Allow-Origin: '*'`
     (`:58`) to the bridge origin.
   - `packages/mcp-server/src/foundry-connector.ts:164` — WS `httpServer.listen(this.config.port)` (no
     host → `0.0.0.0`) → `listen(this.config.port, bindHost)`.
   - `packages/mcp-server/src/config.ts` — read/validate `FOUNDRY_BIND_HOST`; pass into the connector
     config. Control channel already binds `MCP_CONTROL_HOST` (`backend.ts:628`) — keep loopback.
   - In the on-Pi topology all three are loopback, so this is mostly a safety assertion; still required
     so a misconfig can't silently expose them.
2. **Flip `allowNonGmAccess` default → `false` and unlock the toggle.**
   `packages/foundry-module/src/settings.ts:257` (`default: true` → `false`) and remove/neuter
   `lockNonGmAccessSetting()` (`:419`, `:428`) so the UI checkbox is editable. Update the misleading
   comment. The headless bridge logs in as a GM, so it doesn't need the bypass.
3. **Dashboard: bind loopback + `trust proxy`.** `packages/cogm-dashboard/src/server.ts:585`
   `app.listen(config.port)` → `app.listen(config.port, config.bindHost)` with default `127.0.0.1`;
   add `app.set('trust proxy', …)` when behind the tunnel. New config keys in
   `cogm-dashboard/src/config.ts` (`BIND_HOST`, a `trustProxy`/`REQUIRE_AUTH` signal).
4. **Fail-closed auth when reachable off-localhost.** `cogm-dashboard/src/auth.ts` +
   `server.ts`/`config.ts`: when `REQUIRE_AUTH` (or non-loopback bind) is set, refuse to start with no
   GM credential, and never default `resolveRole` to `'gm'`. (`auth.ts:70`.)
5. **Rate-limit + lockout + no-token-logging on the GM token path.** Around `requireGm`/`resolveRole`
   and the token compare in `cogm-dashboard/src/auth.ts` + `server.ts`.
6. **CF-Access header trust only behind Access.** `cogm-dashboard/src/auth.ts:74` — gate the email-header
   trust on `trust proxy`/tunnel provenance (ideally validate the Access JWT). Loopback bind (item 3)
   is the topological backstop.

### B. Supporting the on-Pi headless topology

7. **New `bridge-client` supervised process** (`puppeteer-core` + system Chromium): login automation,
   `noCanvas` profile, auto-reconnect, nightly recycle (§4). New code, outside the frozen wire
   contract. Reads creds from env only.
8. **`deploy/` additions:** a `bridge-client` service in `docker-compose.yml.template` (+ ARM
   `chromium-browser` in the image / a dedicated stage), four **systemd unit** templates
   (bridge-client, backend, dashboard, cloudflared) with `Restart=always` and `EnvironmentFile`, and a
   one-time `noCanvas` profile-seed note. The current `deploy/Dockerfile` explicitly ships **no
   browser** — extend or add a variant.
9. **In-page reconnect for noCanvas.** `packages/foundry-module/src/main.ts:682` — the `canvasReady`
   reconnect nudge won't fire with canvas disabled; add a `ready`-time/interval watchdog fallback so
   the module self-heals without the canvas hook. Small, backward-compatible.

### C. Follow-ups (not blockers)

10. **(Optional) Retire WebRTC (31416).** If we adopt transport plan (B) in §5
    (`--unsafely-treat-insecure-origin-as-secure` + `FOUNDRY_CONNECTION_TYPE=websocket`), delete the
    signaling server (`foundry-connector.ts:54–94`) and the werift dependency, with its own smoke test.
11. **Canvas-less write tools.** Rework the ~half-dozen canvas-coupled writes (`scenes-tokens.ts`
    templates/vision-light, `scene-fx.ts`) to operate on documents directly so they work on the
    noCanvas bridge client. Cross-refs the code-review write-gate items too.
12. **Control-channel auth (H2, defense-in-depth).** Even loopback-only, add an optional shared-token
    on TCP :31414 (`backend.ts:543`) so a hostile local process can't drive the router. Low priority
    given loopback + single-tenant Pi.

**Green bar:** every unit keeps `npm run typecheck && npm run lint -- --quiet && npm run build` + vitest
passing, per Claude.md. Wire ids (`foundry-mcp-bridge`, ports 31414/31415/31416, query prefix, settings
namespace) are **not** touched.

---

## 9. Phased rollout

1. **P0 — Spike (§2.5).** Prove a noCanvas headless Foundry client stays connected 24 h on the chosen
   box. *Gate: if it fails, switch to the fallback box before any code.* Report the verdict.
2. **P1 — Security fixes (§8-A).** Land items 1–6 behind flags, keep green. These are the code-review
   blockers and are independently valuable even before hosting.
3. **P2 — Bridge-client + supervision (§8-B).** Build the headless client + systemd/compose; run the
   full stack locally on the Pi, all loopback, dashboard reachable at `http://<pi>:3000` on the LAN.
4. **P3 — Expose via Tailscale (§6).** Install `tailscaled` on the Orange Pi; `tailscale serve 3000`
   (private) or `tailscale funnel 3000` (public URL); dashboard stays loopback + fail-closed auth
   required. Live end-to-end: remote GM + a test player friend.
5. **P4 — Hardening follow-ups (§8-C).** Optionally retire WebRTC (B), canvas-less write tools,
   control-channel token.

---

## 10. Answered inputs + the one open assumption

Confirmed 2026-07 and folded in:

1. ✅ **Box: Orange Pi 5 Pro — RK3588S, 16 GB LPDDR5.** Verdict: comfortable Go (§1). ARM64, so
   noCanvas is the path; 16 GB removes memory pressure.
2. ✅ **No domain — reach it by IP.** → **Tailscale** (Serve primary / Funnel alternative); Cloudflare
   deprioritized because it needs a domain (§6).
3. ✅ **Dedicated GM-level Foundry user** will be created for the headless session (§4.2). Secrets in a
   gitignored `.env` on the box.

**One remaining assumption to confirm (non-blocking):** that the molten-hosted world is served over
**HTTPS** (standard for hosted Foundry). This only affects §5's transport detail — on HTTPS the module
uses the WebRTC-over-loopback path out of the box (no STUN/TURN), which is what the plan assumes. If it
were plain HTTP, plain `ws://` loopback would just work and WebRTC could be dropped immediately. Either
way the architecture is unchanged.

Nothing else blocks. Say the word to push this doc and/or start P1 (the §8-A security fixes).

---

## 11. Sources

- Chromium SwiftShader (software GL) — [swiftshader.md](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md);
  WebGL-on-ARM disabled — [issues.chromium.org/40277080](https://issues.chromium.org/issues/40277080)
- Foundry "No-Canvas" mode — [foundryvtt#4518](https://github.com/foundryvtt/foundryvtt/issues/4518);
  [Game Settings](https://foundryvtt.com/article/settings/)
- Raspberry Pi 5 GPU (VideoCore VII / Mesa V3D) & headless caveat —
  [pidiylab](https://pidiylab.com/raspberry-pi-5-gpu-acceleration-desktop/);
  [RPi forums: HW accel in headless Chromium](https://forums.raspberrypi.com/viewtopic.php?t=378489)
- Puppeteer no ARM Chromium (use system chromium) —
  [puppeteer#7740](https://github.com/puppeteer/puppeteer/issues/7740)
- `ws://` loopback from HTTPS is the ambiguous/blocked mixed-content case —
  [Chromium 40386732](https://issues.chromium.org/issues/40386732);
  [MDN Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)
- Tailscale Funnel (public `*.ts.net`, no domain, auto-TLS, ports 443/8443/10000, end-to-end
  encrypted) — [Tailscale Funnel docs](https://tailscale.com/docs/features/tailscale-funnel);
  Serve (private tailnet) — [Tailscale Serve docs](https://tailscale.com/docs/features/tailscale-serve)
- Orange Pi 5 / RK3588S OS + Chromium (Ubuntu-rockchip 24.04 / Armbian) —
  [Armbian forum: HW-accel Chromium on Orange Pi 5](https://forum.armbian.com/topic/26188-hardware-acceleration-with-chromium/)
- (If a domain is ever added) `cloudflared` on ARM64 —
  [Cloudflare Tunnel system requirements](https://developers.cloudflare.com/tunnel/downloads/system-requirements/);
  Access free ≤ 50 users — [Cloudflare Zero Trust plans](https://developers.cloudflare.com/cloudflare-one/plans/)
