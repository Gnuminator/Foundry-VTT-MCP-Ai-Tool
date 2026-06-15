# Plan: Detach from upstream & make it your own

A staged plan to take this from "a fork of `adambdooley/foundry-vtt-mcp`" to **your own project**,
safely, across multiple sessions. Open this cold in a new session and start at "Start here."

> **Status (2026‑06‑15):** Phases 0–2.5 done — detached to the standalone repo, clean history,
> surface rebrand to **"Foundry AI Tool"**, Mac support removed, non-D&D system adapters removed
> (dsa5, pf2e, wfrp4e, cosmere-rpg). Now **Windows-targeted + D&D 5e only**.
> Next: **Phase 3 (architecture)** → Phase 4 (reimplement).
>
> **Priority rule — mobile/tablet is LAST.** Don't build mobile/tablet support in parallel; it comes
> only when v1 desktop is DONE. Keep the responsiveness that already came free with the design, but
> invest no further in mobile until then.

## The honest size of it

| Package                   | Files | ~LOC    | Origin            |
| ------------------------- | ----- | ------- | ----------------- |
| `packages/mcp-server`     | 68    | ~22,300 | upstream-derived  |
| `packages/foundry-module` | 13    | ~18,000 | upstream-derived  |
| `packages/cogm-dashboard` | 12    | ~2,400  | **already yours** |
| `shared`                  | —     | ~740    | mostly upstream   |

History: 200 commits rooted in adambdooley's "Initial release" (2025‑08‑27); the GitHub repo is a
**fork** (shows "forked from"). So a literal clean-room rewrite of the bridge is ~40K LOC of working,
multi-system code — a multi-**month** effort. This plan separates the cheap, high-impact "it's mine"
work from the expensive "rewritten from scratch" work so you can stop at whatever depth you want.

---

## Phase 0 — Decisions (do first; ~30 min, no code)

1. **Identity:** project name, Foundry module `id`, npm scope (`@foundry-mcp/*` → `@you/*`), author,
   GitHub repo name.
2. **License:** keep `LICENSE` (MIT) + attribution while _any_ upstream code remains; add your own
   copyright line; license code you write yourself however you like. (Not legal advice — the safe,
   good-faith path is "keep MIT + credit upstream until nothing original remains.")
3. **Repo strategy** — ✅ DECIDED: **(b) fresh standalone repo.** New home created at
   **https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool** (standalone, not a GitHub fork). Push the
   code there and make it canonical; retire the old fork (`Gnuminator/Foundry-VTT-MCP`).
4. **History** — ✅ DECIDED: **keep my own dev commits, drop the upstream ones.** The lineage is clean
   for this — the fork point is **`dba53ec`** (Adam Dooley, 2026-06-07) and the **30 commits after it
   are all mine (Gnuminator)**. So collapse everything up to `dba53ec` into a single **baseline** commit
   and replay my 30 commits on top: the new repo reads "Baseline (forked from upstream, MIT)" + my 30
   dev commits, **no Adam-authored commits**. ⚠️ This drops Adam's _commits/lineage_, not his _code_ —
   the baseline still contains the upstream code my commits build on; actually replacing that code is
   the Phase 4 reimplementation. Credit upstream in `CREDITS.md`/`NOTICE` + the baseline commit message.
5. **Rewrite scope** — pick one:
   - **Rebrand + reorganize (recommended first):** make it unmistakably yours (identity, README,
     structure; the dashboard is already original) _without_ rewriting the engine. Fast, low-risk,
     gets ~80% of the "this is mine" feeling.
   - **Staged reimplementation (the real goal):** additionally reimplement the upstream-derived code
     module-by-module "from the idea," behind stable contracts, over many sessions.
   - **Avoid:** a big-bang rewrite — too risky for a tool you run live.

---

## Phase 1 — Git / remote detach + clean history (~30–45 min)

Goal: the new repo's history = one **baseline** commit + my 30 dev commits, with no Adam-authored
commits. Fork point is `dba53ec`; the 30 commits in `dba53ec..HEAD` are all mine. Recipe:

