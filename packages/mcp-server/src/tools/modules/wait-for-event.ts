import { defineToolModule } from '../tool-module.js';
import { WaitForEventTools } from '../wait-for-event.js';

export const waitForEventModule = defineToolModule({
  id: 'wait-for-event',
  create: ({ services }) =>
    new WaitForEventTools({ hub: services.gameEventHub, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'wait-for-game-event': (tools, args, context) =>
      tools.handleWaitForGameEvent(args, context?.signal),
  },
  tools: {
    'wait-for-game-event': { set: 'play', title: 'Wait for a game event', kind: 'read' },
  },
});
