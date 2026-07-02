# Orange Pi deployment — copy-paste prompts for a Claude session _on the Pi_

This is the "hand it to Claude on the box" companion to [REMOTE-ACCESS-PLAN.md](REMOTE-ACCESS-PLAN.md).
It has three parts:

- **Phase 0 — human bootstrap** (you, ~20–30 min): the unavoidable steps to get the Orange Pi booted
  and a Claude Code session running on it. Claude can't set up the machine it doesn't yet live on, so
  this part is manual. It's short and copy-pasteable.
- **Part 1 prompt** — paste into the Pi's Claude session to take the box from "fresh OS + Claude
  installed" to "this project builds green and is ready to deploy."
- **Part 2 prompt** — paste next to build + deploy the remote-hosting stack, fully autonomous.

Target box: **Orange Pi 5 Pro (RK3588S, 16 GB)**. No domain → **Tailscale** exposure. A **dedicated
GM-level Foundry user** drives the headless bridge. All per the plan.

> **Golden secret rule (applies to every phase):** secrets — the Foundry bridge password, your
> Anthropic API key, the GM dashboard token, Tailscale keys — live **only** in a gitignored `.env`
> on the Pi with `chmod 600`. They are **never** committed, never printed to logs, never pasted into a
> chat. The prompts below enforce this.

---

## Phase 0 — human bootstrap (do this once, by hand)

You need: the Orange Pi 5 Pro, its power supply, a microSD card (or an NVMe SSD + USB adapter), an
Ethernet cable (simplest), and another computer to flash the OS.