1. **Safety first:** `git branch backup-full-history` (nothing is lost if the rewrite goes sideways).
2. **Build the clean history:**
   - `git checkout --orphan new-main dba53ec` — working tree = fork-point tree, no parent commit
   - `git commit -m "Baseline: forked from adambdooley/foundry-vtt-mcp @ dba53ec (MIT) — see CREDITS.md"`
   - `git rebase --onto new-main dba53ec main` — replays my 30 commits onto the baseline (applies
     cleanly: identical tree, so no conflicts), preserving their original author/date/messages
   - Verify: `git log --oneline` shows the baseline + 30 commits; `npm run build` still passes.
3. **Remotes:** `git remote add aitool https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git`;
   remove upstream `git remote remove origin`; retire the old `fork`.
4. **Push** the cleaned `main` to the new repo (only on my confirm): `git push -u aitool main`.
5. Update the remotes/release notes in `CLAUDE.md` so future sessions target the new repo, not upstream.

## Phase 2 — Rebrand (~half a day, mostly mechanical)

- `packages/foundry-module/module.json`: `id`, `title`, `authors`, `description`, URLs.
- `package.json` files: package names + `author`; `LICENSE` (+ a `NOTICE`/`CREDITS` crediting upstream).
- README rewrite (this is the separate "redesign the front page" todo — do it here).
- CI/release workflow names; any branded strings.
- ⚠️ **Load-bearing identifiers:** the module `id`, the socket channel name, settings namespace, and
  the `foundry-mcp-bridge.*` query method names are wire contracts — the in-Foundry module, the
  control channel, and the dashboard all depend on them, and existing installs key off the module id.
  **Recommendation:** rebrand the _surface_ (name/title/docs/repo) first and keep the wire identifiers
  stable; do a true rename later as its own change with a migration note (it breaks existing installs).

## Phase 2.5 — Trim scope: remove Mac support + go D&D-only (do BEFORE Phase 3)

Shrinks what you have to document (Phase 3) and reimplement (Phase 4), and aligns the codebase with how
you actually use it. Both are low-risk deletions — do them now.

- **Remove Mac support** (no Mac to test): delete `packages/mcp-server/src/setup/mac-installer*.ts` and
  `tools/mac-setup.ts`, strip Mac branches from platform utils, drop Mac CI jobs + installer bits +
  Mac docs. Watch that `utils/platform.ts` keeps the Windows detection you still need.
