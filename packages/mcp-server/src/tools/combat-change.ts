import {
  COMBAT_CHANGE_ACTIONS,
  COMBAT_PLAN_QUERY,
  LIVE_PLAY_FEATURE_ID,
  freeText,
  toolRef,
  type CombatChangePlan,
  type CombatChangePlanResult,
  type CombatChangeRequest,
} from '@gnuminator/shared';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
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

export interface CombatChangeToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan' | 'autoApplyEnabled'>;
  logger: Logger;
}

const planParams = z.object({
  action: z.enum(COMBAT_CHANGE_ACTIONS),
  combatId: z.string().optional(),
  tokenIds: z.array(z.string()).optional(),
  sceneId: z.string().optional(),
});

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

/**
 * Starting and ending a fight with undo (David's GM test): `plan-combat-change` plans ending the
 * active combat as one guarded change (feature "live-play", the switch damage and conditions
 * use). The module builds the ops in Foundry (`planCombatChange`), the bridge stores the plan,
 * `apply-planned-change` applies it and `undo-change` brings the fight back, so each change shows
 * in Recent Changes. Ending deletes the Combat, so the plan is destructive: it needs the
 * destructive confirm and never auto-applies.
 *
 * `advance-combat-turn` and the initiative tools stay direct.
 */
export class CombatChangeTools {
  private readonly options: CombatChangeToolsOptions;
  private readonly logger: Logger;

  constructor(options: CombatChangeToolsOptions) {
    this.options = options;
    this.logger = options.logger.child({ component: 'CombatChangeTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'plan-combat-change',
        description:
          'Plan starting or ending a fight. "start" puts tokens of the viewed scene in a new combat (default: player characters and Hostile tokens; already at round 1, no initiative rolled, so roll it next). "end" removes the active combat (else the latest encounter, as get-combat-state shows it). Apply with apply-planned-change, revert with undo-change; ending is destructive, so the GM confirms. Shows in Recent Changes. Undo of an end does not restore effects that end with combat or token movement history (the result carries a warning).',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [...COMBAT_CHANGE_ACTIONS],
              description: 'start: new combat. end: close the active combat.',
            },
            tokenIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'start: the tokens to fight. Omit for player characters and Hostiles.',
              ...toolRef('token', 'id'),
            },
            sceneId: {
              type: 'string',
              description: 'start: scene (default: the viewed one).',
              ...freeText('A scene id; omit for the viewed scene.'),
            },
            combatId: {
              type: 'string',
              description: 'end: the combat to close. Omit for the active one.',
              ...freeText('A Foundry combat id; omit for the active fight.'),
            },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handlePlanCombatChange(args: unknown): Promise<PlanView & CombatChangePlanResult> {
    const params = planParams.parse(args ?? {});
    const request = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined)
    ) as unknown as CombatChangeRequest;
    try {
      const built = unwrap<CombatChangePlan>(
        await this.options.foundryClient.query(`foundry-mcp-bridge.${COMBAT_PLAN_QUERY}`, request),
        'Could not plan the change'
      );
      const plan = await this.options.guardedWrites.createPlan({
        feature: LIVE_PLAY_FEATURE_ID,
        summary: built.summary,
        ops: built.ops,
      });
      const autoApply =
        plan.risk === 'write' && (await this.options.guardedWrites.autoApplyEnabled(plan.feature));
      return {
        ...plan,
        ...(built.combatId ? { combatId: built.combatId } : {}),
        ...(built.combatants ? { combatants: built.combatants } : {}),
        ...(built.skipped ? { skipped: built.skipped } : {}),
        ...(built.warning ? { warning: built.warning } : {}),
        autoApply,
      };
    } catch (error) {
      this.logger.warn('Combat plan not created', {
        action: params.action,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
