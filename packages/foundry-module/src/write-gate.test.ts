/**
 * P-036: "Allow Write Operations" gates every bridge handler that changes the
 * world, and every registered handler is classified as write or non-write.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { bridgeHandlers, type BridgeHandlerKind } from './bridge-handlers.js';
import { changeJournal } from './change-journal.js';
import { MODULE_ID } from './constants.js';
import { FoundryDataAccess } from './data-access.js';
import { QueryHandlers } from './queries.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { WRITES_DISABLED_MESSAGE } from './write-gate.js';

let world: TestWorld;
let restore: () => void;
let qh: QueryHandlers;

const wire = (method: string): string => `${MODULE_ID}.${method}`;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  (globalThis as any).CONFIG.queries = {};
  bridgeHandlers.deleteByPrefix('');
  qh = new QueryHandlers();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

/** A data-access stub whose every method resolves, recording calls. */
function stubEverything(): Mock {
  const calls = vi.fn();
  (qh as any).dataAccess = new Proxy(
    { validateFoundryState: vi.fn() },
    {
      get: (target: Record<string, unknown>, key: string): unknown =>
        key in target
          ? target[key]
          : (...args: unknown[]): Promise<{ success: boolean }> => {
              calls(key, ...args);
              return Promise.resolve({ success: true });
            },
    }
  );
  return calls;
}

/** Registered method names (without the module prefix) of the given kinds. */
const namesOfKind = (...kinds: BridgeHandlerKind[]): string[] =>
  bridgeHandlers
    .methodsOfKind(...kinds)
    .map(m => m.slice(MODULE_ID.length + 1))
    .sort();

/**
 * The methods that change the world, pinned by name. The kind is a required argument of
 * `bridgeHandlers.on/set`, so no handler can be left unclassified; this pins the answer, so a
 * handler that moves between kinds (or a new write) shows up in a review as a test change.
 */
const PINNED_RECORDLESS_WRITES = [
  'ensureJournalFolder',
  'playPlaylist',
  'playerRoll',
  'postHandoutNotice',
  'request-player-rolls',
  'rollNpcCheck',
  'rollSavingThrows',
  'sendChatMessage',
  'showJournalPage',
  'uploadActorImage',
  'uploadHandoutImage',
  'uploadPlayerPortrait',
];
const PINNED_WRITES = [
  'addActorItems',
  'addAttackToActor',
  'addAttackWithSaveToActor',
  'addAuraToActor',
  'addFeaturesFromCompendium',
  'addPassiveFeatureToActor',
  'addSaveFeatureToActor',
  'addSpellsToActor',
  'advanceCombatTurn',
  'createActorFromCompendium',
  'createJournalEntry',
  'createNpcActor',
  'createWorldItems',
  'liveSweep',
  'manageRest',
  'rollInitiativeForNpcs',
  'setActorSpellcasting',
  'setInitiative',
  'switch-scene',
  'updateJournalContent',
  'updateWorldItems',
  'useItem',
  'useNpcActivity',
];

/**
 * Every other registered handler, pinned by name. This is the wire contract of the read
 * surface: a renamed or dropped read handler fails here, and a new handler has to be added to
 * one of the three lists, so it shows up in a review of this write-gate file.
 */
