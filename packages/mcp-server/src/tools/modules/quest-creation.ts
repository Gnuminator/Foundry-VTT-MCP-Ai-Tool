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
  tools: {
    'create-quest-journal': { set: 'prep', title: 'Create quest journal', kind: 'write' },
    'link-quest-to-npc': { set: 'prep', title: 'Link quest to NPC', kind: 'write' },
    'update-quest-journal': { set: 'prep', title: 'Update quest journal', kind: 'destructive' },
    'list-journals': { set: 'core', title: 'List or read journals', kind: 'read' },
    'search-journals': { set: 'core', title: 'Search journals', kind: 'read' },
  },
});
