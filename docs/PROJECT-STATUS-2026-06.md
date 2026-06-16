# Project Status — Foundry AI Tool (synthesis, 2026‑06)

A whole-project review produced by a 5-agent read-only audit (architecture, feature-parity vs upstream,
backlog, code-quality, test/CI health). This is a point-in-time **map + prioritized backlog** to resume
from — not a plan of record. The plans of record remain `docs/DETACH-PLAN.md` (master log) and
`docs/PHASE9-DOMAIN-REWRITE.md` (the data-access rewrite checklist).

**Headline:** the project is functionally live (v0.16.0 released + live-smoke-passed; ~1,830 tests green
across the monorepo). It is **ahead of upstream** in features, not behind. The most actionable findings are
(1) the GitHub **release workflow is broken** (trivial fix), (2) Phase 9 has **4 data-access rewrites left**
(all net-backed), and (3) the highest-risk code (`socket-bridge.ts`, `queries.ts`, WebRTC) is **untested**.

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

| Package          | LOC   | Purpose                                                             | Maturity                           |
| ---------------- | ----- | ------------------------------------------------------------------- | ---------------------------------- |
| `shared`         | ~740  | Wire contracts (constants/protocol/types/zod schemas)               | Solid (rewritten); ~42 tests       |
| `mcp-server`     | ~22k  | MCP stdio wrapper + backend engine; 57 tools; ComfyUI map pipeline  | Upstream-derived; ~1,030 tests     |
| `foundry-module` | ~18k  | In-browser Foundry ESModule; only component with live Foundry API   | data-access heavily rewritten (P9) |
| `cogm-dashboard` | ~2.4k | Express + SSE co-GM dashboard; Anthropic narration; player/GM split | Original work; ~28 tests           |

Cross-cutting: `permissions.ts` (LOW/MED/HIGH write-gate + `validateGMAccess`), `transaction-manager.ts`
(rollback ledger — Actor/Token implemented; Scene/Item/Delete are intentional stubs), `session-events.ts`
(rolling chat/event buffers powering the log tools), the Foundry-mock harness (`foundry-module/src/
test-support/foundry-mock/`) that makes ~725 in-memory data-access tests possible.

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
  `foundry-module/src/comfyui-manager.ts`; dead branches in `mcp-server/src/utils/system-detection.ts` and
  `utils/compendium-filters.ts` (still carry pf2e/cosmere logic).

---

## 3. Health & risks — prioritized

1. **🔴 Release workflow broken (CONFIRMED).** `.github/workflows/build-complete-release.yml` pins
   `actions/{checkout,setup-node,upload-artifact,download-artifact}@v6` (lines 29/32/222/239/242/268) — `@v6`
   does not exist (current stable `@v4`), so the canonical release fails on any tag push.
   `foundry-module-release.yml:11` has the same `@v6` (legacy workflow). **Fix:** `@v6 → @v4`. Effort: S.
2. **🟠 CI doesn't gate typecheck/lint.** `ci.yml` runs build + tests + smoke, but the documented green-gate
   `npm run typecheck && npm run lint` is NOT an explicit CI step — a type/lint error that doesn't break the
   build slips through. **Fix:** add the step. Effort: S.
3. **🟠 Highest-risk untested code.** `foundry-module/src/socket-bridge.ts` (live wire contract) and
   `queries.ts` (MCP→data-access dispatch router) have zero tests; a regression there breaks the bridge
   silently and the data-access tests won't catch it. WebRTC path (`webrtc-connection.ts` / `webrtc-peer.ts`,
   werift 0.23.0) is gated only by a manual live smoke. `mcp-server/src/tools/combat-resolution.ts` is the
   one tool file with no test (other 23 covered). Dashboard `server.ts`/`sse.ts`/AI layer untested.
4. **🟡 `queries.ts` dual handler registration (verify intent).** The 6 token-manipulation handlers are
   registered twice — camelCase and kebab-case (`queries.ts` ~lines 91–99 vs 123–130). Likely intentional
   dual-format support (production works), but confirm the protocol and drop one side if redundant.
5. **🟡 Residual multi-system dead code (policy violation).** `mcp-server/src/utils/system-detection.ts`
   (`GameSystem` still has `'pf2e' | 'cosmere-rpg'`, PF2e SystemPaths), `utils/compendium-filters.ts`
   (PF2e types/schema/convert logic), `tools/compendium.ts` (live pf2e/cosmere branches, ~6 sites). The repo
   is D&D-only; this is executable dead weight. Prune behind a typecheck pass. Effort: M.
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

### Phase 9 — data-access rewrites (4 remaining; all net-backed, Opus-tier)

See `docs/PHASE9-DOMAIN-REWRITE.md` (per-domain checklist). 13/16 modules rewritten; coverage map complete.

| Domain           | LOC  | Net                                                                             |
| ---------------- | ---- | ------------------------------------------------------------------------------- |
| `actor-creation` | 561  | `data-access.actor-creation.test.ts` (42)                                       |
| `creature-index` | 585  | `data-access.creature-index.test.ts` (31) — unblocks `compendium` enhanced path |
| `player-rolls`   | 884  | `data-access.player-rolls.test.ts` (34)                                         |
| `actor-builder`  | 1790 | `data-access.actor-builder-{npc,items,activity}.test.ts` (95)                   |

Plus the **`characters` pf2e-prune** follow-up (characterize dnd5e paths, then drop retained pf2e branches),
and (optional purity) the 4 large mcp-server tool files owned-via-tests only.

### Phase 6 — remote access / standalone / player-GM split (templated, NOT deployed)

Code is built + green (standalone bridge entry, dashboard role-split/auth/redact). Blocked on provisioning,
not code: Cloudflare Tunnel/Access, Docker/compose, Windows service (all templates in `deploy/`); TURN
server for WebRTC-across-NAT; per-event hidden-combatant suppression in `redact.ts`. Runbook:
`docs/PHASE6-DESIGN.md` §6.

### Release

**v0.16.1 queued** — gated on the user running the live werift WebRTC smoke
(`docs/DEPENDENCY-PATCH-SMOKE-TEST.md`), then tag. NOTE: fix the release workflow (#1 above) first or the
tag build fails.

### Phase 7 — presentation (partial): live demo GIF, `/player` screenshot, showcase site, Pages deploy.

---

## 5. Recommended next sequence

1. **Quick wins (S):** fix release-workflow `@v6→@v4`; add `typecheck && lint` to `ci.yml`; prune the
   residual pf2e/cosmere dead code in `mcp-server/src/utils` + `tools/compendium.ts`; add the
   `combat-resolution.ts` test.
2. **Finish Phase 9 (M–L each):** rewrite the 4 remaining data-access domains (suggest order:
   `creature-index` → `actor-creation` → `player-rolls` → `actor-builder`), then the `characters` pf2e-prune.
   Same recipe as the 13 done: rewrite behind the frozen net, keep green, one commit per domain.
3. **Close the top test gaps (M):** `socket-bridge.ts` + `queries.ts` (mock `game.socket`; assert dispatch
   routing — the Foundry-mock harness is already in place); a minimal dashboard `server.ts` SSE/route test.
4. **Release v0.16.1** once the user runs the WebRTC smoke.
5. **Phase 6 infra** when there's appetite to provision hosting.
6. **Optional:** a Windows setup MCP tool (`win-setup.ts`) for parity with upstream's macOS installer.

---

_Method note: this synthesis came from 5 parallel read-only Sonnet investigators; the release-workflow and
data-access-rewrite findings were spot-verified directly. Treat the "verify" items (queries dual-reg, ComfyUI
Mac paths) as leads, not confirmed facts._
