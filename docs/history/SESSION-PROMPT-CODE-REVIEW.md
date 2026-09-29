# New-session kickoff prompt — code-review / cleanup pass

Paste the block below into a fresh Claude Code session (this one's context is
nearly full). It's self-contained.

---

You are picking up the **Foundry AI Tool** (MCP server + Foundry module + co-GM
dashboard) on `aitool/main`, working tree clean. The detach + reimplementation
phases are **done**; the codebase is green (typecheck 0, lint 0 errors, build OK,
~1,935 tests across the 4 workspaces) and has been **live-verified** against a
real game (read surface + a write sample). Your job this session is a **code
quality / cleanup pass** — make it leaner, simpler, more efficient, and "trim the
hedges" (remove defensive over-engineering, dead code, leftover debug cruft, and
needless `any`). **No behavior changes** unless characterized first.

## Read first (carry full state)

- `CLAUDE.md` — identity, remotes (`aitool` = canonical, never add upstream),
  **frozen wire identifiers** (module id `foundry-mcp-bridge`, ports 31414/15/16,
  query prefix `foundry-mcp-bridge.*`, settings namespace) — DO NOT rename these.
- `docs/PROJECT-STATUS-2026-06.md` — architecture + backlog + the `any` baseline
  notes (~340 `as any` + ~459 `: any`; `actor-builder.ts` alone has 43).
- `docs/RUNTIME-TEST-PLAN.md` + `docs/LIVE-VERIFICATION-2026-06-16.md` — what's
  been verified live; the **queued runtime fixes A/B/C** (see below) — those are a
  SEPARATE track, not this session's job unless asked.
- `docs/PHASE9-DOMAIN-REWRITE.md` + `docs/DETACH-PLAN.md` — how the current code
  came to be (parity rewrites behind frozen characterization nets).

## Mission & scope

Hunt for and fix, in small green increments:

1. **Leftover debug cruft.** e.g. `map-generation-handlers.ts`
   `processMapGenerationInBackend` writes a running play-by-play to temp files
   (`process-mapgen-debug.log`, `foundry-mcp-upload-debug.log`) via dozens of
   `fs.appendFile` calls, plus heavy `console.log`. Gate behind a debug flag or
   remove. Sweep `console.log`/`console.error` spam in `main.ts`, `backend.ts`,
   the comfyui paths.
2. **`any` reduction.** Introduce shared `FoundryActor`/`FoundryItem`/… interfaces
   in `shared` (or a `foundry-module` types module) and narrow the most
   `any`-dense files (`actor-builder.ts`, `backend.ts`, `index.ts`,
   `system-detection.ts`). Don't chase the harness-duck-typed `any` in data-access
   reads where it's genuinely unavoidable — that's the accepted baseline.
3. **Duplication.** The ~80 `queries.ts` handlers and the mcp-server tool handlers
   repeat `validateGMAccess → validateFoundryState → validate args → delegate →
wrap "Failed to …"`. Consider a single wrapper/decorator. Same shape may exist
   in the tool layer.
4. **Over-defensive fallbacks ("hedges").** Like the pf2e fallbacks already pruned
   from `characters.ts` — look for remaining multi-system / dead `?? || ??` chains,
   redundant try/catch that swallow errors, unreachable branches.
5. **Dead code + cycles.** Run `npm run audit:unused` (knip) and
   `npm run audit:circular` (madge) — both are configured — and clear what's safe.
6. **Further `backend.ts` decomposition.** It's ~1,474 lines: the giant
   control-channel `call_tool` switch (~70 cases) could be a table-driven dispatch;
   the ComfyUI lifecycle (`startComfyUIService`/`stop`/`checkStatus`/paths/state)
   could move to a `comfyui-service.ts` with a real test. Lower priority / higher
   risk — do behind tests, keep it stable.
7. **The 4 large mcp-server tool files** (`character` ~1034, `dnd5e/add-feature`
   ~1038, `compendium` ~1329, `quest-creation` ~1380) are output-formatting-heavy
   and owned-via-tests — simplify only where it's clearly a win.

## Non-negotiables

- **Keep green after each change:** `npm run typecheck && npm run lint -- --quiet
&& npm run build` + the relevant `npx vitest run packages/<ws>`. Lint gate = **0
  errors** (the ~11.8k `any` _warnings_ are the accepted Foundry-duck-typing
  baseline; CI runs lint `--quiet`).
- **Don't edit the frozen `data-access.*.test.ts` / characterization tests.** If a
  cleanup changes observable behavior, **characterize it in a NEW test first**,
  then change — exactly like the `get-character` and pf2e-prune work.
- **Don't touch wire identifiers / ports / query names / settings namespace.**
- **Commit per logical unit** with a clear message; **push only when the user
  asks**; pre-commit runs prettier (LF) — use `git commit -F` for multi-line msgs.
  End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context)
<noreply@anthropic.com>`.
- Useful tools: the `/simplify` and `/code-review` skills; `npm run audit:unused`,
  `npm run audit:circular`, `npm run size:analyze`.

## Suggested order

Start with the **safe, high-signal wins** (debug-cruft removal in
`map-generation-handlers.ts` + console sweep; knip/madge dead-code) to build
momentum, then the `any`-reduction interface work, then duplication
consolidation, and only then the riskier `backend.ts` decomposition behind tests.
Produce a short prioritized findings list first, confirm scope with the user, then
execute incrementally.

## Out of scope this session

The queued **runtime** fixes (A: duplicate condition events; B: ComfyUI startup
noise; C: agentic co-GM ask) — those are behavior/feature work tracked in
`docs/LIVE-VERIFICATION-2026-06-16.md`. Leave them unless the user redirects.
