# Phase 9 — `data-access` from-scratch domain rewrites

> **STATUS — ✅ COMPLETE (2026‑06‑16): all 16 data-access domains rewritten/refactored to parity.** The last
> four large domains (`creature-index`, `actor-creation`, `player-rolls`, `actor-builder`) and the
> `characters` pf2e-prune landed on `aitool/main`. The whole phase is faithful parity except the one
> intentional `characters` behavior change (pf2e `category=focus`/`invested` now inert). The recipe + notes
> below are retained as the record of how it was done.

The step _after_ the modular reorg (`docs/PHASE9-DATA-ACCESS-REORG.md`, R1–R3 complete). The reorg was
a **behavior-preserving physical move**: every one of the 16 `data-access/` domain modules is still
upstream-derived code, just relocated behind a thin facade. This phase makes each domain **truly ours** —
reimplemented _from first principles_ (from the tool's purpose + its characterization tests), replacing
the upstream-derived logic with original code rather than a line-by-line copy.

> **The net is the contract.** Each rewrite is verified to parity by that domain's characterization
> test(s) — the Phase 9 Foundry-mock harness at `packages/foundry-module/src/test-support/foundry-mock/`.
> The public method signatures, the 18 `data-access.*.test.ts` files, and `queries.ts` stay **unchanged**.

## Why this is different from the reorg

The reorg was mechanical (move bytes, rewrite `this.helper` → `shared.helper`) → Sonnet workers + Opus
assembly. A **rewrite needs understanding and judgment**: you derive what each method _must_ do from its
tests + the tool's purpose, then write fresh code to that spec. So the unit of work is one domain, owned
end-to-end by one author who has read the tests. The pilot (`journals`) + this recipe were done on Opus;
see **Model guidance** for how later domains fan out.

## The rewrite recipe (per domain — keep green after each)

1. **Read the contract, not the code.** Read the domain module's _public signatures_, then read its
   characterization test(s) end-to-end, then the slice of `shared.ts` + the harness builders the tests
   touch. Write down, per public method, **what it must do** — inputs, outputs, error strings, branch
   conditions, and the exact return _shape_ (which keys are present vs absent vs present-but-`undefined`).
   The test assertions _are_ the spec. The old implementation's structure is just one way to hit it.
2. **Reimplement behind the same signatures.** New file, original structure. Free to:
   - extract private helpers that dedupe repeated logic (page-summary mapping, permission gate, …),
   - introduce small local types/interfaces for clarity,
   - reorder methods (e.g. reads-before-writes), consolidate audit/permission calls,
   - write fresh JSDoc that explains _why_, not _what_.
     Keep the `shared.*` helper calls (they're the cross-cutting contract) and the **import/DI shape**
     (which deps the module pulls in, how injected). Don't add a dependency on another domain that wasn't
     already injected.
3. **Preserve pinned behavior; clean only the unpinned.** Where a test pins a behavior — _including
   upstream quirks_ — preserve it exactly. Where the tests don't pin something, you may simplify. If you
   decide to drop a quirk a test encodes, change the **test** only with an explicit rationale in the
   commit; **default is preserve** (the net is the contract).
4. **Keep it green.** After the rewrite:
   `npm run typecheck --workspace=@gnuminator/foundry-module` + the domain's test file(s) + the full
   `npx vitest run packages/foundry-module` (was 377; **732** now that every domain is characterized — the
   count grew as each net landed), then `npm run build`. Run the full root
   `npm run typecheck && npm run build` before any push.
5. **Commit** `refactor(phase9): rewrite <domain> from first principles to parity`, noting any
   intentional behavior change and any test edits.

## Safety rails

- **The public surface is frozen.** Method names, parameter shapes, and return types must match the
  facade's declarations (`data-access.ts` delegates to each domain — its signatures are the source of
  truth). `queries.ts` and all 18 `data-access.*.test.ts` files must compile and pass unchanged.
- **Signatures under `exactOptionalPropertyTypes`.** Optional fields are `key?: T | undefined`. When a
  test asserts a key is _absent_ (`not.toHaveProperty`), the branch must omit it — don't set it to
  `undefined`. When a test's `toEqual` includes `key: undefined`, either present-undefined or absent
  passes (vitest `toEqual` ignores `undefined` props) — match the historical shape to stay faithful.
- **Error strings are part of the contract.** Tests assert exact/`^prefix` messages
  (`Journal creation denied: …`, `Page not found: <id>`, `Journal entry not found`). Reproduce them.
- **Wire-level constants stay.** Permission keys (`checkWritePermission('createActor', …)`), socket
  channels, flag scopes (`foundry-mcp-bridge`), `auditLog` operation names — these are live contracts,
  not cosmetics. Keep them even when reorganizing the code around them.
- **Lint gate = 0 _errors_.** The Foundry-global `any` _warnings_ are the accepted baseline (the harness
  duck-types every doc as `any`). A clean rewrite typically produces **0 errors** even where the moved
  upstream body carried verbatim error-level debt — a welcome side effect, not a required one.
- **Never widen scope to another domain.** If a method seems to need a sibling domain's logic, that edge
  was already injected via the ctor in the reorg (e.g. `actor-creation` injects `compendium`). Keep the
  injection; don't import a second domain module directly.

## Pilot result — `journals` (✅ done)

`packages/foundry-module/src/data-access/journals.ts`, verified by `data-access.journals.test.ts` (23) +
`data-access.journal-writes.test.ts` (21) = **44 tests**. Rewritten from the contract: introduced a
`PageSummary` type and four private helpers (`summarizePages`, `buildPageManifestNote`, `createTextPage`,
`requireJournalWrite`, `errorMessage`) that dedupe the page-mapping, note-building, embedded-page-create,
and permission-gate logic that were inline+duplicated upstream; reordered to reads-then-writes;
consolidated `updateJournalContent`'s per-branch success `auditLog` into one post-dispatch call (behavior
identical — every success branch logged then returned). **No behavior change; no test edits.** 276 → 247
lines, 0 eslint errors (was carrying verbatim `any`-error debt). Quirks deliberately preserved:

