/**
 * One write gate for every bridge handler that changes the world (P-036).
 *
 * "Allow Write Operations" used to be checked by a few handlers only (actor
 * creation, some scene edits, guarded writes); ownership, token vision and
 * light, item and feature additions, damage, conditions, combat, chat and more
 * wrote regardless. Now each registered method is classified here, and
 * `gateWriteHandlers` wraps every write method once at registration, so a
 * write is refused while the switch is off, whoever asks (Claude or the
 * dashboard). A test fails when a registered method is in neither list.
 *
 * Chat and roll messages count as writes: they create chat messages players
 * see. Guarded writes (`applyGuardedOps`) keep their own gate, which also
 * checks the feature switches.
 */
import type { BridgeHandlerTable } from './bridge-handlers.js';
import { writeOperationsAllowed } from './guarded-features.js';

/** The refusal every gated write gets (the same text as guarded writes). */
export const WRITES_DISABLED_MESSAGE = 'Write operations are disabled in the module settings';

/** Methods that change the world: refused while "Allow Write Operations" is off. */
export const WRITE_METHODS: readonly string[] = [
  // actors, items and features
  'addActorItems',
  'addAttackToActor',
  'addAttackWithSaveToActor',
  'addAuraToActor',
  'addFeaturesFromCompendium',
  'addPassiveFeatureToActor',
  'addSaveFeatureToActor',
  'addSpellsToActor',
  'createActorFromCompendium',
  'createNpcActor',
  'createWorldItems',
  'dropLoot',
  'setActorOwnership',
  'setActorSpellcasting',
  'updateCharacterResource',
  'updateWorldItems',
  'useItem',
  // damage, conditions, rests
  'applyDamageAndHealing',
  'clearStaleConditions',
  'manageRest',
  'toggleTokenCondition',
  'toggle-token-condition',
  // tokens and scenes
  'addActorsToScene',
  'addMapNote',
  'deleteMapNote',
  'deleteMeasuredTemplate',
  'deleteTokens',
  'delete-tokens',
  'moveToken',
  'move-token',
  'placeMeasuredTemplate',
  'setSceneMood',
  'setTokenVisionLight',
  'switch-scene',
  'updateToken',
  'update-token',
  // combat
  'advanceCombatTurn',
  'rollInitiativeForNpcs',
  'setInitiative',
  // journals
  'createJournalEntry',
  'updateCampaignProgress',
  'updateJournalContent',
  // chat and rolls (new chat messages)
  'request-player-rolls',
  'requestAbilityCheck',
  'requestAttackRoll',
  'rollNpcCheck',
  'rollSavingThrows',
  'sendChatMessage',
  'useNpcActivity',
];

/**
 * Methods that do not change the world: reads, the guarded-write plumbing
 * (`applyGuardedOps` has its own gate), the GM feed line after an allowed
 * change, opening a sheet on the GM's screen and clearing the local error list.
 */
export const NON_WRITE_METHODS: readonly string[] = [
  'applyGuardedOps',
  'clearModuleErrors',
  'findActor',
  'findPlayers',
  'get-available-conditions',
  'get-token-details',
  'getActiveEffects',
  'getActiveScene',
  'getActorOwnership',
  'getAvailableConditions',
  'getAvailablePacks',
  'getCharacterInfo',
  'getCharacterResources',
  'getChatLog',
  'getCombatPlayByPlay',
  'getCombatState',
  'getCompendiumDocumentFull',
  'getConnectedPlayers',
  'getEnhancedCreatureIndex',
  'getExportIndex',
  'getFriendlyNPCs',
  'getJournalContent',
  'getJournalPageContent',
  'getModuleErrors',
  'getModuleManifest',
  'getModules',
  'getPagesForPlayers',
  'getPartyCharacters',
  'getPlayRecords',
  'getPlayerVisibility',
  'getRecentEvents',
  'getSessionLog',
  'getTargets',
  'getTarokkaReading',
  'getTokenDetails',
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
  'searchCharacterItems',
  'searchCompendium',
  'searchLinkCandidates',
  'snapshotGuardedOps',
  'suggestBalancedEncounter',
  'validateWritePermissions',
];

/** Throw the standard refusal while "Allow Write Operations" is off. */
export function requireWriteOperations(): void {
  if (!writeOperationsAllowed()) throw new Error(WRITES_DISABLED_MESSAGE);
}

/**
 * Wrap every registered write method in `table` (wire names `<prefix>.<method>`)
 * with the write gate. Call once, after all handlers are registered.
 */
export function gateWriteHandlers(table: BridgeHandlerTable, prefix: string): void {
  for (const method of WRITE_METHODS) {
    const wire = `${prefix}.${method}`;
    const handler = table.get(wire);
    if (!handler) continue;
    table.set(wire, async (data: unknown) => {
      requireWriteOperations();
      return await handler(data);
    });
  }
}
