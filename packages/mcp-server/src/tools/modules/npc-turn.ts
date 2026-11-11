import { NpcTurnTools } from '../npc-turn.js';
import { defineToolModule } from '../tool-module.js';

export const npcTurnModule = defineToolModule({
  id: 'npc-turn',
  create: ({ services }) =>
    new NpcTurnTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-npc-turn': (tools, args) => tools.handleToolCall('plan-npc-turn', args),
  },
});
