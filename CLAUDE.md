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
- Keep it green after each change: `npm run typecheck && npm run lint:ratchet && npm run build`, plus
  `CI=true npm test`. The lint ratchet (`scripts/lint-ratchet.mjs`, baseline
  `scripts/lint-baseline.json`, 7,777 warnings) fails on any ESLint error or any rule whose warning
  count rises; lower the baseline with `npm run lint:ratchet -- --update` when counts drop.
- **Local test environment:** `.claude/skills/foundry-test-env/SKILL.md` + `scripts/test-env/*.ps1`
  (Foundry 14 at `C:\FoundryTest` on localhost:30001, world `ai-tool-test`, passwordless "Claude" GM
  user; test bridge 31514/31515/31516; dashboard 3100; own vault). Use it to verify features in
  Foundry before calling them done. Never type passwords; the admin password stays with the GM.
- Smoke tests and manual runs use alternate ports (e.g. control 31514, dashboard 3100) and
  `--control-only` for the standalone backend; never bind 31414/31415/31416.

## Tech stack

- TypeScript strict + `exactOptionalPropertyTypes`, ESM (relative imports use `.js` extensions)
- Prettier: single quotes, `printWidth: 100`
- Node 18+, npm workspaces. CI and release builds run Node 22; the shipped runtime floor is Node 18
  (`engines`); the NSIS installer bundles portable Node 20.12.2 and `deploy/Dockerfile` uses
  `node:20-slim`. Bump them together.

## Detach plan

Staged plan in `docs/DETACH-PLAN.md`. Progress:

