import { SceneChangeTools } from '../scene-change.js';
import { defineToolModule } from '../tool-module.js';

export const sceneChangeModule = defineToolModule({
  id: 'scene-change',
  create: ({ services }) =>
    new SceneChangeTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-scene-change': (tools, args) => tools.handlePlanSceneChange(args),
    'play-playlist': (tools, args) => tools.handlePlayPlaylist(args),
  },
  tools: {
    'plan-scene-change': { set: 'play', title: 'Plan scene dressing', kind: 'read' },
    'play-playlist': { set: 'play', title: 'Play or stop playlist', kind: 'write' },
  },
});