- **Go D&D-only** (you only play 5e): remove the `pf2e`, `dsa5`, `wfrp4e`, `cosmere-rpg` system adapters
  under `packages/mcp-server/src/systems/`, their system-specific tools (e.g. the DSA5 character
  creator/importer), and their registry/index registrations. Keep the **dnd5e** adapter cleanly behind
  the registry abstraction (don't hard-code) so the design stays sound.
- Verify green (typecheck/lint/build) + a mock-bridge smoke test after each removal.

## Phase 3 — Architecture from the idea (write the spec)

- Author `docs/ARCHITECTURE.md` describing the system from first principles — the IDEA, not the code:
  an MCP server that exposes Foundry as tools; an in-Foundry module that bridges over a socket; the
  JSON-lines control channel; the (dnd5e-only, after Phase 2.5) system adapter; the job queue;
  security/GM-gating; and the standalone co-GM dashboard. Document the **trimmed, Windows-targeted,
  D&D-only** system you're keeping — it's the spec you reimplement against and the evidence the design
  is yours.

## Phase 4 — Staged reimplementation (the long pole; many sessions)

Reimplement **behind stable external contracts** so the dashboard + Foundry keep working throughout.
Live status + done log lives in **`docs/PHASE4-TRACKER.md`** (read it to resume). Suggested order
(low-risk → high-value):

1. ✅ `shared` types — small; sets the vocabulary. **DONE** (2026-06-15) — reimplemented behind its
   frozen public surface, 34-test parity/contract guard added + wired into CI.
2. **Control-channel / socket-bridge protocol** — the contract everything depends on. Design + rewrite
   carefully (this is the part most worth Opus-level attention).
3. Foundry module `data-access` / `queries` layer.
4. **Tool layer, domain-by-domain** (combat, scene, compendium, actor-creation, effects, …). Each is a
   self-contained chunk; use `docs/TOOL_INVENTORY.md` as the parity checklist.
5. The **dnd5e** system adapter — last (the other systems are removed in Phase 2.5).

Per chunk: capture current behavior in tests first → reimplement → verify parity (the test bench +
a mock-bridge harness like the `temp/cogm-*.cjs` scripts) → ship. **Never leave it broken between
sessions.** Keep a "rewritten vs still-upstream" tracker so a fresh session resumes cleanly.

## Phase 5 — Cutover & docs

- New README/CREDITS, migration notes (if the module id changed), release under the new identity,
  live smoke test (Foundry open + bridge connected + dashboard).

> **Status (2026‑06‑15): v0.16.0 released on `aitool`** — first release under the new identity.
> Version bumped (root `package.json` + `module.json`); CHANGELOG rewritten (real v0.16.0 entry; the
> pre-detach multi-system entries bannered as historical lineage); `docs/MIGRATION.md` (module id
> unchanged → no breaking migration; existing installs reinstall once from the new manifest to repoint
> Foundry's update check from the old repo to the new one); `docs/SMOKE-TEST.md` (the user-driven live
> check). **Release workflow fixes** (the canonical path is `build-complete-release.yml`): module zip
> renamed `foundry-ai-tool-module.zip` → `foundry-mcp-bridge.zip` to match the frozen `download` URL
> (the old name 404s every install); added the `v*` tag-push trigger (it was dispatch-only and could
> never publish the full distribution on a tag); made `release.yml` a dispatch-only module-only
> fallback so it can't double-publish; added `permissions: contents: write` to the release job (the
> first run 403'd without it); hardened the Foundry-registry step (continue-on-error + skip-if-no-token
>
> - honour `dry_run_foundry`). GitHub Release + all 4 assets published and verified;
>   `releases/latest/download/{module.json,foundry-mcp-bridge.zip}` resolve (200).
>   **Live smoke test PASSED (2026-06-15).** User did steps 1–4 (install build, reinstall module from
>   the new manifest, restart Claude Desktop, open Foundry as GM) — the module settings show the MCP
>   Bridge **Connected**. Dashboard verified: `npm run dev:cogm` bound http://localhost:3000, connected
>   to the live bridge on `127.0.0.1:31414`, and read real world data ("Rime of the Frostmaiden", dnd5e)
>   — the full Foundry → bridge → control-channel → dashboard read path works end-to-end. **Phase 5
>   cutover complete.** Next: Phase 6 (do the dep-security prereq below first).

## Phase 6 — Standalone bridge + remote access (product goal)

> **Status (2026‑06‑15): prerequisite DONE; framework BUILT; infra TEMPLATED.**
> The dep-security prerequisite is patched (see the prereq note below — DONE). The
> infra-**independent** framework is built + green: **(A)** a standalone bridge entrypoint
> (`packages/mcp-server/src/standalone.ts`; control host/port injectable via
> `MCP_CONTROL_HOST/PORT`; `MCP_FOUNDRY_LINK=off` control-only mode; port-scoped lock; `npm run
bridge:standalone`; `scripts/standalone-smoke-test.mjs` in CI) and **(B)** the server-side
> player/GM split in the dashboard (`auth.ts` role resolution, `redact.ts` filtering, role-aware
> SSE, `requireGm` on the write surface, `/player` view; unit tests + `scripts/cogm-split-smoke-test.mjs`
> in CI). The infra-**dependent** parts are TEMPLATED, not deployed: **(C)** `docs/REMOTE-ACCESS.md`
>
> - `deploy/` (Cloudflare Tunnel/Access config, Dockerfile, compose, Windows service) and **(D)** the
>   design/roadmap `docs/PHASE6-DESIGN.md` (seams inventory + "when the infra is ready" checklist).
>   Test baseline now **1120** (shared 49, foundry-module 12, mcp-server 1030, cogm-dashboard 29).
>   **Remaining (needs your infra):** stand up Cloudflare + a VPS/Pi + reach the hosted Foundry, then
>   follow `docs/PHASE6-DESIGN.md` §6. The bridge currently still runs Claude-Desktop-spawned by default;
>   the standalone entry removes the hard dependency.

Make the tool usable by you **and** your GM from outside your PC. Decisions locked 2026‑06‑15:

