# Project Status — Foundry AI Tool (synthesis, 2026‑06)

A whole-project review produced by a 5-agent read-only audit (architecture, feature-parity vs upstream,
backlog, code-quality, test/CI health). This is a point-in-time **map + prioritized backlog** to resume
from — not a plan of record. The plans of record remain `docs/DETACH-PLAN.md` (master log) and
`docs/PHASE9-DOMAIN-REWRITE.md` (the data-access rewrite checklist).

**Headline:** the project is functionally live (v0.16.0 released + live-smoke-passed; ~1,874 tests green
across the monorepo). It is **ahead of upstream** in features, not behind. Since this audit was written,
(1) the GitHub **release workflow fix** + a `typecheck && lint` CI gate landed, and (2) **Phase 9
data-access is now complete (16/16 domains rewritten/refactored to parity)** including the `characters`
pf2e-prune. The top remaining finding is (3): the highest-risk code (`socket-bridge.ts`, `queries.ts`,
WebRTC) is still **untested**.

---

## 1. Architecture at a glance

npm-workspaces monorepo. Runtime data flow:

```
Claude Desktop ─[MCP stdio]─► mcp-server/src/index.ts (wrapper)
                                   │ TCP JSON-lines :31414 (control channel)
                                   ▼
                              mcp-server/src/backend.ts  ◄── cogm-dashboard (also a :31414 client)
                                   │ WebSocket :31415  (or WebRTC :31416 on HTTPS)
                                   ▼
                              foundry-module (browser) ──► CONFIG.queries["foundry-mcp-bridge.*"]
                                   │                              └─► data-access.ts → live Foundry API
                                   └─ GM-gated at the `ready` hook
```

Frozen wire IDs: module id `foundry-mcp-bridge`, socket channel `module.foundry-mcp-bridge`, query prefix
`foundry-mcp-bridge.*`, control port `31414`, Foundry-link WS `31415`, WebRTC signaling `31416`,
ComfyUI `31411`.

| Package          | LOC   | Purpose                                                             | Maturity                               |
| ---------------- | ----- | ------------------------------------------------------------------- | -------------------------------------- |
| `shared`         | ~740  | Wire contracts (constants/protocol/types/zod schemas)               | Solid (rewritten); ~42 tests           |
| `mcp-server`     | ~22k  | MCP stdio wrapper + backend engine; 57 tools; ComfyUI map pipeline  | Upstream-derived; ~1,030 tests         |
| `foundry-module` | ~18k  | In-browser Foundry ESModule; only component with live Foundry API   | data-access fully rewritten (P9 16/16) |
| `cogm-dashboard` | ~2.4k | Express + SSE co-GM dashboard; Anthropic narration; player/GM split | Original work; ~28 tests               |

Cross-cutting: `permissions.ts` (LOW/MED/HIGH write-gate + `validateGMAccess`), `transaction-manager.ts`
(rollback ledger — Actor/Token implemented; Scene/Item/Delete are intentional stubs), `session-events.ts`
(rolling chat/event buffers powering the log tools), the Foundry-mock harness (`foundry-module/src/
test-support/foundry-mock/`) that makes ~732 in-memory data-access tests possible.

---

## 2. Feature parity vs upstream (`adambdooley/foundry-vtt-mcp`)

**The fork is AHEAD, not behind.** Fork exposes **57 MCP tools**; upstream is at v0.8.2 (Jun 2026) with
~40 and has added no new tools since the fork point. All the Phase 4 additions (chat, resources, effects,
combat, movement, session-log, combat-resolution, encounter/scene-fx, loot, diagnostics) are fork-only.

- **Deliberate removals (do NOT restore):** macOS support; non-D&D adapters dsa5/pf2e/wfrp4e/cosmere-rpg.
- **One genuine feature gap:** **no Windows setup/installer MCP tool.** Upstream ships `mac-setup` tools
  (`check-mac-setup-status`/`run-mac-setup`/`get-mac-setup-progress`) so Claude can install ComfyUI for the
  user; the Windows-only fork has no equivalent (`win-setup.ts` would be net-new). Optional, MED value.
- **Trim collateral to verify (not confirmed broken):** possible macOS paths in
  `foundry-module/src/comfyui-manager.ts`. (The pf2e/cosmere dead branches in
  `mcp-server/src/utils/system-detection.ts` + `utils/compendium-filters.ts` were pruned in Section A,
  2026‑06‑16.)

---

## 3. Health & risks — prioritized

