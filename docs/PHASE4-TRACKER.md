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

| #   | Chunk                                    | Origin           | Status               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------- | ---------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `shared` types/schemas/constants         | upstream-derived | ✅ **Done**          | Reimplemented with original structure + docs; public surface (30 types, 30 schemas, 10 constants) preserved exactly; frozen wire IDs byte-identical. 34-test parity/contract-guard suite added and wired into CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2   | Control-channel / socket-bridge protocol | upstream-derived | ✅ **Done**          | **Opus-led.** Wire contract codified in `shared/src/protocol.ts` (frames + Zod, 15 tests). Control-channel endpoints migrated onto the contract (dashboard `mcp-control-client`, stdio wrapper `index.ts`, backend control server). Chunking constants deduped to the canonical `WEBRTC_LIMITS` (Node `config.ts` re-exports it as `WEBRTC_CONSTANTS`; `webrtc-peer.ts` unchanged). The contract is the source of truth; the Foundry-link **implementation** adoption (Node `foundry-connector`/`webrtc-peer` frame typing + browser `socket-bridge`/`webrtc-connection`) and the transaction-manager fold into chunk 3 — they live in the connector + module and the browser side is gated on the bundler decision (see Decisions). Verified via build/typecheck/bundle; no live-bridge calls (31414 owned by the live backend).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | Foundry module `data-access` / `queries` | upstream-derived | ✅ **Done** (scoped) | **Shrink + clean.** Stripped all non-dnd5e code (PF2e/DSA5/WFRP/Cosmere — builders/extractors, spell helpers, creature-index types, system-gated branches; dnd5e paths untouched) and pruned 3 dead `@unused` legacy methods. `data-access.ts` **10,991 → 9,500** (−1,491). `queries.ts` already clean. **Deep reimplementation deferred** (user decision 2026-06-15): the full from-scratch rewrite → modular reorg, the `transaction-manager` rewrite, and the Foundry-link `import type` adoption are now **Phase 9** in DETACH-PLAN.md. The shrink+clean is the realistic ownership win for untestable browser plumbing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4   | Tool layer, domain-by-domain             | upstream-derived | ✅ **Done** (scoped) | **Approach:** these are thin, already-clean wrappers (validate args → `foundryClient.query('foundry-mcp-bridge.*')` → shape result), so the win is **test coverage** (the tools had none) + light cleanup — blind from-scratch rewrites of clean files are churn. Reserve real rewrites for the genuinely-large/messy files (`character` 1034, `dnd5e/add-feature` 1038, `compendium` 1329, `quest-creation` 1380). **Done: all 19 thin/medium tool domains have test suites** (batches 1–3, mocked `FoundryClient`): movement, effects, resources, session-log, combat, diagnostics, loot, scene-control, encounter, chat-log, scene, dice-roll, token-manipulation, actor-creation, ownership, map-generation, dnd5e/features, dnd5e/npc, campaign-management. mcp-server tests wired into CI. **488 mcp-server tests.** The parallel-Sonnet-worker fan-out (each writes only its own `*.test.ts`, verifies via `vitest`, no build collisions) worked cleanly across 18 workers. **All 23 tool files now have test coverage** — the 4 large files (`character`, `dnd5e/add-feature`, `compendium`, `quest-creation`) got thorough **characterization** suites (+336 tests) that pin result-shaping (HTML markers, stat extraction, formatting) as a parity net. **824 mcp-server tests.** **Assessment:** all 4 are large-but-clean (0 cruft) and mostly output-formatting helpers, so a from-scratch reimplementation = reproduce-the-same-output (low marginal value, same tradeoff deferred for data-access). The parity net now makes any future reimplementation _verifiable_. **Decided (user, 2026-06-15):** the deep from-scratch reimplementation of these 4 is folded into **Phase 9**; the tool layer is **owned-via-tests** for now (824 tests, full coverage). |
| 5   | D&D 5e system adapter                    | upstream-derived | ✅ **Done**          | Behind the registry. `adapter.ts` + `filters.ts` (live, pure logic) got thorough test suites (102 + 91 = **193 tests** — metadata, canHandle, matchesFilters/getPowerLevel/describeFilters, format helpers, extractCharacterStats, the filter schema + predicates). Removed the dead `dnd5e/index-builder.ts` (352 LOC, unimported in mcp-server — actual indexing lives in the foundry-module's data-access). Owned-via-tests, consistent with chunk 4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Verification baseline (must stay green)

- `npm run build` (composite build — if a workspace emits nothing, delete stale `*.tsbuildinfo` and rebuild)
- `npm test -w @gnuminator/shared` — 49 tests (shared parity + protocol contract)
- `npm test -w @gnuminator/foundry-module` — 24 tests (EventTracker 12 + data-access read-slice 12, via the Phase 9 Foundry-mock harness)
- `npm test -w @gnuminator/mcp-server` — 1030 tests (lock + all 23 tool suites + dnd5e adapter/filters + standalone-config)
- `npm test -w @gnuminator/cogm-dashboard` — 29 tests (Phase 6 player/GM split: auth + redact)
- `node scripts/mcp-schema-smoke-test.mjs`
- `node scripts/standalone-smoke-test.mjs` (Phase 6-A: standalone bridge on a free port)
- `node scripts/cogm-split-smoke-test.mjs` (Phase 6-B: server-side player/GM split over HTTP)
- `node validate-manifest.js`

**1132 unit tests total** (shared 49 + foundry-module 24 + mcp-server 1030 + cogm-dashboard 29).
CI (`​.github/workflows/ci.yml`) runs build + the four unit suites + the schema/standalone/split smokes + manifest on every push to `main`.

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
- **2026-06-15 — Chunk 4 start (test template).** Established the chunk-4 pattern: tool classes are
  thin `FoundryClient.query` wrappers, so the value is **test coverage** (they had none) over blind
  rewrites. Added `packages/mcp-server/src/tools/movement.test.ts` (9 tests) — mocks `FoundryClient`
  and covers tool-definition shape, query dispatch, foundry-error propagation, and the
  validation-error-as-string path. Wired the mcp-server suite into CI (new `Unit tests (mcp-server)`
  step; 26 tests incl. the pre-existing lock suite). Next tool slices (per domain) follow this
  template and can fan out to parallel Sonnet workers; reserve true rewrites for the large/messy
  files (`character`, `dnd5e/add-feature`, `compendium`, `quest-creation`).
- **2026-06-15 — Chunk 4 fan-out batch 1.** 6 parallel Sonnet workers added test suites for `effects`
  (14), `resources` (18), `session-log` (17), `combat` (28), `diagnostics` (19), `loot` (12) — **+108
  tests**. Each worker wrote only its own `*.test.ts` and verified via `vitest` (no build → no parallel
  collisions). Workers matched each handler's actual behavior (validation throws vs. `Parameter error`
  string; `logger.error` vs `console.error`). Reviewed (Opus): only the 6 new files added, spot-checked
  for real assertions. mcp-server suite **26 → 134** tests. Verified green incl. wiped/clean build:
  build, mcp-server (134) + shared (49) + foundry-module (12) tests, smoke, manifest. The
  parallel-worker pattern is confirmed for the remaining thin-tool suites.
