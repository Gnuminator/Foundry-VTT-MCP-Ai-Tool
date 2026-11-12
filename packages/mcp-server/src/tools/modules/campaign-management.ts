import { CampaignManagementTools } from '../campaign-management.js';
import { defineToolModule } from '../tool-module.js';

export const campaignManagementModule = defineToolModule({
  id: 'campaign-management',
  create: ({ services }) => new CampaignManagementTools(services.foundryClient, services.logger),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'create-campaign-dashboard': (tools, args) => tools.handleCreateCampaignDashboard(args),
  },
  tools: {
    'create-campaign-dashboard': { set: 'prep', title: 'Create campaign dashboard', kind: 'write' },
  },
});