1. **✅ RESOLVED (2026‑06‑16).** ~~🔴 Release workflow broken (CONFIRMED).~~ The canonical
   `build-complete-release.yml` (+ legacy `foundry-module-release.yml`) `@v6 → @v4` pin fix landed in
   Section A. (Original finding: `@v6` doesn't exist, so the release failed on any tag push.)
2. **✅ RESOLVED (2026‑06‑16).** ~~🟠 CI doesn't gate typecheck/lint.~~ The `typecheck && lint` green-gate is
   now an explicit `ci.yml` step (and the lint baseline was cleaned 640→0 errors). (Original finding: a
   type/lint error that didn't break the build could slip through.)
3. **🟠 Highest-risk untested code.** `foundry-module/src/socket-bridge.ts` (live wire contract) and
   `queries.ts` (MCP→data-access dispatch router) have zero tests; a regression there breaks the bridge
   silently and the data-access tests won't catch it. WebRTC path (`webrtc-connection.ts` / `webrtc-peer.ts`,
   werift 0.23.0) is gated only by a manual live smoke. (Section A closed the `combat-resolution.ts` gap, so
   all 24 tool files are now covered.) Dashboard `server.ts`/`sse.ts`/AI layer untested. **Top remaining
   item.**
4. **🟡 `queries.ts` dual handler registration (verify intent).** The 6 token-manipulation handlers are
   registered twice — camelCase and kebab-case (`queries.ts` ~lines 91–99 vs 123–130). Likely intentional
   dual-format support (production works), but confirm the protocol and drop one side if redundant.
5. **✅ RESOLVED (2026‑06‑16).** ~~🟡 Residual multi-system dead code (policy violation).~~ Section A pruned
   the pf2e/cosmere dead code from `mcp-server` (`utils/system-detection.ts` — `GameSystem` → `'dnd5e' |
'other'`, `utils/compendium-filters.ts`, `tools/compendium.ts`), behind a typecheck pass. (Original
   finding: those three files still carried executable pf2e/cosmere logic in a D&D-only repo.)
6. **🟡 `backend.ts` (1,555 lines) — zero tests + mixed concerns + swallowed errors** (process lock, ComfyUI
   lifecycle, job queue, WS server, tool registration in one file; bare `catch`/`console.error` at a few
   sites). Decompose before testing. Effort: L.
7. **`comfyui-client.ts:486`** fakes progress with `Math.random()` (`// Placeholder — ComfyUI doesn't expose
real-time step progress`). Cosmetic.

**`any` baseline:** ~340 `as any` + ~459 `: any`. ~136 of the data-access casts are architecturally
unavoidable (no Foundry type package installed); ~50–80 (in `backend.ts`/`index.ts`/`system-detection.ts`/
tools) are reducible. Zero `@ts-ignore`/`@ts-expect-error` — a good signal. A `shared` `FoundryActor`-ish
interface would narrow many casts (`actor-builder.ts` alone has 43).

---

## 4. Backlog

### Phase 9 — data-access rewrites ✅ COMPLETE (16/16 domains, 2026‑06‑16)

See `docs/PHASE9-DOMAIN-REWRITE.md` (per-domain checklist). All 16 modules are now rewritten/refactored
from first principles behind their frozen characterization nets. The last four deferred domains landed
2026‑06‑16:

| Domain           | Disposition                    | Net                                                                             |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `creature-index` | rewritten (253a17b)            | `data-access.creature-index.test.ts` (31) — unblocks `compendium` enhanced path |
| `actor-creation` | rewritten (c478d1e)            | `data-access.actor-creation.test.ts` (42)                                       |
| `player-rolls`   | rewritten (994afbc)            | `data-access.player-rolls.test.ts` (34)                                         |
| `actor-builder`  | refactored to parity (ad62281) | `data-access.actor-builder-{npc,items,activity}.test.ts` (95)                   |

The **`characters` pf2e-prune** follow-up is also done (3a2fce2, after the 4edb7e5 partial prune):
`data-access.character-search-extra.test.ts` (+7) pins the dnd5e category/level/prepared contract, then the
inert pf2e fallbacks (`rank`, `location.prepared`/`location.expended`, the `focus` check, the `invested`
branch) were dropped. Only remaining purity item: the 4 large mcp-server tool files owned-via-tests only.

### Phase 6 — remote access / standalone / player-GM split (templated, NOT deployed)

Code is built + green (standalone bridge entry, dashboard role-split/auth/redact). Blocked on provisioning,
not code: Cloudflare Tunnel/Access, Docker/compose, Windows service (all templates in `deploy/`); TURN
server for WebRTC-across-NAT; per-event hidden-combatant suppression in `redact.ts`. Runbook:
`docs/PHASE6-DESIGN.md` §6.

### Release

**v0.16.1 queued** — gated on the user running the live werift WebRTC smoke
(`docs/DEPENDENCY-PATCH-SMOKE-TEST.md`), then tag. The release-workflow `@v6→@v4` fix is already in (risk #1
resolved), so the tag build is unblocked.

### Phase 7 — presentation (partial): live demo GIF, `/player` screenshot, showcase site, Pages deploy.

---

## 5. Recommended next sequence

1. ~~**Quick wins (S):**~~ **DONE (2026‑06‑16):** release-workflow `@v6→@v4`; `typecheck && lint` gate added
   to `ci.yml`; pruned the residual pf2e/cosmere dead code in `mcp-server`; added the `combat-resolution.ts`
   test.
2. ~~**Finish Phase 9 (M–L each):**~~ **DONE (2026‑06‑16):** all 4 remaining data-access domains rewritten/
   refactored to parity (`creature-index` → `actor-creation` → `player-rolls` → `actor-builder`), then the
   `characters` pf2e-prune. Phase 9 data-access is complete (16/16). **Next active item is #3.**
3. **Close the top test gaps (M):** `socket-bridge.ts` + `queries.ts` (mock `game.socket`; assert dispatch
   routing — the Foundry-mock harness is already in place); a minimal dashboard `server.ts` SSE/route test.
4. **Release v0.16.1** once the user runs the WebRTC smoke.
5. **Phase 6 infra** when there's appetite to provision hosting.
6. **Optional:** a Windows setup MCP tool (`win-setup.ts`) for parity with upstream's macOS installer.

---

_Method note: this synthesis came from 5 parallel read-only Sonnet investigators; the release-workflow and
data-access-rewrite findings were spot-verified directly. Treat the "verify" items (queries dual-reg, ComfyUI
Mac paths) as leads, not confirmed facts._
