import { DnD5eFeaturesFromCompendiumTools } from '../dnd5e/features.js';
import { defineToolModule } from '../tool-module.js';

export const dnd5eFeaturesModule = defineToolModule({
  id: 'dnd5e-features',
  create: ({ services }) =>
    new DnD5eFeaturesFromCompendiumTools({
      foundryClient: services.foundryClient,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'dnd5e-add-features-from-compendium': (tools, args) =>
      tools.handleAddFeaturesFromCompendium(args),
  },
  tools: {
    'dnd5e-add-features-from-compendium': {
      set: 'build',
      title: 'Add compendium features to actor',
      kind: 'write',
    },
  },
});
