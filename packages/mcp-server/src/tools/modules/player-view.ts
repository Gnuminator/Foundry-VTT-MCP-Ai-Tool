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
});
