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

| #   | Chunk                                    | Origin           | Status         | Notes                                                                                                                                                                                                             |
| --- | ---------------------------------------- | ---------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `shared` types/schemas/constants         | upstream-derived | ✅ **Done**    | Reimplemented with original structure + docs; public surface (30 types, 30 schemas, 10 constants) preserved exactly; frozen wire IDs byte-identical. 34-test parity/contract-guard suite added and wired into CI. |
| 2   | Control-channel / socket-bridge protocol | upstream-derived | ⬜ Not started | **Opus-led.** The contract everything depends on (control channel §3a + Foundry link §3b). Design carefully; verify with the mock-bridge harness.                                                                 |
| 3   | Foundry module `data-access` / `queries` | upstream-derived | ⬜ Not started | Largest surface (`data-access.ts` ~11k LOC). Also still holds local PF2e/DSA5 remnants to remove.                                                                                                                 |
| 4   | Tool layer, domain-by-domain             | upstream-derived | ⬜ Not started | combat, scene, compendium, actor-creation, effects, tokens, movement, … Each a self-contained chunk; good fan-out target for parallel Sonnet workers.                                                             |
| 5   | D&D 5e system adapter                    | upstream-derived | ⬜ Not started | Last. Behind the registry already; reimplement filters/index/stat extraction.                                                                                                                                     |

## Verification baseline (must stay green)

- `npm run build` (composite build — if a workspace emits nothing, delete stale `*.tsbuildinfo` and rebuild)
- `npm test -w @gnuminator/shared` — 34 tests
- `npm test -w @gnuminator/foundry-module` — 12 tests
- `node scripts/mcp-schema-smoke-test.mjs`
- `node validate-manifest.js`

CI (`​.github/workflows/ci.yml`) runs build + both unit suites + smoke + manifest on every push to `main`.

## Done log

- **2026-06-15 — Chunk 1 (`shared`).** Reimplemented `shared/src/{index,types,schemas,constants}.ts`
  from first principles, organized around the ARCHITECTURE.md domains, with original doc comments.
  Public surface preserved exactly (every export name, type shape, schema bound/default, and constant
  value — frozen wire IDs `MODULE_ID`, `SOCKET_EVENTS`, `MCP_METHODS`, `DEFAULT_CONFIG.MCP_PORT=31415`,
  `CONNECTION_STATES` byte-identical). Added `shared/src/shared.test.ts` (34 tests: frozen constants,
  schema defaults, validation bounds, round-trip parse) + `shared/vitest.config.ts`, and a CI step.
  Sole consumer (`packages/mcp-server/src/tools/campaign-management.ts`) compiles unchanged. Green
  across build/tests/smoke/manifest.
