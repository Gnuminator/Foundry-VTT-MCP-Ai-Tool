import { PlayStatsTools } from '../play-stats.js';
import { defineToolModule } from '../tool-module.js';

export const playStatsModule = defineToolModule({
  id: 'play-stats',
  create: ({ services }) =>
    new PlayStatsTools({
      worldIds: services.worldIds,
      store: services.store,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-play-stats': (tools, args) => tools.handleGetPlayStats(args),
  },
  tools: {
    'get-play-stats': { set: 'prep', title: 'Get play stats', kind: 'read' },
  },
});
