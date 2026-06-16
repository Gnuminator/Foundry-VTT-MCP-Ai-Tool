# Phase 9 — `data-access` from-scratch domain rewrites

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
   `npx vitest run packages/foundry-module` (377) + `npm run build`. Run the full root
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

A domain may only be rewritten once it has a parity net. Status as of the journals pilot (sizes =
current module LOC; tests = `it()` count in the listed file(s)):

### Ready now — characterized (rewrite directly, order small → large)

| Domain                | LOC | Characterization test(s)                                                                                 |
| --------------------- | --- | -------------------------------------------------------------------------------------------------------- |
| `world-reads`         | 90  | `reads.test.ts` (12; also exercises `getCharacterInfo`)                                                  |
| `chat`                | 98  | `chat-resources.test.ts` (`sendChatMessage`)                                                             |
| `modules`             | 124 | `modules.test.ts` (19)                                                                                   |
| `ownership-players`   | 218 | `ownership.test.ts` (20) + `players.test.ts` (20)                                                        |
| `world-items`         | 233 | `world-items.test.ts` (29)                                                                               |
| **`journals`** ✅     | 247 | `journals.test.ts` (23) + `journal-writes.test.ts` (21) — **DONE (pilot)**                               |
| `resources-effects`   | 339 | `resources.test.ts` (25) + `effects.test.ts` (20) + `chat-resources.test.ts`                             |
| `compendium`          | 560 | `compendium.test.ts` (26; basic search + `listByCriteria` fallback + `getDocFull`)                       |
| `scenes-tokens`       | 558 | `scenes.test.ts` (16) + `token-manipulation.test.ts` (24)                                                |
| `characters`          | 585 | `reads.test.ts` (`getCharacterInfo`) + `character-search.test.ts` (20) + `character-entity.test.ts` (14) |
| `combat` (reads only) | 416 | `combat.test.ts` (26; `getCombatState`/`getCombatPlayByPlay` **read** only)                              |

### Characterize first, then rewrite (deferred — no net yet)

| Domain / surface                             | LOC  | What a net needs first                                                                                       |
| -------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `session-log`                                | 48   | characterize `getSessionLog` / `getRecentEvents`                                                             |
| `scene-fx` (all writes)                      | 333  | `setSceneMood`/`addMapNote`/`dropLoot`/measured-templates — needs `canvas`                                   |
| `actor-creation`                             | 561  | `createActorFromCompendium`/`addActorsToScene` — needs canvas token placement                                |
| `combat` **mutation**                        | —    | `advanceCombatTurn`/`setInitiative`/`applyDamageAndHealing`/`rollSavingThrows`/`manageRest` (in `combat.ts`) |
| `creature-index` (`PersistentCreatureIndex`) | 585  | needs a storage + `fetch` mock                                                                               |
| `player-rolls`                               | 884  | `requestPlayerRolls`/roll-button handlers/`rollNpcCheck` — needs socket + chat-button mock                   |
| `actor-builder`                              | 1790 | `useItem`/`createNpcActor`/`addAttack*`/`addSpells*`/… — large; needs compendium + item-creation depth       |

Building a deferred domain's net is its own sub-task (mirror the wave-1/2/3 characterization fan-outs in
`docs/DETACH-PLAN.md`): extend the harness as needed, write the `data-access.<domain>.test.ts` pinning
current behavior, _then_ rewrite. Don't rewrite ahead of the net.

## Per-domain checklist

Order: characterized small→large first; each deferred domain gets a "characterize first" sub-task.

- [x] `journals` — rewrite to parity (pilot + this recipe)
- [ ] `world-reads` — rewrite to parity
- [ ] `chat` — rewrite to parity (note: `chat-resources.test.ts` pins `sendChatMessage`; confirm
      `getChatLog`/`getCombatPlayByPlay` coverage before relying on it — `getCombatPlayByPlay` lives in
      `combat.ts`, not here)
- [ ] `modules` — rewrite to parity
- [ ] `ownership-players` — rewrite to parity
- [ ] `world-items` — rewrite to parity
- [ ] `resources-effects` — rewrite to parity
- [ ] `compendium` — rewrite to parity (ctor-injected `persistentIndex`; only the basic-search /
      `listCreaturesByCriteria` fallback / `getCompendiumDocumentFull` paths are characterized — the
      enhanced creature-index path depends on the deferred `PersistentCreatureIndex` net)
- [ ] `scenes-tokens` — rewrite to parity
- [ ] `characters` — rewrite to parity
- [ ] `combat` (reads) — rewrite `getCombatState`/`getCombatPlayByPlay` to parity
- [ ] `session-log` — **characterize first**, then rewrite
- [ ] `scene-fx` — **characterize first** (canvas), then rewrite
- [ ] `actor-creation` — **characterize first** (canvas placement; ctor-injected `compendium`), then rewrite
- [ ] `combat` (mutation) — **characterize first**, then rewrite
- [ ] `creature-index` — **characterize first** (storage + fetch mock), then rewrite
- [ ] `player-rolls` — **characterize first** (socket + chat buttons; owns `rollButtonProcessingStates`), then rewrite
- [ ] `actor-builder` — **characterize first** (largest; compendium + item depth), then rewrite

## Model guidance

- **Pilot + recipe: Opus** (done).
- **Well-characterized small domains** (`world-reads`, `chat`, `modules`, `ownership-players`,
  `world-items`, `resources-effects`): fan out **Sonnet** workers — one domain per worker, each given
  this recipe + its test file(s) — with **Opus review** of each rewrite before commit.
- **Big / risky targets** (`compendium`, `scenes-tokens`, `characters`, and every deferred domain —
  especially `actor-builder`, `creature-index`, `player-rolls`, `combat` mutation, `actor-creation`,
  `scene-fx`): stay **Opus**, and build their characterization nets first.
