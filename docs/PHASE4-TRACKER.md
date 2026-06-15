# Phase 4 — Rewritten vs. Upstream Tracker

Staged reimplementation of the upstream-derived code, **behind stable external contracts** so the
dashboard and the Foundry module keep working throughout. This file is the source of truth for what
has been reimplemented "from the idea" (per `docs/ARCHITECTURE.md`) vs. what is still upstream-derived.
A fresh session should read this first to resume cleanly.

**Method per chunk:** capture current behavior in tests → reimplement from first principles, preserving
the public surface → verify parity (green: typecheck + lint + build + tests + smoke + manifest) → ship.
Never leave it broken between sessions.

**Orchestration:** Opus designs/reviews; Sonnet workers do the per-module reimplementation. The
control-channel / socket-bridge protocol step (step 2) is Opus-led — it's the contract everything
depends on.

## Status

| #   | Chunk                                    | Origin           | Status               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------- | ---------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `shared` types/schemas/constants         | upstream-derived | ✅ **Done**          | Reimplemented with original structure + docs; public surface (30 types, 30 schemas, 10 constants) preserved exactly; frozen wire IDs byte-identical. 34-test parity/contract-guard suite added and wired into CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2   | Control-channel / socket-bridge protocol | upstream-derived | ✅ **Done**          | **Opus-led.** Wire contract codified in `shared/src/protocol.ts` (frames + Zod, 15 tests). Control-channel endpoints migrated onto the contract (dashboard `mcp-control-client`, stdio wrapper `index.ts`, backend control server). Chunking constants deduped to the canonical `WEBRTC_LIMITS` (Node `config.ts` re-exports it as `WEBRTC_CONSTANTS`; `webrtc-peer.ts` unchanged). The contract is the source of truth; the Foundry-link **implementation** adoption (Node `foundry-connector`/`webrtc-peer` frame typing + browser `socket-bridge`/`webrtc-connection`) and the transaction-manager fold into chunk 3 — they live in the connector + module and the browser side is gated on the bundler decision (see Decisions). Verified via build/typecheck/bundle; no live-bridge calls (31414 owned by the live backend). |
| 3   | Foundry module `data-access` / `queries` | upstream-derived | ✅ **Done** (scoped) | **Shrink + clean.** Stripped all non-dnd5e code (PF2e/DSA5/WFRP/Cosmere — builders/extractors, spell helpers, creature-index types, system-gated branches; dnd5e paths untouched) and pruned 3 dead `@unused` legacy methods. `data-access.ts` **10,991 → 9,500** (−1,491). `queries.ts` already clean. **Deep reimplementation deferred** (user decision 2026-06-15): the full from-scratch rewrite → modular reorg, the `transaction-manager` rewrite, and the Foundry-link `import type` adoption are now **Phase 9** in DETACH-PLAN.md. The shrink+clean is the realistic ownership win for untestable browser plumbing.                                                                                                                                                                                                      |
| 4   | Tool layer, domain-by-domain             | upstream-derived | ⬜ Not started       | combat, scene, compendium, actor-creation, effects, tokens, movement, … Each a self-contained chunk; good fan-out target for parallel Sonnet workers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5   | D&D 5e system adapter                    | upstream-derived | ⬜ Not started       | Last. Behind the registry already; reimplement filters/index/stat extraction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Verification baseline (must stay green)

- `npm run build` (composite build — if a workspace emits nothing, delete stale `*.tsbuildinfo` and rebuild)
- `npm test -w @gnuminator/shared` — 49 tests (shared parity + protocol contract)
- `npm test -w @gnuminator/foundry-module` — 12 tests
- `node scripts/mcp-schema-smoke-test.mjs`
- `node validate-manifest.js`

CI (`​.github/workflows/ci.yml`) runs build + both unit suites + smoke + manifest on every push to `main`.

## Decisions

- **Browser module ↔ `@gnuminator/shared` (bundler policy).** The `foundry-module` is `tsc`-compiled
  ESM that Foundry loads file-by-file from `dist/` — there is **no bundler**, so a bare runtime
  `import` of a workspace package would not resolve in Foundry's browser context. Policy:
  - **Node packages** (mcp-server, cogm-dashboard) import `shared` freely (values + types).
  - **The browser module** may use **`import type`** from `shared` (tsc erases it — zero runtime cost),
    but **must not import runtime values** (constants/schemas). Runtime values stay as local mirrors
    that reference the canonical `shared` definition by comment (e.g. the WebRTC chunk sizes in
    `webrtc-connection.ts` mirror `WEBRTC_LIMITS`).
  - Adding a bundler to the module build is **deferred** — revisit only if/when the module genuinely
    needs shared runtime values, as part of its chunk-3 reimplementation.

## Done log

- **2026-06-15 — Chunk 1 (`shared`).** Reimplemented `shared/src/{index,types,schemas,constants}.ts`
  from first principles, organized around the ARCHITECTURE.md domains, with original doc comments.
  Public surface preserved exactly (every export name, type shape, schema bound/default, and constant
  value — frozen wire IDs `MODULE_ID`, `SOCKET_EVENTS`, `MCP_METHODS`, `DEFAULT_CONFIG.MCP_PORT=31415`,
  `CONNECTION_STATES` byte-identical). Added `shared/src/shared.test.ts` (34 tests: frozen constants,
  schema defaults, validation bounds, round-trip parse) + `shared/vitest.config.ts`, and a CI step.
  Sole consumer (`packages/mcp-server/src/tools/campaign-management.ts`) compiles unchanged. Green
  across build/tests/smoke/manifest.
