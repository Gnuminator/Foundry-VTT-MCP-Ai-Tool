import { CombatResolutionTools } from '../combat-resolution.js';
import { defineToolModule } from '../tool-module.js';

export const combatResolutionModule = defineToolModule({
  id: 'combat-resolution',
  create: ({ services }) =>
    new CombatResolutionTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'roll-saving-throws': (tools, args) => tools.handleRollSavingThrows(args),
    'use-npc-activity': (tools, args) => tools.handleUseNpcActivity(args),
    'manage-rest': (tools, args) => tools.handleManageRest(args),
  },
  tools: {
    'roll-saving-throws': { set: 'play', title: 'Roll NPC saving throws', kind: 'write' },
    'use-npc-activity': { set: 'play', title: 'Use NPC attack or activity', kind: 'write' },
    'manage-rest': { set: 'play', title: 'Run a rest', kind: 'destructive' },
  },
});