- **2026-06-15 — Chunk 4 fan-out batch 2.** 6 more parallel workers added suites for `scene-control`
  (34), `encounter` (26), `chat-log` (25), `scene` (30), `dice-roll` (32), `token-manipulation` (36)
  — **+183 tests**. Workers matched source precisely (e.g. `request-player-rolls` uses a dash-cased
  bridge method; `handleRollNpcCheck` returns the raw response; `scene`/`get-token-details` assert
  result-shaping + disposition-name mapping; per-handler throw-vs-`Parameter error`-string). Reviewed
  (Opus): only the 6 new files added, spot-checked. mcp-server suite **134 → 317** tests. Verified
  green incl. wiped/clean build: build, mcp-server (317) + shared (49) + foundry-module (12) tests,
  smoke, manifest.
- **2026-06-15 — Chunk 4 fan-out batch 3 (thin/medium tools complete).** 6 more parallel workers added
  suites for `actor-creation` (20), `ownership` (23), `map-generation` (47), `dnd5e/features` (26),
  `dnd5e/npc` (33), `campaign-management` (22) — **+171 tests**. Handled the quirky ones well:
  `ownership`'s single `handleToolCall` dispatch (tested the full `findActor→findPlayers→
setActorOwnership` chain + bulk-confirm guard), `map-generation`'s `backendComfyUIHandlers` ctor arg,
  the dnd5e tools' `vi.mock` of `system-detection` + cache clearing, `campaign-management`'s positional
  ctor + shared-schema validation + HTML-dashboard dispatch. Reviewed (Opus): only the 6 new files
  added; full suite isolation confirmed (the module mocks don't bleed). **All 19 thin/medium tool
  domains now have tests; mcp-server 317 → 488.** Verified green incl. wiped/clean build. Only the 4
  large rewrite-targets remain in chunk 4.
- **2026-06-15 — Chunk 4 big-file characterization.** 4 parallel workers added thorough
  characterization suites for the large files: `character` (57), `compendium` (64), `quest-creation`
  (98), `dnd5e/add-feature` (117) — **+336 tests**, pinning result-shaping (HTML content markers,
  creature stat extraction, feature/spell message formatting) as a parity net. **All 23 tool files now
  covered; mcp-server 488 → 824.** Assessment (Opus): all 4 are large-but-clean (no cruft) and dominated
  by output-formatting helpers — a from-scratch reimplementation would reproduce the same output (the
  tests now pin it), i.e. high-effort/low-marginal-value churn, the same tradeoff deferred for
  data-access. The parity net makes any future reimplementation verifiable. Verified green incl.
  wiped/clean build: build, mcp-server (824) + shared (49) + foundry-module (12) tests, smoke, manifest.
- **2026-06-15 — Chunk 5 done (dnd5e adapter).** Added test suites for the live, pure-logic
  `systems/dnd5e/adapter.ts` (102) and `filters.ts` (91) — **+193 tests** covering metadata, canHandle,
  filter matching (CR exact/range, type, size, alignment substring, legendary, spellcaster-via-
  `hasSpellcasting`), power level, format helpers, `extractCharacterStats`, the zod schema + predicates.
  Removed the dead `systems/dnd5e/index-builder.ts` (352 LOC `DnD5eIndexBuilder` — unimported in
  mcp-server; the real creature indexing lives in the foundry-module's `data-access.ts`), and fixed the
  now-stale class reference in `adapter.ts`'s `extractCreatureData` throw message. mcp-server **824 →
  1017** tests. Verified green incl. wiped/clean build.

---

**Phase 4 reimplementation work is substantively complete.** All 5 chunks done at the agreed depth:
chunks 1–2 reimplemented behind the stable `shared` contract; chunk 3 shrunk+cleaned; chunks 4–5
owned-via-tests (the tool layer + dnd5e adapter are large-but-clean, so comprehensive tests +
dead-code removal are the realistic ownership win). **1078 tests total** across the workspaces
(mcp-server 1017 + shared 49 + foundry-module 12). The deep from-scratch reimplementations (data-access,
the 4 large tool files) are deferred to **Phase 9** with parity nets in place. Next up in the broader
plan: **Phase 5 — cutover** (release under the new identity, migration notes, live smoke test).
