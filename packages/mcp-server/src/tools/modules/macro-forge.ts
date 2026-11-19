import { MacroForgeTools } from '../macro-forge.js';
import { defineToolModule } from '../tool-module.js';

export const macroForgeModule = defineToolModule({
  id: 'macro-forge',
  create: ({ services }) =>
    new MacroForgeTools({
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-macro': (tools, args) => tools.handleToolCall('plan-macro', args),
  },
  tools: {
    'plan-macro': { set: 'build', title: 'Plan a GM-only script macro', kind: 'read' },
  },
});