- **2026-06-15 — Chunk 2 start (protocol contract).** Codified both wire contracts (ARCHITECTURE.md
  §3) in `shared/src/protocol.ts`: control-channel frames (`ControlRequest/Response`, `CallToolParams`,
  `ToolResultPayload`, `CONTROL_METHODS`) and Foundry-link frames (`FoundryQueryFrame`,
  `FoundryResponseFrame`, ping/pong, `ChunkedMessageFrame`, the `FoundryFrameSchema` discriminated
  union) + `WEBRTC_LIMITS` (canonical SCTP/chunking constants). Frame `type` strings reuse the frozen
  `SOCKET_EVENTS`; query/response inner payloads reuse `MCPQuery`/`MCPResponse` from chunk 1. Added
  `shared/src/protocol.test.ts` (15 tests). Additive only — no running code imports it yet; the
  implementation migration listed in the Status table is the next sub-step (Opus-led). Green across
  build/tests/smoke/manifest.
- **2026-06-15 — Chunk 2 slices 1–2 (control-channel endpoints migrated).** Swapped the inline,
  per-file frame type declarations for the `shared` contract: the dashboard `mcp-control-client.ts`
  (added `@gnuminator/shared` dep; now imports `ControlResponse`/`ToolResultPayload`), the stdio
  wrapper `index.ts` (`ControlRequest`/`ControlResponse`; added an id-undefined guard the optional-id
  contract requires), and the backend control server `backend.ts` (`ControlRequest` for the inbound
  request, `ToolResultPayload` for the `call_tool` result). Type-level adoption — runtime wire
  behavior unchanged. Verified: typecheck (all workspaces), build, mcp-server esbuild bundle (shared
  inlined — 0 bare requires), shared (49) + foundry-module (12) tests, smoke, manifest, npm ci
  --dry-run. Runtime control-channel exercise deferred to the Phase 5 live smoke test (can't bind
  31414 here — owned by the live backend). Remaining chunk-2 work: the Foundry link, chunking-constant
  dedup, transaction-manager.
- **2026-06-15 — Chunk 2 done (chunking dedup + policy).** Deduped the WebRTC SCTP/chunking constants
  onto the canonical `WEBRTC_LIMITS`: `config.ts` now re-exports it under the established
  `WEBRTC_CONSTANTS` name (identical fields/values, so `webrtc-peer.ts` is untouched), replacing a
  ~45-line hand-maintained copy. The browser module's `webrtc-connection.ts` keeps its local mirror
  (no bundler) with a comment pointing at `WEBRTC_LIMITS` as canonical. Recorded the browser-module
  bundler policy (see Decisions) and folded the Foundry-link implementation adoption +
  transaction-manager into chunk 3. Chunk 2 (the protocol **contract** + control-channel adoption +
  constant dedup) is complete. Verified green: typecheck (all), build, mcp-server bundle, shared (49)
  - foundry-module (12) tests, smoke, manifest, npm ci --dry-run.
- **2026-06-15 — Chunk 3 start (data-access remnant removal).** Stripped all non-dnd5e system code
  from `packages/foundry-module/src/data-access.ts` (the trim's leftover browser-side remnants):
  the dedicated PF2e/Cosmere index builders + extractors, the PF2e/DSA5 spell helpers
  (`extractPF2eSpellSlots`/`extractPF2eSpellTargeting`/`extractDSA5SpellTargeting`/`formatPF2eActionCost`),
  the `PF2eCreatureIndex`/`CosmereRpgCreatureIndex` types (union narrowed to `DnD5eCreatureIndex`),
  the system-criteria checkers (`passesPF2eCriteria`/`passesCosmereRpgCriteria`), and the
  `systemId === 'pf2e'|'dsa5'|'wfrp4e'|'cosmere-rpg'` branches in shared methods
  (`extractSpellcastingData`, `searchCharacterItems`, `listCreaturesByCriteria`,
  `toggleTokenCondition`, `useItem`, `createActorFromCompendiumEntry`). The `buildEnhancedIndex`
  dispatch is now dnd5e-only (throws for other systems). `data-access.ts` **10,991 → 9,742**
  (the worker's own LOC figures were miscounted and were corrected here after independent `wc`);
  `queries.ts` was already clean. Reviewed (Opus): only `data-access.ts` changed, 0 residual non-dnd5e
  references, dnd5e code paths preserved (spell extraction + creature search verified by reading).
  Verified green incl. wiped/clean build: build, typecheck, foundry-module (12) + shared (49) tests,
  smoke, manifest. Remaining chunk-3 work: reimplement/reorganize from the idea + Foundry-link
  `import type` adoption + transaction-manager.
- **2026-06-15 — Chunk 3 (dead-method prune).** Removed 3 confirmed-unused private legacy methods from
  `data-access.ts` — `passesFilters`, `prioritizePacksForCreatures`, `passesCriteria` (each marked
  `@unused` + `@ts-ignore`'d precisely because TS flagged them as unused; confirmed 0 call sites).
  −242 LOC (9,742 → 9,500); adjacent methods (`calculateRelevanceScore`, `matchesSearchCriteria`)
  intact; no `@unused` markers remain. Verified green incl. wiped/clean build: build, typecheck,
  foundry-module (12) tests.
- **2026-06-15 — Chunk 3 closed (scoped) + decision.** Per user decision, chunk 3 is **done at
  shrink+clean** — the realistic ownership win for the large, untestable, browser-bound module. The
  deep `data-access` reimplementation (full rewrite → modular reorg), the `transaction-manager`
  rewrite, and the Foundry-link `import type` adoption are split out to **Phase 9** (DETACH-PLAN.md),
  to do later with a proper Foundry-mock test harness first. Proceeding to **chunk 4 (tool layer)** —
  Node-side, testable, the high-value-safe reimplementation target.
