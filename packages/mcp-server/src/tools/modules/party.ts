import { PartyTools } from '../party.js';
import { defineToolModule } from '../tool-module.js';

export const partyModule = defineToolModule({
  id: 'party',
  create: ({ services }) =>
    new PartyTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-party': (tools, args) => tools.handleGetParty(args),
    'plan-party-change': (tools, args) => tools.handlePlanPartyChange(args),
  },
});