- `getJournalContent` with no text page returns `{ content, allPages, pageCount }` **without**
  `currentPage`/`note` keys (a test asserts their absence); with a text page, `note` is a present key
  whose value is `undefined` when `pageCount === 1`.
- `getJournalPageContent` reports `type` via `page.type || 'text'` but selects content via the **raw**
  `page.type === 'text'` check — so an untyped page reports `'text'` yet reads its `src`. Faithful to
  upstream; pinned by the "falls back type to text" test.
- `updateJournalContent` checks `newPageName` **before** `pageId` (create wins over update-by-id).

## Coverage map — characterized vs. deferred

A domain may only be rewritten once it has a parity net — and that bar is **per method**, not per
domain. The fan-out coverage check (2026‑06‑16) found two domains whose headline methods are pinned but
which carry **uncharacterized sibling methods**: `chat` (`getChatLog` has no data-access net — only
`sendChatMessage` is pinned) and `modules` (`getModuleErrors`/`clearModuleErrors` have no net — only
`getModules`/`getModuleManifest` are pinned). Both were therefore moved to "characterize first" — and have
**since been characterized and rewritten to parity** (along with `session-log`) in the 2026‑06‑16 fan-out;
see **Done** / the checklist for current status (sizes = current module LOC; tests = `it()` count in the
listed file(s)):

### Done — rewritten to parity ✅

