# Roadmap & Recommendations

Where this fork goes next. Most of the original roadmap has shipped — this file now tracks
what's done and what's left, plus the "live update in a Claude session" analysis that the
co-GM dashboard came out of.

See also: [BUILT.md](BUILT.md), [FIXES.md](FIXES.md), [FEATURE-IDEAS.md](FEATURE-IDEAS.md).

---

## Shipped (as of v0.13.0)

- **Combat-resolution suite** — `apply-damage-and-healing`, `roll-saving-throws`,
  `roll-initiative-for-npcs`, `manage-rest`, `use-npc-activity`. The AI can actually run a 5e round.
- **Encounter & scene tooling** — `suggest-balanced-encounter`, `place-measured-template`,
  `set-scene-mood`, `drop-loot`, `add-map-note`, `set-token-vision-light`.
- **`get-recent-events`** — the incremental "what changed since timestamp X" session delta.
- **Module diagnostics** (v0.12.0) — `get-module-errors` / `get-modules` / `get-module-manifest` /
  `clear-module-errors`.
- **Roll-request button fixes** (v0.10.1 / v0.10.2) — loading (ad-blocker filename) and the dnd5e v5
  save-object formula + save proficiency. See [FIXES.md](FIXES.md).
- **Standalone co-GM dashboard** (`packages/cogm-dashboard`, v0.13.0) — the live-update "option 1"
  below, now built: read-only feed + combat tracker + streaming AI commentary + post-to-chat, a
  hardened reconnecting MCP control client (TCP keepalive, heartbeat, half-open recovery), and a
  **live module-error feed** where the co-GM offers a likely cause/fix on new errors.
- **Distribution & CI** — manifest-URL install from the published fork + GitHub Releases
  (`release.yml`, tag `v*`); `ci.yml` runs build/checks.

---

## Remaining

### Near term

- **Re-verify the roll-request button** on the current dnd5e / Foundry after each system bump — the
  bug is fixed, but it's the kind of thing that drifts; smoke-test per upgrade.
- **Version-robustness.** Keep pinning behavior to the installed system version and lean on the test
  bench after each Foundry/dnd5e update (status classification, `uses.spent` vs `value`, chat
  `style` vs `type` were the historical drift points).
- ✅ **Dashboard design overhaul** _(shipped v0.15.0)_ — "Modern Command Center" redesign: refined
  typography/spacing/density, reworked diagnostics pane + status bar, and a graduated responsive
  layout that fixes the mobile overflow. See [COGM-DASHBOARD.md](COGM-DASHBOARD.md).

### Medium term

- ✅ **Dashboard calls tools _back_ into Foundry** _(shipped v0.15.0)_ — a GM control surface:
  confirm-gated `/api/tool` proxy (read/write/destructive classification + master GM-Actions switch),
  a generic schema-driven Tool Runner for every bridge tool, and a curated combat panel with
  multi-select combatants and a batch action bar.
- **`wait-for-game-event` long-poll tool** _(optional)_ — the in-Claude-Desktop alternative for
  "while I'm chatting, keep me posted." The dashboard supersedes it for live/autonomous use; only
  build it if the in-chat loop is specifically wanted. Analysis below.

### Make it my own (the detach + product push)

Detached to the standalone repo **Gnuminator/Foundry-VTT-MCP-Ai-Tool** ("Foundry AI Tool"); the full
staged plan + locked decisions live in [DETACH-PLAN.md](DETACH-PLAN.md). Status + what's left:

- ✅ **Detach + rebrand** (Phases 0–2) — clean history (my 30 commits over a single upstream baseline,
  no Adam-authored commits), surface rebrand, **README rewritten from scratch**, LICENSE/CREDITS.
- **Trim scope** (do next, before the rewrite): remove Mac support (no Mac to test) and go **D&D-only**
  (drop the pf2e/dsa5/wfrp4e/cosmere adapters + their tools) — less to document and reimplement.
- **Architecture spec → staged reimplementation** (Phases 3–4): document the trimmed system from first
  principles, then rebuild it module-by-module behind stable contracts. _(Opus for the spec + the
  socket-bridge step; Sonnet for the grind.)_
- **Standalone bridge + remote access** (Phase 6): decouple the bridge from Claude Desktop so the
  dashboard runs without it; reach the **hosted** Foundry over the network; later move to a Pi/VPS;
  expose to you + your GM via a **Cloudflare Tunnel + Access gate**; add the **player vs GM split**
  (server-side-filtered, write surface behind auth).
