import { z } from 'zod';
import { toolRef } from '@gnuminator/shared';
import type { Logger } from '../logger.js';
import {
  DEFAULT_WAIT_MS,
  MAX_WAIT_MS,
  type GameEventHub,
  type WaitResult,
} from '../game-event-hub.js';
import type { SessionLogToolDefinition } from './types/session-log-types.js';

interface WaitForEventToolsOptions {
  hub: GameEventHub;
  logger: Logger;
}

/**
 * I-001: wait for the next game event instead of polling `get-recent-events` in a loop. The wait
 * sleeps on the event pumps' hub (game-event-hub.ts) and never queries Foundry itself.
 */
export class WaitForEventTools {
  private readonly hub: GameEventHub;
  private readonly logger: Logger;

  constructor(options: WaitForEventToolsOptions) {
    this.hub = options.hub;
    this.logger = options.logger.child({ component: 'WaitForEventTools' });
  }

  getToolDefinitions(): SessionLogToolDefinition[] {
    return [
      {
        name: 'wait-for-game-event',
        description: `Wait for the next game event instead of polling get-recent-events. Returns when a matching event is logged (a few seconds after it happens), or empty on timeout: call again with sinceTimestamp = the returned latestTimestamp so nothing is missed.`,
        inputSchema: {
          type: 'object',
          properties: {
            eventTypes: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Event types, e.g. ["combat-turn"], ["scene-change"], ["roll","damage-roll"]. Empty = any.',
            },
            actorName: {
              type: 'string',
              description: 'Actor name filter (partial match).',
              ...toolRef(['actor', 'token', 'user'], 'name'),
            },
            sinceTimestamp: {
              type: 'string',
              description:
                'The latestTimestamp of the previous call (not an event time); matching events after it return at once. Omit = only new ones.',
            },
            timeoutSeconds: {
              type: 'integer',
              description: `Default ${DEFAULT_WAIT_MS / 1000}, max ${MAX_WAIT_MS / 1000}.`,
            },
          },
        },
      },
    ];
  }

  async handleWaitForGameEvent(args: unknown, signal?: AbortSignal): Promise<unknown> {
    const schema = z.object({
      eventTypes: z.array(z.string()).max(30).optional(),
      actorName: z.string().optional(),
      sinceTimestamp: z.string().optional(),
      timeoutSeconds: z
        .number()
        .int()
        .min(1)
        .max(MAX_WAIT_MS / 1000)
        .optional(),
    });
    const params = schema.parse(args ?? {});
    let sinceMs: number | undefined;
    if (params.sinceTimestamp !== undefined) {
      sinceMs = Date.parse(params.sinceTimestamp);
      if (!Number.isFinite(sinceMs)) {
        throw new Error(`sinceTimestamp "${params.sinceTimestamp}" is not an ISO timestamp.`);
      }
    }
    const result = await this.hub.wait({
      ...(params.eventTypes ? { eventTypes: params.eventTypes } : {}),
      ...(params.actorName ? { actorName: params.actorName } : {}),
      ...(sinceMs !== undefined ? { sinceMs } : {}),
      timeoutMs: (params.timeoutSeconds ?? DEFAULT_WAIT_MS / 1000) * 1000,
      ...(signal ? { signal } : {}),
    });
    this.logger.debug('wait-for-game-event ended', {
      endedBy: result.endedBy,
      events: result.events.length,
    });
    return reply(result);
  }
}

function reply(result: WaitResult): Record<string, unknown> {
  return {
    success: true,
    timedOut: result.endedBy !== 'event',
    ...(result.endedBy === 'cancelled' ? { cancelled: true } : {}),
    events: result.events,
    ...(result.truncated ? { truncated: true } : {}),
    latestTimestamp: result.latestMs === null ? null : new Date(result.latestMs).toISOString(),
  };
}
