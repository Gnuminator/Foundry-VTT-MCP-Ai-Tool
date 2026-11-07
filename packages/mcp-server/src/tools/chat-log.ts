import { z } from 'zod';
import { AT_THE_TABLE, toolRef } from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import type {
  ChatLogBridgeReply,
  ChatLogSendResult,
  ChatLogToolDefinition,
} from './types/chat-log-types.js';

interface ChatLogToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3A: Chat log / combat play-by-play / in-character chat tools.
 *
 * The chat-log buffer itself lives in the Foundry module (browser memory); these
 * tools request it on demand over the existing WebSocket query channel.
 */
export class ChatLogTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: ChatLogToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'ChatLogTools' });
  }

  getToolDefinitions(): ChatLogToolDefinition[] {
    return [
      {
        name: 'get-chat-log',
        description:
          "Recent Foundry chat messages from the module's in-memory buffer: dice rolls, ability uses, damage and combat narration. Each has the speaker, type, content and flavor; rolls add formula, total, dice, critical/fumble, advantage/disadvantage and damage total and types. Use this to read the chat and rolls; for a combat recap use get-combat-play-by-play, for game events get-session-log.",
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Maximum number of messages to return (default 50, max 200).',
              default: 50,
            },
            speakerName: {
              type: 'string',
              description: 'Filter to messages from this actor/speaker name (partial match).',
              ...toolRef(['actor', 'token', 'user'], 'name'),
            },
            messageType: {
              type: 'string',
              description: 'Filter by message type.',
              enum: ['roll', 'damage', 'all'],
              default: 'all',
            },
            sinceTimestamp: {
              type: 'string',
              description: 'ISO timestamp; only return messages created after this time.',
            },
          },
        },
      },
      {
        name: 'get-combat-play-by-play',
        description:
          'Use this for a recap of the current or most recent combat (for raw chat use get-chat-log), rebuilt from the chat-log buffer and the turn timeline: each round by turn (who acted, with roll and damage results), key events (downed, dead, stabilized, conditions applied or removed), and totals for rounds and damage dealt per actor.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'send-chat-message',
        description:
          'Direct write. Post a chat message as a character or as the GM. Types: in-character (ic), out-of-character (ooc), emote, whisper.',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message text to post.',
            },
            speakerActorId: {
              type: 'string',
              description:
                'Actor ID to post as. If omitted (and no name given), posts as the GM/world.',
              ...toolRef('actor', 'id', { filter: AT_THE_TABLE }),
            },
            speakerActorName: {
              type: 'string',
              description: 'Actor name to post as (alternative to speakerActorId).',
              ...toolRef('actor', 'name', { filter: AT_THE_TABLE }),
            },
            messageType: {
              type: 'string',
              description: 'Type of message.',
              enum: ['ic', 'ooc', 'emote', 'whisper'],
              default: 'ic',
            },
            whisperTargets: {
              type: 'array',
              items: { type: 'string' },
              description: 'When messageType is "whisper", the user names to whisper to.',
              ...toolRef('user', 'name'),
            },
          },
          required: ['message'],
        },
      },
    ];
  }

  async handleGetChatLog(args: unknown): Promise<ChatLogBridgeReply | undefined> {
    const schema = z.object({
      limit: z.number().int().min(1).max(200).optional(),
      speakerName: z.string().optional(),
      messageType: z.enum(['roll', 'damage', 'all']).optional(),
      sinceTimestamp: z.string().optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = (await this.foundryClient.query('foundry-mcp-bridge.getChatLog', params)) as
        | ChatLogBridgeReply
        | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get chat log');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting chat log', error);
      throw error;
    }
  }

  async handleGetCombatPlayByPlay(_args?: unknown): Promise<ChatLogBridgeReply | undefined> {
    try {
      const response = (await this.foundryClient.query(
        'foundry-mcp-bridge.getCombatPlayByPlay',
        {}
      )) as ChatLogBridgeReply | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get combat play-by-play');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting combat play-by-play', error);
      throw error;
    }
  }

  async handleSendChatMessage(args: unknown): Promise<ChatLogSendResult> {
    const schema = z.object({
      message: z.string().min(1),
      speakerActorId: z.string().optional(),
      speakerActorName: z.string().optional(),
      messageType: z.enum(['ic', 'ooc', 'emote', 'whisper']).optional(),
      whisperTargets: z.array(z.string()).optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = (await this.foundryClient.query(
        'foundry-mcp-bridge.sendChatMessage',
        params
      )) as ChatLogBridgeReply | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to send chat message');
      }
      return response;
    } catch (error) {
      this.logger.error('Error sending chat message', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }
}
