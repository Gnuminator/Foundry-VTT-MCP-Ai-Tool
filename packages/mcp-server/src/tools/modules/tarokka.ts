import { TarokkaTools } from '../tarokka.js';
import { defineToolModule } from '../tool-module.js';

export const tarokkaModule = defineToolModule({
  id: 'tarokka',
  create: ({ services }) =>
    new TarokkaTools({ tarokka: services.tarokka, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-tarokka-reading': (tools, args) => tools.handleGetTarokkaReading(args),
    'plan-tarokka-import': (tools, args) => tools.handlePlanTarokkaImport(args),
    'suggest-tarokka-links': (tools, args) => tools.handleSuggestTarokkaLinks(args),
    'plan-tarokka-links': (tools, args) => tools.handlePlanTarokkaLinks(args),
    'plan-tarokka-reveal': (tools, args) => tools.handlePlanTarokkaReveal(args),
  },
});
