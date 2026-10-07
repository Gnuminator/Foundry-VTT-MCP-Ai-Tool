import { freeText, toolRef } from '@gnuminator/shared';
import { z } from 'zod';

import type { ChangeHistory, ChangeListResult } from '../change-history.js';
import { UNDO_SCOPES, type UndoPlanView, type UndoPlanner } from '../guarded-write/undo-planner.js';
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
  undoPlanner: Pick<UndoPlanner, 'plan'>;
  logger: Logger;
}

/**
 * `list-changes` (I-109 part 2): everyone's recent changes in Foundry, players and GM from the
 * bridge's change journal and the AI's from the guarded-write audit log, newest first. Read-only.
 * `plan-undo-changes` (I-109 part 3): plans undoing one of them, or everything since on the same
 * thing; the caller applies the plan with `apply-planned-change`.
 */
export class ChangeHistoryTools {
  private readonly changeHistory: ChangeHistoryToolsOptions['changeHistory'];
  private readonly undoPlanner: ChangeHistoryToolsOptions['undoPlanner'];
  private readonly logger: Logger;

  constructor(options: ChangeHistoryToolsOptions) {
    this.changeHistory = options.changeHistory;
    this.undoPlanner = options.undoPlanner;
    this.logger = options.logger.child({ component: 'ChangeHistoryTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'list-changes',
        description:
          'List everyone\'s recent changes in Foundry (players, the GM and the AI) from the last 7 days, newest first: who, what and when, as readable lines such as "Ireena: HP 10 -> 5". Filter by person, by thing (a document uuid) and by AI or human. Read-only. Each change has an id; undo it with plan-undo-changes (anyone\'s change) or, for an AI change, undo-change.',
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
      {
        name: 'plan-undo-changes',
        description:
          'Plan undoing one change from list-changes (by anyone: a player, the GM or the AI), or everything since it on the same thing. Scope just-this (default) keeps what changed after it and lists those later changes; everything-since also undoes later changes to the same thing; world-since rewinds the whole table and needs rewindTable. Apply with apply-planned-change; undoing that change again is the redo.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The change to undo: its id from list-changes.',
              ...freeText('A change id from list-changes'),
            },
            scope: {
              type: 'string',
              enum: [...UNDO_SCOPES],
              description: 'just-this (default), everything-since or world-since.',
              default: 'just-this',
            },
            rewindTable: {
              type: 'boolean',
              description: 'Must be true for world-since: rewind everything at the table.',
            },
          },
          required: ['id'],
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

  async handlePlanUndoChanges(args: unknown): Promise<UndoPlanView> {
    const params = z
      .object({
        id: z.string().trim().min(1).max(200),
        scope: z.enum(UNDO_SCOPES).optional(),
        rewindTable: z.boolean().optional(),
      })
      .parse(args ?? {});
    this.logger.debug('Planning an undo', params);
    return this.undoPlanner.plan({
      id: params.id,
      scope: params.scope ?? 'just-this',
      ...(params.rewindTable !== undefined ? { rewindTable: params.rewindTable } : {}),
    });
  }
}
