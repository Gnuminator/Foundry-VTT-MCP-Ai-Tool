import { ObsidianMirrorTools } from '../obsidian-mirror.js';
import { defineToolModule } from '../tool-module.js';

export const obsidianMirrorModule = defineToolModule({
  id: 'obsidian-mirror',
  create: ({ services }) =>
    new ObsidianMirrorTools({
      store: services.store,
      worldIds: services.worldIds,
      guardedWrites: services.guardedWrites,
      status: services.mirrorStatus,
      env: services.mirrorEnv,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-obsidian-mirror': (tools, args) => tools.handleGetObsidianMirror(args),
    'plan-obsidian-mirror': (tools, args) => tools.handlePlanObsidianMirror(args),
  },
  tools: {
    'get-obsidian-mirror': { set: 'admin', title: 'Get Obsidian mirror settings', kind: 'read' },
    'plan-obsidian-mirror': { set: 'admin', title: 'Plan Obsidian mirror change', kind: 'read' },
  },
});
