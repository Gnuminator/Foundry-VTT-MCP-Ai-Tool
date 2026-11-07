import { TokenRingsTools } from '../token-rings.js';
import { defineToolModule } from '../tool-module.js';

export const tokenRingsModule = defineToolModule({
  id: 'token-rings',
  create: ({ services }) =>
    new TokenRingsTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-token-rings': (tools, args) => tools.handleToolCall('plan-token-rings', args),
  },
});
