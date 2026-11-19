import { HandoutPressTools } from '../handout-press.js';
import { defineToolModule } from '../tool-module.js';

export const handoutPressModule = defineToolModule({
  id: 'handout-press',
  create: ({ services }) =>
    new HandoutPressTools({
      handouts: services.handouts,
      secretTerms: services.secretTerms,
      foundryClient: services.foundryClient,
      worldIds: services.worldIds,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-handout-press': (tools, args) => tools.handleToolCall('plan-handout-press', args),
  },
  tools: {
    // 'write': the picture file is stored in the world's assets/ai-art/handouts folder when the plan is made.
    // 'play', not 'prep': prep is at its size budget and play has room; a handout made mid-session fits.
    'plan-handout-press': { set: 'play', title: 'Plan a handout picture', kind: 'write' },
  },
});
