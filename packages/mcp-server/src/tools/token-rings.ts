import { z } from 'zod';
import {
  TOKEN_RINGS_ACTIONS,
  TOKEN_RINGS_ACTOR_TYPES,
  TOKEN_RINGS_FEATURE_ID,
  TOKEN_RINGS_TARGETS,
  freeText,
  unwrapBridgeReply,
  featureSwitchOff,
  type TokenRingsPlanRequest,
  type TokenRingsPlanResult,
} from '@gnuminator/shared';
import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';

export interface TokenRingsToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const planParams = z.object({
  action: z.enum(TOKEN_RINGS_ACTIONS),
  tokens: z.enum(TOKEN_RINGS_TARGETS).optional(),
  scenes: z.array(z.string().min(1)).max(100).optional(),
  actorType: z.enum(TOKEN_RINGS_ACTOR_TYPES).optional(),
  names: z.array(z.string().min(1)).max(100).optional(),
});

const SWITCH_OFF = featureSwitchOff('Token rings', 'AI Tool: Token rings (writes)');

/**
 * Dynamic token rings by default (I-093). `plan-token-rings` plans turning the dynamic token ring
 * on (or off) on the prototype tokens of the world's actors as one guarded change of up to 150
 * actors; the plan result says how many are left for a next plan. Apply it with
 * apply-planned-change, revert it with undo-change.
 */
export class TokenRingsTools {
  private readonly foundryClient: Pick<FoundryClient, 'query'>;
  private readonly guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  private readonly logger: Logger;

  constructor(options: TokenRingsToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.guardedWrites = options.guardedWrites;
    this.logger = options.logger.child({ component: 'TokenRingsTools' });
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'plan-token-rings',
        description:
          "Plan turning the dynamic token ring on or off on the actors' default tokens (round tokens; dnd5e flashes the ring on damage). Up to 150 actors or tokens per plan: when some remain, apply and ask again. Undo is all-or-nothing (it reverts every actor of the plan or none), and disable is not the exact inverse of an enable (it turns every ring in scope off, also rings that were on before). With tokens placed, plan the tokens already on scenes instead (each token, linked or not, on every scene or only the named scenes): try it on a copy first. Apply with apply-planned-change, revert with undo-change.",
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: [...TOKEN_RINGS_ACTIONS] },
            tokens: {
              type: 'string',
              enum: [...TOKEN_RINGS_TARGETS],
              description:
                'actors (default): the default token of each actor. placed: the tokens already placed on scenes.',
            },
            scenes: {
              type: 'array',
              items: { type: 'string' },
              description: 'With tokens placed: only these scenes; default all scenes.',
              ...freeText('Several scene names matched by the module; a picker holds one value'),
            },
            actorType: {
              type: 'string',
              enum: [...TOKEN_RINGS_ACTOR_TYPES],
              description: 'Which actors; default all (characters and NPCs).',
            },
            names: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only actors with these names.',
              ...freeText('Several actor names matched by the module; a picker holds one value'),
            },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<PlanView & TokenRingsPlanResult> {
    try {
      if (name !== 'plan-token-rings') throw new Error(`Unknown token rings tool: ${name}`);
      return await this.planTokenRings(args);
    } catch (error) {
      this.logger.error(`Error in token rings tool ${name}:`, error);
      throw error;
    }
  }

  private async planTokenRings(args: unknown): Promise<PlanView & TokenRingsPlanResult> {
    const params = planParams.parse(args ?? {});
    const features = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    if (!features.find(f => f.id === TOKEN_RINGS_FEATURE_ID)?.enabled) {
      throw new Error(SWITCH_OFF);
    }
    if (params.scenes?.length && params.tokens !== 'placed') {
      throw new Error('scenes only applies with tokens "placed".');
    }
    const request = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined)
    ) as unknown as TokenRingsPlanRequest;
    const built = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.planTokenRings', request),
      'Could not plan the token rings'
    );
    if (params.tokens === 'placed' && built.unmatched === undefined) {
      throw new Error(
        'This Foundry module is too old to plan placed tokens: update the module, then ask again.'
      );
    }
    const plan = await this.guardedWrites.createPlan({
      feature: TOKEN_RINGS_FEATURE_ID,
      summary: built.summary,
      ops: built.ops,
    });
    return {
      ...plan,
      count: built.count,
      remaining: built.remaining,
      alreadyDone: built.alreadyDone,
      unmatched: built.unmatched ?? [],
      autoApply: false,
    };
  }
}
