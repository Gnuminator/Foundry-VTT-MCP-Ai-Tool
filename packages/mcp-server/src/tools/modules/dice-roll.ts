import { DiceRollTools } from '../dice-roll.js';
import { defineToolModule } from '../tool-module.js';
import { rulesCheckModule } from './rules-check.js';

export const diceRollModule = defineToolModule({
  id: 'dice-roll',
  create: ({ services, use }) =>
    new DiceRollTools({
      foundryClient: services.foundryClient,
      logger: services.logger,
      rulesCheck: use(rulesCheckModule),
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'request-player-rolls': (tools, args) => tools.handleRequestPlayerRolls(args),
    'request-ability-check': (tools, args) => tools.handleRequestAbilityCheck(args),
    'request-attack-roll': (tools, args) => tools.handleRequestAttackRoll(args),
    'roll-npc-check': (tools, args) => tools.handleRollNpcCheck(args),
  },
});
