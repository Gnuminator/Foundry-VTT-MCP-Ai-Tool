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
});
