/**
 * Test helper: the whole tool router built from the real tool classes with
 * stub dependencies. Tool definitions never touch their dependencies, so this
 * is enough to call `collectToolDefinitions()` / `buildToolRouter()` in a unit
 * test (tool-catalog.test.ts, prompts/prompts.test.ts).
 */
import { vi } from 'vitest';

import type { ToolRouterDeps } from '../tool-router.js';
import { ActorCreationTools } from '../tools/actor-creation.js';
import { CampaignManagementTools } from '../tools/campaign-management.js';
import { CharacterTools } from '../tools/character.js';
import { ChatLogTools } from '../tools/chat-log.js';
import { CombatResolutionTools } from '../tools/combat-resolution.js';
import { CombatTools } from '../tools/combat.js';
import { CompendiumTools } from '../tools/compendium.js';
import { DiagnosticsTools } from '../tools/diagnostics.js';
import { DiceRollTools } from '../tools/dice-roll.js';
import { DnD5eAddFeatureTool } from '../tools/dnd5e/add-feature.js';
import { DnD5eFeaturesFromCompendiumTools } from '../tools/dnd5e/features.js';
import { DnD5eNpcTools } from '../tools/dnd5e/npc.js';
import { EffectsTools } from '../tools/effects.js';
import { EncounterTools } from '../tools/encounter.js';
import { GuardedChangeTools } from '../tools/guarded-changes.js';
import { LootTools } from '../tools/loot.js';
import { MovementTools } from '../tools/movement.js';
import { ObsidianMirrorTools } from '../tools/obsidian-mirror.js';
import { OwnershipTools } from '../tools/ownership.js';
import { PlaySessionTools } from '../tools/play-session.js';
import { PlayStatsTools } from '../tools/play-stats.js';
import { PlayerViewTools } from '../tools/player-view.js';
import { PreflightTools } from '../tools/preflight.js';
import { PartyTools } from '../tools/party.js';
import { PrepDigestTools } from '../tools/prep-digest.js';
import { QuestCreationTools } from '../tools/quest-creation.js';
import { RefChoiceTools } from '../tools/ref-choices.js';
import { ResourceTools } from '../tools/resources.js';
import { SceneControlTools } from '../tools/scene-control.js';
import { SceneTools } from '../tools/scene.js';
import { SessionLogTools } from '../tools/session-log.js';
import { TarokkaTools } from '../tools/tarokka.js';
import { TokenManipulationTools } from '../tools/token-manipulation.js';

export function stubToolRouterDeps(): ToolRouterDeps {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const foundryClient: any = { query: vi.fn() };
  const base: any = { foundryClient, logger };

  return {
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
    movementTools: new MovementTools(base),
    obsidianMirrorTools: new ObsidianMirrorTools({
      store: {} as any,
      worldIds: {} as any,
      guardedWrites: {} as any,
      status: () => null,
      logger,
    }),
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
    preflightTools: new PreflightTools({
      foundryClient,
      secretTerms: {} as any,
      worldIds: {} as any,
      playSession: {} as any,
      obsidianVaultDirSet: false,
      logger,
    }),
    prepDigestTools: new PrepDigestTools({
      foundryClient,
      worldIds: {} as any,
      store: {} as any,
      handouts: {} as any,
      preflight: {} as any,
      guardedWrites: {} as any,
      tarokka: {} as any,
      logger,
    }),
    partyTools: new PartyTools({ foundryClient, guardedWrites: {} as any, logger }),
    questCreationTools: new QuestCreationTools(base),
    refChoiceTools: new RefChoiceTools({ ...base, guardedWrites: {} }),
    resourceTools: new ResourceTools(base),
    sceneControlTools: new SceneControlTools(base),
    sceneTools: new SceneTools(base),
    sessionLogTools: new SessionLogTools(base),
    tarokkaTools: new TarokkaTools({ tarokka: {} as any, logger }),
    tokenManipulationTools: new TokenManipulationTools(base),
  };
}
