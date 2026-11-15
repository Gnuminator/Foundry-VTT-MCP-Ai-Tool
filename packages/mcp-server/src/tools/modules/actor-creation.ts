import { ActorCreationTools } from '../actor-creation.js';
import { defineToolModule } from '../tool-module.js';

export const actorCreationModule = defineToolModule({
  id: 'actor-creation',
  create: ({ services }) =>
    new ActorCreationTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'create-actor-from-compendium': (tools, args) => tools.handleCreateActorFromCompendium(args),
    'get-compendium-entry-full': (tools, args) => tools.handleGetCompendiumEntryFull(args),
  },
  tools: {
    'create-actor-from-compendium': {
      set: 'build',
      title: 'Create actor from compendium',
      kind: 'write',
    },
    'get-compendium-entry-full': { set: 'build', title: 'Get full compendium entry', kind: 'read' },
  },
});
