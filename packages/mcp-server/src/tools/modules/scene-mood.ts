import { SceneMoodTools } from '../scene-mood.js';
import { defineToolModule } from '../tool-module.js';

export const sceneMoodModule = defineToolModule({
  id: 'scene-mood',
  create: ({ services }) =>
    new SceneMoodTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-scene-mood': (tools, args) => tools.handleToolCall('plan-scene-mood', args),
    'list-scene-moods': (tools, args) => tools.handleToolCall('list-scene-moods', args),
  },
});
