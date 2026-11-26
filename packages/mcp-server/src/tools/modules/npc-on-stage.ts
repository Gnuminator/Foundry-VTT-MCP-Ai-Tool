import { NpcOnStageTools } from '../npc-on-stage.js';
import { defineToolModule } from '../tool-module.js';

export const npcOnStageModule = defineToolModule({
  id: 'npc-on-stage',
  create: ({ services }) =>
    new NpcOnStageTools({
      foundryClient: services.foundryClient,
      worldIds: services.worldIds,
      store: services.store,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'set-npc-on-stage': (tools, args) => tools.handleSetNpcOnStage(args),
  },
  tools: {
    'set-npc-on-stage': { set: 'play', title: 'Put an NPC on stage on the TV', kind: 'write' },
  },
});
