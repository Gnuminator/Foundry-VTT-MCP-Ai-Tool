import { RefChoiceTools } from '../ref-choices.js';
import { defineToolModule } from '../tool-module.js';

export const refChoicesModule = defineToolModule({
  id: 'ref-choices',
  create: ({ services }) =>
    new RefChoiceTools({
      foundryClient: services.foundryClient,
      guardedWrites: services.guardedWrites,
      logger: services.logger,
    }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'list-ref-choices': (tools, args) => tools.handleListRefChoices(args),
  },
});
