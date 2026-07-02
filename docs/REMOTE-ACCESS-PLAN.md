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

**Author's note on open inputs.** Three facts were requested but not yet confirmed (the interactive
prompt failed in this environment). The plan is written to be correct across the plausible range and
flags each decision point. See [§10 What I need from you](#10-what-i-need-from-you). The single
gating input is **Pi model + RAM** — the feasibility verdict below is given as a matrix keyed to it.

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
10. [What I need from you](#10-what-i-need-from-you)
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

**Verdict by box (single gating input = Pi model/RAM):**

| Box | noCanvas headless bridge 24/7 | Recommendation |
| --- | --- | --- |
| **Pi 5 / 8 GB** (NVMe) | ✅ Comfortable | **Go.** Best Pi target. |
| **Pi 5 / 4 GB** | ✅ Workable | Go; watch memory, add zram/swap, nightly browser recycle. |
| **Pi 4 / 8 GB** | ✅ Workable (slower boot of the world) | Go. |
| **Pi 4 / 4 GB** | 🟡 Tight but plausible with noCanvas | Go with discipline (recycle browser daily, cap tabs to 1). |
| **Pi 3 / Zero 2W / <4 GB** | 🔴 Not recommended | Use a fallback box. |
| **Fallback: mini-PC / small x86 VPS / HA Green** | ✅ Easiest of all | If any doubt, this is the safe choice — **architecture is identical, only the box changes.** On x86, even full-canvas headless works because SwiftShader-WebGL is available there. |

The rest of the stack is unambiguously fine on any of these boxes: the standalone MCP backend, the
co-GM dashboard (Node + Anthropic API), and `cloudflared` all run happily on ARM64
([cloudflared system requirements](https://developers.cloudflare.com/tunnel/downloads/system-requirements/)).

**Exposure recommendation:** `cloudflared` (Cloudflare Tunnel + Access) **on the Pi** — zero open
router ports, Cloudflare absorbs scanning/DoS, free at this scale (Access is free ≤ 50 users
([Cloudflare Zero Trust plans](https://developers.cloudflare.com/cloudflare-one/plans/))); the only
real cost is a domain (~$10/yr). It also solves TLS for the dashboard for free. The self-hosted
reverse-proxy + port-forward option is a fair alternative but makes *you* the target and puts you on
the hook for TLS renewal, brute-force lockout, and patching an exposed port.

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
([puppeteer#7740](https://github.com/puppeteer/puppeteer/issues/7740)). On a Pi you must use the
**system** browser: `sudo apt install chromium-browser`, then `puppeteer-core` with
`executablePath: '/usr/bin/chromium-browser'` and `args: ['--no-sandbox','--disable-setuid-sandbox']`.
(On x86/Docker the bundled build works, so a mini-PC/VPS avoids this entirely.) Recommendation:
**`puppeteer-core` + system Chromium** — lightest, and it's the well-trodden Pi path.

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
                  │   │  cloudflared  →  only :3000 leaves the box    │    │
                  │   └──────────────────────┬───────────────────────┘    │
                  └──────────────────────────┼────────────────────────────┘
                                             │ QUIC/TLS, no open router port
                            ┌────────────────▼─────────────────┐
                            │  Cloudflare edge + Access gate    │
                            └───────┬───────────────────┬───────┘
                    GM email match  │                   │  player (token or open)
                     https://cogm.<domain>              https://cogm.<domain>/player
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
governed by the module's own permission tiers, so a second GM user is safe. If you'd rather not, the
plan works with your main GM login too — the only cost is the shared-session awkwardness. **(Confirm in
[§10](#10-what-i-need-from-you).)**

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

All three keep everything but :3000 on loopback. They differ in who absorbs attacks and what you
operate.

| Dimension | **Cloudflare Tunnel + Access** (on Pi) | Pi reverse-proxy + port-forward (Caddy/nginx + LE) | Tailscale / WireGuard |
| --- | --- | --- | --- |
| Open router ports | **None** | One (443) — your home IP is a target | None |
| Who absorbs scans/DoS/brute-force | **Cloudflare edge** | **You** | N/A (no public surface) |
| TLS | Automatic at edge | You own cert issuance + **renewal** | N/A |
| Player onboarding | Just a URL + email login | Just a URL | **Install a VPN client + you approve each device** |
| Identity gate | **Built-in (Access email allow-list, OTP/OAuth)** | You build (basic-auth / app tokens only) | Device-based, not per-person email |
| Cost | Free (Access ≤ 50 users); domain ~$10/yr | Domain + your time; DDNS if no static IP | Free tier fine at this scale |
| Runs on Pi ARM64 | ✅ | ✅ | ✅ |
| Main downside | Trust Cloudflare as TLS-terminating proxy | **You are the attack surface + on-call for patching** | Friction for casual player friends |

**Recommendation: Cloudflare Tunnel + Access on the Pi.** For "a few player friends," a URL + a
one-time-PIN email login is the lowest-friction *and* the most secure: no open ports, Cloudflare eats
the spam, TLS is free and auto-renewed, and the identity gate is a first layer *in front of* the
dashboard's own token check (defense-in-depth). Access is free at ≤ 50 users
([plans](https://developers.cloudflare.com/cloudflare-one/plans/)); the tunnel is free with unlimited
bandwidth; the only cost is a domain (~$10/yr). `cloudflared` runs fine on Pi ARM64
([system requirements](https://developers.cloudflare.com/tunnel/downloads/system-requirements/), and
numerous Pi walkthroughs).

Tailscale is the pick **only** if you'd rather no public surface exist at all and every player is
willing to install a VPN client and be device-approved — heavier for casual friends. The
reverse-proxy + port-forward option is respectable but makes you the target and the TLS/patching
operator for an internet-facing port; choose it only if you specifically want to avoid Cloudflare in
the path.

**Step-by-step (Cloudflare):** the exact `cloudflared tunnel login/create/route`, `config.yml`, and
Access-application steps are already written in [REMOTE-ACCESS.md §3](REMOTE-ACCESS.md) and
[PHASE6-DESIGN §6](PHASE6-DESIGN.md) — reuse them verbatim (the tunnel fronts `http://localhost:3000`
exactly as documented; nothing about the tunnel changes in the on-Pi topology).

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
   `cf-access-authenticated-user-email` verbatim. Anyone hitting :3000 directly (bypassing the tunnel)
   could forge it. **Change:** only honor that header when we know the request came through Cloudflare —
   set Express **`trust proxy`** appropriately and verify the request arrived via the tunnel (upstream
   IP / a shared secret header the tunnel injects, or ideally validate the Cloudflare Access **JWT**
   `Cf-Access-Jwt-Assertion` against the team's public keys). At minimum: bind :3000 to **loopback** so
   the *only* path to it is through `cloudflared`, which closes the direct-forge route by topology.

Net: with the dashboard on loopback behind the tunnel, GM identity requires **both** passing the
Cloudflare Access gate **and** presenting a valid GM token/email — two independent layers.

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
4. **P3 — Expose via Cloudflare (§6).** Stand up the tunnel + Access (reuse REMOTE-ACCESS.md §3), bind
   dashboard loopback, require auth. Live end-to-end: remote GM + a test player.
5. **P4 — Hardening follow-ups (§8-C).** Optionally retire WebRTC (B), canvas-less write tools,
   control-channel token.

---

## 10. What I need from you

1. **Pi model + RAM** (and storage: SD vs NVMe) — the single gating input for the §1 verdict. If it's
   a Pi 3 / Zero 2W / <4 GB, tell me and I'll spec the fallback box instead.
2. **Domain + Cloudflare** — do you already own a domain and have (or will make) a free Cloudflare
   account with its nameservers pointed at Cloudflare? If not, that's the one ~$10/yr purchase the
   recommendation needs.
3. **Bridge Foundry user** — OK to create a **dedicated GM-level** Foundry user on the molten-hosted
   world for the headless session (recommended), or must it reuse your main GM login? And confirm the
   world is served over **HTTPS** (standard for molten-hosting) so §5's transport logic holds.

Everything else in this plan proceeds without further input.

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
- `cloudflared` on ARM64 / system requirements —
  [Cloudflare Tunnel system requirements](https://developers.cloudflare.com/tunnel/downloads/system-requirements/)
- Cloudflare Access free ≤ 50 users —
  [Cloudflare Zero Trust plans](https://developers.cloudflare.com/cloudflare-one/plans/)
