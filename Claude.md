# Foundry AI Tool

## Project overview

**Foundry AI Tool** — an MCP server + Foundry VTT module that gives AI models (Claude, local LLMs)
full access to Foundry VTT, plus a co-GM dashboard for live session control.

**Canonical repo:** https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool
**Old fork (retired):** https://github.com/Gnuminator/Foundry-VTT-MCP (holds v0.15.0 release)
**Upstream (do not push/merge):** https://github.com/adambdooley/foundry-vtt-mcp

## Remotes

| Remote   | URL                                                          | Purpose                    |
| -------- | ------------------------------------------------------------ | -------------------------- |
| `aitool` | https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git   | canonical — push here      |
| `fork`   | https://github.com/Gnuminator/Foundry-VTT-MCP.git           | old fork — retire/archive  |

**Never add an `origin` pointing at adambdooley/foundry-vtt-mcp.**

## Architecture

npm workspaces: `packages/{cogm-dashboard,mcp-server,foundry-module}` + `shared`

| Package            | LOC    | Status              |
| ------------------ | ------ | ------------------- |
| `cogm-dashboard`   | ~2,400 | original work       |
| `mcp-server`       | ~22,000| upstream-derived    |
| `foundry-module`   | ~18,000| upstream-derived    |
| `shared`           | ~740   | mostly upstream     |

## Wire identifiers — DO NOT RENAME without a migration plan

These are live contracts between the Foundry module, the MCP server, and the dashboard:

- Module id: `foundry-mcp-bridge`
- Socket channel: matches module id
- Settings namespace: `foundry-mcp-bridge`
- Query method prefix: `foundry-mcp-bridge.*`

Renaming any of these breaks existing installs. Plan a migration note first.

## Critical rules

- **NEVER call `mcp__foundry-mcp__*` tools** — Claude Desktop owns the live bridge on
  `127.0.0.1:31414`; spawning a competing backend breaks the connection. The cogm-dashboard
  is a pure client.
- **NEVER push to `adambdooley/foundry-vtt-mcp`** (upstream). It's not a remote anymore.
- Keep it green after each change: `npm run typecheck && npm run lint && npm run build`.

## Tech stack

- TypeScript strict + `exactOptionalPropertyTypes`, ESM (relative imports use `.js` extensions)
- Prettier: single quotes, `printWidth: 100`
- Node 18+, npm workspaces

## Detach plan

Staged plan in `docs/DETACH-PLAN.md`. Progress:

- [x] Phase 0 — Identity decisions locked
- [x] Phase 1 — Clean history built (baseline @dba53ec + 30 dev commits); pushed to new repo
- [x] Phase 2 — Surface rebrand (module.json, package names, LICENSE/CREDITS, README)
- [x] Phase 2.5 — Trim: Mac support removed; non-D&D adapters (dsa5, pf2e, wfrp4e, cosmere-rpg) removed; now Windows + D&D 5e only
- [x] Phase 3 — `docs/ARCHITECTURE.md` from first principles (Opus 4.8)
- [x] Phase 4 — Staged reimplementation (substantively complete — see `docs/PHASE4-TRACKER.md`). Chunk 1 (`shared`) + chunk 2 (wire-protocol contract + control-channel) reimplemented behind the `shared` contract; chunk 3 (data-access shrink+clean, 10,991→9,500); chunks 4–5 owned-via-tests (all 23 tool files + dnd5e adapter/filters covered; dead code removed). 1078 tests total. Deep from-scratch rewrites (data-access + 4 large tool files) deferred to Phase 9 with parity nets in place.
- [~] Phase 5 — Cutover. **v0.16.0 released on `aitool`** (2026-06-15) — first release under the new identity. CHANGELOG rewritten, `docs/MIGRATION.md` + `docs/SMOKE-TEST.md` added, release workflow fixed (canonical `build-complete-release.yml` now tag-triggered + `contents:write`; module zip `foundry-mcp-bridge.zip` matches the manifest download URL). GitHub Release + all 4 assets published and verified; `releases/latest/download/{module.json,foundry-mcp-bridge.zip}` resolve. **Remaining: the user-driven live smoke test** (`docs/SMOKE-TEST.md`) — can't be run from a session inside Claude Desktop (the restart ends it).

## Model guidance

- **Sonnet 4.6** — mechanical work (rebranding, test-writing, per-module reimplementation grind)
- **Opus 4.8** — architecture/contract design (Phase 3), socket-bridge rewrite (Phase 4 step 2),
  parity-decision calls, reviewing each reimplemented chunk
