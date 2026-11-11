import { LivePlayTools } from '../live-play.js';
import { defineToolModule } from '../tool-module.js';
import { rulesCheckModule } from './rules-check.js';

export const livePlayModule = defineToolModule({
  id: 'live-play',
  create: ({ services, use }) =>
    new LivePlayTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
      rulesCheck: use(rulesCheckModule),
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-actor-change': (tools, args) => tools.handlePlanActorChange(args),
    'plan-token-change': (tools, args) => tools.handlePlanTokenChange(args),
  },
});
