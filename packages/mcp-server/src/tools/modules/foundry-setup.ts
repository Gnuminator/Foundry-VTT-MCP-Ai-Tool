import { FoundrySetupTools } from '../foundry-setup.js';
import { defineToolModule } from '../tool-module.js';

export const foundrySetupModule = defineToolModule({
  id: 'foundry-setup',
  create: ({ services }) =>
    new FoundrySetupTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-foundry-setup': (tools, args) => tools.handleToolCall('plan-foundry-setup', args),
  },
  tools: {
    'plan-foundry-setup': { set: 'admin', title: 'Read or plan Foundry setup', kind: 'read' },
  },
});
