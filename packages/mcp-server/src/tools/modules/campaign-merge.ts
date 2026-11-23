import { CampaignMergeTools } from '../campaign-merge.js';
import { defineToolModule } from '../tool-module.js';

export const campaignMergeModule = defineToolModule({
  id: 'campaign-merge',
  create: ({ services }) =>
    new CampaignMergeTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'plan-campaign-merge': (tools, args) => tools.handlePlanCampaignMerge(args),
  },
  tools: {
    'plan-campaign-merge': { set: 'admin', title: 'Plan campaign page merge', kind: 'read' },
  },
});
