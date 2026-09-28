/**
 * The whole tool catalog, built from the real tool classes (with stub
 * dependencies: definitions do not touch them).
 *
 * - Every tool has exactly one control-channel route and every route a tool.
 * - Every parameter that names something carries a picker annotation
 *   (`toolRef(...)` or `freeText(reason)`, see shared/src/tool-refs.ts), so the
 *   dashboard's tool runner can offer a list instead of a blank field. A new
 *   tool with an unannotated `...Id` / `...Name` / `targets` parameter fails
 *   here.
 */
import { TOOL_REF_KEY, checkToolRefs, stripToolRefs } from '@gnuminator/shared';
import { describe, expect, it, vi } from 'vitest';

import { buildToolRouter, collectToolDefinitions, type ToolRouterDeps } from './tool-router.js';
import { ActorCreationTools } from './tools/actor-creation.js';
import { CampaignManagementTools } from './tools/campaign-management.js';
import { CharacterTools } from './tools/character.js';
import { ChatLogTools } from './tools/chat-log.js';
import { CombatResolutionTools } from './tools/combat-resolution.js';
import { CombatTools } from './tools/combat.js';
import { CompendiumTools } from './tools/compendium.js';
import { DiagnosticsTools } from './tools/diagnostics.js';
import { DiceRollTools } from './tools/dice-roll.js';
import { DnD5eAddFeatureTool } from './tools/dnd5e/add-feature.js';
import { DnD5eFeaturesFromCompendiumTools } from './tools/dnd5e/features.js';
import { DnD5eNpcTools } from './tools/dnd5e/npc.js';
import { EffectsTools } from './tools/effects.js';
import { EncounterTools } from './tools/encounter.js';
import { GuardedChangeTools } from './tools/guarded-changes.js';
import { LootTools } from './tools/loot.js';
import { MapGenerationTools } from './tools/map-generation.js';
import { MovementTools } from './tools/movement.js';
import { OwnershipTools } from './tools/ownership.js';
import { PlaySessionTools } from './tools/play-session.js';
import { PlayStatsTools } from './tools/play-stats.js';
import { PlayerViewTools } from './tools/player-view.js';
import { QuestCreationTools } from './tools/quest-creation.js';
import { RefChoiceTools } from './tools/ref-choices.js';
import { ResourceTools } from './tools/resources.js';
import { SceneControlTools } from './tools/scene-control.js';
import { SceneTools } from './tools/scene.js';
import { SessionLogTools } from './tools/session-log.js';
import { TarokkaTools } from './tools/tarokka.js';
import { TokenManipulationTools } from './tools/token-manipulation.js';

const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
logger.child = (): unknown => logger;
const foundryClient: any = { query: vi.fn() };
const base: any = { foundryClient, logger };

const deps: ToolRouterDeps = {
  actorCreationTools: new ActorCreationTools(base),
  campaignManagementTools: new CampaignManagementTools(foundryClient, logger),
  characterTools: new CharacterTools(base),
  chatLogTools: new ChatLogTools(base),
  combatResolutionTools: new CombatResolutionTools(base),
  combatTools: new CombatTools(base),
  compendiumTools: new CompendiumTools(base),
  diagnosticsTools: new DiagnosticsTools(base),
  diceRollTools: new DiceRollTools(base),
  dnd5eAddFeatureTool: new DnD5eAddFeatureTool(base),
  dnd5eFeaturesFromCompendiumTools: new DnD5eFeaturesFromCompendiumTools(base),
  dnd5eNpcTools: new DnD5eNpcTools(base),
  effectsTools: new EffectsTools(base),
  encounterTools: new EncounterTools(base),
  guardedChangeTools: new GuardedChangeTools({ ...base, guardedWrites: {} }),
  lootTools: new LootTools(base),
  mapGenerationTools: new MapGenerationTools({ ...base, backendComfyUIHandlers: {} }),
  movementTools: new MovementTools(base),
  ownershipTools: new OwnershipTools(base),
  playSessionTools: new PlaySessionTools({ worldIds: {} as any, store: {} as any, logger }),
  playStatsTools: new PlayStatsTools({ worldIds: {} as any, store: {} as any, logger }),
  playerViewTools: new PlayerViewTools({
    handouts: {} as any,
    secretTerms: {} as any,
    foundryClient,
    worldIds: {} as any,
    logger,
  }),
  questCreationTools: new QuestCreationTools(base),
  refChoiceTools: new RefChoiceTools({ ...base, guardedWrites: {} }),
  resourceTools: new ResourceTools(base),
  sceneControlTools: new SceneControlTools(base),
  sceneTools: new SceneTools(base),
  sessionLogTools: new SessionLogTools(base),
  tarokkaTools: new TarokkaTools({ tarokka: {} as any, logger }),
  tokenManipulationTools: new TokenManipulationTools(base),
};

const tools = collectToolDefinitions(deps);

describe('tool catalog', () => {
  it('has unique names, one route per tool and a tool per route', () => {
    const names = tools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(buildToolRouter(deps)).sort()).toEqual([...names].sort());
  });

  it('annotates every parameter that names something (picker or free text)', () => {
    expect(tools.flatMap(t => checkToolRefs(t))).toEqual([]);
  });

  it('gives MCP clients the schemas without the annotations', () => {
    expect(JSON.stringify(tools)).toContain(TOOL_REF_KEY);
    expect(JSON.stringify(stripToolRefs(tools))).not.toContain(TOOL_REF_KEY);
  });
});
