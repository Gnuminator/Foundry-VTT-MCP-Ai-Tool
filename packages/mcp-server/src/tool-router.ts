/**
 * Tool dispatch table for the control-channel `call_tool` requests.
 *
 * Extracted from backend.ts's ~70-case switch into a declarative name → handler
 * map so the routing is (a) data, not control flow, and (b) unit-testable —
 * backend.ts runs a process lock + server bootstrap at import time and can't be
 * loaded in a test, but this builder is pure. Each entry forwards the call_tool
 * `args` to the owning tool method, exactly as the original switch did.
 */
import type { ActorCreationTools } from './tools/actor-creation.js';
import type { CampaignManagementTools } from './tools/campaign-management.js';
import type { CharacterTools } from './tools/character.js';
import type { ChatLogTools } from './tools/chat-log.js';
import type { CombatResolutionTools } from './tools/combat-resolution.js';
import type { CombatTools } from './tools/combat.js';
import type { CompendiumTools } from './tools/compendium.js';
import type { DiagnosticsTools } from './tools/diagnostics.js';
import type { DiceRollTools } from './tools/dice-roll.js';
import type { DnD5eAddFeatureTool } from './tools/dnd5e/add-feature.js';
import type { DnD5eFeaturesFromCompendiumTools } from './tools/dnd5e/features.js';
import type { DnD5eNpcTools } from './tools/dnd5e/npc.js';
import type { EffectsTools } from './tools/effects.js';
import type { EncounterTools } from './tools/encounter.js';
import type { GuardedChangeTools } from './tools/guarded-changes.js';
import type { LootTools } from './tools/loot.js';
import type { MovementTools } from './tools/movement.js';
import type { ObsidianMirrorTools } from './tools/obsidian-mirror.js';
import type { OwnershipTools } from './tools/ownership.js';
import type { PlaySessionTools } from './tools/play-session.js';
import type { PlayStatsTools } from './tools/play-stats.js';
import type { PlayerViewTools } from './tools/player-view.js';
import type { PreflightTools } from './tools/preflight.js';
import type { PrepDigestTools } from './tools/prep-digest.js';
import type { QuestCreationTools } from './tools/quest-creation.js';
import type { RefChoiceTools } from './tools/ref-choices.js';
import type { ResourceTools } from './tools/resources.js';
import type { SceneControlTools } from './tools/scene-control.js';
import type { SceneTools } from './tools/scene.js';
import type { SessionLogTools } from './tools/session-log.js';
import type { TarokkaTools } from './tools/tarokka.js';
import type { TokenManipulationTools } from './tools/token-manipulation.js';

/** The tool instances backend.ts constructs and the router dispatches to. */
export interface ToolRouterDeps {
  actorCreationTools: ActorCreationTools;
  campaignManagementTools: CampaignManagementTools;
  characterTools: CharacterTools;
  chatLogTools: ChatLogTools;
  combatResolutionTools: CombatResolutionTools;
  combatTools: CombatTools;
  compendiumTools: CompendiumTools;
  diagnosticsTools: DiagnosticsTools;
  diceRollTools: DiceRollTools;
  dnd5eAddFeatureTool: DnD5eAddFeatureTool;
  dnd5eFeaturesFromCompendiumTools: DnD5eFeaturesFromCompendiumTools;
  dnd5eNpcTools: DnD5eNpcTools;
  effectsTools: EffectsTools;
  encounterTools: EncounterTools;
  guardedChangeTools: GuardedChangeTools;
  lootTools: LootTools;
  movementTools: MovementTools;
  obsidianMirrorTools: ObsidianMirrorTools;
  ownershipTools: OwnershipTools;
  playSessionTools: PlaySessionTools;
  playStatsTools: PlayStatsTools;
  playerViewTools: PlayerViewTools;
  preflightTools: PreflightTools;
  prepDigestTools: PrepDigestTools;
  questCreationTools: QuestCreationTools;
  refChoiceTools: RefChoiceTools;
  resourceTools: ResourceTools;
  sceneControlTools: SceneControlTools;
  sceneTools: SceneTools;
  sessionLogTools: SessionLogTools;
  tarokkaTools: TarokkaTools;
  tokenManipulationTools: TokenManipulationTools;
}

