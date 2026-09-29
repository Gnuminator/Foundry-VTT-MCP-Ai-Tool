# Foundry AI Tool

## Project overview

**Foundry AI Tool**: an MCP server plus a Foundry VTT module that give AI models (Claude through
Claude Desktop, local LLMs) full access to Foundry VTT, a co-GM dashboard for live session control, an
Obsidian export of the world and the play log, and (planned) our own Discord bot. Windows and D&D 5e
(dnd5e) only. Supported: **Foundry 14 with dnd5e 6**.

**Canonical repo:** https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool
**Old fork (retired, archive pending):** https://github.com/Gnuminator/Foundry-VTT-MCP (holds v0.15.0)
**Upstream (do not push/merge):** https://github.com/adambdooley/foundry-vtt-mcp

The running history (detach, phases, milestones M0 to M3, Obsidian O1 to O4) is in
`docs/history/PROGRESS.md`. Decisions since 2026-09-28 are notes in the Obsidian vault
(`Dev/Foundry AI Tool/Decisions/`, D-064 onward for 2026-09-29).

## Roles and how the parts fit (decided 2026-09-29)

- **The user (Gnuminator) builds the tool and decides scope. The user is not the GM.** The Curse of
  Strahd GM is a friend who learns Foundry and the tool from scratch; docs, videos and in-product help
  are written for him. Older text (`docs/history/`, vault Dev notes before 2026-09-29) says "the GM"
  where it means the user. Do not raise spoiler concerns about the user seeing campaign content.
- **Foundry** is where the game happens. **The dashboard** is the GM's control panel (a browser window
  on a second screen): every AI change is approved there (plan, confirm with a diff, undo).
  **Obsidian** is for reading (a GM vault and a player vault, generated one way from Foundry) and may
  push prep changes, only as pending changes approved in the dashboard: never live play (HP,
  conditions, initiative, rolls, tokens), never deletes, never the only way to do something, never by
  players (D-067). **The Discord bot** is for notices and lookups.
- **Trust model (D-065):** the table is five trusted friends. Do not build hardening against players
  (console digging, reading world settings, crafted requests). Keep: no spoilers on the normal
  screens, plan/confirm/undo for AI writes, no book or campaign text in the public repo, nothing
  reachable from the internet without a login. New game state may live in Foundry (GM-only journals,
  flags) instead of only in the bridge vault.
- **Subscription-first AI (D-066):** AI features work by someone asking Claude (Claude Desktop through
  the bridge, or a Claude Code skill). Nothing calls the paid Anthropic API unless it is turned on;
  speech to text runs locally.
- **Push back openly:** when there is a better way (tools, modules, setup, ease of use), say so with a
  bold recommended option; the user decides.

## Remotes

| Remote   | URL                                                         | Purpose                     |
| -------- | ----------------------------------------------------------- | --------------------------- |
| `aitool` | https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git   | canonical: push here        |
| `fork`   | https://github.com/Gnuminator/Foundry-VTT-MCP.git           | old fork: retired           |

**Never add an `origin` pointing at adambdooley/foundry-vtt-mcp.**

## Architecture

npm workspaces: `packages/{cogm-dashboard,mcp-server,foundry-module}` + `shared`. Details:
`docs/dev/ARCHITECTURE.md`.

| Package          | What it is                                                                        |
| ---------------- | --------------------------------------------------------------------------------- |
| `foundry-module` | runs in a GM's Foundry client: bridge handlers, play recorder, version adapter    |
| `mcp-server`     | the bridge backend: MCP tools, guarded writes, bridge vault, Obsidian renderer    |
| `cogm-dashboard` | the GM's web dashboard and the players' `/player` page                            |
| `shared`         | wire contracts shared by the three                                                |

## Wire identifiers: do not rename without a migration plan

These are live contracts between the Foundry module, the MCP server and the dashboard:

