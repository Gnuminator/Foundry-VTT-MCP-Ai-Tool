import { RulesCheckTools } from '../rules-check.js';
import { defineToolModule } from '../tool-module.js';

export const rulesCheckModule = defineToolModule({
  id: 'rules-check',
  create: ({ services }) =>
    new RulesCheckTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'check-action': (tools, args) => tools.handleToolCall('check-action', args),
  },
  tools: {
    'check-action': { set: 'play', title: 'Check an action against the rules', kind: 'read' },
  },
});
