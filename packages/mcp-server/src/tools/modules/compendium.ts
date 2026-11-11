import { CompendiumTools } from '../compendium.js';
import { defineToolModule } from '../tool-module.js';

export const compendiumModule = defineToolModule({
  id: 'compendium',
  create: ({ services }) =>
    new CompendiumTools({
      foundryClient: services.foundryClient,
      logger: services.logger,
      ...(services.systemRegistry ? { systemRegistry: services.systemRegistry } : {}),
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'search-compendium': (tools, args) => tools.handleSearchCompendium(args),
    'search-rules': (tools, args) => tools.handleSearchRules(args),
    'get-compendium-item': (tools, args) => tools.handleGetCompendiumItem(args),
    'list-creatures-by-criteria': (tools, args) => tools.handleListCreaturesByCriteria(args),
    'list-compendium-packs': (tools, args) => tools.handleListCompendiumPacks(args),
  },
});
