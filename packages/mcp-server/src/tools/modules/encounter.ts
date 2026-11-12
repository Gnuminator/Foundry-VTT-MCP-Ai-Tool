import { EncounterTools } from '../encounter.js';
import { defineToolModule } from '../tool-module.js';

export const encounterModule = defineToolModule({
  id: 'encounter',
  create: ({ services }) =>
    new EncounterTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'suggest-balanced-encounter': (tools, args) => tools.handleSuggestBalancedEncounter(args),
  },
  tools: {
    'suggest-balanced-encounter': {
      set: 'prep',
      title: 'Suggest balanced encounter',
      kind: 'read',
    },
  },
});
