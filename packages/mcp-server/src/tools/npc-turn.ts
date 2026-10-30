import { z } from 'zod';
import {
  freeText,
  NPC_TURN_FEATURE_ID,
  NPC_TURN_QUERY,
  toolRef,
  unwrapBridgeReply,
  type NpcTurnContext,
  type NpcTurnPlan,
  type NpcTurnRequest,
} from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import { Logger } from '../logger.js';

export interface NpcTurnToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const planParams = z.object({
  token: z.string().min(1).optional(),
  moveTo: z.object({ gridX: z.number().int().min(0), gridY: z.number().int().min(0) }).optional(),
  itemName: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  attacks: z
    .array(
      z.object({
        itemName: z.string().min(1),
        target: z.string().min(1),
        activity: z.string().min(1).optional(),
      })
    )
    .max(10)
    .optional(),
  results: z
    .array(
      z.object({
        target: z.string().min(1),
        amount: z.number().min(0).max(10000),
        damageType: z.string().min(1).max(40).optional(),
        multiplier: z.number().min(0).max(1).optional(),
      })
    )
    .min(1)
    .max(20)
    .optional(),
  dash: z.boolean().optional(),
  reason: z.string().min(1).max(300).optional(),
});

/** What `plan-npc-turn` returns: the context, the steps, and a plan when a move was asked for. */
export interface NpcTurnResult {
  context: NpcTurnContext;
  steps: string[];
  attack: NpcTurnPlan['attack'];
  attacks: NpcTurnPlan['attacks'];
  /** The squares walked, start first; set with a move. */
  path?: NpcTurnPlan['path'];
  /** What the move costs in the scene's units. */
  moveCost?: number;
  /** The guarded plan of the move; absent when no move was asked for (context only). */
  plan?: PlanView;
  autoApply: false;
}

/**
 * NPC turn assistant (I-125). `plan-npc-turn` reads the running combat and the NPC whose turn it
 * is (speed, attacks, Multiattack text, targets with distance, AC, state and a score). With
 * `moveTo` it finds the way (walls, doors, difficult terrain) and plans the move as one guarded
 * change (feature `npc-turn`, off by default); apply it with apply-planned-change and revert it
 * with undo-change. The attacks stay with use-npc-activity and plan-actor-change.
 */
export class NpcTurnTools {
  constructor(private readonly options: NpcTurnToolsOptions) {
    this.options = { ...options, logger: options.logger.child({ component: 'NpcTurnTools' }) };
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'plan-npc-turn',
        description:
          "Plan a monster's turn. Without moveTo it only reads the fight: speed, attacks, Multiattack text, and each enemy's distance, AC, HP, state and score. With moveTo (a grid square) it paths round walls, doors and creatures, counts difficult terrain and plans the move (apply-planned-change, undo-change). List a multiattack in attacks (activity for a save action; legendary actions only on another creature's turn). Roll first with the tools the steps name, then call again with moveTo and results: one plan holds the move and all damage. Needs the \"NPC turn assistant\" switch (off by default).",
        inputSchema: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'NPC token. Default: whose turn it is.',
              ...toolRef('token', 'name'),
            },
            moveTo: {
              type: 'object',
              description: 'Move the NPC to this grid square (its top-left square).',
              properties: {
                gridX: { type: 'integer', minimum: 0 },
                gridY: { type: 'integer', minimum: 0 },
              },
              required: ['gridX', 'gridY'],
            },
            itemName: {
              type: 'string',
              description: 'Attack or action to use.',
              ...freeText('An item name on the NPC, checked by the module'),
            },
            target: {
              type: 'string',
              description: 'Token to attack.',
              ...toolRef('token', 'name'),
            },
            attacks: {
              type: 'array',
              description: 'A multiattack, in order.',
              maxItems: 10,
              items: {
                type: 'object',
                properties: {
                  itemName: { type: 'string', ...freeText('An item name on the NPC') },
                  target: { type: 'string', ...toolRef('token', 'name') },
                  activity: {
                    type: 'string',
                    description: 'Activity of the item.',
                    ...freeText('An activity name'),
                  },
                },
                required: ['itemName', 'target'],
              },
            },
            results: {
              type: 'array',
              description: 'Per damageByType entry. multiplier 0.5 = half on a made save.',
              minItems: 1,
              maxItems: 20,
              items: {
                type: 'object',
                properties: {
                  target: { type: 'string', ...toolRef('token', 'name') },
                  amount: {
                    type: 'number',
                    minimum: 0,
                    description: 'The damage the roll reported.',
                  },
                  damageType: {
                    type: 'string',
                    ...freeText('A dnd5e damage type'),
                  },
                  multiplier: { type: 'number', minimum: 0, maximum: 1 },
                },
                required: ['target', 'amount'],
              },
            },
            dash: {
              type: 'boolean',
              description:
                'Dash: twice the speed; no attacks unless reason names a bonus-action Dash.',
            },
            reason: {
              type: 'string',
              description: 'Why (shown in the plan).',
            },
          },
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<NpcTurnResult> {
    if (name !== 'plan-npc-turn') throw new Error(`Unknown NPC turn tool: ${name}`);
    try {
      return await this.planNpcTurn(args);
    } catch (error) {
      this.options.logger.warn('NPC turn plan not created', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async planNpcTurn(args: unknown): Promise<NpcTurnResult> {
    const params = planParams.parse(args ?? {});
    const { foundryClient, guardedWrites } = this.options;

    // Fail early and plainly while the switch is off (the module would refuse the apply anyway).
    const features = unwrapBridgeReply(
      await foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    const feature = features.find(f => f.id === NPC_TURN_FEATURE_ID);
    if (!feature?.enabled) {
      throw new Error(
        'The NPC turn assistant is switched off. In Foundry, open the Settings tab, Game Settings, Foundry AI Tool and turn on "AI Tool: NPC turn assistant (writes)".'
      );
    }

    const built = unwrapBridgeReply(
      await foundryClient.query(`foundry-mcp-bridge.${NPC_TURN_QUERY}`, {
        ...params,
      } as NpcTurnRequest),
      'Could not plan the NPC turn'
    );
    // An older module ignores `attacks` and `dash` and answers without `attacks`.
    if ((params.attacks?.length || params.dash) && built.attacks === undefined) {
      throw new Error(
        'The Foundry module is older than this server and does not check attacks or a Dash: update the module and reload Foundry.'
      );
    }
    // An older module ignores `results` and `activity` and answers without the activity list.
    const usesPartThree =
      params.results !== undefined || params.attacks?.some(a => a.activity !== undefined);
    if (usesPartThree && built.context.ownTurn === undefined) {
      throw new Error(
        'The Foundry module is older than this server and does not plan damage results, activities or legendary actions: update the module and reload Foundry.'
      );
    }
    const result = {
      context: built.context,
      steps: built.steps,
      attack: built.attack,
      attacks: built.attacks ?? (built.attack ? [built.attack] : []),
      ...(built.path ? { path: built.path } : {}),
      ...(built.moveCost !== undefined ? { moveCost: built.moveCost } : {}),
      autoApply: false as const,
    };
    if (!built.ops || built.ops.length === 0 || !built.summary) return result;
    const plan = await guardedWrites.createPlan({
      feature: NPC_TURN_FEATURE_ID,
      summary: built.summary,
      ops: built.ops,
    });
    return { ...result, plan };
  }
}
