import { DnD5eNpcTools } from '../dnd5e/npc.js';
import { defineToolModule } from '../tool-module.js';

export const dnd5eNpcModule = defineToolModule({
  id: 'dnd5e-npc',
  create: ({ services }) =>
    new DnD5eNpcTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'dnd5e-create-npc': (tools, args) => tools.handleCreateNpc(args),
  },
});
