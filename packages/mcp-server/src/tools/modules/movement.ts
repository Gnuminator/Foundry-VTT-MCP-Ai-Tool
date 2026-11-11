import { MovementTools } from '../movement.js';
import { defineToolModule } from '../tool-module.js';

export const movementModule = defineToolModule({
  id: 'movement',
  create: ({ services }) =>
    new MovementTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-token-positions': (tools, args) => tools.handleGetTokenPositions(args),
    'measure-distance': (tools, args) => tools.handleMeasureDistance(args),
    'get-targets': (tools, args) => tools.handleGetTargets(args),
  },
});