- [x] Phase 0 — Identity decisions locked
- [x] Phase 1 — Clean history built (baseline @dba53ec + 30 dev commits); pushed to new repo
- [x] Phase 2 — Surface rebrand (module.json, package names, LICENSE/CREDITS, README)
- [x] Phase 2.5 — Trim: Mac support removed; non-D&D adapters (dsa5, pf2e, wfrp4e, cosmere-rpg) removed; now Windows + D&D 5e only
- [x] Phase 3 — `docs/ARCHITECTURE.md` from first principles (Opus 4.8)
- [x] Phase 4 — Staged reimplementation (substantively complete — see `docs/PHASE4-TRACKER.md`). Chunk 1 (`shared`) + chunk 2 (wire-protocol contract + control-channel) reimplemented behind the `shared` contract; chunk 3 (data-access shrink+clean, 10,991→9,500); chunks 4–5 owned-via-tests (all 23 tool files + dnd5e adapter/filters covered; dead code removed). 1078 tests total. Deep from-scratch rewrites (data-access + 4 large tool files) deferred to Phase 9 with parity nets in place.
- [x] Phase 5 — Cutover. **v0.16.0 released on `aitool`** (2026-06-15) — first release under the new identity. CHANGELOG rewritten, `docs/MIGRATION.md` + `docs/SMOKE-TEST.md` added, release workflow fixed (canonical `build-complete-release.yml` now tag-triggered + `contents:write`; module zip `foundry-mcp-bridge.zip` matches the manifest download URL). GitHub Release + all 4 assets published and verified; `releases/latest/download/{module.json,foundry-mcp-bridge.zip}` resolve. **Live smoke test PASSED** (2026-06-15): user installed the build + reinstalled the module from the new manifest + restarted Claude Desktop; Foundry shows the bridge **Connected**; the co-GM dashboard (`npm run dev:cogm` → http://localhost:3000) connected to the live bridge on 31414 and read real world data ("Rime of the Frostmaiden", dnd5e).
- [~] Phase 6 — Standalone bridge + remote access + player/GM split. **Dep-security prereq DONE** (2026-06-15): removed dead `socket.io-client`; non-breaking `audit fix` (ws/axios/MCP-SDK/express); breaking **werift 0.17.7→0.23.0** (clears the `uuid` advisory; WebRTC path only, user-driven live smoke in `docs/DEPENDENCY-PATCH-SMOKE-TEST.md`); setup-node bumped. Audit prod-only **15→3** (residual = the no-fix `ip` advisory in werift-ice). **Framework BUILT + green:** (A) standalone bridge entry (`packages/mcp-server/src/standalone.ts`; `MCP_CONTROL_HOST/PORT` + `MCP_FOUNDRY_LINK=off` control-only; `npm run bridge:standalone`; CI smoke) and (B) server-side player/GM split in the dashboard (`auth.ts`/`redact.ts`/role-aware `sse.ts`/`requireGm`/`/player`; tests + CI smoke). **Infra TEMPLATED (not deployed):** (C) `docs/REMOTE-ACCESS.md` + `deploy/` (Cloudflare Tunnel/Access, Dockerfile, compose, Windows service); (D) `docs/PHASE6-DESIGN.md` (seams + setup checklist). **Test baseline 1120** (shared 49, foundry-module 12, mcp-server 1030, cogm-dashboard 29). **v0.16.1 released** (2026-06-15, werift validated live by the GM). Remaining: hosting. Target since 2026-07-02 (`docs/ROADMAP.md`): everything on an Orange Pi 5 Pro, PC not required, no domain. The exposure method is not settled on this branch: `docs/REMOTE-ACCESS.md` and `deploy/` template Cloudflare Tunnel/Access, the unmerged hosting branch chose Tailscale (open question for the GM).
- [~] Phase 7: Presentation (`docs/PHASE7-PLAN.md`). Done 2026-06-15: README redesign, badges, brand brief and assets, 30fps demo GIF, regenerated screenshots. Deferred: real screen-capture demo, `/player` screenshot, showcase site.
- [x] Phase 8: Repo tidy (root clutter removed 2026-06-15; the "Baseline" last-commit labels fade as files are rewritten).
- [x] Phase 9: Deep reimplementation (2026-06-16, on `main`): Foundry mock harness, data-access reorganized into 16 domain modules and rewritten to parity (`docs/PHASE9-DATA-ACCESS-REORG.md`, `docs/PHASE9-DOMAIN-REWRITE.md`); the one intended behavior change is the `characters` pf2e prune. The 4 large tool files stay owned-via-tests (optional rewrite).
- [x] Releases after v0.16.0, all on `main` and tagged on `aitool`: **v0.16.1** (2026-06-15, dependency-security patch), **v0.17.0** (2026-06-17, `allowNonGmAccess` setting shipped locked on + internal cleanup), **v0.18.0** (2026-06-17, roll initiative for selected combatants). Full-repo code review 2026-07-02: `docs/CODE-REVIEW-2026-07.md`, backlog in `docs/ROADMAP.md`. `main` stops at `a80b330` (2026-07-02) and still ships the review's two Blockers (0.0.0.0 binds, `allowNonGmAccess` locked on); this branch fixes both (M0) and is not merged back yet.
- Unmerged remote branches (reference only; no merge plan yet, a GM decision): `claude/remote-gm-hosting-design-cwllhf` (Orange Pi hosting design with a Tailscale choice, its own version of the M0 security fixes, `docs/PI-DEPLOY-PROMPTS.md`, `docs/REMOTE-ACCESS-PLAN.md`); `claude/remove-comfyui-pipeline-d9wlp8` and `claude/audit-comfyui-removal-0xzj8l` (full ComfyUI removal with a draft "v0.19.0" CHANGELOG entry; this branch instead keeps ComfyUI opt-in and removes it only on the GM's confirmation). Check them before building anything they already cover.

- [x] Curse of Strahd plan, **M0 (step 0) DONE** (2026-09-28, branch `claude/amazing-bardeen-q1x1q6`;
  see `docs/CURSE-OF-STRAHD-PLAN.md` "M0 as built"): bridge handlers out of `CONFIG.queries`
  (`allowNonGmAccess` default off); Foundry v14/dnd5e 6 version adapter + 2014/2024 rules tags; v9
  typings replaced by `packages/foundry-module/types/foundry-v14.d.ts`; guarded writes
  (plan/apply/undo: backend plans + audit, module executes with checks); bridge vault
  (`FOUNDRY_AI_DATA_DIR`, `npm run vault`); persistent session event log; dashboard confirm-with-diff
  + Recent Changes; loopback binds (`DASHBOARD_HOST`, `FOUNDRY_LINK_HOST`); ComfyUI auto-start
  opt-in; lockfile integrity filled. `npm audit`: 2 advisories in shipped code (`ip`, `werift`), 12
  total, none critical. **Tests 2,171** (foundry-module 914, mcp-server 1169, shared 49,
  cogm-dashboard 39).
- [x] Curse of Strahd **M1 (Tarokka) DONE** (2026-09-28): built-in roll + `tarokka-reading` provider,
  vault storage with archive, per-position/card link table, reveal pages for players (mixed guarded
  plans), GM-only dashboard drawer, canary tests. **Tests 2,217** (foundry-module 930, mcp-server
  1198, shared 49, cogm-dashboard 40). **Next: GM live test of M0+M1, then M2 (spoiler-safe /player).**
- [x] **M0+M1 live test PASSED on the test server** (2026-09-28, `efe6e73`): query lockdown as Player,
  Tarokka import/apply/list/undo (API + dashboard UI), switch off refuses (vault, mixed, Foundry-only),
  vault and Foundry conflicts write nothing, reveal page shows Player only the typed text, `/player`
  (split on and off) has no card data, vault files + session log. 4 bugs fixed with tests.
- [x] **Tool-parameter pickers** (`e22dc15`): every tool parameter that names something has "Pick…" in
  the dashboard tool runner (`x-foundry-ref` annotations, read tool `list-ref-choices`,
  `tool-catalog.test.ts` enforces it for new tools). Skills split (`cd50ec3`): `foundry-test-env`
  (infra), `foundry-ai-tool` (tools, dashboard, smoke checklist), `foundry-core-ui` (index).
- [x] **Obsidian O1** (`808d092`, plan `2b126f1` = `docs/OBSIDIAN-PLAN.md`): Claude owns the GM's vault
  `C:\Users\chris\Documents\Obsidian\vault` (structure, plugins, automations). Vault skeleton,
  templates, Dev dashboard with Question notes, `npm run obsidian -- export` (sessions, changes,
  Tarokka), `scripts/obsidian/sync-dev-docs.ps1` (read-only docs mirror). Next: rest of O2.
- [x] **Project history imported** (2026-09-28): the cloud project's history export is in the GM's
  vault under `Dev/Foundry AI Tool/` (History, Open work, Working agreements, Glossary, one note per
  decision/idea/lesson, Bases on the Dashboard, new Question notes). It is documentation only: it does
  not change current goals. Repo fixes from the cross-check: this file (Phases 7 to 9, releases,
  unmerged branches, Node versions, lint baseline), CHANGELOG "Unreleased", ROADMAP ticks.
- [~] **Handoff (2026-09-28).**
  - Open GM questions (Obsidian `Dev/Foundry AI Tool/Questions/`): M2 go-ahead; merge plan for this
    branch and the unmerged ones; ComfyUI removal; Orange Pi exposure and deploy gating; archive the
    old fork; vault sync method; deny rule for `Campaigns/`.
  - Part B verification is unfinished: `.claude/skills/foundry-core-ui/reference/*.md` (11 pages) are
    uncommitted drafts; the click-through lanes were stopped mid-run, so some pages may carry partial
    `[verified]` marks and no stamp. Resume later (Sonnet, one lane per GM user, canvas pages in front).
  - The test world has two temporary GM users "Verifier A" and "Verifier B" (for parallel lanes) and
    three "Wolf" actors/tokens (picker test data): delete the users when verification is done.
  - Still open: M2 waits for the GM's go-ahead (also a Question note in Obsidian).

## Model guidance

- **Sonnet 4.6** — mechanical work (rebranding, test-writing, per-module reimplementation grind)
- **Opus 4.8** — architecture/contract design (Phase 3), socket-bridge rewrite (Phase 4 step 2),
  parity-decision calls, reviewing each reimplemented chunk