| Domain              | LOC (before → after) | Verified by                                                                                                                                                           |
| ------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `journals` (pilot)  | 276 → 247            | `journals.test.ts` (23) + `journal-writes.test.ts` (21)                                                                                                               |
| `world-reads`       | 97 → 142             | `reads.test.ts` (12; world-reads slice)                                                                                                                               |
| `ownership-players` | 218 → 292            | `ownership.test.ts` (20) + `players.test.ts` (20)                                                                                                                     |
| `world-items`       | 265 → 317            | `world-items.test.ts` (29)                                                                                                                                            |
| `resources-effects` | 373 → 470            | `resources.test.ts` (25) + `effects.test.ts` (20) + `chat-resources.test.ts` (resource slice)                                                                         |
| `characters`        | 585 → 643            | `reads.test.ts` (`getCharacterInfo`) + `character-search.test.ts` (20) + `character-entity.test.ts` (14) + **`character-search-extra.test.ts` (7, new — pf2e-prune)** |
| `compendium`        | 560 → 539            | `compendium.test.ts` (26; basic search + `listByCriteria` fallback + `getDocFull`)                                                                                    |
| `scenes-tokens`     | 558 → 566            | `scenes.test.ts` (16) + `token-manipulation.test.ts` (24) + **`scenes-tokens-extra.test.ts` (22, new)** = 62                                                          |
| `combat` (full)     | 458 → 493            | `combat.test.ts` (26) + `combat-playbyplay.test.ts` (4) + **`combat-mutation.test.ts` (37, new)** = 67                                                                |
| `session-log`       | 55 → 98              | `session-log.test.ts` (20; `getSessionLog` + `getRecentEvents`)                                                                                                       |
| `chat`              | 112 → 220            | `chat-log.test.ts` (11; `getChatLog`) + `chat-resources.test.ts` (`sendChatMessage` slice)                                                                            |
| `modules`           | 137 → 247            | `modules.test.ts` (`getModules`/`getModuleManifest`) + `module-errors.test.ts` (15; error methods)                                                                    |
| `scene-fx`          | 333 → 430            | `scene-fx.test.ts` (37; templates + AoE geometry, mood, map notes, loot, deletes)                                                                                     |
| `creature-index`    | 585 → 585            | `creature-index.test.ts` (31; `PersistentCreatureIndex` build/persist/staleness/hooks)                                                                                |
| `actor-creation`    | 561 → 617            | `actor-creation.test.ts` (42; create-from-compendium/-entry, addActorItems, addActorsToScene)                                                                         |
| `player-rolls`      | 884 → 925            | `player-rolls.test.ts` (34; request/rollNpcCheck/id-map/state/relay; DOM handlers skipped)                                                                            |
| `actor-builder`     | 1790 → 1779          | `actor-builder-{npc,items,activity}.test.ts` (52+34+9 = 95; all 11 facade methods)                                                                                    |

