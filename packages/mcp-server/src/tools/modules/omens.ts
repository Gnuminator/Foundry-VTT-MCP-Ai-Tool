import { OmensTools } from '../omens.js';
import { defineToolModule } from '../tool-module.js';

export const omensModule = defineToolModule({
  id: 'omens',
  create: ({ services }) => new OmensTools({ omens: services.omens }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'draft-omens': (tools, args) => tools.handleDraftOmens(args),
  },
  tools: {
    'draft-omens': { set: 'prep', title: 'Draft omens by post', kind: 'write' },
  },
});
