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
  tools: {
    'get-combat-state': { set: 'core', title: 'Get combat state', kind: 'read' },
    'advance-combat-turn': { set: 'play', title: 'Advance combat turn', kind: 'write' },
    'set-initiative': { set: 'play', title: 'Set initiative', kind: 'destructive' },
    'roll-initiative-for-npcs': { set: 'play', title: 'Roll initiative', kind: 'write' },
  },
});
