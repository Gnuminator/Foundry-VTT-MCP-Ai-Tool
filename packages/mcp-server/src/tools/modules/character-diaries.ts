import { CharacterDiaryTools } from '../character-diaries.js';
import { defineToolModule } from '../tool-module.js';

export const characterDiariesModule = defineToolModule({
  id: 'character-diaries',
  create: ({ services }) =>
    new CharacterDiaryTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      secretTerms: services.secretTerms,
      worldIds: services.worldIds,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-character-diaries': (tools, args) => tools.handleToolCall('plan-character-diaries', args),
  },
  tools: {
    'plan-character-diaries': { set: 'play', title: 'Plan character diaries', kind: 'read' },
  },
});
