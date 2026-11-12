import { PlayerTools } from '../player.js';
import { defineToolModule } from '../tool-module.js';

/**
 * The player set (D-136): listed here so the definitions come from one place, but with no
 * call_tool route. The tools run only through the `player_tool` control message in backend.ts,
 * which reads this module's instance back with `tools.get(playerModule)`.
 */
export const playerModule = defineToolModule({
  id: 'player',
  create: ({ services }) =>
    new PlayerTools({
      foundryClient: services.foundryClient,
      logger: services.logger,
      secretTerms: services.secretTerms,
      worldIds: services.worldIds,
      extraDenyTerms: services.playerExtraDenyTerms,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {},
  tools: {
    'get-my-character': { set: 'player', title: 'Get my character', kind: 'read' },
    'get-my-level-up-options': { set: 'player', title: 'Get my level-up options', kind: 'read' },
    'search-books': { set: 'player', title: 'Search the books', kind: 'read' },
    'find-book-entries': { set: 'player', title: 'Find book entries', kind: 'read' },
    'get-book-entry': { set: 'player', title: 'Get a book entry', kind: 'read' },
  },
});
