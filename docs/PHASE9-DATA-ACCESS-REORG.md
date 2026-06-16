# Phase 9 — `data-access` modular reorg

Splitting the 9,503-line `packages/foundry-module/src/data-access.ts` monolith into a cohesive
`data-access/` package, **behavior-preserving**, verified end-to-end by the 377-test characterization
net (the Phase 9 Foundry-mock harness). This reorg comes _before_ the deeper from-scratch domain
rewrites: once each domain is its own module with explicit dependencies, it becomes independently
rewritable. Until then this is a pure physical refactor — no behavior changes.

> **Hard contract (must not change):** consumers do `new FoundryDataAccess().<method>(...)`
> (`queries.ts` + all 18 `data-access.*.test.ts` files import `FoundryDataAccess` from
> `./data-access.js`). So `data-access.ts` **stays put as the facade file** and `FoundryDataAccess`
> keeps every public method signature. The new modules live under `data-access/`. No import path that
> any consumer uses may change.

## Why a facade + free-function core (the architecture decision)

Two structural facts from mapping the monolith make the decomposition clean:

1. **The class is almost stateless.** `FoundryDataAccess`'s only instance state is `moduleId`
   (a constant), `persistentIndex` (a `PersistentCreatureIndex`), and `rollButtonProcessingStates`
   (a `Map`, used _only_ by the player-rolls roll-button code). Everything else is computed from
   Foundry globals.
2. **The ~13 cross-cutting private helpers are stateless** — they read Foundry globals + their args
   and return values. They're called ~197 times across the class. Because they hold no state, they
   become **plain exported free functions** in `data-access/shared.ts`; domains import them directly.
   No "context object" is needed.

So the shape is:

```text
data-access.ts                 ← FACADE. `export class FoundryDataAccess` — thin delegators only.
data-access/
  types.ts                     ← all interfaces/types (pure, was lines 6–245)
  dnd5e-tables.ts              ← module-level pure data + pure fns (was lines 9204–end)
  creature-index.ts           ← `PersistentCreatureIndex` (was lines 247–915)
  shared.ts                    ← stateless cross-cutting helpers, as free functions
  characters.ts                ← domain handler class, ctor takes the deps it needs
  compendium.ts
  world-reads.ts
  journals.ts
  actor-creation.ts
  world-items.ts
  player-rolls.ts              ← owns its own rollButtonProcessingStates Map
  ownership-players.ts
  scenes-tokens.ts
  scene-fx.ts
  actor-builder.ts             ← imports dnd5e-tables.ts
  combat.ts
  resources-effects.ts
  chat.ts
  session-log.ts
  modules.ts
```

**Facade pattern.** Each domain is a handler **class** instantiated once in the facade ctor; each
public `FoundryDataAccess` method becomes a one-line delegation:

```ts
// data-access.ts
export class FoundryDataAccess {
  private persistentIndex = new PersistentCreatureIndex();
  private characters = new CharacterDataAccess();
  private journals = new JournalDataAccess();
  // ...one field per domain

  getCharacterInfo(identifier: string) {
    return this.characters.getCharacterInfo(identifier);
  }
  listJournals() {
    return this.journals.listJournals();
  }
  // ...one delegator per public method
}
```

Inside a domain module, former `this.sanitizeData(x)` calls become `sanitizeData(x)` (imported from
`./shared.js`); calls to other methods of the _same_ domain stay `this.method(...)`.

**Cross-domain calls** (a method in domain A calling a method that now lives in domain B) are the only
wrinkle. Protocol, in order of preference:

1. If the callee is actually a **shared helper** → it's already a free function, just import it.
2. If it's a genuine domain-B method → **inject** domain B into domain A's ctor
   (`new CharacterDataAccess(this.compendium)`), or
3. keep the call routed through the facade by passing a small bound callback.
   The extracting agent must report every cross-domain edge it finds; default to (2).

## Domain ownership table

