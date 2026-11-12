import { CharacterTools } from '../character.js';
import { defineToolModule } from '../tool-module.js';
import { rulesCheckModule } from './rules-check.js';

export const characterModule = defineToolModule({
  id: 'character',
  create: ({ services, use }) =>
    new CharacterTools({
      foundryClient: services.foundryClient,
      logger: services.logger,
      ...(services.systemRegistry ? { systemRegistry: services.systemRegistry } : {}),
      rulesCheck: use(rulesCheckModule),
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-character': (tools, args) => tools.handleGetCharacter(args),
    'list-characters': (tools, args) => tools.handleListCharacters(args),
    'get-character-entity': (tools, args) => tools.handleGetCharacterEntity(args),
    'use-item': (tools, args) => tools.handleUseItem(args),
    'search-character-items': (tools, args) => tools.handleSearchCharacterItems(args),
    'manage-world-items': (tools, args) => tools.handleManageWorldItems(args),
  },
  tools: {
    'get-character': { set: 'core', title: 'Get character', kind: 'read' },
    'get-character-entity': { set: 'core', title: 'Get character item or effect', kind: 'read' },
    'list-characters': { set: 'core', title: 'List characters', kind: 'read' },
    'use-item': { set: 'play', title: 'Use item', kind: 'destructive' },
    'manage-world-items': { set: 'build', title: 'Manage world items', kind: 'destructive' },
    'search-character-items': { set: 'core', title: 'Search character items', kind: 'read' },
  },
});
