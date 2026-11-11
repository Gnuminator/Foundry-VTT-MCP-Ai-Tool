import { TokenManipulationTools } from '../token-manipulation.js';
import { defineToolModule } from '../tool-module.js';

export const tokenManipulationModule = defineToolModule({
  id: 'token-manipulation',
  create: ({ services }) =>
    new TokenManipulationTools({
      foundryClient: services.foundryClient,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-token-details': (tools, args) => tools.handleGetTokenDetails(args),
    'get-available-conditions': (tools, args) => tools.handleGetAvailableConditions(args),
  },
});