- Module id: `foundry-mcp-bridge`
- Socket channel: matches module id
- Settings namespace: `foundry-mcp-bridge`
- Query method prefix: `foundry-mcp-bridge.*`

## Critical rules

- **NEVER call `mcp__foundry-mcp__*` tools.** Claude Desktop owns the live bridge on
  `127.0.0.1:31414`; spawning a competing backend breaks the connection. Smoke tests and manual runs
  use alternate ports (control 31514, dashboard 3100) and `--control-only`; never bind 31414 to 31416.
- **NEVER push to `adambdooley/foundry-vtt-mcp`** (upstream).
- **Outward actions need the user's explicit OK each time:** push (remote `aitool`), tag, release,
  merge into `main`, deleting code or files the user may still want.
- **Keep it green** after each change: `npm run typecheck && npm run lint:ratchet && npm run build`,
  plus `CI=true npm test`. The lint ratchet (`scripts/lint-ratchet.mjs`, baseline
  `scripts/lint-baseline.json`) fails on any ESLint error or any rule whose warning count rises; lower
  the baseline with `npm run lint:ratchet -- --update` when counts drop.
- **Local test environment:** `.claude/skills/foundry-test-env/SKILL.md` + `scripts/test-env/*.ps1`
  (Foundry 14 at `C:\FoundryTest` on localhost:30001, world `ai-tool-test`, passwordless "Claude" GM
  user; test bridge 31514/31515/31516; dashboard 3100; own vault). Verify features there before calling
  them done. Never type passwords or licence keys; the admin password stays with the user.
- **Writing for the user:** English unless the user writes Danish; never use em dashes.

## Tech stack

- TypeScript strict + `exactOptionalPropertyTypes`, ESM (relative imports use `.js` extensions)
- Prettier: single quotes, `printWidth: 100`
- Node 18+, npm workspaces. CI and release builds run Node 22; the shipped runtime floor is Node 18
  (`engines`); the NSIS installer bundles portable Node 20.12.2 and `deploy/Dockerfile` uses
  `node:20-slim`. Bump them together. CI also runs Node 24, which the Orange Pi uses (Foundry 14
  requires Node 24). Locally use the portable Node 22 (see memory).

## Docs layout (2026-09-29)

- `docs/gm/`, `docs/player/`: guides for the GM and the players (being written).
- `docs/dev/`: architecture, dev setup, testing, deployment, remote access.
- `docs/reference/`: tool inventory, dashboard reference.
- `docs/design/`: current plans (`CURSE-OF-STRAHD-PLAN.md`, `OBSIDIAN-PLAN.md`,
  `OBSIDIAN-O4-DESIGN.md`, `ROADMAP.md`, `BRAND-BRIEF.md`).
- `docs/history/`: finished plans, session logs, reviews, `PROGRESS.md`. Never rewritten.

## Working in parallel

- `main` is the trunk (from the merge after the consolidation step). One short branch per session,
  in its own worktree, split by area (docs, one package, research). Merge back when green.
- Files every session touches change only at merge time: this file's status and next steps, the
  CHANGELOG "Unreleased" section, `scripts/lint-baseline.json`, test counts. A session puts its handoff
  in its branch (last commit message or PR description).
- One live test at a time per PC: the test server has fixed ports and one module folder.
- Each worktree needs its own `npm ci`. Obsidian vault: pull before writing, push after.
- Parallel workers inside one session: partition by file, write big files in parts of at most ~250
  lines per tool call, lock shared contracts first.

## Status (2026-09-29)

- Built on branch `claude/amazing-bardeen-q1x1q6` (not merged into `main`, which stops at v0.18.0):
  Curse of Strahd M0 to M3 (guarded writes, Tarokka, spoiler-safe `/player`, Foundry 14 / dnd5e 6
  pass), Obsidian O1 to O4 (vault, session notes, play log and stats, Foundry mirrors), tool-parameter
  pickers, dashboard hardening, ComfyUI removed (D-070). Live-tested on the test server (the ComfyUI
  removal is unit-tested; its live check is part of the release smoke test). 91 tools, 3,246 tests,
  lint baseline 6,743.
