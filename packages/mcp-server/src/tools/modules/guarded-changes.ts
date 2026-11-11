import { GuardedChangeTools } from '../guarded-changes.js';
import { defineToolModule } from '../tool-module.js';

export const guardedChangesModule = defineToolModule({
  id: 'guarded-changes',
  create: ({ services }) =>
    new GuardedChangeTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-planned-change': (tools, args) => tools.handleGetPlannedChange(args),
    'apply-planned-change': (tools, args, context) =>
      tools.handleApplyPlannedChange(args, context?.requestedBy),
    'list-recent-changes': (tools, args) => tools.handleListRecentChanges(args),
    'undo-change': (tools, args, context) => tools.handleUndoChange(args, context?.requestedBy),
    'open-in-foundry': (tools, args) => tools.handleOpenInFoundry(args),
  },
});
