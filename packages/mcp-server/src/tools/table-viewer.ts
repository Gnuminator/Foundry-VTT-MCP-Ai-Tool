import { z } from 'zod';
import {
  freeText,
  TABLE_VIEWER_DEFAULT_NAME,
  TABLE_VIEWER_FEATURE_ID,
  TABLE_VIEWER_ROLE,
  type GuardedOp,
} from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import { Logger } from '../logger.js';

export interface TableViewerToolsOptions {
  foundryClient: FoundryClient;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const planParams = z.object({
  name: z.string().trim().min(1).max(40).optional(),
});

/**
 * `plan-table-viewer` (tv-login, G1): plans a Player-role Foundry user for the TV at the table,
 * with no password and no characters, as a guarded change (feature "table-viewer", on by default).
 * Applied with apply-planned-change, reverted with undo-change (which deletes the user again).
 * The user is only a Foundry login: the TV browser signs in as it once (docs/gm/tv-table-viewer.md)
 * and sees what any player without a character sees. Refuses when a user of that name exists.
 */
export class TableViewerTools {
  private foundryClient: FoundryClient;
  private guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  private logger: Logger;

  constructor({ foundryClient, guardedWrites, logger }: TableViewerToolsOptions) {
    this.foundryClient = foundryClient;
    this.guardedWrites = guardedWrites;
    this.logger = logger.child({ component: 'TableViewerTools' });
  }

  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: object }> {
    return [
      {
        name: 'plan-table-viewer',
        description: `Plan a Foundry user for the TV at the table (default name "${TABLE_VIEWER_DEFAULT_NAME}"): Player role, no password, owns nothing. Apply it with apply-planned-change, revert it with undo-change. The TV signs in as this user once (see the TV table viewer guide). Refuses if a user with that name already exists.`,
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              ...freeText('The name for the new Table user, not an existing document'),
              description: `The user's name on Foundry's join page. Default "${TABLE_VIEWER_DEFAULT_NAME}".`,
            },
          },
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<PlanView & { autoApply: false }> {
    if (name !== 'plan-table-viewer') throw new Error(`Unknown table viewer tool: ${name}`);
    try {
      return await this.planTableViewer(args);
    } catch (error) {
      this.logger.error(`Error in table viewer tool ${name}:`, error);
      throw error;
    }
  }

  private async planTableViewer(args: unknown): Promise<PlanView & { autoApply: false }> {
    const params = planParams.parse(args ?? {});
    const name = params.name ?? TABLE_VIEWER_DEFAULT_NAME;

    // Exact name match among non-GM users (findPlayers skips GMs; a GM user cannot be the Table).
    const existing = (await this.foundryClient.query('foundry-mcp-bridge.findPlayers', {
      identifier: name,
      allowPartialMatch: false,
      includeCharacterOwners: false,
    })) as Array<{ id: string; name: string }> | undefined;
    if (existing && existing.length > 0) {
      throw new Error(
        `A user named "${existing[0]?.name ?? name}" already exists; nothing to create. Use it as is, or pick another name.`
      );
    }

    const ops: GuardedOp[] = [
      { kind: 'create', documentName: 'User', data: { name, role: TABLE_VIEWER_ROLE } },
    ];
    const plan = await this.guardedWrites.createPlan({
      feature: TABLE_VIEWER_FEATURE_ID,
      summary: `Create the "${name}" user for the TV (Player role, no password, owns nothing)`,
      ops,
    });
    return { ...plan, autoApply: false };
  }
}
