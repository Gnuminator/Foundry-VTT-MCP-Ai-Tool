import { ChatLogTools } from '../chat-log.js';
import { defineToolModule } from '../tool-module.js';

export const chatLogModule = defineToolModule({
  id: 'chat-log',
  create: ({ services }) =>
    new ChatLogTools({ foundryClient: services.foundryClient, logger: services.logger }),
  definitions: tools => tools.getToolDefinitions(),
  routes: {
    'get-chat-log': (tools, args) => tools.handleGetChatLog(args),
    'get-combat-play-by-play': (tools, args) => tools.handleGetCombatPlayByPlay(args),
    'send-chat-message': (tools, args) => tools.handleSendChatMessage(args),
  },
});
