import { PlayerViewTools } from '../player-view.js';
import { defineToolModule } from '../tool-module.js';

export const playerViewModule = defineToolModule({
  id: 'player-view',
  create: ({ services }) =>
    new PlayerViewTools({
      handouts: services.handouts,
      secretTerms: services.secretTerms,
      foundryClient: services.foundryClient,
      worldIds: services.worldIds,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-player-visibility': (tools, args) => tools.handleGetPlayerVisibility(args),
    'list-revealed-pages': (tools, args) => tools.handleListRevealedPages(args),
    'get-player-handouts': (tools, args) => tools.handleGetPlayerHandouts(args),
    'plan-page-reveal': (tools, args) => tools.handlePlanPageReveal(args),
    'check-secret-terms': (tools, args) => tools.handleCheckSecretTerms(args),
  },
  tools: {
    'get-player-visibility': { set: 'prep', title: 'Get player visibility', kind: 'read' },
    'list-revealed-pages': { set: 'prep', title: 'List revealed pages', kind: 'read' },
    'get-player-handouts': { set: 'prep', title: 'Get player handouts', kind: 'read' },
    'plan-page-reveal': { set: 'prep', title: 'Plan page reveal', kind: 'read' },
    'check-secret-terms': { set: 'core', title: 'Check secret terms', kind: 'read' },
  },
});