Line numbers are the **pre-reorg** monolith (commit `1223fbd`'s parent tree for data-access). `(P)` =
private helper, otherwise public (on the facade surface). Each domain module owns its publics +
listed privates + any domain-local helpers.

| Module                     | Public methods                                                                                                                                                                                                                                                                                                                                                                                                                 | Private helpers                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `creature-index.ts`        | _(class `PersistentCreatureIndex`, 247–915; whole thing)_                                                                                                                                                                                                                                                                                                                                                                      | all its own                                                                                                                                                                                                                                                                                            |
| facade delegators to index | `rebuildEnhancedCreatureIndex` (926), `getEnhancedCreatureIndex` (4288)                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                                                      |
| `characters.ts`            | `getCharacterInfo` (951), `searchCharacterItems` (1097), `getCharacterEntity` (4976)                                                                                                                                                                                                                                                                                                                                           | `extractSpellcastingData` (1322), `extractDnD5eSpellSlots` (1423), `extractDnD5eSpellTargeting` (1456)                                                                                                                                                                                                 |
| `compendium.ts`            | `searchCompendium` (1511), `listCreaturesByCriteria` (1819), `getCompendiumDocumentFull` (3321)                                                                                                                                                                                                                                                                                                                                | `shouldApplyFilters` (1743), `calculateRelevanceScore` (1756), `passesEnhancedCriteria` (1926), `passesDnD5eCriteria` (1933), `fallbackBasicCreatureSearch` (1994), `matchesSearchCriteria` (2036)                                                                                                     |
| `world-reads.ts`           | `listActors` (2074), `getActiveScene` (2086), `getWorldInfo` (2131), `getAvailablePacks` (2152)                                                                                                                                                                                                                                                                                                                                | —                                                                                                                                                                                                                                                                                                      |
| `journals.ts`              | `createJournalEntry` (2394), `listJournals` (2471), `getJournalContent` (2499), `getJournalPageContent` (2542), `updateJournalContent` (2572)                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                      |
| `actor-creation.ts`        | `createActorFromCompendium` (2663), `createActorFromCompendiumEntry` (2812), `addActorItems` (2972), `addActorsToScene` (3375)                                                                                                                                                                                                                                                                                                 | `findBestCompendiumMatch` (3478), `createActorFromSource` (3504), `calculateTokenPosition` (3554)                                                                                                                                                                                                      |
| `world-items.ts`           | `listWorldItems` (3061), `updateWorldItems` (3126), `createWorldItems` (3221)                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                      |
| `player-rolls.ts`          | `requestPlayerRolls` (3629), `attachRollButtonHandlers` (4093), `saveRollState` (4300), `getRollState` (4316), `saveRollButtonMessageId` (4333), `getRollButtonMessageId` (4346), `getRollStateFromMessage` (4359), `updateRollButtonMessage` (4372), `requestRollStateSave` (4466), `broadcastRollState` (4486), `cleanOldRollStates` (4495), `requestAbilityCheck` (8002), `requestAttackRoll` (8023), `rollNpcCheck` (8038) | `resolveTargetPlayer` (3763), `buildRollFormula` (3936), `getSkillCode` (4029), `buildRollButtonLabel` (4063), `isRollButtonProcessing` (4794), `setRollButtonProcessing` (4801) **+ owns `rollButtonProcessingStates` Map (4789)**                                                                    |
| `ownership-players.ts`     | `setActorOwnership` (4528), `getActorOwnership` (4578), `getFriendlyNPCs` (4651), `getPartyCharacters` (4679), `getConnectedPlayers` (4702), `findPlayers` (4725), `findActor` (4776)                                                                                                                                                                                                                                          | `findActorByIdentifier` (4638) _(verify not cross-domain; else → shared)_                                                                                                                                                                                                                              |
| `scenes-tokens.ts`         | `listScenes` (4867), `switchScene` (4913), `moveToken` (5075), `updateToken` (5137), `deleteTokens` (5192), `getTokenDetails` (5255), `toggleTokenCondition` (5306), `getTokenPositions` (7886), `measureDistance` (7927), `getTargets` (9047), `setTokenVisionLight` (8869)                                                                                                                                                   | —                                                                                                                                                                                                                                                                                                      |
| `scene-fx.ts`              | `setSceneMood` (8747), `addMapNote` (8801), `dropLoot` (8915), `placeMeasuredTemplate` (8678), `deleteMeasuredTemplate` (8996), `deleteMapNote` (9020)                                                                                                                                                                                                                                                                         | `tokensInTemplate` (8633)                                                                                                                                                                                                                                                                              |
| `actor-builder.ts`         | `createNpcActor` (5818), `addSaveFeatureToActor` (5662), `addAttackToActor` (6027), `addAuraToActor` (6262), `addPassiveFeatureToActor` (6440), `addAttackWithSaveToActor` (6534), `setActorSpellcasting` (6810), `addSpellsToActor` (6916), `addFeaturesFromCompendium` (7096), `useItem` (5449), `useNpcActivity` (8382)                                                                                                     | _(imports `dnd5e-tables.ts`)_                                                                                                                                                                                                                                                                          |
| `combat.ts`                | `getCombatState` (7775), `advanceCombatTurn` (7830), `setInitiative` (7860), `rollInitiativeForNpcs` (8160), `applyDamageAndHealing` (8233), `rollSavingThrows` (8299), `manageRest` (8492), `suggestBalancedEncounter` (8547), `getCombatPlayByPlay` (7316)                                                                                                                                                                   | —                                                                                                                                                                                                                                                                                                      |
| `resources-effects.ts`     | `getCharacterResources` (7412), `updateCharacterResource` (7550), `getActiveEffects` (7671), `clearStaleConditions` (7726), `getAvailableConditions` (5418)                                                                                                                                                                                                                                                                    | `actorConditionNames` (7658)                                                                                                                                                                                                                                                                           |
| `chat.ts`                  | `getChatLog` (7285), `sendChatMessage` (7334)                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                      |
| `session-log.ts`           | `getSessionLog` (8100), `getRecentEvents` (8125)                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                                                                                                                                                                                      |
| `modules.ts`               | `getModules` (9075), `getModuleErrors` (9146), `clearModuleErrors` (9175), `getModuleManifest` (9182)                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                                                                                                                                                      |
| **facade / `shared.ts`**   | `validateFoundryState` (2340) _(public → facade method delegating to shared)_, `validateWritePermissions` (3603)                                                                                                                                                                                                                                                                                                               | `sanitizeData` (2165), `removeSensitiveFields` (2191), `isSensitiveOrProblematicField` (2266), `safeJSONStringify` (2309), `getTokenDisposition` (2328), `auditLog` (2357), `getOrCreateFolder` (4812), `resolveTargetActor` (8213), `systemMajor` (8198), `requireDnd5e` (8202), `rollModeFor` (8224) |

`shared.ts` free functions = the bottom row's private helpers. `findActorByIdentifier` is provisionally
in `ownership-players.ts` — promote to `shared.ts` if any other domain calls it.

## Extraction recipe (per stage — keep green after each)

Run after **every** stage: `npx vitest run packages/foundry-module` (377 tests) **+**
`npm run typecheck --workspace=@gnuminator/foundry-module` **+** root `npx eslint <changed files>`
(0 errors; the Foundry-global `any` _warnings_ are the accepted baseline) **+** `npm run build`.

1. **Foundation (R1):** move `types.ts`, `dnd5e-tables.ts`, `creature-index.ts` out verbatim; replace
   their blocks in `data-access.ts` with `import`s. (`PersistentCreatureIndex` must gain `export`.)
2. **Shared core (R2):** move the 11–12 stateless helpers into `shared.ts` as free functions; replace
   `this.<helper>(` call sites with `<helper>(` + add the import. `validateFoundryState` stays a
   facade method (delegating to the shared fn) because it's public.
3. **Domains (R3, fan-out):** one domain module per agent. Agent **writes the new module only** (no
   monolith edits, to avoid conflicts) + reports its delegation lines and any cross-domain edges. The
   facade is then wired **one domain at a time**, tests green between each. Order easiest→hardest:
   `modules`, `session-log`, `chat`, `world-reads`, `journals`, `world-items`, `resources-effects`,
   `ownership-players`, `scene-fx`, `compendium`, `characters`, `scenes-tokens`, `combat`,
   `actor-creation`, `actor-builder`, `player-rolls`.

## Status

- [x] Architecture decided; this doc.
- [x] R1 — foundation (`types` / `dnd5e-tables` / `creature-index`). `data-access.ts` 9,503 → 8,326
      lines; 377 tests + typecheck + build green; lint-neutral (byte-identical slice).
- [x] R2 — `shared.ts` core. 13 stateless helpers lifted to free functions (`sanitizeData` +
      `removeSensitiveFields` + `isSensitiveOrProblematicField` + `safeJSONStringify`,
      `getTokenDisposition`, `validateFoundryState`, `auditLog`, `findActorByIdentifier`,
      `resolveTargetActor`, `getOrCreateFolder`, `systemMajor`, `requireDnd5e`, `rollModeFor`); facade
      keeps thin `shared.*` delegating wrappers so its ~193 call sites are untouched. `data-access.ts`
      8,326 → 8,058 lines; 377 tests + typecheck + build green. (R3 domains import `shared.ts`
      directly; the facade wrappers get removed by attrition as their last callers move out.)
- [~] R3 — domain modules (16 modules; see order above).
  - [x] **Batch 1 (6 leaf domains, Sonnet fan-out):** `modules`, `session-log`, `world-reads`,
        `journals`, `world-items`, `chat` — all confirmed to depend only on `shared.ts` (zero
        cross-domain calls). Each extracted to a handler class (`ModulesDataAccess`,
        `SessionLogDataAccess`, `WorldReadsDataAccess`, `JournalDataAccess`, `WorldItemsDataAccess`,
        `ChatDataAccess`); facade delegates via a field per domain. Dropped the now-dead
        `getTokenDisposition` facade wrapper + `diagnostics` import. `data-access.ts` 8,058 → 7,316
        lines; 377 tests + typecheck + build green. (`chat` skipped the interleaved
        `getCombatPlayByPlay`, which stays with `combat`.)
  - [x] **Batch 2 (2 domains, Sonnet fan-out):** `ownership-players` (`OwnershipPlayersDataAccess`:
        setActorOwnership/getActorOwnership/getFriendlyNPCs/getPartyCharacters/getConnectedPlayers/
        findPlayers/findActor) + `resources-effects` (`ResourcesEffectsDataAccess`:
        getAvailableConditions/getCharacterResources/updateCharacterResource/getActiveEffects/
        clearStaleConditions). Prereq: promoted `actorConditionNames` to `shared.ts` (it's called by
        `combat` + `scenes-tokens`, not by resources itself). `data-access.ts` 7,316 → 6,751 lines;
        377 tests + typecheck + build green.
  - [x] **Batch 3 (3 domains, Sonnet fan-out):** `characters` (`CharacterDataAccess`:
        getCharacterInfo/searchCharacterItems/getCharacterEntity + the 3 private spell helpers
        extractSpellcastingData/extractDnD5eSpellSlots/extractDnD5eSpellTargeting) + `scenes-tokens`
        (`ScenesTokensDataAccess`: listScenes/switchScene/moveToken/updateToken/deleteTokens/
        getTokenDetails/toggleTokenCondition/getTokenPositions/measureDistance/getTargets/
        setTokenVisionLight) + `scene-fx` (`SceneFxDataAccess`: placeMeasuredTemplate/setSceneMood/
        addMapNote/dropLoot/deleteMeasuredTemplate/deleteMapNote + private tokensInTemplate).
        `getCharacterEntity` (characters) was interleaved among the scene methods; `setTokenVisionLight`/
        `getTargets`/`getTokenPositions` (scenes-tokens) were interleaved among scene-fx — the
        name-based splicer relocates each by name so interleaving is a non-issue. All three depend only
        on `shared.*` (no cross-domain method edges; scenes-tokens also imports `permissionManager`).
        Dropped now-unused `SpellcastingEntry`/`SpellInfo` type imports from the facade.
        `data-access.ts` 6,751 → 5,266 lines; 377 tests + typecheck + build green.
  - [x] **Batch 4 (1 domain, `compendium`):** `CompendiumDataAccess`: searchCompendium /
        listCreaturesByCriteria / getCompendiumDocumentFull + 6 private filter/scoring helpers
        (shouldApplyFilters, calculateRelevanceScore, passesEnhancedCriteria, passesDnD5eCriteria,
        fallbackBasicCreatureSearch, matchesSearchCriteria). Cross-domain edge: it calls
        `this.persistentIndex.getEnhancedIndex()` — `PersistentCreatureIndex` is **injected** via ctor
        (`new CompendiumDataAccess(this.persistentIndex)`); otherwise `shared.sanitizeData` +
        same-domain only. Dropped the now-dead `sanitizeData` facade wrapper (last `this.sanitizeData`
        caller, getCompendiumDocumentFull, moved out) and the now-unused `DnD5eCreatureIndex` /
        `EnhancedCreatureIndex` type imports. `data-access.ts` 5,266 → 4,675 lines; 377 tests +
        typecheck + build green.
  - [x] **Batch 5 (1 domain, `combat`):** `CombatDataAccess`: getCombatPlayByPlay, getCombatState,
        advanceCombatTurn, setInitiative, rollInitiativeForNpcs, applyDamageAndHealing,
        rollSavingThrows, manageRest, suggestBalancedEncounter. Depends only on `shared.*`
        (validateFoundryState/auditLog/requireDnd5e/resolveTargetActor/rollModeFor/systemMajor +
        `shared.actorConditionNames`) and `eventTracker`; no cross-domain edges, no private helpers.
        Dropped now-dead facade pieces: the `resolveTargetActor` + `rollModeFor` shared wrappers (last
        `this.` callers moved out) and the `eventTracker` import (combat was its last facade user).
        `requireDnd5e` + `systemMajor` wrappers stay (still called by not-yet-extracted actor-builder).
        `data-access.ts` 4,675 → 4,271 lines; 377 tests + typecheck + build green.
  - [x] **Batch 6 (1 domain, `actor-creation`):** `ActorCreationDataAccess`:
        createActorFromCompendium / createActorFromCompendiumEntry / addActorItems / addActorsToScene +
        private findBestCompendiumMatch / createActorFromSource / calculateTokenPosition. Cross-domain
        edge: it calls `getCompendiumDocumentFull` + `searchCompendium` (compendium) — `compendium` is
        **injected** via ctor (`new ActorCreationDataAccess(this.compendium)`), and those two call sites
        were rewritten to `this.compendium.*`. Otherwise `shared.*`
        (auditLog/validateFoundryState/findActorByIdentifier/getOrCreateFolder) + `permissionManager` +
        `transactionManager`. Dropped now-dead facade pieces: the `transactionManager` import
        (actor-creation was its last facade user) and the now-unused `CreatedActorInfo` type import.
        `data-access.ts` 4,271 → 3,687 lines; 377 tests + typecheck + build green.
  - [x] **Batch 7 (1 domain, `actor-builder`):** `ActorBuilderDataAccess` (the large one, 11 methods,
        no private helpers): useItem, addSaveFeatureToActor, createNpcActor, addAttackToActor,
        addAuraToActor, addPassiveFeatureToActor, addAttackWithSaveToActor, setActorSpellcasting,
        addSpellsToActor, addFeaturesFromCompendium, useNpcActivity. Imports `dnd5e-tables.ts` (all 15
        symbols) + `shared.*` (auditLog/validateFoundryState/findActorByIdentifier/getOrCreateFolder/
        requireDnd5e/systemMajor) + ERROR_MESSAGES; no cross-domain edges; uses the `MODULE_ID`
        constant directly (no `this.moduleId`). Bodies byte-identical to originals after the
        `this.<helper>` → `shared.<helper>` rewrites. Dropped now-dead facade pieces: the entire
        `dnd5e-tables` import block (actor-builder was its last facade user) and the `auditLog`,
        `getOrCreateFolder`, `systemMajor`, `requireDnd5e` shared wrappers (last `this.` callers moved
        out). `data-access.ts` 3,687 → 1,851 lines; 377 tests + typecheck + build green.
  - [ ] **Batch 8 (last domain, `player-rolls`):** `PlayerRollsDataAccess` — owns the
        `rollButtonProcessingStates` Map + roll-button helpers. Depends only on `shared.*` + same-domain
        (no cross-domain method edges).

> **Assembly hazard (learned in batch 2):** the R2 `shared.*` delegating wrappers
> (`findActorByIdentifier`, `resolveTargetActor`, `systemMajor`, `requireDnd5e`, `rollModeFor`,
> `getOrCreateFolder`, `auditLog`, `sanitizeData`) sit at their _original_ scattered positions and can
> be **interleaved inside a domain's method span** (e.g. `findActorByIdentifier` lived between
> `getActorOwnership` and `getFriendlyNPCs`). A block-replace of `[firstMethod..lastMethod]` will
> delete an interleaved wrapper. After each batch, if typecheck reports a missing `this.<helper>`,
> re-add that wrapper (it's still needed by not-yet-extracted methods). Only drop a wrapper once it has
> zero remaining `this.` callers (as with `getTokenDisposition` in batch 1).

Each stage = its own commit, `refactor(phase9): ...`, all suites green.
