import { SessionLogTools } from '../session-log.js';
import { defineToolModule } from '../tool-module.js';

export const sessionLogModule = defineToolModule({
  id: 'session-log',
  create: ({ services }) =>
    new SessionLogTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-session-log': (tools, args) => tools.handleGetSessionLog(args),
    'get-recent-events': (tools, args) => tools.handleGetRecentEvents(args),
  },
  tools: {
    'get-session-log': { set: 'prep', title: 'Get session log', kind: 'read' },
    'get-recent-events': { set: 'play', title: 'Get recent events', kind: 'read' },
  },
});