> Most rewrites grew slightly (inline duplication → extracted helpers + fuller JSDoc; logic density
> dropped); `compendium` shrank by dropping no-op dead code. **All 16 domains are now done** (incl. `combat`
> reads + mutation, `scene-fx`, and the four formerly-deferred large domains): no existing-test edits, 0
> eslint errors (`scenes-tokens` +22 and `combat` +4/+37 each added a per-method net first). The only
> intentional behavior change in the whole phase is the `characters` pf2e-prune (see its note below); every
> other domain is faithful parity.
>
> **`session-log` / `chat` / `modules` (second Sonnet fan-out, Opus-reviewed — 2026‑06‑16).** Three
> parallel Sonnet workers, one fully-characterized domain each, editing only their module and verifying
> (typecheck + their nets) but not committing; Opus reviewed each against the contract, ran the
> authoritative gates (full suite + typecheck + build), lint/prettier-cleaned where a worker skipped it,
> and committed one domain per commit. **Faithful parity, no behavior change, no existing-test edits.**
> Each is a thin wrapper delegating to a singleton (`eventTracker` / `diagnostics`); helpers extracted to
> dedupe the undefined-key filter construction (`buildFilters`/`buildErrorFilters`), `chat`'s
> speaker/style/whisper resolution (`resolveSpeaker`/`resolveStyle`/`resolveWhisperTargets`, preserving the
> whisper-safety GM fallback + `warning`), and `modules`' dependency resolution + compat-issue collection
> (`summarizeModule`/`resolveRequires`/`collectCompatIssues`, preserving the count invariants:
> `activeCount`/`modulesWithIssues` over the full set, `moduleCount` over the filtered list).
>
> **`characters` (first Opus-tier/large domain) — rewritten to parity, then pf2e-pruned (DONE).** The
> rewrite itself was faithful parity (no behavior change). The pre-trim multi-system cruft was then removed
> in two passes: `getCharacterInfo`'s rule-element toggles + ChoiceSet/RollOption `itemVariants` and the
> `getCharacterEntity` non-dnd5e branches in **4edb7e5**, and the `searchCharacterItems` inline fallbacks in
> **3a2fce2** — `rank` (spell-level chain), `location.prepared`/`location.expended`, the `traits`/`category`
> focus check + `category=focus` branch, and the `invested` field + `category=invested` branch. The B5 prune
> **does change observable dnd5e behavior**: `category=focus`/`invested` carry no dnd5e data, so they used to
> match nothing and are now inert (an unrecognized category applies no filter). It was characterized first in
> a NEW `data-access.character-search-extra.test.ts` (+7) pinning the dnd5e contract (level from
> `system.level`, prepared from raw `preparation.prepared`, cantrip/prepared honored, focus/invested inert);
> the frozen `character-search.test.ts` was untouched. (The `system.actions` array branch in
> `getCharacterEntity` IS pinned — kept.)
>
> **`compendium` — enhanced-index fast path RETAINED (unpinned).** The `searchCompendium` enhanced
> branch and the `listCreaturesByCriteria` enhanced path both gate on the `enableEnhancedCreatureIndex`
> setting, which is OFF in the harness — so the 26 tests pin only the basic name search, the
> `fallbackBasicCreatureSearch` path, and `getDocFull`. The enhanced path (which calls the injected
> `persistentIndex.getEnhancedIndex()`) was preserved verbatim; it'll be covered when the deferred
> `PersistentCreatureIndex` net lands. The unpinned filter/relevance-scoring helpers
> (`shouldApplyFilters`/`calculateRelevanceScore`/`passesActorNameFilters`/`matchesSearchCriteria`) were
> likewise kept.
>
> **`scenes-tokens` (third Opus-tier domain — net extended first).** A per-method coverage check
> confirmed the existing nets pinned only 6 of 11 methods, so the 5 unpinned ones (`switchScene`,
> `getTokenPositions`, `measureDistance`, `getTargets`, `setTokenVisionLight`) were **characterized first**
> in a new `data-access.scenes-tokens-extra.test.ts` (+22) before any rewrite — the whole domain surface
> now has a parity net. Rewritten behind the frozen signatures with extracted helpers
> (`requireCurrentScene`/`requireToken`/`requireScenePermission`/`hpSnapshot`,
> `buildConditionEffect`/`effectMatchesCondition`, `panCanvasToScene`) deduping the scene+token lookup,
> permission gate, and hp-snapshot boilerplate; reads-then-writes. **Faithful parity** (no behavior change,
> no existing-test edits): preserved both error conventions (the write group's wrapped `Failed to …` +
> `No active scene found` vs the tactical group's raw `SCENE_NOT_FOUND`), the permission-gate-before-try
> quirk, and `setTokenVisionLight`'s `!= null` vs truthy field semantics. The **two canvas-gated branches**
> (`switchScene` `optimize_view` pan, `measureDistance` `grid.measurePath` fast path) are **unpinned** (no
> `canvas` in the harness) and were **preserved verbatim-equivalent** — covered live, not in the mock.
> Cleared inherited redundant `as any` casts (eslint 6→0). 558 → 566 lines.
>
> **`combat` (reads) — partial domain; mutation deferred (Opus).** `getCombatState` was pinned by
> `combat.test.ts` (26) but `getCombatPlayByPlay` was **not** (only the pure `EventTracker.buildPlayByPlay`
> it delegates to is, in `session-events.test.ts`), so it was **characterized first** in a new
> `data-access.combat-playbyplay.test.ts` (+4: combat resolution `game.combat → most-recent game.combats →
null` + descriptor passthrough via a spied `buildPlayByPlay`). The two **read** methods were rewritten
> **in place** behind the frozen signatures (extracted `resolveActiveOrRecentCombat`/`summarizeCombatant`),
> preserving the two distinct `hp.value` defaults (`defeated` uses `?? 0`, `deathSaves` uses `?? 1`) and the
> index-based `actedThisRound`. The **7 mutation/compute methods** (`advanceCombatTurn`/`setInitiative`/
> `rollInitiativeForNpcs`/`applyDamageAndHealing`/`rollSavingThrows`/`manageRest`/`suggestBalancedEncounter`)
> are **left byte-identical** — not yet characterized (see `combat` **mutation** in the deferred table).
> Cleared an inherited redundant `as any[]` cast (eslint 1→0). **Update:** those 7 methods were
> subsequently **characterized** in `data-access.combat-mutation.test.ts` (+37, Opus; local stubs for the
> combat/actor methods, v3-vs-v4+ roll dispatch via `game.system` overrides, 2014-DMG XP-budget path) and
> then **rewritten in place** — extracted `requireActiveCombat` (live combat or throw — distinct from the
> reads' recent-fallback resolver), `forEachTarget` (resolve + per-target try/catch dedup across the 3 dnd5e
> batch methods), `hpValueTemp`, `applyHpChange`, and the `rollDnd5eV4`/`rollDnd5eV3` dispatch split.
> `suggestBalancedEncounter` was left as-is (already original; its 2014-DMG XP table is data, kept verbatim).
> **The combat domain is now fully rewritten + characterized** (reads + mutation, 67 tests). 458 → 493 lines.
>
> **`scene-fx` (Opus).** Rewritten behind its 37-test net — extracted `requireCurrentScene` (the
> `SCENE_NOT_FOUND` gate repeated across 5 methods), `findToken` (name/id lookup shared by template + map
> note), `runPlaylist`, and `grantCurrency`/`grantItems`/`lootSummary` (the dropLoot sub-steps); the pure
> `tokensInTemplate` AoE geometry (circle/ray/cone/rect) is preserved verbatim. **Faithful parity** — v13
> `environment.*` vs pre-v13 flat schema, darkness clamp with raw-value echo, shape defaults, whisper-free
> loot announce. The "needs canvas" worry was unfounded (pure geometry + `createEmbeddedDocuments`). No
> write-permission gate exists on this domain. 333 → 430 lines.

### Formerly deferred — now rewritten ✅ (2026‑06‑16)

The last four large domains have all been rewritten/refactored to parity behind their nets (see the **Done**
table above for sizes/tests):

| Domain           | Disposition                     | Commit  | Notes                                                                          |
| ---------------- | ------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `creature-index` | rewritten from first principles | 253a17b | standalone `PersistentCreatureIndex`; unblocked the `compendium` enhanced path |
| `actor-creation` | rewritten from first principles | c478d1e | kept the ctor-injected `compendium`                                            |
| `player-rolls`   | rewritten from first principles | 994afbc | `attachRollButtonHandlers` stays uncharacterized (jQuery/DOM, covered live)    |
| `actor-builder`  | targeted refactor to parity     | ad62281 | largest (1779 lines); net was split 3 ways, refactor stayed conservative       |

Every domain has a parity net, and all are now rewritten. The 2026‑06‑16 fan-out closed the last four
(`actor-creation`, `creature-index`, `player-rolls`, `actor-builder`); see the table above. Each was
characterized with **local stubs only** (no shared-harness edits), disproving the earlier "needs
canvas/fetch/socket/DOM-harness" worries: canvas/fetch/FilePicker/`game.user.targets` are all set on the
ambient globals per-test and restored on teardown. The only genuinely un-characterizable surface found was
`player-rolls.attachRollButtonHandlers` (live jQuery/DOM click handlers).

The historical recipe for a deferred net (kept for reference): mirror the wave-1/2/3 characterization
fan-outs in `docs/DETACH-PLAN.md` — write the `data-access.<domain>.test.ts` pinning current behavior
(stubbing missing globals locally), verify it passes against current, _then_ rewrite. Don't rewrite ahead
of the net.

## Per-domain checklist

Order: characterized small→large first; each deferred domain gets a "characterize first" sub-task.

- [x] `journals` — rewrite to parity (pilot + this recipe)
- [x] `world-reads` — rewrite to parity (Sonnet, Opus-reviewed)
- [x] `ownership-players` — rewrite to parity (Sonnet, Opus-reviewed)
- [x] `world-items` — rewrite to parity (Sonnet, Opus-reviewed)
- [x] `resources-effects` — rewrite to parity (Sonnet, Opus-reviewed)
- [x] `characters` — rewrite to parity (Opus) **+ pf2e-prune done** (4edb7e5 getCharacterInfo/Entity;
      3a2fce2 searchCharacterItems, characterized first in `character-search-extra.test.ts` +7 — the one
      intentional behavior change in the phase: `category=focus`/`invested` now inert; see note above)
- [x] `compendium` — rewrite to parity (Opus; ctor-injected `persistentIndex`; faithful parity, enhanced
      creature-index path retained verbatim — unpinned, waits on the deferred `PersistentCreatureIndex` net)
- [x] `scenes-tokens` — rewrite to parity (Opus; per-method coverage check → characterized the 5 unpinned
      methods first in `scenes-tokens-extra.test.ts` (+22), then full-domain rewrite; canvas branches retained)
- [x] `combat` — rewrite to parity, full domain (Opus; reads in `combat-playbyplay.test.ts` +4, mutation in
      `combat-mutation.test.ts` +37; `requireActiveCombat`/`forEachTarget`/`rollDnd5eV4`/`rollDnd5eV3`
      helpers; `suggestBalancedEncounter` kept as-is, 2014-DMG table verbatim)
- [x] `session-log` — rewrite to parity (Sonnet, Opus-reviewed; `buildFilters` helper)
- [x] `chat` — rewrite to parity (Sonnet, Opus-reviewed; whisper-safety fallback + style mapping preserved)
- [x] `modules` — rewrite to parity (Sonnet, Opus-reviewed; dependency resolution + count invariants preserved)
- [x] `scene-fx` — rewrite to parity (Opus; `requireCurrentScene`/`findToken`/`runPlaylist`/loot helpers;
      `tokensInTemplate` geometry preserved verbatim; no canvas needed after all)
- [x] `actor-creation` — rewrite from first principles (Opus, c478d1e; kept the ctor-injected `compendium`)
- [x] `creature-index` — rewrite from first principles (Opus, 253a17b; `PersistentCreatureIndex` class —
      also unblocked the `compendium` enhanced-index path)
- [x] `player-rolls` — rewrite from first principles (Opus, 994afbc; `attachRollButtonHandlers` stays
      uncharacterized — jQuery/DOM only, covered live)
- [x] `actor-builder` — targeted refactor to parity (Opus, ad62281; largest at 1779 lines; net was split 3
      ways, refactor stayed conservative)

## Model guidance

- **Pilot + recipe: Opus** (done — `journals`).
- **Well-characterized small domains: Sonnet, Opus-reviewed.** Proven on the first fan-out wave
  (`world-reads`, `ownership-players`, `world-items`, `resources-effects`, 2026‑06‑16): four parallel
  Sonnet workers, one domain per worker, each given this recipe + its test file(s) + the `journals` pilot
  as a style reference, each editing only its own module and verifying (typecheck + its tests + full
  377-suite) but **not committing** — Opus reviewed each file (faithful contract, preserved quirks, no
  scope creep, no test edits), ran the authoritative gates once with all four applied, and committed one
  domain per commit. Workers were told **not** to run `npm run build` (it writes `dist/` and would
  contend across parallel workers); Opus runs the build during review.
- **Big / risky targets** (`compendium`, `scenes-tokens`, `characters`, and every deferred domain —
  especially `actor-builder`, `creature-index`, `player-rolls`, `combat` mutation, `actor-creation`,
  `scene-fx`): stay **Opus**, and build their characterization nets first.

## Lessons from the first fan-out wave (2026‑06‑16)

- **Verify per-method coverage before dispatching.** "The domain is characterized" is not enough — check
  every public method has assertions. This wave demoted `chat` (`getChatLog` unpinned) and `modules`
  (`getModuleErrors`/`clearModuleErrors` unpinned) from the ready list to "characterize first".
- **Parallel rewrites are conflict-free** because each worker edits exactly one module file (never tests,
  the facade, `shared.ts`, `queries.ts`, or a sibling domain). After the wave, confirm `git status` shows
  only the intended N files changed and **zero test edits** — the cheapest guard against a worker
  "fixing" a test to pass.
- **Workers verify; Opus is the gate.** Have workers run typecheck + their tests + the full module suite,
  but treat their green as provisional. Opus re-runs typecheck + full suite + build with all rewrites
  applied, then reads each file against the contract before committing.
