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

| #   | Chunk                                    | Origin           | Status         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------- | ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `shared` types/schemas/constants         | upstream-derived | ✅ **Done**    | Reimplemented with original structure + docs; public surface (30 types, 30 schemas, 10 constants) preserved exactly; frozen wire IDs byte-identical. 34-test parity/contract-guard suite added and wired into CI.                                                                                                                                                                                                                                                                                             |
| 2   | Control-channel / socket-bridge protocol | upstream-derived | 🟡 In progress | **Opus-led.** Wire contract codified in `shared/src/protocol.ts` (frames + Zod, 15 tests). Control-channel endpoints migrated onto the contract (dashboard `mcp-control-client`, stdio wrapper `index.ts`, backend control server). Remaining: Foundry link (`foundry-connector`/`webrtc-peer`, module `socket-bridge`/`webrtc-connection`), chunking-constants dedup → `WEBRTC_LIMITS`, transaction-manager. Verified via build/typecheck/bundle; no live-bridge calls (31414 is owned by the live backend). |
| 3   | Foundry module `data-access` / `queries` | upstream-derived | ⬜ Not started | Largest surface (`data-access.ts` ~11k LOC). Also still holds local PF2e/DSA5 remnants to remove.                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | Tool layer, domain-by-domain             | upstream-derived | ⬜ Not started | combat, scene, compendium, actor-creation, effects, tokens, movement, … Each a self-contained chunk; good fan-out target for parallel Sonnet workers.                                                                                                                                                                                                                                                                                                                                                         |
| 5   | D&D 5e system adapter                    | upstream-derived | ⬜ Not started | Last. Behind the registry already; reimplement filters/index/stat extraction.                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Verification baseline (must stay green)

- `npm run build` (composite build — if a workspace emits nothing, delete stale `*.tsbuildinfo` and rebuild)
- `npm test -w @gnuminator/shared` — 49 tests (shared parity + protocol contract)
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
