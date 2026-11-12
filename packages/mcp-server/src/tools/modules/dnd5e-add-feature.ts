import { DnD5eAddFeatureTool } from '../dnd5e/add-feature.js';
import { defineToolModule } from '../tool-module.js';

export const dnd5eAddFeatureModule = defineToolModule({
  id: 'dnd5e-add-feature',
  create: ({ services }) =>
    new DnD5eAddFeatureTool({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'dnd5e-add-feature': (tools, args) => tools.handleAddFeature(args),
  },
  tools: {
    'dnd5e-add-feature': { set: 'build', title: 'Add feature to actor', kind: 'write' },
  },
});
