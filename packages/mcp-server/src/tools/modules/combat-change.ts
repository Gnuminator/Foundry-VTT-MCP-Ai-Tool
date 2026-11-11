import { CombatChangeTools } from '../combat-change.js';
import { defineToolModule } from '../tool-module.js';

export const combatChangeModule = defineToolModule({
  id: 'combat-change',
  create: ({ services }) =>
    new CombatChangeTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-combat-change': (tools, args) => tools.handlePlanCombatChange(args),
  },
});
