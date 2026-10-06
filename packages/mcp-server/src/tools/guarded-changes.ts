import { toolRef } from '@gnuminator/shared';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type {
  AppliedChange,
  GuardedWriteService,
  PlanView,
  RecentChange,
} from '../guarded-write/service.js';
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

interface GuardedChangeToolsOptions {
  guardedWrites: Pick<
    GuardedWriteService,
    'getPlan' | 'listPlans' | 'applyPlan' | 'undo' | 'listRecentChanges'
  >;
  foundryClient: Pick<FoundryClient, 'query'>;
  logger: Logger;
}

/**
 * Guarded-write tools (plan step 0.2): the one generic way new features change
 * game state. Features add read-only `plan-*` tools that return a `planId`;
 * these tools show a plan, apply it after explicit confirmation, list what was
 * applied, and undo it. `open-in-foundry` opens a linked document on the GM's
 * own Foundry screen (secrets stay in the vault; links still work).
 */
export class GuardedChangeTools {
  private readonly guardedWrites: GuardedChangeToolsOptions['guardedWrites'];
  private readonly foundryClient: GuardedChangeToolsOptions['foundryClient'];
  private readonly logger: Logger;

  constructor(options: GuardedChangeToolsOptions) {
    this.guardedWrites = options.guardedWrites;
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'GuardedChangeTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get-planned-change',
        description:
          'Show a pending planned change (from a plan-* tool): what it will change as a readable diff, its risk ("write" or "destructive") and when it expires (15 minutes). Without planId, lists all pending plans. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            planId: {
              type: 'string',
              description: 'The planId returned by a plan-* tool.',
              ...toolRef('plan', 'id'),
            },
          },
        },
      },
      {
        name: 'apply-planned-change',
        description:
          'Apply a pending planned change after the GM has seen its diff and agreed. Requires confirm: true, plus confirmDestructive: true when the plan risk is "destructive" (it deletes something). Fails without writing anything if the affected documents changed since the plan was made, if "Allow Write Operations" or the feature is switched off in the module settings. The change is recorded and can be undone with undo-change. When the plan also pops a page up on the players\' screens (showNow), the result has shown: { ok: true } or { ok: false, error }, and undo does not take the popup back.',
        inputSchema: {
          type: 'object',
          properties: {
            planId: {
              type: 'string',
              description: 'The planId to apply.',
              ...toolRef('plan', 'id'),
            },
            confirm: {
              type: 'boolean',
              description: 'Must be true: the GM confirmed this change.',
            },
            confirmDestructive: {
              type: 'boolean',
              description: 'Must be true for a destructive plan: the GM confirmed the deletion.',
            },
          },
          required: ['planId', 'confirm'],
        },
      },
      {
        name: 'list-recent-changes',
        description:
          'List recently applied guarded changes for the current world (newest first): summary, diff, when, and whether each can still be undone. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Maximum number of changes to return (default 20, max 500).',
              default: 20,
            },
          },
        },
      },
      {
        name: 'undo-change',
        description:
          'Undo an applied change (by changeId from list-recent-changes), restoring the previous values. Requires confirm: true. Refuses instead of overwriting if the documents were edited since the change.',
        inputSchema: {
          type: 'object',
          properties: {
            changeId: {
              type: 'string',
              description: 'The changeId to undo.',
              ...toolRef('change', 'id', { filter: { undoable: true } }),
            },
            confirm: {
              type: 'boolean',
              description: 'Must be true: the GM confirmed the undo.',
            },
          },
          required: ['changeId', 'confirm'],
        },
      },
      {
        name: 'open-in-foundry',
        description:
          "Open a document (journal page, scene, actor, item) on a GM's Foundry screen, by uuid. Only the GM sees it; nothing is changed. Opening on another GM's client needs Foundry 14.352 or newer.",
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Document uuid, e.g. JournalEntry.abc.JournalEntryPage.def',
              ...toolRef('document', 'uuid'),
            },
            userId: {
              type: 'string',
              description: "The GM user whose screen to use (default: the bridge's own client).",
              ...toolRef('user', 'id', { filter: { role: 'gm' } }),
            },
          },
          required: ['uuid'],
        },
      },
    ];
  }

  handleGetPlannedChange(args: unknown): Promise<PlanView | { plans: PlanView[] }> {
    const { planId } = z.object({ planId: z.string().min(1).optional() }).parse(args ?? {});
    if (planId) return Promise.resolve(this.guardedWrites.getPlan(planId));
    return Promise.resolve({ plans: this.guardedWrites.listPlans() });
  }

  /** `requestedBy`: who asked, when it was not Claude (a GM's window in Foundry). */
  async handleApplyPlannedChange(args: unknown, requestedBy?: string): Promise<AppliedChange> {
    const params = z
      .object({
        planId: z.string().min(1),
        confirm: z.boolean().optional(),
        confirmDestructive: z.boolean().optional(),
      })
      .parse(args ?? {});
    try {
      return await this.guardedWrites.applyPlan(
        params.planId,
        {
          ...(params.confirm !== undefined ? { confirm: params.confirm } : {}),
          ...(params.confirmDestructive !== undefined
            ? { confirmDestructive: params.confirmDestructive }
            : {}),
        },
        requestedBy
      );
    } catch (error) {
      this.logger.warn('Planned change not applied', {
        planId: params.planId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async handleListRecentChanges(args: unknown): Promise<{ changes: RecentChange[] }> {
    const { limit } = z
      .object({ limit: z.number().int().min(1).max(500).optional() })
      .parse(args ?? {});
    return { changes: await this.guardedWrites.listRecentChanges(limit ?? 20) };
  }

  /** `requestedBy`: who asked, when it was not Claude (a GM's "AI changes" window in Foundry). */
  async handleUndoChange(args: unknown, requestedBy?: string): Promise<AppliedChange> {
    const params = z
      .object({ changeId: z.string().min(1), confirm: z.boolean().optional() })
      .parse(args ?? {});
    try {
      return await this.guardedWrites.undo(
        params.changeId,
        params.confirm !== undefined ? { confirm: params.confirm } : {},
        requestedBy
      );
    } catch (error) {
      this.logger.warn('Change not undone', {
        changeId: params.changeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async handleOpenInFoundry(args: unknown): Promise<unknown> {
    const params = z
      .object({ uuid: z.string().min(1).max(500), userId: z.string().min(1).optional() })
      .parse(args ?? {});
    const response = (await this.foundryClient.query(
      'foundry-mcp-bridge.openDocumentForGm',
      params
    )) as { success?: boolean; error?: string } | undefined;
    if (response?.success === false) {
      throw new Error(response.error ? response.error : 'Failed to open the document in Foundry');
    }
    return response;
  }
}
