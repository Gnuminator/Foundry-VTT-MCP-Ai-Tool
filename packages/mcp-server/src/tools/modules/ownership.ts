import { OwnershipTools } from '../ownership.js';
import { defineToolModule } from '../tool-module.js';

export const ownershipModule = defineToolModule({
  id: 'ownership',
  create: ({ services }) =>
    new OwnershipTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-ownership-change': (tools, args) => tools.handleToolCall('plan-ownership-change', args),
    'list-actor-ownership': (tools, args) => tools.handleToolCall('list-actor-ownership', args),
  },
  tools: {
    'plan-ownership-change': { set: 'admin', title: 'Plan ownership change', kind: 'read' },
    'list-actor-ownership': { set: 'admin', title: 'List actor ownership', kind: 'read' },
  },
});