const PINNED_READS = [
  'aiChangesUpdated',
  'applyGuardedOps',
  'characterSheet',
  'clearModuleErrors',
  'findActor',
  'findPlayers',
  'get-available-conditions',
  'get-token-details',
  'getActiveEffects',
  'getActiveScene',
  'getActorOwnership',
  'getAvailablePacks',
  'getChangeJournal',
  'getCharacterEntity',
  'getCharacterInfo',
  'getCharacterResources',
  'getChatLog',
  'getCombatPlayByPlay',
  'getCombatState',
  'getCompendiumDocumentFull',
  'getConnectedPlayers',
  'getExportIndex',
  'getFriendlyNPCs',
  'getJournalContent',
  'getJournalPageContent',
  'getLevelUpOptions',
  'getLibraryDocuments',
  'getScenePages',
  'getLibraryIndex',
  'getModuleErrors',
  'getModuleManifest',
  'getModules',
  'getPagesForPlayers',
  'getPartyCharacters',
  'getPartyState',
  'getPlayRecords',
  'getPlayerVisibility',
  'getPreflightScan',
  'getPrepScan',
  'getRecentEvents',
  'getRenownState',
  'getSceneMoods',
  'getSceneState',
  'getSessionLog',
  'getSetupInfo',
  'getSpentActions',
  'getTargets',
  'getTokenPositions',
  'getUsageRecords',
  'getWorldInfo',
  'guardedApplyOutcome',
  'list-scenes',
  'listActors',
  'listCreaturesByCriteria',
  'listGuardedFeatures',
  'listJournals',
  'listRefChoices',
  'listWorldItems',
  'logGmChange',
  'measureDistance',
  'openDocumentForGm',
  'ping',
  'planCombatChange',
  'planLiveChange',
  'planNpcTurn',
  'planPaperSync',
  'planPartyPlacement',
  'planPcCreation',
  'planRoomSetup',
  'planSceneChange',
  'planSceneMood',
  'planTokenRings',
  'playerRead',
  'searchCharacterItems',
  'searchCompendium',
  'searchLinkCandidates',
  'searchRules',
  'sessionSwitches',
  'snapshotGuardedOps',
  'suggestBalancedEncounter',
];

describe('write gate: classification', () => {
  it('registers every handler with a kind, and the wire names did not change', () => {
    qh.registerHandlers();
    const registered = bridgeHandlers.methods();
    expect(registered.length).toBeGreaterThan(90);
    for (const m of registered) {
      expect(bridgeHandlers.kindOf(m), m).toMatch(/^(write|recordless-write|read)$/);
      expect(m.startsWith(`${MODULE_ID}.`), m).toBe(true);
    }
    expect(bridgeHandlers.methodsOfKind('write', 'recordless-write', 'read').sort()).toEqual(
      [...registered].sort()
    );
  });

  it('pins which handlers write and which write without a change-journal record', () => {
    qh.registerHandlers();
    expect(namesOfKind('recordless-write')).toEqual([...PINNED_RECORDLESS_WRITES].sort());
    expect(namesOfKind('write')).toEqual([...PINNED_WRITES].sort());
    expect(namesOfKind('read')).toEqual([...PINNED_READS].sort());
  });

  it('keeps the reads that must work with writes off, and the plans, as reads', () => {
    qh.registerHandlers();
    const reads = namesOfKind('read');
    for (const m of [
      'getWorldInfo',
      'ping',
      'listActors',
      'applyGuardedOps',
      'snapshotGuardedOps',
      'sessionSwitches',
      'planSceneChange',
      'planLiveChange',
      'planPcCreation',
      'getPlayerVisibility',
      'clearModuleErrors',
      'openDocumentForGm',
      'playerRead',
      'characterSheet',
    ]) {
      expect(reads, m).toContain(m);
    }
  });

  it('covers the handlers named in P-036', () => {
    qh.registerHandlers();
    expect(bridgeHandlers.kindOf(wire('addActorItems'))).toBe('write');
    expect(bridgeHandlers.kindOf(wire('playPlaylist'))).toBe('recordless-write');
    expect(bridgeHandlers.kindOf(wire('getWorldInfo'))).toBe('read');
  });

  it('has no direct token write handlers left (F5 L2: plan-token-change replaces them)', () => {
    qh.registerHandlers();
    const registered = bridgeHandlers.methods().map(m => m.slice(MODULE_ID.length + 1));
    for (const m of [
      'moveToken',
      'move-token',
      'updateToken',
      'update-token',
      'deleteTokens',
      'delete-tokens',
      'setTokenVisionLight',
    ]) {
      expect(registered, m).not.toContain(m);
    }
  });
});

describe('write gate: scene dressing plans', () => {
  it('has no direct scene-dressing handlers left (I-112: plan-scene-change replaces them)', () => {
    qh.registerHandlers();
    const registered = bridgeHandlers.methods().map(m => m.slice(MODULE_ID.length + 1));
    for (const m of [
      'placeMeasuredTemplate',
      'deleteMeasuredTemplate',
      'setSceneMood',
      'addMapNote',
      'deleteMapNote',
      'dropLoot',
    ]) {
      expect(registered, m).not.toContain(m);
    }
  });

  it('classifies the scene plan query as a read and the playlist as a write', () => {
    qh.registerHandlers();
    expect(bridgeHandlers.kindOf(wire('planSceneChange'))).toBe('read');
    expect(bridgeHandlers.kindOf(wire('playPlaylist'))).toBe('recordless-write');
  });
});

