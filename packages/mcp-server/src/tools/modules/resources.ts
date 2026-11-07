import { ResourceTools } from '../resources.js';
import { defineToolModule } from '../tool-module.js';

export const resourcesModule = defineToolModule({
  id: 'resources',
  create: ({ services }) =>
    new ResourceTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-character-resources': (tools, args) => tools.handleGetCharacterResources(args),
  },
});