1. **Flash the OS.** Download an Ubuntu 24.04 image for the Orange Pi 5 Pro (the Orange Pi official
   "Ubuntu Jammy/Noble" image, or the community **Ubuntu-Rockchip** build for RK3588). Flash it to the
   microSD (or NVMe) with **balenaEtcher** (https://etcher.balena.io) or Raspberry Pi Imager. A `.deb`
   Chromium (not snap) is the reason to prefer a Debian/Ubuntu image — see the plan §2.4.
2. **First boot.** Insert the card, connect Ethernet, power on. Find the Pi's LAN IP from your router
   (or plug in a monitor + keyboard for the first login). Default login is usually `orangepi` /
   `orangepi` — **change the password immediately** (`passwd`).
3. **SSH in** from your main computer: `ssh orangepi@<pi-lan-ip>`. (Optional but nice: set up an SSH
   key.)
4. **Install Node 20 LTS:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node -v    # expect v20.x
   ```
5. **Install Claude Code and sign in:**
   ```bash
   sudo npm install -g @anthropic-ai/claude-code
   mkdir -p ~/foundry-ai && cd ~/foundry-ai
   claude        # follow the login prompt (browser code or API key), then you're at the Claude prompt
   ```
6. You now have a Claude session running in `~/foundry-ai` on the Pi. **Paste the Part 1 prompt below.**

> If the GitHub repo is **private**, have a Personal Access Token ready — Part 1 will ask for it to
> clone. If it's public, no token is needed.

---

## Part 1 prompt — from fresh OS to "builds green, ready to deploy"

Paste everything in the box into the Pi's Claude session.

```text
You are running on an Orange Pi 5 Pro (Rockchip RK3588S, 16 GB RAM, ARM64) that I just set up. Your
job in THIS session is to take this box from "fresh Ubuntu + Node + Claude installed" to "the Foundry
AI Tool project is cloned, builds green, and the machine has every system dependency the remote-hosting
deployment will need." Do NOT deploy anything or write any secrets yet — that's the next session.

Context you should read first (after cloning): docs/REMOTE-ACCESS-PLAN.md and docs/PI-DEPLOY-PROMPTS.md
and Claude.md in the repo. The plan is the spec; this box is the "everything on the Pi" host in it.

Do the following, checking each step succeeded before moving on, and stop and ask me if anything fails:

1. System prep. Update apt. Install: git, build-essential, ca-certificates, curl, and a **.deb**
   Chromium (NOT the snap — a snap breaks a fixed executablePath under a service). Try
   `sudo apt-get install -y chromium` or `chromium-browser`; if apt only offers a snap, tell me and
   propose a .deb source before proceeding. Record the resulting Chromium binary path (e.g.
   /usr/bin/chromium) — the deploy step needs it.
2. Install Tailscale (do not run `tailscale up` yet): `curl -fsSL https://tailscale.com/install.sh | sh`.
3. Clone the repo into ~/foundry-ai/repo and check out the working branch:
   `git clone https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git repo` then
   `cd repo && git checkout claude/remote-gm-hosting-design-cwllhf`. If the clone needs auth, ask me
   for a GitHub token (I'll paste it; do NOT store it in the repo or echo it back).
4. Configure git identity for any commits you may make later:
   `git config user.email noreply@anthropic.com && git config user.name Claude`.
5. Install dependencies and build: `npm ci` then `npm run build`.
6. Prove the baseline is green exactly as Claude.md requires:
   `npm run typecheck && npm run lint -- --quiet && npm run build` and then `npm test`. Report the test
   totals. If anything is red, STOP and show me — do not "fix" product code in this setup session.
7. Create the deployment skeleton WITHOUT secrets: a directory ~/foundry-ai/run and a template file
   ~/foundry-ai/run/.env.example listing every variable the backend + dashboard + bridge-client will
   need (from docs/REMOTE-ACCESS-PLAN.md §7/§8 and docs/PHASE6-DESIGN.md §4) with placeholder values
   and comments. Do NOT create the real .env yet. Make sure ~/foundry-ai/run is NOT inside the git repo
   so secrets can never be committed.
8. Sanity-report: print node version, npm version, the Chromium binary path and `chromium --version`,
   free memory (`free -h`), disk (`df -h /`), and confirm Tailscale is installed (`tailscale version`).

When done, give me a short readiness summary: what's installed, the Chromium path, the green-bar
result, and confirm the box is ready for the Part 2 deploy prompt. Do not proceed to deployment.
```

---

## Part 2 prompt — build + deploy the remote-hosting stack (autonomous)

Paste this once Part 1 reports green. Have your secrets ready to paste when asked (Foundry world URL,
the dedicated bridge GM username + password, your Anthropic API key). Claude will generate the GM
dashboard token itself.

```text
You are on the Orange Pi 5 Pro, in ~/foundry-ai/repo on branch
claude/remote-gm-hosting-design-cwllhf, which builds green. Your job THIS session is to build and
deploy the "everything on the Pi" remote-hosting stack from docs/REMOTE-ACCESS-PLAN.md — fully, but
safely and verifiably. Read docs/REMOTE-ACCESS-PLAN.md (especially §4 the headless bridge client, §5
transport, §6 Tailscale, §7 auth, §8-B/§8-C code changes, §9 phases) and Claude.md before you start.

HARD RULES (do not violate):
- Secrets ONLY in ~/foundry-ai/run/.env with chmod 600. Never commit them, never print them, never put
  them in code, systemd unit bodies that get committed, or logs. The repo's .env files are gitignored —
  keep it that way.
- Do NOT touch the frozen wire identifiers: module id foundry-mcp-bridge, ports 31414/31415/31416,
  the query-method prefix, the settings namespace.
- Never call any mcp__foundry-mcp__* tool.
- Keep it green after every code change: npm run typecheck && npm run lint -- --quiet && npm run build,
  plus npm test. Commit per logical unit with clear messages and the trailers already configured; push
  to origin on this same branch (claude/remote-gm-hosting-design-cwllhf). Do NOT open a PR unless I ask.
- Everything except the dashboard stays on loopback: set FOUNDRY_BIND_HOST=127.0.0.1,
  MCP_CONTROL_HOST=127.0.0.1, dashboard BIND_HOST=127.0.0.1. Only Tailscale exposes port 3000.

BUILD (code — commit + push each unit):
1. Implement the headless bridge-client described in the plan §4 and §8-B item 7: a small supervised
   Node process using puppeteer-core + the system Chromium (executablePath from Part 1). It must:
   log into the molten-hosted Foundry world as the dedicated GM user using creds from env; enable the
   client-side "Disable Canvas" (core.noCanvas) so no WebGL context is created (seed it via a persistent
   --user-data-dir per plan §4.3); wait for game.ready; auto-reconnect on logout/world-restart/page
   crash with backoff; and do a nightly page recycle. Add tests where practical. Keep it OUTSIDE the
   frozen wire contract.
2. Add the plan §8-B item 9 in-page reconnect fallback for noCanvas (the canvasReady nudge won't fire).
3. Add deploy artifacts under deploy/: systemd unit templates for the standalone backend, the
   dashboard, the bridge-client, and Tailscale — each with Restart=always and an EnvironmentFile
   pointing at ~/foundry-ai/run/.env (units reference the file; they don't inline secrets).

DEPLOY (host config — NOT committed):
4. Create ~/foundry-ai/run/.env (chmod 600) from the Part 1 .env.example. Ask me for: the Foundry world
   URL, the dedicated bridge GM username + password, and my Anthropic API key. Generate a strong GM
   dashboard token yourself with `openssl rand -hex 32` and set GM_DASHBOARD_TOKEN. Set REQUIRE_AUTH=true,
   the loopback binds above, LOG_LEVEL=info, and leave CF_ACCESS_ENABLED unset/false (we're on Tailscale,
   not Cloudflare Access).
5. Install and start the systemd services (backend → dashboard → bridge-client). Verify: the backend
   control channel is up on 127.0.0.1:31414; the bridge-client browser reaches game.ready and the
   Foundry module shows "Connected"; the dashboard is listening on 127.0.0.1:3000 with playerGmSplit
   enabled.
6. Bring up Tailscale: run `sudo tailscale up` and give me the login URL to authorize the node. Then,
   per plan §6, default to PRIVATE access: `sudo tailscale serve --bg 3000`. Tell me the tailnet
   URL/IP. (If I say I want a no-install public URL for players instead, switch to
   `sudo tailscale funnel --bg 3000` and confirm auth hardening is on — it's the only gate then.)

VERIFY (end to end, per plan §9 P3):
7. From the tailnet, confirm the dashboard loads and, with the GM token, a read tool (e.g. "Get World
   Info") returns live Foundry data. Confirm an unauthenticated GM-endpoint call is refused (401/403),
   and that a wrong token eventually trips the lockout (429). Restart the backend service and confirm
   the dashboard + bridge reconnect on their own.
8. Write a runbook to deploy/PI-RUNBOOK.md (commit it — no secrets): how to start/stop/restart each
   service, where the .env lives, how to rotate the GM token, how to check the bridge-client is logged
   in, and how to recover after a Foundry update. Then give me a final report: what's running, the
   tailnet URL, the green-bar result, and anything you couldn't complete.

If any step is ambiguous or a decision has real trade-offs (e.g. Serve vs Funnel, a Chromium quirk on
this board, a Foundry login change), ask me before charging ahead. Otherwise proceed autonomously.
```

---

## Notes / gotchas the Pi session should watch for

- **Chromium snap trap.** On Ubuntu 24.04 the `chromium` apt package can be a snap wrapper; its binary
  path isn't a stable file for `executablePath` and it sandboxes oddly under systemd. Prefer a real
  `.deb` Chromium; if only snap is available, that's a "stop and ask" moment (Part 1 step 1).
- **`--no-sandbox`.** Headless Chromium under a service on ARM typically needs
  `args: ['--no-sandbox','--disable-setuid-sandbox']`. Fine here — the browser only ever loads your own
  Foundry world.
- **noCanvas seeding is one-time.** Use a persistent `--user-data-dir`; set `core.noCanvas` once, then
  the profile keeps it. Don't rely on toggling it after canvas has already initialized.
- **HTTPS Foundry → WebRTC-over-loopback** is the default transport and needs no STUN/TURN because both
  peers are on 127.0.0.1 (plan §5). Only chase the WS-force option if WebRTC misbehaves.
- **Tailscale Funnel = app-auth is the only gate.** If you choose Funnel over Serve, the hardened
  dashboard token/rate-limit is the sole protection — keep REQUIRE_AUTH on and the GM token strong.
