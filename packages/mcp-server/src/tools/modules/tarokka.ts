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
  tools: {
    'get-tarokka-reading': { set: 'prep', title: 'Get Tarokka reading', kind: 'read' },
    'plan-tarokka-import': { set: 'prep', title: 'Plan Tarokka reading import', kind: 'read' },
    'suggest-tarokka-links': { set: 'prep', title: 'Suggest Tarokka links', kind: 'read' },
    'plan-tarokka-links': { set: 'prep', title: 'Plan Tarokka links', kind: 'read' },
    'plan-tarokka-reveal': { set: 'prep', title: 'Plan Tarokka reveal', kind: 'read' },
  },
});
