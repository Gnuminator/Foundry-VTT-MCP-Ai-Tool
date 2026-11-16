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
  tools: {
    // 'write': the picture file is stored in the world's assets/ai-art folder when the plan is made.
    'plan-actor-image': {
      set: 'build',
      title: 'Plan a new portrait and token picture for an actor',
      kind: 'write',
    },
  },
});
