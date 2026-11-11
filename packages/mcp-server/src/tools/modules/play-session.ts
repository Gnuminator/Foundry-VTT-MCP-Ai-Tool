import { PlaySessionTools } from '../play-session.js';
import { defineToolModule } from '../tool-module.js';

export const playSessionModule = defineToolModule({
  id: 'play-session',
  create: ({ services }) =>
    new PlaySessionTools({
      worldIds: services.worldIds,
      store: services.store,
      logger: services.logger,
      onMarked: services.onPlaySessionMarked,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'mark-play-session': (tools, args) => tools.handleMarkPlaySession(args),
    'get-play-session': (tools, args) => tools.handleGetPlaySession(args),
  },
});