- **Presentation** (Phase 7, once polished): a real landing README (branding + demo GIF) **and** a
  standalone showcase page; in-app visual polish later.
- **Priority rule:** mobile/tablet support is **last** — never built in parallel; only after v1 desktop
  is done.

### Code review 2026-07 — action backlog

Full audit in [CODE-REVIEW-2026-07.md](CODE-REVIEW-2026-07.md) (HEAD `bfbc93b`, v0.18.0). The two biggest
items are their own sessions: **decommission ComfyUI entirely** and **design remote hosting for the GM**.
Everything else outstanding is below, roughly in priority order.

**Security — before any non-localhost exposure (do with / right after the hosting session):**

- [ ] Gate the `0.0.0.0` binds behind an explicit opt-in, loopback by default: WebRTC signaling
      (`foundry-connector.ts:84`, **Blocker**), main WS server (`foundry-connector.ts:164`), dashboard
      (`cogm-dashboard/src/server.ts:585`).
- [ ] Flip `allowNonGmAccess` default to **false** and unlock the UI toggle (`foundry-module/src/settings.ts:257`, **Blocker**).
- [ ] Add auth to the control channel (TCP :31414) — no allow-list / token today (`backend.ts:69`,`543`).
- [ ] Verify the Cloudflare-Access email header (JWT/signature or `trust proxy` + upstream-IP), don't
      trust it verbatim (`cogm-dashboard/src/auth.ts:74`).

**Write-permission gate holes (High):**

- [ ] Route through `permissionManager.checkWritePermission`: `setActorOwnership`
      (`data-access/ownership-players.ts:58`), `createActorFromCompendiumEntry`
      (`data-access/actor-creation.ts:165`), `addActorItems` (`:307`), `actor-builder` writes,
      `setTokenVisionLight` (`data-access/scenes-tokens.ts:596`), `scene-fx` writes.
- [ ] Enforce the HIGH_RISK tier: `checkWritePermission` should read `WriteOperation.requiresGM`; gate
      `deleteTokens` under `deleteData`, not MEDIUM (`foundry-module/src/permissions.ts`).

**Player-view leaks (High):**

- [ ] Strip exact numbers/hidden names from the player event feed `description`
      (`cogm-dashboard/src/redact.ts:141` + `foundry-module/src/session-events.ts:522`).
- [ ] Filter journal reads by `ownership` so GM-only "secret" pages aren't returned
      (`data-access/journals.ts:44`).
- [ ] Server-side verify roll-completion attribution — don't trust client `userId` / DOM `data-*`
      (`data-access/player-rolls.ts:532`, `foundry-module/src/main.ts:543`).

**Correctness / functionality:**

- [ ] Fix `link-quest-to-npc` silent no-op fallback (`tools/quest-creation.ts:888`) + real post-write verify.
- [ ] Reject negative currency in `drop-loot` (`tools/loot.ts:64`).
- [ ] `system-detection` — retry/expire the `'other'` cache instead of poisoning it forever (`utils/system-detection.ts:32`).
- [ ] WebRTC incoming `chunked-message` reassembly (`foundry-module/src/webrtc-connection.ts`).
- [ ] Fix the Foundry-mock 16-char-type id collision (`test-support/foundry-mock/documents.ts:88`).

**Tests (High-risk untested files):**

- [ ] Add coverage for `socket-bridge.ts`, `queries.ts`, `foundry-connector.ts`, `main.ts`, `index.ts`,
      `job-queue.ts`, and the dashboard feed (`mcp-control-client.ts`, `polling-feed.ts`).

**Housekeeping / drift:**

- [ ] Decide the dead runtime Zod schemas in `shared/src/protocol.ts` — wire the validation or drop them.
- [ ] Drop unused dep `axios` from `mcp-server`; resolve the `tslib` reference in `tsconfig.json`.
- [ ] Sync workspace `package.json` versions to root (0.18.0); regenerate `TOOL_INVENTORY.md` (73 tools,
      not 57); refresh PROJECT-STATUS test counts (1,959).
- [ ] Remove dead PF2e formatting branches (`tools/character.ts`, `tools/compendium.ts`) and the unused
      in-memory job subsystem in `tools/map-generation.ts`.
- [ ] Audit the unreviewed surfaces: `installer/` NSIS + `configure-claude.ps1`, the release workflows,
      `deploy/Dockerfile`.

### Remote hosting for the GM — target architecture (session 2)

**Decided: run everything on the Raspberry Pi so the PC is never a requirement anywhere.**

