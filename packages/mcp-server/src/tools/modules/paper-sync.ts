import { PaperSyncTools } from '../paper-sync.js';
import { defineToolModule } from '../tool-module.js';

export const paperSyncModule = defineToolModule({
  id: 'paper-sync',
  create: ({ services }) =>
    new PaperSyncTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-paper-sync': (tools, args) => tools.handleToolCall('plan-paper-sync', args),
  },
});
