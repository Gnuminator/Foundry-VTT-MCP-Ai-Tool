import { TableViewerTools } from '../table-viewer.js';
import { defineToolModule } from '../tool-module.js';

export const tableViewerModule = defineToolModule({
  id: 'table-viewer',
  create: ({ services }) =>
    new TableViewerTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-table-viewer': (tools, args) => tools.handleToolCall('plan-table-viewer', args),
  },
});