- Foundry stays on **molten-hosting** (remote); a separate later todo covers migrating it off.
- **On the Pi:** the **standalone MCP backend** (`standalone.ts`, Foundry-link ON) + a **persistent
  headless-browser session** running the bridge module logged into the molten-hosted world + the
  **co-GM dashboard**. All wire links (31414 control, 31415 WS, 31416 WebRTC) become **loopback on the
  Pi** — which dissolves the earlier cross-host / 0.0.0.0 exposure problem for those ports. Only the
  dashboard (:3000) is exposed externally, behind the reverse-proxy/tunnel + auth.
- The dashboard is the AI surface (Anthropic API directly), so **Claude Desktop becomes optional**, not
  a dependency. A human can still point Claude Desktop at the Pi's backend over the VPN when wanted.
- Because the module-browser and backend are co-located on the Pi, the **WebRTC path (31416) may be
  droppable** — plain WebSocket over loopback should suffice. Evaluate.
- Auth is **not** a from-scratch build: `cogm-dashboard/src/auth.ts` already has a shared GM/player
  token model (constant-time compared) + a Cloudflare-Access email path — _require + harden_ it (fail
  closed, strong random tokens, rate-limit/lockout, don't trust the CF header unless actually behind
  Access).
- Exposure: leaning **Pi reverse-proxy + port-forward**; compare fairly against `cloudflared`-on-Pi
  (free at this scale — only a domain ~$10/yr — and **no open router ports**) and Tailscale.

**Biggest new risk to validate: can the Pi run a headless Foundry client 24/7?** Foundry's canvas
(PixiJS/WebGL) in headless Chromium is heavy on ARM. Check the Pi model/RAM; research
Puppeteer/Playwright + software WebGL (SwiftShader) + Docker flags; keep a fallback host (mini-PC / VPS
/ HA Green) if the Pi can't cope. The headless session also needs Foundry login creds stored as secrets
on the Pi + auto-reconnect on disconnect/world-restart.

- [ ] **Later / investigate:** migrating the Foundry _game server_ off molten-hosting (self-host on the
      Pi / elsewhere). Feasibility unknown; separate from the headless-client work above.

---

## The "live update in a Claude session" question (why the dashboard exists)

**Verdict: not possible inside Claude Desktop today** — which is exactly why the co-GM dashboard is a
separate app. Researched against the MCP spec and Anthropic's docs:

- The MCP protocol _does_ define server→client push (notifications, resource subscriptions,
  `sampling/createMessage`). But Anthropic's connector docs list **resource subscriptions and sampling
  as "not yet supported,"** and tools are strictly request/response — **nothing can wake the model
  unprompted.** Even if sampling shipped, the spec mandates human approval per call, so no silent
  autonomous reactions.

### Options, ranked

1. **Best for genuinely live + autonomous — a standalone co-GM dashboard + the Anthropic Messages API
   (streaming). ✅ SHIPPED (`packages/cogm-dashboard`, v0.13.0).** The AI commentary lives outside the
   Claude chat window: the dashboard pulls the game feed off the bridge control channel and calls the
   Messages API with streaming, pushing commentary (and now live module-error diagnostics) to a
   dashboard page, with optional post-back into Foundry chat. Prompt caching on the campaign/system
   context controls cost.
2. **In-Claude-Desktop, polling-simulated — a `wait-for-game-event` long-poll tool.** A tool that
   blocks server-side until the next Foundry event (or a timeout) and returns it; instruct the model to
   call it in a loop. The only in-chat option, but the model must keep choosing to loop, it consumes
   context each iteration, latency = poll interval, and a user turn must start it. Not built — the
   dashboard covers the live/autonomous case.
3. **Don't bother (yet):** Claude Code background watchers / Routines — MCP notifications land in logs,
   not the model's context, so the async loop doesn't close; Routines run cloud-side and can't reach a
   local Foundry. Waiting on Claude Desktop to support sampling won't help either (human-in-the-loop).

---

## Longer term / bigger bets

- **A dedicated co-GM client app.** The dashboard is the foundation; "taken further" means it owns the
  conversation, subscribes to the game feed, streams reactions, and calls tools back into Foundry — a
  purpose-built AI-GM surface rather than the general-purpose Claude Desktop chat.

## Operational

- **Deployment / distribution.** ✅ Done — manifest-URL install from the published fork + GitHub
  Releases (`release.yml`), so updates don't require manual file replacement on the host.
- **CI.** ✅ `ci.yml` (build/checks on push) + `release.yml` (tag-driven release that builds and
  attaches the module zip).
