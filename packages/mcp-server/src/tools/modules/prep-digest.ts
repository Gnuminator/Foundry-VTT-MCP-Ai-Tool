import { PrepDigestTools } from '../prep-digest.js';
import { defineToolModule } from '../tool-module.js';
import { preflightModule } from './preflight.js';

export const prepDigestModule = defineToolModule({
  id: 'prep-digest',
  create: ({ services, use }) =>
    new PrepDigestTools({
      foundryClient: services.foundryClient,
      worldIds: services.worldIds,
      store: services.store,
      handouts: services.handouts,
      preflight: use(preflightModule),
      guardedWrites: services.guardedWrites,
      tarokka: services.tarokka,
      vaultDir: services.obsidianVaultDir,
      sessionsDir: services.sessionsDir,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-prep-digest': (tools, args) => tools.handleGetPrepDigest(args),
  },
});
