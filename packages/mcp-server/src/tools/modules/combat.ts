import { CombatTools } from '../combat.js';
import { defineToolModule } from '../tool-module.js';

export const combatModule = defineToolModule({
  id: 'combat',
  create: ({ services }) =>
    new CombatTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-combat-state': (tools, args) => tools.handleGetCombatState(args),
    'advance-combat-turn': (tools, args) => tools.handleAdvanceCombatTurn(args),
    'set-initiative': (tools, args) => tools.handleSetInitiative(args),
    'roll-initiative-for-npcs': (tools, args) => tools.handleRollInitiativeForNpcs(args),
  },
});