- **Decouple the bridge from Claude Desktop first.** Today the control-channel backend
  (`127.0.0.1:31414`) the dashboard needs is _spawned by_ Claude Desktop's MCP config. Make it a
  standalone long-lived process (npm script / OS service) so the dashboard works with Claude Desktop
  closed. (Near-term it can still run in your Claude Desktop/Code session — this just removes the hard
  dependency.)
- **Foundry is HOSTED (Forge/VPS), not localhost** — a real constraint. Wherever the bridge runs it must
  reach the remote Foundry, and the in-Foundry module must reach the bridge. Confirm the module's
  connection path (it dials out to the MCP server — check the WebRTC/socket handshake) works across the
  network, not just on loopback.
- **Later, move the bridge + dashboard to an always-on host** (Raspberry Pi or cheap VPS) so it's up
  even when your PC is off. The "where does it live" answer evolves over time: Claude Desktop now →
  standalone process → Pi/VPS.
- **Remote access = Cloudflare Tunnel + Access gate** (chosen). New to it, so when we build this:
  1. Install `cloudflared` on the host; `cloudflared tunnel login` (authorize your Cloudflare account).
  2. `cloudflared tunnel create cogm` → creates the tunnel + a credentials file.
  3. Route a hostname (e.g. `cogm.yourdomain`) to `http://localhost:3000` (config file or dashboard);
     `cloudflared tunnel run cogm`.
  4. Put **Cloudflare Access** in front of that hostname (email/SSO allow-list for you + your GM) so it
     isn't open to the world. No port-forwarding, no exposed home IP.
- **Player vs GM split** (composes here): a player view (public combat order + public feed only — no
  diagnostics, hidden enemy HP/notes, or write actions) and a full GM view. Filter GM-only data
  **server-side** (the SSE stream + REST), not just in CSS, and gate the write surface server-side
  behind auth. The Anthropic API key stays server-side — never shipped to the browser.

### Phase 6 prerequisite — patch the network stack before exposing it (dep security)

`npm ci` during the v0.16.0 release surfaced 38 audit advisories (4 critical / 23 high). **Triaged
2026-06-15 — almost all are dev/types-only and never ship or touch the network:**

- **Non-shipping (ignore for runtime):** `handlebars` (critical) comes via `foundry-vtt-types` (a
  TypeScript types devDep); `vitest` (critical) is the test runner; `vite`/`lint-staged` EBADENGINE
  warnings are dev tooling. None reach the installer, the bundled server, or the compiled module.
- **Dead dep (safe to delete anytime):** `socket.io-client@^4.7.0` is a **runtime dep of
  `packages/foundry-module` that is not imported anywhere** in its `src/` — it drags in the
  `socket.io-parser` (critical) + `engine.io-client` + `ws@8.2` chain for nothing, and wouldn't ship
  regardless (the module is `tsc`-compiled, no bundler, browser-loaded). Removing it clears that whole
  chain from the production audit.
- **The only genuinely-shipping runtime advisories** are in **`packages/mcp-server`**'s WebRTC/socket
  stack — `ws@8.18.3` (moderate; non-breaking `npm audit fix`) and **`werift@0.17.7` → the `uuid`
  bounds-check advisory** (fix needs `werift@0.23.0`, a **breaking** bump → must be tested against the
  live bridge). This bridge is **loopback-only today** (low real risk), but **Phase 6 puts it on the
  internet** behind Cloudflare Access — so patch it here, before remote exposure.

**Do as Phase 6 prep:** (1) remove the dead `socket.io-client`; (2) non-breaking `npm audit fix` for
`ws`; (3) the breaking `werift` bump with a live-bridge smoke test; (4) bump the workflows' pinned
`actions/setup-node` from `20.12.2` → `20.19.x`/`22.x` to clear EBADENGINE (the shipped runtime targets
Node 18, so this is build-env hygiene only). Verify green + re-audit.