- Hardware: the Orange Pi 5 Pro (16 GB) has arrived and is not set up yet (D-068: Foundry, the tool and
  the bot move there; Tailscale; Syncthing; SSH-first bring-up from the PC).
- First Curse of Strahd session (a live session 0): around November or December 2026.

## Next (order agreed 2026-09-29)

1. **Consolidate** (done on this branch 2026-09-29: ComfyUI removed, Foundry 14 minimum, docs layout,
   this file, Pi guide and scripts, CI on Node 22 and 24). **Merging into `main` waits for the user's
   OK.** Release v0.19.0 when the Strahd world is set up on the Pi.
2. **Parallel lanes off `main`:** Pi setup (`docs/dev/PI-SETUP.md`: the user flashes the card and runs
   two scripts when there is time, then Claude continues over SSH; not a blocker); Discord bot v1 (own
   package: a session-day reminder for the fixed weekly session, `/away`, bridge up/down, a GM alert
   channel incl. failed backups; D-069); GM docs (beginner guide, before/after-session checklists,
   player page); Foundry side (a reveal that copies a handout into a player journal, a check of the
   GM's module list on dnd5e 6 against the play log, Claude Desktop prompts); voice benchmark (needs a
   past Craig recording); video pipeline research (60 fps, 1080p to 2160p, AI voice in English and
   Danish).
3. M4 onward (state in Foundry, controls in the dashboard), Obsidian pushes (O6), player vault (O7),
   M5 to M9, videos after the guides.

Open: how players reach Foundry on the Pi (decided during bring-up); the Strahd world's module list
(vault question, after the world exists).

## Handoff notes

- **Paused 2026-09-30 (pick up here):** `main` = `9fe15bc`; its CI fails on one Obsidian test that
  assumes a Windows path (runs on Linux in CI); fix first. The step-2 workflow (`wf_6b52204c-42a`,
  script under this session's workflows folder) was stopped: builds done in worktrees
  `.claude/worktrees/wf_6b52204c-42a-1` (GM docs + README), `-2` (reveal copies a handout), `-3`
  (Claude Desktop prompts); reviews partly done; no fixes applied; nothing merged. Design round 1
  was rejected as recolors; round 2 brief in memory `design-direction-feedback` and the vault
  session note of 2026-09-29. Queued after the merge: repo tidy (approved, incl. deleting
  `test-bench/` and the unused macro), usage log for dashboard and module (I-084), dashboard help
  with the design pass.

- Test env per PC (not synced): world `ai-tool-test` (users Gamemaster, Claude, Player; `Test Hero`
  owned by Player; world actor `Wolf` with unlinked tokens Wolf 1-3 on "Test Arena").
  `scripts/test-env/local.json` holds the test server's admin login (gitignored).
- The vault is the private git repo `Gnuminator/obsidian-vault`; Claude owns everything Obsidian.
- `.claude/skills/foundry-core-ui/reference/*.md` are drafts; the click-through verification is
  unfinished.
- Unmerged remote branches (reference only): `claude/remote-gm-hosting-design-cwllhf` (older Pi plan,
  `docs/PI-DEPLOY-PROMPTS.md`; Molten and API-key assumptions are outdated),
  `claude/remove-comfyui-pipeline-d9wlp8` and `claude/audit-comfyui-removal-0xzj8l` (obsolete: the
  removal landed here in `b5f76bc`; deleting them needs the user's OK).

## Model guidance

- **Sonnet 5.5**: mechanical work, test-writing, parallel workers (check the `sonnet` alias per PC and
  session with a one-line test agent).
- **Haiku** (else Sonnet): agents that only read and report on documents.
- **Opus**: architecture and contract design, security-sensitive review, parity calls, reviewing
  worker output.
