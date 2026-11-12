import { ChangeHistoryTools } from '../change-history.js';
import { defineToolModule } from '../tool-module.js';

export const changeHistoryModule = defineToolModule({
  id: 'change-history',
  create: ({ services }) =>
    new ChangeHistoryTools({
      changeHistory: services.changeHistory,
      undoPlanner: services.undoPlanner,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'list-changes': (tools, args) => tools.handleListChanges(args),
    'plan-undo-changes': (tools, args) => tools.handlePlanUndoChanges(args),
  },
  tools: {
    'list-changes': { set: 'core', title: 'List all recent changes', kind: 'read' },
    'plan-undo-changes': { set: 'core', title: 'Plan undoing changes', kind: 'read' },
  },
});
