import { DiagnosticsTools } from '../diagnostics.js';
import { defineToolModule } from '../tool-module.js';

export const diagnosticsModule = defineToolModule({
  id: 'diagnostics',
  create: ({ services }) =>
    new DiagnosticsTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-modules': (tools, args) => tools.handleGetModules(args),
    'get-module-errors': (tools, args) => tools.handleGetModuleErrors(args),
    'clear-module-errors': (tools, args) => tools.handleClearModuleErrors(args),
    'get-module-manifest': (tools, args) => tools.handleGetModuleManifest(args),
  },
});
