import { SceneTools } from '../scene.js';
import { defineToolModule } from '../tool-module.js';

export const sceneModule = defineToolModule({
  id: 'scene',
  create: ({ services }) =>
    new SceneTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'list-scenes': (tools, args) => tools.listScenes(args),
    'switch-scene': (tools, args) => tools.switchScene(args),
    'get-current-scene': (tools, args) => tools.handleGetCurrentScene(args),
    'get-world-info': (tools, args) => tools.handleGetWorldInfo(args),
  },
  tools: {
    'get-current-scene': { set: 'core', title: 'Get current scene', kind: 'read' },
    'get-world-info': { set: 'core', title: 'Get world info', kind: 'read' },
    'list-scenes': { set: 'core', title: 'List scenes', kind: 'read' },
    'switch-scene': { set: 'play', title: 'Switch scene', kind: 'write' },
  },
});
