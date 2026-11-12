import { PreflightTools } from '../preflight.js';
import { defineToolModule } from '../tool-module.js';
import { playSessionModule } from './play-session.js';

export const preflightModule = defineToolModule({
  id: 'preflight',
  create: ({ services, use }) =>
    new PreflightTools({
      foundryClient: services.foundryClient,
      wrapperStatus: services.wrapperStatus,
      secretTerms: services.secretTerms,
      worldIds: services.worldIds,
      playSession: use(playSessionModule),
      obsidianVaultDirSet: Boolean(services.obsidianVaultDir),
      pumpHealth: services.pumpHealth,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-preflight': (tools, args) => tools.handleGetPreflight(args),
  },
  tools: {
    'get-preflight': { set: 'prep', title: 'Run pre-flight check', kind: 'read' },
  },
});
