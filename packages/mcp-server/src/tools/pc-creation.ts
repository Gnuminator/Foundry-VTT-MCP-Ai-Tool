import { z } from 'zod';
import {
  PC_CREATION_FEATURE_ID,
  PC_CREATION_QUERY,
  freeText,
  unwrapBridgeReply,
  featureSwitchOff,
  type PcCreationPlan,
  type PcCreationRequest,
} from '@gnuminator/shared';
import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';

export interface PcCreationToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const planParams = z.object({
  name: z.string().min(1).max(200),
  owner: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        uuid: z.string().min(1),
        equipped: z.boolean().optional(),
        prepared: z.boolean().optional(),
        quantity: z.number().int().min(1).max(9999).optional(),
      })
    )
    .max(200)
    .optional(),
});

/** What `plan-pc-creation` returns beside the guarded plan. */
export interface PcCreationPlanResult extends PlanView {
  actor: PcCreationPlan['actor'];
  items: PcCreationPlan['items'];
  warnings: string[];
  autoApply: false;
}

/**
 * Player-character creation (pc-creation-tool). `plan-pc-creation` plans one character-type actor
 * with items copied from compendium packs as a guarded change (feature `pc-creation`). Apply it
 * with apply-planned-change, undo it with undo-change (deletes the actor).
 */
export class PcCreationTools {
  private readonly foundryClient: Pick<FoundryClient, 'query'>;
  private readonly guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  private readonly logger: Logger;

  constructor(options: PcCreationToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.guardedWrites = options.guardedWrites;
    this.logger = options.logger.child({ component: 'PcCreationTools' });
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'plan-pc-creation',
        description:
          'Plan a new player character: a character actor with items copied from compendium packs by uuid (a container brings its contents). Advancement does not run: add class features by uuid. Apply with apply-planned-change, undo with undo-change.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', ...freeText('The new character name') },
            owner: { type: 'string', description: 'Player user name or id.' },
            items: {
              type: 'array',
              description: 'Up to 200.',
              items: {
                type: 'object',
                properties: {
                  uuid: { type: 'string', ...freeText('Compendium.<pack>.Item.<id>') },
                  equipped: { type: 'boolean' },
                  prepared: { type: 'boolean' },
                  quantity: { type: 'integer' },
                },
                required: ['uuid'],
              },
            },
          },
          required: ['name'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<PcCreationPlanResult> {
    try {
      if (name !== 'plan-pc-creation') throw new Error(`Unknown character tool: ${name}`);
      return await this.planPc(args);
    } catch (error) {
      this.logger.error(`Error in character tool ${name}:`, error);
      throw error;
    }
  }

  private async planPc(args: unknown): Promise<PcCreationPlanResult> {
    const params = planParams.parse(args ?? {}) as PcCreationRequest;

    // Fail early and plainly while the switch is off (the module would refuse the apply anyway).
    const features = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    const feature = features.find(f => f.id === PC_CREATION_FEATURE_ID);
    if (!feature?.enabled) {
      throw new Error(
        featureSwitchOff('Character creation', 'AI Tool: Character creation (writes)')
      );
    }

    const built: PcCreationPlan = unwrapBridgeReply(
      await this.foundryClient.query(`foundry-mcp-bridge.${PC_CREATION_QUERY}`, params),
      'Could not plan the character'
    );
    const plan = await this.guardedWrites.createPlan({
      feature: PC_CREATION_FEATURE_ID,
      summary: built.summary,
      ops: built.ops,
    });
    return {
      ...plan,
      actor: built.actor,
      items: built.items,
      warnings: built.warnings,
      autoApply: false,
    };
  }
}
