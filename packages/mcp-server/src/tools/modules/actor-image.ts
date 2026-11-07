import { ActorImageTools } from '../actor-image.js';
import { defineToolModule } from '../tool-module.js';

export const actorImageModule = defineToolModule({
  id: 'actor-image',
  create: ({ services }) =>
    new ActorImageTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-actor-image': (tools, args) => tools.handleToolCall('plan-actor-image', args),
  },
});
