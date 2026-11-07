import { EffectsTools } from '../effects.js';
import { defineToolModule } from '../tool-module.js';

export const effectsModule = defineToolModule({
  id: 'effects',
  create: ({ services }) =>
    new EffectsTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-active-effects': (tools, args) => tools.handleGetActiveEffects(args),
  },
});
