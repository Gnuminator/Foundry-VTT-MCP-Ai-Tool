import { SceneRestoreTools } from '../scene-restore.js';
import { defineToolModule } from '../tool-module.js';

export const sceneRestoreModule = defineToolModule({
  id: 'scene-restore',
  create: ({ services }) =>
    new SceneRestoreTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      worldIds: services.worldIds,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-scene-restore': (tools, args) => tools.handleToolCall('plan-scene-restore', args),
  },
  tools: {
    'plan-scene-restore': { set: 'play', title: 'Plan scene restore from backup', kind: 'read' },
  },
});