export type ToolHandler = (args: any) => Promise<any>;

/**
 * Build the `call_tool` name → handler map. Unknown names are absent from the
 * map; the caller throws `Unknown tool: <name>` exactly as the switch's default
 * did.
 *
 * The map has a null prototype so a `name` like 'toString' / 'constructor' can't
 * resolve to an inherited Object.prototype method and slip past that guard (the
 * old switch sent every unlisted name to `default`).
 */
export function buildToolRouter(deps: ToolRouterDeps): Record<string, ToolHandler> {
  const routes: Record<string, ToolHandler> = {
    'create-actor-from-compendium': args =>
      deps.actorCreationTools.handleCreateActorFromCompendium(args),
    'get-compendium-entry-full': args => deps.actorCreationTools.handleGetCompendiumEntryFull(args),
    'create-campaign-dashboard': args =>
      deps.campaignManagementTools.handleCreateCampaignDashboard(args),
    'get-character': args => deps.characterTools.handleGetCharacter(args),
    'list-characters': args => deps.characterTools.handleListCharacters(args),
    'get-character-entity': args => deps.characterTools.handleGetCharacterEntity(args),
    'use-item': args => deps.characterTools.handleUseItem(args),
    'search-character-items': args => deps.characterTools.handleSearchCharacterItems(args),
    'manage-world-items': args => deps.characterTools.handleManageWorldItems(args),
    'get-chat-log': args => deps.chatLogTools.handleGetChatLog(args),
    'get-combat-play-by-play': args => deps.chatLogTools.handleGetCombatPlayByPlay(args),
    'send-chat-message': args => deps.chatLogTools.handleSendChatMessage(args),
    'apply-damage-and-healing': args =>
      deps.combatResolutionTools.handleApplyDamageAndHealing(args),
    'roll-saving-throws': args => deps.combatResolutionTools.handleRollSavingThrows(args),
    'use-npc-activity': args => deps.combatResolutionTools.handleUseNpcActivity(args),
    'manage-rest': args => deps.combatResolutionTools.handleManageRest(args),
    'get-combat-state': args => deps.combatTools.handleGetCombatState(args),
    'advance-combat-turn': args => deps.combatTools.handleAdvanceCombatTurn(args),
    'set-initiative': args => deps.combatTools.handleSetInitiative(args),
    'roll-initiative-for-npcs': args => deps.combatTools.handleRollInitiativeForNpcs(args),
    'search-compendium': args => deps.compendiumTools.handleSearchCompendium(args),
    'get-compendium-item': args => deps.compendiumTools.handleGetCompendiumItem(args),
    'list-creatures-by-criteria': args => deps.compendiumTools.handleListCreaturesByCriteria(args),
    'list-compendium-packs': args => deps.compendiumTools.handleListCompendiumPacks(args),
    'get-modules': args => deps.diagnosticsTools.handleGetModules(args),
    'get-module-errors': args => deps.diagnosticsTools.handleGetModuleErrors(args),
    'clear-module-errors': args => deps.diagnosticsTools.handleClearModuleErrors(args),
    'get-module-manifest': args => deps.diagnosticsTools.handleGetModuleManifest(args),
    'request-player-rolls': args => deps.diceRollTools.handleRequestPlayerRolls(args),
    'request-ability-check': args => deps.diceRollTools.handleRequestAbilityCheck(args),
    'request-attack-roll': args => deps.diceRollTools.handleRequestAttackRoll(args),
    'roll-npc-check': args => deps.diceRollTools.handleRollNpcCheck(args),
    'dnd5e-add-feature': args => deps.dnd5eAddFeatureTool.handleAddFeature(args),
    'dnd5e-add-features-from-compendium': args =>
      deps.dnd5eFeaturesFromCompendiumTools.handleAddFeaturesFromCompendium(args),
    'dnd5e-create-npc': args => deps.dnd5eNpcTools.handleCreateNpc(args),
    'get-active-effects': args => deps.effectsTools.handleGetActiveEffects(args),
    'clear-stale-conditions': args => deps.effectsTools.handleClearStaleConditions(args),
    'suggest-balanced-encounter': args => deps.encounterTools.handleSuggestBalancedEncounter(args),
    'place-measured-template': args => deps.encounterTools.handlePlaceMeasuredTemplate(args),
    'delete-measured-template': args => deps.encounterTools.handleDeleteMeasuredTemplate(args),
    'get-planned-change': args => deps.guardedChangeTools.handleGetPlannedChange(args),
    'apply-planned-change': args => deps.guardedChangeTools.handleApplyPlannedChange(args),
    'list-recent-changes': args => deps.guardedChangeTools.handleListRecentChanges(args),
    'undo-change': args => deps.guardedChangeTools.handleUndoChange(args),
    'open-in-foundry': args => deps.guardedChangeTools.handleOpenInFoundry(args),
    'drop-loot': args => deps.lootTools.handleDropLoot(args),
    'list-scenes': args => deps.sceneTools.listScenes(args),
    'switch-scene': args => deps.sceneTools.switchScene(args),
    'get-token-positions': args => deps.movementTools.handleGetTokenPositions(args),
    'measure-distance': args => deps.movementTools.handleMeasureDistance(args),
    'get-targets': args => deps.movementTools.handleGetTargets(args),
    'assign-actor-ownership': args =>
      deps.ownershipTools.handleToolCall('assign-actor-ownership', args),
    'remove-actor-ownership': args =>
      deps.ownershipTools.handleToolCall('remove-actor-ownership', args),
    'list-actor-ownership': args =>
      deps.ownershipTools.handleToolCall('list-actor-ownership', args),
    'mark-play-session': args => deps.playSessionTools.handleMarkPlaySession(args),
    'get-play-session': args => deps.playSessionTools.handleGetPlaySession(args),
    'get-play-stats': args => deps.playStatsTools.handleGetPlayStats(args),
    'get-obsidian-mirror': args => deps.obsidianMirrorTools.handleGetObsidianMirror(args),
    'plan-obsidian-mirror': args => deps.obsidianMirrorTools.handlePlanObsidianMirror(args),
    'create-quest-journal': args => deps.questCreationTools.handleCreateQuestJournal(args),
    'link-quest-to-npc': args => deps.questCreationTools.handleLinkQuestToNPC(args),
    'update-quest-journal': args => deps.questCreationTools.handleUpdateQuestJournal(args),
    'list-journals': args => deps.questCreationTools.handleListJournals(args),
    'search-journals': args => deps.questCreationTools.handleSearchJournals(args),
    'get-character-resources': args => deps.resourceTools.handleGetCharacterResources(args),
    'update-character-resource': args => deps.resourceTools.handleUpdateCharacterResource(args),
    'set-scene-mood': args => deps.sceneControlTools.handleSetSceneMood(args),
    'add-map-note': args => deps.sceneControlTools.handleAddMapNote(args),
    'set-token-vision-light': args => deps.sceneControlTools.handleSetTokenVisionLight(args),
    'delete-map-note': args => deps.sceneControlTools.handleDeleteMapNote(args),
    'get-current-scene': args => deps.sceneTools.handleGetCurrentScene(args),
    'get-world-info': args => deps.sceneTools.handleGetWorldInfo(args),
    'get-session-log': args => deps.sessionLogTools.handleGetSessionLog(args),
    'get-recent-events': args => deps.sessionLogTools.handleGetRecentEvents(args),
    'get-tarokka-reading': args => deps.tarokkaTools.handleGetTarokkaReading(args),
    'plan-tarokka-import': args => deps.tarokkaTools.handlePlanTarokkaImport(args),
    'suggest-tarokka-links': args => deps.tarokkaTools.handleSuggestTarokkaLinks(args),
    'plan-tarokka-links': args => deps.tarokkaTools.handlePlanTarokkaLinks(args),
    'plan-tarokka-reveal': args => deps.tarokkaTools.handlePlanTarokkaReveal(args),
    'get-player-visibility': args => deps.playerViewTools.handleGetPlayerVisibility(args),
    'list-revealed-pages': args => deps.playerViewTools.handleListRevealedPages(args),
    'get-player-handouts': args => deps.playerViewTools.handleGetPlayerHandouts(args),
    'plan-page-reveal': args => deps.playerViewTools.handlePlanPageReveal(args),
    'check-secret-terms': args => deps.playerViewTools.handleCheckSecretTerms(args),
    'get-preflight': args => deps.preflightTools.handleGetPreflight(args),
    'get-prep-digest': args => deps.prepDigestTools.handleGetPrepDigest(args),
    'list-ref-choices': args => deps.refChoiceTools.handleListRefChoices(args),
    'move-token': args => deps.tokenManipulationTools.handleMoveToken(args),
    'update-token': args => deps.tokenManipulationTools.handleUpdateToken(args),
    'delete-tokens': args => deps.tokenManipulationTools.handleDeleteTokens(args),
    'get-token-details': args => deps.tokenManipulationTools.handleGetTokenDetails(args),
    'toggle-token-condition': args => deps.tokenManipulationTools.handleToggleTokenCondition(args),
    'get-available-conditions': args =>
      deps.tokenManipulationTools.handleGetAvailableConditions(args),
  };

  return Object.assign(Object.create(null), routes);
}

