import { z } from 'zod';
import { toolRef } from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import type { SessionLogBridgeReply, SessionLogToolDefinition } from './types/session-log-types.js';

interface SessionLogToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3H: Session event log — the "memory" layer. Returns a structured log of
 * significant events accumulated by the Foundry module for the current browser
 * session (combat start/end, HP changes, deaths/stabilizations, conditions,
 * resource spend, scene changes, journal create/update).
 */
export class SessionLogTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: SessionLogToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'SessionLogTools' });
  }

  getToolDefinitions(): SessionLogToolDefinition[] {
    return [
      {
        name: 'get-session-log',
        description:
          'The structured event log of the current session: combat start/end, HP changes, deaths and stabilizations, conditions, resources spent, scene changes, journal edits, and dice rolls (public rolls as roll/damage-roll with a full breakdown in details.breakdown; whispered, blind and self rolls as gm-roll), and item-use cards. Use this to recap the whole session; for only what is new since a timestamp use get-recent-events (Play), for chat text get-chat-log (Play).',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Maximum number of events to return (default 100).',
              default: 100,
            },
            eventType: {
              type: 'string',
              description:
                'Optional event type filter (e.g. "combat-start", "combat-end", "damage", "healing", "death", "stabilize", "condition-applied", "condition-removed", "resource-spent", "scene-change", "journal-created", "journal-updated", "roll", "damage-roll", "gm-roll", "item-use").',
            },
            actorName: {
              type: 'string',
              description: 'Optional actor name filter (partial match).',
              // `damage-roll` events copy their actorName straight from the chat
              // log's speakerName (session-events.ts onCreateChatMessage), which
              // falls back to the acting user's name when no actor/token speaker
              // is set (session-events.ts parseChatMessage) — same reasoning as
              // chat-log.ts's speakerName picker.
              ...toolRef(['actor', 'token', 'user'], 'name'),
            },
          },
        },
      },
      {
        name: 'get-recent-events',
        description:
          'Use this during play to poll "what happened since timestamp X"; for the full session history use get-session-log (Prep). Returns the events plus `latestTimestamp`, which you pass back as `sinceTimestamp` next time to poll incrementally for only new events.',
        inputSchema: {
          type: 'object',
          properties: {
            sinceTimestamp: {
              type: 'string',
              description:
                'ISO timestamp; only return events after this time. Omit for the most recent events.',
            },
            limit: {
              type: 'integer',
              description: 'Maximum number of events to return (default 100).',
              default: 100,
            },
            eventType: {
              type: 'string',
              description: 'Optional event type filter.',
            },
          },
        },
      },
    ];
  }

  async handleGetSessionLog(args: unknown): Promise<SessionLogBridgeReply | undefined> {
    const schema = z.object({
      limit: z.number().int().min(1).max(1000).optional(),
      eventType: z.string().optional(),
      actorName: z.string().optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = (await this.foundryClient.query(
        'foundry-mcp-bridge.getSessionLog',
        params
      )) as SessionLogBridgeReply | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get session log');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting session log', error);
      throw error;
    }
  }

  async handleGetRecentEvents(args: unknown): Promise<SessionLogBridgeReply | undefined> {
    const schema = z.object({
      sinceTimestamp: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      eventType: z.string().optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = (await this.foundryClient.query(
        'foundry-mcp-bridge.getRecentEvents',
        params
      )) as SessionLogBridgeReply | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get recent events');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting recent events', error);
      throw error;
    }
  }
}
