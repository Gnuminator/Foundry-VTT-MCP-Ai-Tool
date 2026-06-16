# Code-quality cleanup pass — session log (2026-06-17)

Resume point for the "trim the hedges" cleanup track (kickoff:
`docs/SESSION-PROMPT-CODE-REVIEW.md`). Tree clean, **all green**: typecheck 0,
lint `--quiet` 0 errors, build OK, **1942 tests** pass across 4 workspaces.

## Done this session (4 commits on `main`)

1. **`2af3830` — strip temp-file debug cruft from the map-gen pipeline.**
   `map-generation-handlers.ts` `processMapGenerationInBackend` wrote a running
   play-by-play to two temp files (`process-mapgen-debug.log`,
   `foundry-mcp-upload-debug.log`) via ~30 `fs.appendFile` calls + a `debugLog`
   helper — every one shadowing a `logger.*` that already records the event.
   Removed all of them, plus two now-empty try/catches (only logged-then-rethrew)
   and the `connectionType` block (computed solely for debug output). Pure
   orchestration now, no filesystem access. **−185 net lines.**

2. **`0cad750` — verified dead code + unused dependency.** Each item grep-verified
   (knip is unreliable here — it mis-flags entry-point files, so it false-flagged
   `axios` and `getHiddenProcessSpawnOptions`, both of which have real consumers).
   Removed: `platform.ts` `isLinux`/`getClaudeConfigDir`/`getFoundryDataDir`;
   `constants.ts` `MODULE_TITLE` + `SOCKET_EVENTS` (never imported — the
   `'mcp-query'`/`'mcp-response'` strings are hardcoded in `foundry-connector.ts`);
   the `@primno/dpapi` root dep. De-exported `platform.ts` `getPlatform`/`Platform`
   (internal-only). Fixed a stale "Mac" comment.

3. **`7835fb0` — drop dead `index-builder-registry` cluster.** Browser-context code
   stranded in mcp-server, reachable only via the `systems/index.ts` barrel but
   never instantiated/called. Removed the module + the now-orphaned `IndexBuilder`
   /`GenericCreatureIndex`/`AnyCreatureIndex` types + barrel re-exports. This also
   resolved the only `console.log` calls in mcp-server. **−145 lines.**

4. **`80aff8d` — drop 16 cargo-cult `as any` casts (foundry-module).**
   `(foundry.utils as any).randomID(16)` → `foundry.utils.randomID(16)` (×5) and
   `(game.system as any)` → `game.system` (×11). Both symbols are already typed
   (foundry-vtt-types + `types/foundry-extensions.d.ts`), so the casts bought
   nothing. Type-only, behavior identical.

### Console sweep verdict (Tier 1 item 3)

No further action — the remaining `console.*` is legitimate and intentionally
left: `foundry-module` `main.ts`/data-access use `console` as the **browser
module's logging channel**; `backend.ts` uses `console.error` (stderr,
protocol-safe) during **pre-logger bootstrap**. In an MCP stdio server, stray
`console.log` would corrupt the protocol — there are now **zero** in mcp-server.

### `any`-reduction verdict (Tier 2)

The 16-cast removal was the real win (redundant casts where types already
existed). The rest is the **accepted baseline**, not reducible cruft:

- `game.scenes`/`game.user` casts (`.current`/`.active`/`.targets`/`.color`/
  `.updateTokenTargets`) are **load-bearing** — the simplified
  `foundry-extensions.d.ts` types genuinely lack those members. Typing them would
  only relocate the `any` into the `.d.ts` (value stays `any`), not reduce it.
- The deep `system.*` data-access casts are the documented Foundry-duck-typing
  baseline (no point modeling `system.details.cr` etc.).
- mcp-server has **no** Foundry types at all (the `.d.ts` is foundry-module-only),
  so its Foundry-shaped casts are unavoidable.
- A shared `FoundryActor`/`FoundryItem` interface (the kickoff's suggestion) would
  **not** help the dense files: `actor-builder.ts`'s 43 casts are almost all live
  **global-API** access (`game.*`, `foundry.utils.*`, `pack.getDocument`,
  `createEmbeddedDocuments` return types), not our own data shapes.

## Not started — analysis for next session

### Tier 3 — `queries.ts` handler-boilerplate consolidation (HIGH value, delicate)

- **Shape:** ~80 handlers (mix of `private async handle*` **and** public
  `async handle*` — grep both) sharing one convention:
  `validateGMAccess` (non-GM → `return {error:'Access denied', success:false}`) →
  `this.dataAccess.validateFoundryState()` → arg-validate → delegate → `catch`
  wrap as `Failed to <thing>: <msg>`. ~60 distinct "Failed to …" prefixes.
- **Net already exists:** `queries.test.ts` pins the convention on a _sample_ +
  the two divergent handlers (`handlePing` ungated; `handleGenerateMap`/map-gen
  return error objects, never throw).
- **Plan:** add a `withGmGate(prefix, data, body)` helper that reproduces the
  boilerplate exactly (GM check returns early; `validateFoundryState` + body inside
  the try; catch wraps). Reduce each matching handler to its unique core (~7 lines
  saved each → ~500+ lines).
- **⚠ Risk — it's a LIVE WIRE CONTRACT, silent breakage is bad.** Only a sample is
  characterized. **Audit each handler before converting** — specifically watch for
  handlers that do **not** call `validateFoundryState` (the wrapper would _add_ it
  = behavior change) or that aren't GM-gated/return-shaped like the norm. Leave
  divergent ones bespoke. Per project rule: characterize-in-a-new-test before any
  behavior change. Convert in batches; run the 787 foundry-module tests after each.

### Tier 4 — `backend.ts` decomposition (~1474 lines, ZERO tests)

- **ComfyUI extraction (do first — it's _additive_, adds coverage):** lifecycle is
  module-level state (`comfyuiProcess`, `comfyuiStatus` ~L200-202) + module
  functions (`findComfyUIPath` ~L301, `waitForComfyUIReady` ~L357,
  `startComfyUIService` ~L379, plus stop/checkStatus/paths). Move into a
  `comfyui-service.ts` class with injected logger + a real unit test, backend
  delegates. Self-contained; lowest-risk piece of backend.
- **`call_tool` switch (~70 cases) → table-driven dispatch:** higher risk; do
  behind tests, keep stable.

## Out of scope (separate track — do NOT touch unless redirected)

Runtime fixes **A** (duplicate condition events), **B** (ComfyUI startup noise),
**C** (agentic co-GM ask) — tracked in `docs/LIVE-VERIFICATION-2026-06-16.md` and
the `queued-fixes-live-verification` memory.
