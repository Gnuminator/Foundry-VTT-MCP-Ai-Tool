import { PcCreationTools } from '../pc-creation.js';
import { defineToolModule } from '../tool-module.js';

export const pcCreationModule = defineToolModule({
  id: 'pc-creation',
  create: ({ services }) =>
    new PcCreationTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-pc-creation': (tools, args) => tools.handleToolCall('plan-pc-creation', args),
  },
});
