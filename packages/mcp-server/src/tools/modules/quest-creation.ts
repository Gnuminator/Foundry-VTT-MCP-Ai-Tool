import { QuestCreationTools } from '../quest-creation.js';
import { defineToolModule } from '../tool-module.js';

export const questCreationModule = defineToolModule({
  id: 'quest-creation',
  create: ({ services }) =>
    new QuestCreationTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'create-quest-journal': (tools, args) => tools.handleCreateQuestJournal(args),
    'link-quest-to-npc': (tools, args) => tools.handleLinkQuestToNPC(args),
    'update-quest-journal': (tools, args) => tools.handleUpdateQuestJournal(args),
    'list-journals': (tools, args) => tools.handleListJournals(args),
    'search-journals': (tools, args) => tools.handleSearchJournals(args),
  },
});