> **DONE (2026‑06‑15).** All four patched: dead `socket.io-client` removed; non-breaking `npm audit fix`
> (`ws 8.14→8.21`, `axios 1.6→1.18`, `@modelcontextprotocol/sdk 1.7→1.29`, `body-parser`, `path-to-regexp`,
> dashboard `express 4.19→4.22`); breaking **`werift 0.17.7→0.23.0`** (clears the `uuid` bounds-check;
> type-compatible, esbuild bundle parses); `vitest 3.2.4→3.2.6` (dev critical); `setup-node` bumped.
> **Audit: full 38→24 (remaining all dev/types via `foundry-vtt-types`), prod-only 15→3** (the 3 are the
> single `ip` advisory via `werift-ice`, no upstream fix). Green incl. wiped build + 1078 tests at the time.
> werift is the only shipping breaking bump and only affects the WebRTC path — **live confirm is
> user-driven** (`docs/DEPENDENCY-PATCH-SMOKE-TEST.md`). **Decision: hold a v0.16.1 patch release until
> that live WebRTC smoke passes, then cut it** (so users get the axios/MCP-SDK/ws/werift fixes). Tag only
> on explicit confirm.

## Phase 7 — Presentation (when functionality is polished)

> **Scoped 2026‑06‑15 → `docs/PHASE7-PLAN.md`.** Current state assessed (README already rebranded with
> 5 screenshots; `COGM-DASHBOARD.md` showcase exists). The plan splits the work into buildable-now
> (README redesign, showcase-site scaffold, wordmark), needs-assets (a 10–15s demo GIF — user-recorded
> from a shot-list), and needs-decisions (branding, scope, hosting). Phase 6 capabilities aren't in the
> README yet — fold them in. Mobile/tablet still deferred.

The current `docs/COGM-DASHBOARD.md` markdown showcase isn't enough. Build a real presentation —
**(1) a polished GitHub landing README** with branding + a 10–15s demo GIF/screen-capture, and **(2) a
standalone showcase page/site**. Do this once there's polished functionality to show. **In-app visual
polish** (beyond the current Modern Command Center pass) is a _given but later_ — after all
functionality is in. (Mobile/tablet stays deferred per the priority rule up top.)

## Phase 8 — Repo tidy (cosmetic; low priority, do alongside Phase 4/5)

The repo currently reads as a fresh fork, and the root is cluttered. Two things to fix:

- **"Baseline: forked from adambdooley…" on every file.** GitHub shows the last commit that
  touched each file, and most files were last touched by the single baseline squash commit, so the
  file list is wall-to-wall "Baseline: forked from…". This is cosmetic and inherent to the
  clean-history approach — it **resolves itself naturally** as Phase 4 reimplements files
  module-by-module (each rewritten file gets a fresh, descriptive last-commit). No history rewrite
  needed; just let the reimplementation commits land. Optionally shorten the baseline commit's
  subject line if a history rewrite happens for another reason.
