import { DraftsTools } from '../drafts.js';
import { defineToolModule } from '../tool-module.js';

export const draftsModule = defineToolModule({
  id: 'drafts',
  create: ({ services }) => new DraftsTools(services.drafts),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'draft-player-text': (tools, args) => tools.handleDraftPlayerText(args),
  },
  tools: {
    'draft-player-text': { set: 'prep', title: 'Draft text for players', kind: 'write' },
  },
});
