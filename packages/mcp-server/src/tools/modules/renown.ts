import { RenownTools } from '../renown.js';
import { defineToolModule } from '../tool-module.js';

export const renownModule = defineToolModule({
  id: 'renown',
  create: ({ services }) =>
    new RenownTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-renown': (tools, args) => tools.handleGetRenown(args),
    'plan-renown-change': (tools, args) => tools.handlePlanRenownChange(args),
  },
  tools: {
    'get-renown': { set: 'play', title: 'Get renown', kind: 'read' },
    'plan-renown-change': { set: 'play', title: 'Plan renown change', kind: 'read' },
  },
});
