import {
  AT_THE_TABLE,
  LIVE_ACTOR_ACTIONS,
  LIVE_PLAN_QUERY,
  LIVE_PLAY_FEATURE_ID,
  toolRef,
  type LiveActorPlanResult,
  type LiveActorRequest,
  type LiveChangePlan,
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

export interface LivePlayToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan' | 'autoApplyEnabled'>;
  logger: Logger;
}

/** Fixed resource values resolved before item names: spell slots, pact, class resources. */
const RESOURCE_CHOICES = [
  ...Array.from({ length: 9 }, (_, i) => ({
    value: `spell${i + 1}`,
    label: `Spell slots, level ${i + 1}`,
  })),
  { value: 'pact', label: 'Pact magic slots' },
  { value: 'primary', label: 'Class resource: primary' },
  { value: 'secondary', label: 'Class resource: secondary' },
  { value: 'tertiary', label: 'Class resource: tertiary' },
];

const planParams = z.object({
  action: z.enum(LIVE_ACTOR_ACTIONS),
  targets: z.array(z.string().min(1)).min(1),
  amount: z.number().int().min(0).optional(),
  damageType: z.string().min(1).optional(),
  multiplier: z.number().positive().optional(),
  ignoreResistance: z.boolean().optional(),
  condition: z.string().min(1).optional(),
  active: z.boolean().optional(),
  level: z.number().int().min(0).optional(),
  conditions: z.array(z.string().min(1)).optional(),
  resource: z.string().min(1).optional(),
  value: z.number().int().min(0).optional(),
});

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

/**
 * Live play with undo (F5, D-082): `plan-actor-change` plans damage, healing,
 * temporary hit points, conditions and resources as one guarded change
 * (feature "live-play", on by default). The module builds the ops in Foundry
 * (`planLiveChange`, a dnd5e dry run for damage), the bridge stores the plan,
 * `apply-planned-change` applies it and `undo-change` reverts it. With the GM's
 * "apply without confirming" switch on, the result says `autoApply: true` and
 * the caller applies it at once. Replaces apply-damage-and-healing,
 * toggle-token-condition, update-character-resource and clear-stale-conditions.
 */
export class LivePlayTools {
  private readonly options: LivePlayToolsOptions;
  private readonly logger: Logger;

  constructor(options: LivePlayToolsOptions) {
    this.options = options;
    this.logger = options.logger.child({ component: 'LivePlayTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'plan-actor-change',
        description:
          'Plan damage, healing, temp HP, a condition or a resource change for one or more tokens or actors; apply it with apply-planned-change, revert it with undo-change. dnd5e works out resistances, vulnerabilities, immunities and temp HP; the result previews each target ("Wolf 2: 12 fire damage, 6 taken, HP 11 to 5"). If the result says autoApply: true, the GM chose to skip confirming: apply it at once. If the GM\'s request says "go ahead", apply it in the same turn. D&D 5e only.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [...LIVE_ACTOR_ACTIONS],
              description:
                'damage, healing, temp-hp, condition (on or off), resource (set a value) or clear-conditions.',
            },
            targets: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Token names on the current scene (preferred: unlinked NPC tokens have their own HP) or actor names.',
              ...toolRef(['token', 'actor'], 'name', { filter: AT_THE_TABLE }),
            },
            amount: { type: 'integer', description: 'damage, healing, temp-hp: the amount.' },
            damageType: {
              type: 'string',
              description:
                'damage: acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing or thunder. Omit for untyped.',
            },
            multiplier: { type: 'number', description: 'damage: 2 for a critical, 0.5 for half.' },
            ignoreResistance: {
              type: 'boolean',
              description: "damage: ignore the target's resistances and immunities.",
            },
            condition: {
              type: 'string',
              description: 'condition: the id or name (prone, poisoned, exhaustion...).',
              ...toolRef('condition', 'id'),
            },
            active: {
              type: 'boolean',
              description: 'condition: false removes it.',
              default: true,
            },
            level: { type: 'integer', description: 'condition exhaustion: the level to set.' },
            conditions: {
              type: 'array',
              items: { type: 'string' },
              description: 'clear-conditions: names to remove; omit to remove expired effects.',
              ...toolRef('condition', 'id'),
            },
            resource: {
              type: 'string',
              description:
                'resource: "spell3", "pact", a class resource (Ki Points, primary) or an item name.',
              ...toolRef('actor-item', 'name', { parent: 'targets', extra: RESOURCE_CHOICES }),
            },
            value: { type: 'integer', description: 'resource: the new current value (0 to max).' },
          },
          required: ['action', 'targets'],
        },
      },
    ];
  }

  async handlePlanActorChange(args: unknown): Promise<PlanView & LiveActorPlanResult> {
    const params = planParams.parse(args ?? {});
    const request = { scope: 'actor', ...stripUndefined(params) } as LiveActorRequest;
    try {
      const built = unwrap<LiveChangePlan>(
        await this.options.foundryClient.query(`foundry-mcp-bridge.${LIVE_PLAN_QUERY}`, request),
        'Could not plan the change'
      );
      const plan = await this.options.guardedWrites.createPlan({
        feature: LIVE_PLAY_FEATURE_ID,
        summary: built.summary,
        ops: built.ops,
      });
      const autoApply =
        plan.risk === 'write' && (await this.options.guardedWrites.autoApplyEnabled(plan.feature));
      return { ...plan, targets: built.targets, autoApply };
    } catch (error) {
      this.logger.warn('Live play plan not created', {
        action: params.action,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

/** Drop absent optional keys (JSON has no `undefined`). */
function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