/** A tool as the backend lists it (MCP `tools/list` shape). */
export interface ToolDefinitionLike {
  name: string;
  description?: string | undefined;
  inputSchema: unknown;
}

/**
 * Every tool definition, in the order the backend lists them. Pure, like the
 * router, so the tool catalog test can check all tools (picker annotations,
 * one route per tool).
 */
export function collectToolDefinitions(deps: ToolRouterDeps): ToolDefinitionLike[] {
  return [
    ...deps.characterTools.getToolDefinitions(),
    ...deps.compendiumTools.getToolDefinitions(),
    ...deps.sceneTools.getToolDefinitions(),
    ...deps.actorCreationTools.getToolDefinitions(),
    ...deps.dnd5eAddFeatureTool.getToolDefinitions(),
    ...deps.dnd5eNpcTools.getToolDefinitions(),
    ...deps.dnd5eFeaturesFromCompendiumTools.getToolDefinitions(),
    ...deps.questCreationTools.getToolDefinitions(),
    ...deps.diceRollTools.getToolDefinitions(),
    ...deps.campaignManagementTools.getToolDefinitions(),
    ...deps.ownershipTools.getToolDefinitions(),
    ...deps.tokenManipulationTools.getToolDefinitions(),
    ...deps.chatLogTools.getToolDefinitions(),
    ...deps.resourceTools.getToolDefinitions(),
    ...deps.effectsTools.getToolDefinitions(),
    ...deps.combatTools.getToolDefinitions(),
    ...deps.movementTools.getToolDefinitions(),
    ...deps.sessionLogTools.getToolDefinitions(),
    ...deps.combatResolutionTools.getToolDefinitions(),
    ...deps.encounterTools.getToolDefinitions(),
    ...deps.sceneControlTools.getToolDefinitions(),
    ...deps.lootTools.getToolDefinitions(),
    ...deps.diagnosticsTools.getToolDefinitions(),
    ...deps.guardedChangeTools.getToolDefinitions(),
    ...deps.tarokkaTools.getToolDefinitions(),
    ...deps.playSessionTools.getToolDefinitions(),
    ...deps.playStatsTools.getToolDefinitions(),
    ...deps.obsidianMirrorTools.getToolDefinitions(),
    ...deps.playerViewTools.getToolDefinitions(),
    ...deps.preflightTools.getToolDefinitions(),
    ...deps.prepDigestTools.getToolDefinitions(),
    ...deps.refChoiceTools.getToolDefinitions(),
  ];
}