describe('write gate: behaviour', () => {
  it('refuses every write handler while "Allow Write Operations" is off, before any work', async () => {
    const calls = stubEverything();
    world.setSetting(MODULE_ID, 'allowWriteOperations', false);
    qh.registerHandlers();
    const writes = bridgeHandlers.methodsOfKind('write', 'recordless-write');
    expect(writes.length).toBe(PINNED_WRITES.length + PINNED_RECORDLESS_WRITES.length);
    for (const method of writes) {
      await expect(bridgeHandlers.get(method)!({}), method).rejects.toThrow(
        WRITES_DISABLED_MESSAGE
      );
    }
    expect(calls).not.toHaveBeenCalled();
  });

  it('lets writes through when the switch is on', async () => {
    const calls = stubEverything();
    world.enableWrites();
    qh.registerHandlers();
    await bridgeHandlers.get(wire('playPlaylist'))!({});
    expect(calls).toHaveBeenCalledWith('playPlaylist', expect.anything());
  });

  it('ends the change group before a write runs, so it is its own change', async () => {
    stubEverything();
    const order: string[] = [];
    const brk = vi.spyOn(changeJournal, 'breakGroup').mockImplementation(() => {
      order.push('break');
    });
    world.enableWrites();
    qh.registerHandlers();
    (qh as any).dataAccess.setInitiative = (): Promise<{ success: boolean }> => {
      order.push('write');
      return Promise.resolve({ success: true });
    };
    await bridgeHandlers.get(wire('setInitiative'))!({ combatantName: 'x', initiative: 1 });
    expect(order).toEqual(['break', 'write']);
    brk.mockClear();
    await bridgeHandlers.get(wire('ping'))!({});
    expect(brk).not.toHaveBeenCalled();
    world.setSetting(MODULE_ID, 'allowWriteOperations', false);
    await expect(
      bridgeHandlers.get(wire('setInitiative'))!({ combatantName: 'x' })
    ).rejects.toThrow();
    expect(brk).not.toHaveBeenCalled();
  });

  it('keeps the group for writes that record nothing', async () => {
    stubEverything();
    const brk = vi.spyOn(changeJournal, 'breakGroup').mockImplementation(() => {});
    world.enableWrites();
    qh.registerHandlers();
    await bridgeHandlers.get(wire('playPlaylist'))!({});
    await bridgeHandlers.get(wire('sendChatMessage'))!({ message: 'hi' });
    expect(brk).not.toHaveBeenCalled();
    expect(bridgeHandlers.kindOf(wire('playPlaylist'))).toBe('recordless-write');
    expect(bridgeHandlers.kindOf(wire('sendChatMessage'))).toBe('recordless-write');
  });

  it('never gates reads', async () => {
    const calls = stubEverything();
    world.setSetting(MODULE_ID, 'allowWriteOperations', false);
    qh.registerHandlers();
    await expect(bridgeHandlers.get(wire('ping'))!({})).resolves.toBeDefined();
    await bridgeHandlers.get(wire('listActors'))!({});
    expect(calls).toHaveBeenCalledWith('listActors');
  });
});

describe('direct write paths below the bridge', () => {
  it('refuses them when writes are off (data access, no bridge)', async () => {
    const da = new FoundryDataAccess();
    world.setSetting(MODULE_ID, 'allowWriteOperations', false);
    await expect(
      da.createActorFromCompendiumEntry({ packId: 'p', itemId: 'i', customNames: ['A'] })
    ).rejects.toThrow(WRITES_DISABLED_MESSAGE);
    await expect(
      da.addActorItems({ actorIdentifier: 'a', items: [{ name: 'x', type: 'loot' }] })
    ).rejects.toThrow(WRITES_DISABLED_MESSAGE);
    await expect(
      (
        da as unknown as { actorCreation: { addActorsToScene(p: unknown): Promise<unknown> } }
      ).actorCreation.addActorsToScene({ actorIds: ['a'], placement: 'grid', hidden: false })
    ).rejects.toThrow(WRITES_DISABLED_MESSAGE);
  });
});
