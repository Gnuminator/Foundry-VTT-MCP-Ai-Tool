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
  tools: {
    'search-compendium': { set: 'core', title: 'Search compendiums', kind: 'read' },
    'search-rules': { set: 'core', title: 'Search rules', kind: 'read' },
    'get-compendium-item': { set: 'core', title: 'Get compendium item', kind: 'read' },
    'list-creatures-by-criteria': {
      set: 'build',
      title: 'List creatures by criteria',
      kind: 'read',
    },
    'list-compendium-packs': { set: 'core', title: 'List compendium packs', kind: 'read' },
  },
});
