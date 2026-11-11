import { LevelUpTools } from '../level-up.js';
import { defineToolModule } from '../tool-module.js';

export const levelUpModule = defineToolModule({
  id: 'level-up',
  create: ({ services }) =>
    new LevelUpTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-level-up-options': (tools, args) => tools.handleGetLevelUpOptions(args),
  },
});
