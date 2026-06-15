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
