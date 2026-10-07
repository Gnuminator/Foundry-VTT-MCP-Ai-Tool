import { toolRef } from '@gnuminator/shared';
import { z } from 'zod';

import type { ChangeHistory, ChangeListResult } from '../change-history.js';
import type { Logger } from '../logger.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface ChangeHistoryToolsOptions {
  changeHistory: Pick<ChangeHistory, 'list'>;
  logger: Logger;
}

/**
 * `list-changes` (I-109 part 2): everyone's recent changes in Foundry, players and GM from the
 * bridge's change journal and the AI's from the guarded-write audit log, newest first. Read-only.
 */
export class ChangeHistoryTools {
  private readonly changeHistory: ChangeHistoryToolsOptions['changeHistory'];
  private readonly logger: Logger;

  constructor(options: ChangeHistoryToolsOptions) {
    this.changeHistory = options.changeHistory;
    this.logger = options.logger.child({ component: 'ChangeHistoryTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'list-changes',
        description:
          "List everyone's recent changes in Foundry (players, the GM and the AI) from the last 7 days, newest first: who, what and when, as readable lines such as \"Ireena: HP 10 -> 5\". Filter by person, by thing (a document uuid) and by AI or human. Read-only. Undo of a player's or GM's change is not available yet; an AI change can be undone with undo-change using its id.",
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Maximum number of changes to return (default 30, max 200).',
              default: 30,
            },
            person: {
              type: 'string',
              description:
                'Only changes by this person: a Foundry user id or user name (not case sensitive).',
              ...toolRef('user', 'id'),
            },
            thing: {
              type: 'string',
              description:
                'Only changes to this document uuid (an actor, token, scene, ...) and anything on it, such as its items and effects.',
              ...toolRef('document', 'uuid'),
            },
            source: {
              type: 'string',
              enum: ['all', 'ai', 'human'],
              description: "Which changes to list: all (default), only the AI's, or only people's.",
              default: 'all',
            },
            since: {
              type: 'string',
              description:
                'Only changes at or after this time (ISO 8601, e.g. 2026-10-06T19:00:00Z).',
            },
          },
        },
      },
    ];
  }

  async handleListChanges(args: unknown): Promise<ChangeListResult> {
    const params = z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        person: z.string().trim().min(1).max(200).optional(),
        thing: z.string().trim().min(1).max(500).optional(),
        source: z.enum(['all', 'ai', 'human']).optional(),
        since: z
          .string()
          .refine(value => Number.isFinite(Date.parse(value)), 'since must be an ISO 8601 time')
          .optional(),
      })
      .parse(args ?? {});
    this.logger.debug('Listing changes', params);
    return this.changeHistory.list({
      limit: params.limit ?? 30,
      ...(params.person ? { userId: params.person, userName: params.person } : {}),
      ...(params.thing ? { thingUuid: params.thing } : {}),
      source: params.source ?? 'all',
      ...(params.since ? { sinceIso: params.since } : {}),
    });
  }
}