- **Root-directory clutter.** ✅ **DONE (2026‑06‑15).** Deleted 15 dead/transient upstream working
  notes (`ADDING_NEW_SYSTEMS.md`, `BRANCH_COMPARISON_SUMMARY.md`, `DOCUMENTATION_COMPARISON.md`,
  `IMPLEMENTATION_ORDER.md`, `MCP_FOUNDRY_TEST_PROMPT.md`, `MCP_TEST_PROMPT.md`, `MIGRATION_PLAN.md`,
  `MISSING_TOOLS.md`, `PR4_ANALYSIS.md`, `PR4_USEFUL_PATTERNS.md`, `QUICK_START.md`,
  `REGISTRY_PATTERN_TEST.md`, `RISK_ANALYSIS.md`, `TEST_PROMPT.md`, `TEST_RESULTS.md`) + the two dead
  Mac dev scripts (`update-backend-now.sh`, `update-wrapper.sh`) + the stale upstream `INSTALLATION.md`
  (README's Installation section is canonical). Moved `TOOL_INVENTORY.md` → `docs/`. Root now holds
  only `README.md`, `LICENSE`, `CREDITS.md`, `CHANGELOG.md`, `Claude.md`, and config files. All
  removed files remain recoverable in git history; done in one focused commit.

## Phase 9 — Deep reimplementation (deferred; own phase)

Phase 4 chunk 3 deliberately stopped at **shrink + clean** for the Foundry module's `data-access.ts`
(removed all non-dnd5e remnants + dead code; the file is working, but it's large, browser-bound, and
not runtime-testable in a dev session). The deeper "make it truly mine" reimplementation of the module
is split out here as its own phase, to tackle when there's appetite for it. Decided order (2026-06-15):

1. **Full from-scratch reimplementation of `data-access` (and `queries`) from the idea**, domain by
   domain, behind the now-stable `shared` contract. High effort/risk because it's untestable browser
   plumbing — needs a Foundry-mock test harness built first (characterize current behavior, then
   reimplement to parity). This is the big one; treat as multi-session.
2. **Then reorganize** the result into cohesive domain modules (creature-index, characters,
   scenes/tokens, journals, spells, combat-resolution, …) instead of one monolith.

Also folds in the two items deferred from chunk 3 (they live in the module / browser side):

- **`transaction-manager` rewrite** (write-safety rollback; currently used by actor/token creation).
- **Foundry-link `import type` adoption** in `socket-bridge`/`webrtc-connection` (per the bundler
  policy in `docs/PHASE4-TRACKER.md` → Decisions: `import type` only, no runtime value imports).

Prereq worth doing first: a **browser/Foundry mock harness** so the module finally has real test
coverage — without it, a from-scratch rewrite of ~9.5k LOC can't be verified to parity.

**Also deferred here (Phase 4 chunk 4 decision, 2026-06-15): the 4 large mcp-server tool files.**
`character` (~1034), `dnd5e/add-feature` (~1038), `compendium` (~1329), `quest-creation` (~1380) are
**large-but-clean** (no cruft) and dominated by output-formatting helpers, so a from-scratch rewrite is
mostly transcription (the output format is the spec) — high-effort/low-value churn. They were given
**full characterization test suites** in chunk 4 (parity net pinning their exact output), so unlike
data-access these CAN be reimplemented verifiably whenever desired. Until then the whole tool layer is
**owned-via-tests** (824 mcp-server tests, all 23 tool files covered). Reimplement these only if the
ownership purity is wanted; the tests make it safe and the value is low, so it's genuinely optional.

---

## Working method (safe + resumable)

- **Contracts first**, then swap implementations behind them — the dashboard never sees a difference.
- **One module per session/chunk**; each ends green: typecheck + lint + build + tests + a mock-bridge
  or live smoke test.
- Reuse the verification harnesses in `temp/` (mock bridge speaks the JSON-lines protocol; run with
  `ANTHROPIC_API_KEY=''` + `MCP_CONTROL_PORT=<mock>` so it never touches the live bridge on 31414).
- Track progress in a checklist doc; treat the parity checklist as the definition of done.

## Model choice (Opus 4.8 vs Sonnet 4.6)

**Sonnet 4.6 is fine for most of this.** The bulk is well-specified reimplementation, mechanical
rebranding, and test-writing — Sonnet is fast, capable, and much cheaper, and the cost/speed compounds
over a multi-session grind. **Reserve Opus 4.8 (or fast-mode Opus) for the ~20% where mistakes are
expensive or the reasoning is deep:** the architecture/contract design (Phase 3), the socket-bridge /
transaction / concurrency rewrite (Phase 4 step 2), parity-decision calls, and reviewing each chunk.
Best pattern: **Opus plans/designs/reviews, Sonnet executes** — either switch with `/model` per
session, or have an Opus session orchestrate and spawn **Sonnet** subagents/workflows for the
per-module labor (per-agent model is selectable). Keeps judgment high where it counts and cost low
on the 40K-LOC grind.

---

## Start here (current state)

Phases 0–2 are **done** (detached repo, clean history, surface rebrand to "Foundry AI Tool"). Remaining
order:

1. **Phase 2.5 — trim** (remove Mac + non-DnD) — do first; less to document/reimplement. _(Sonnet)_
2. **Phase 3 — `docs/ARCHITECTURE.md`** from first principles, describing the trimmed system. _(Opus)_
3. **Phase 4 — staged reimplementation**, module by module behind stable contracts. _(Sonnet grind;
   Opus for the socket-bridge/protocol step + reviewing each chunk)_
4. **Phase 5 — cutover**, then **Phase 6 — standalone bridge + Cloudflare remote access + player/GM
   split**, then **Phase 7 — presentation**. Mobile/tablet last.
