import { ReadAloudTools } from '../read-aloud.js';
import { defineToolModule } from '../tool-module.js';

export const readAloudModule = defineToolModule({
  id: 'read-aloud',
  create: ({ services }) =>
    new ReadAloudTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-read-aloud': (tools, args) => tools.handleGetReadAloud(args),
  },
  tools: {
    'get-read-aloud': { set: 'play', title: 'Get read-aloud text', kind: 'read' },
  },
});
