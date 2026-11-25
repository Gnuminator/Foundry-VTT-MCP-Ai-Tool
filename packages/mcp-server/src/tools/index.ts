/**
 * Every tool module (R9), as a static list: the server ships as an esbuild bundle, where a folder
 * scan or import-time registration would break or be tree-shaken away.
 *
 * The order of TOOL_MODULES is the order of the MCP tool list Claude Desktop receives
 * (`tools/list`), so it must not be re-sorted. A new tool family adds its import (alphabetical)
 * and goes at the end of the list; a new tool in an existing family goes into that module.
 */
import { actorCreationModule } from './modules/actor-creation.js';
import { actorImageModule } from './modules/actor-image.js';
import { handoutPressModule } from './modules/handout-press.js';
import { campaignManagementModule } from './modules/campaign-management.js';
import { changeHistoryModule } from './modules/change-history.js';
import { characterModule } from './modules/character.js';
import { chatLogModule } from './modules/chat-log.js';
import { combatChangeModule } from './modules/combat-change.js';
import { combatResolutionModule } from './modules/combat-resolution.js';
import { combatModule } from './modules/combat.js';
import { compendiumModule } from './modules/compendium.js';
import { campaignMergeModule } from './modules/campaign-merge.js';
import { diagnosticsModule } from './modules/diagnostics.js';
import { diceRollModule } from './modules/dice-roll.js';
import { dnd5eAddFeatureModule } from './modules/dnd5e-add-feature.js';
import { dnd5eFeaturesModule } from './modules/dnd5e-features.js';
import { dnd5eNpcModule } from './modules/dnd5e-npc.js';
import { effectsModule } from './modules/effects.js';
import { encounterModule } from './modules/encounter.js';
import { foundrySetupModule } from './modules/foundry-setup.js';
import { guardedChangesModule } from './modules/guarded-changes.js';
import { levelUpModule } from './modules/level-up.js';
import { livePlayModule } from './modules/live-play.js';
import { movementModule } from './modules/movement.js';
import { npcTurnModule } from './modules/npc-turn.js';
import { obsidianMirrorModule } from './modules/obsidian-mirror.js';
import { draftsModule } from './modules/drafts.js';
import { omensModule } from './modules/omens.js';
import { ownershipModule } from './modules/ownership.js';
import { characterDiariesModule } from './modules/character-diaries.js';
import { paperSyncModule } from './modules/paper-sync.js';
import { partyModule } from './modules/party.js';
import { pcCreationModule } from './modules/pc-creation.js';
import { playSessionModule } from './modules/play-session.js';
import { playStatsModule } from './modules/play-stats.js';
import { playerViewModule } from './modules/player-view.js';
import { playerModule } from './modules/player.js';
import { preflightModule } from './modules/preflight.js';
import { prepDigestModule } from './modules/prep-digest.js';
import { readAloudModule } from './modules/read-aloud.js';
import { questCreationModule } from './modules/quest-creation.js';
import { refChoicesModule } from './modules/ref-choices.js';
import { renownModule } from './modules/renown.js';
import { resourcesModule } from './modules/resources.js';
import { roomSetupModule } from './modules/room-setup.js';
import { rulesCheckModule } from './modules/rules-check.js';
import { sceneChangeModule } from './modules/scene-change.js';
import { sceneMoodModule } from './modules/scene-mood.js';
import { sceneRestoreModule } from './modules/scene-restore.js';
import { sceneModule } from './modules/scene.js';
import { sessionLogModule } from './modules/session-log.js';
import { skillGuideModule } from './modules/skill-guide.js';
import { tableViewerModule } from './modules/table-viewer.js';
import { macroForgeModule } from './modules/macro-forge.js';
import { tarokkaModule } from './modules/tarokka.js';
import { tokenManipulationModule } from './modules/token-manipulation.js';
import { tokenRingsModule } from './modules/token-rings.js';
import { waitForEventModule } from './modules/wait-for-event.js';
import {
  type AnyToolModule,
  type ToolInstances,
  type ToolServices,
  createToolInstances,
} from './tool-module.js';

/** Every tool module, in tools/list order. */
export const TOOL_MODULES: readonly AnyToolModule[] = [
  characterModule,
  compendiumModule,
  sceneModule,
  actorCreationModule,
  dnd5eAddFeatureModule,
  dnd5eNpcModule,
  dnd5eFeaturesModule,
  questCreationModule,
  diceRollModule,
  campaignManagementModule,
  ownershipModule,
  sceneRestoreModule,
  npcTurnModule,
  paperSyncModule,
  characterDiariesModule,
  roomSetupModule,
  pcCreationModule,
  tokenRingsModule,
  actorImageModule,
  handoutPressModule,
  sceneMoodModule,
  rulesCheckModule,
  tableViewerModule,
  macroForgeModule,
  foundrySetupModule,
  tokenManipulationModule,
  chatLogModule,
  resourcesModule,
  levelUpModule,
  effectsModule,
  combatModule,
  movementModule,
  sessionLogModule,
  waitForEventModule,
  combatResolutionModule,
  encounterModule,
  diagnosticsModule,
  guardedChangesModule,
  changeHistoryModule,
  tarokkaModule,
  playSessionModule,
  omensModule,
  draftsModule,
  playStatsModule,
  obsidianMirrorModule,
  campaignMergeModule,
  playerViewModule,
  preflightModule,
  prepDigestModule,
  readAloudModule,
  partyModule,
  livePlayModule,
  sceneChangeModule,
  combatChangeModule,
  refChoicesModule,
  skillGuideModule,
  playerModule,
  renownModule,
];

/** One instance of every tool module, built from the services. */
export function createTools(services: ToolServices): ToolInstances {
  return createToolInstances(services, TOOL_MODULES);
}

export { guardedChangesModule, playerModule };
