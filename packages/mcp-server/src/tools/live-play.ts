import {
  AT_THE_TABLE,
  LIVE_ACTOR_ACTIONS,
  LIVE_PLAN_QUERY,
  LIVE_PLAY_FEATURE_ID,
  LIVE_TOKEN_ACTIONS,
  LIVE_TOKEN_FIELDS,
  freeText,
  toolRef,
  type LiveActorPlanResult,
  type LiveActorRequest,
  type LiveChangePlan,
  type LiveTokenField,
  type LiveTokenRequest,
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

const tokenParams = z.object({
  action: z.enum(LIVE_TOKEN_ACTIONS),
  tokens: z.array(z.string().min(1)).min(1),
  x: z.number().optional(),
  y: z.number().optional(),
  gridX: z.number().int().optional(),
  gridY: z.number().int().optional(),
  dx: z.number().int().optional(),
  dy: z.number().int().optional(),
  name: z.string().min(1).optional(),
  hidden: z.boolean().optional(),
  disposition: z.number().int().optional(),
  elevation: z.number().optional(),
  rotation: z.number().optional(),
  lockRotation: z.boolean().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  sightEnabled: z.boolean().optional(),
  sightRange: z.number().min(0).optional(),
  visionMode: z.string().min(1).optional(),
  lightDim: z.number().min(0).optional(),
  lightBright: z.number().min(0).optional(),
  lightColor: z.string().optional(),
  lightAnimation: z.string().optional(),
});

/** The update fields, as tool parameters (one per entry of LIVE_TOKEN_FIELDS). */
const TOKEN_FIELD_SCHEMA: Record<LiveTokenField, Record<string, unknown>> = {
  name: {
    type: 'string',
    description: 'update: the token name.',
    ...freeText('The new token name, typed by the GM'),
  },
  hidden: { type: 'boolean', description: 'update: hidden from players.' },
  disposition: {
    type: 'integer',
    enum: [-2, -1, 0, 1],
    description: 'update: -2 secret, -1 hostile, 0 neutral, 1 friendly.',
  },
  elevation: { type: 'number', description: 'update: elevation in scene units (ft).' },
  rotation: { type: 'number', description: 'update: rotation in degrees.' },
  lockRotation: { type: 'boolean', description: 'update: lock the rotation.' },
  width: { type: 'number', description: 'update: width in grid squares.' },
  height: { type: 'number', description: 'update: height in grid squares.' },
  sightEnabled: { type: 'boolean', description: 'update: the token has vision.' },
  sightRange: { type: 'number', description: 'update: vision range (ft).' },
  visionMode: { type: 'string', description: 'update: basic, darkvision...' },
  lightDim: { type: 'number', description: 'update: dim light radius (ft); a torch is 40.' },
  lightBright: { type: 'number', description: 'update: bright light radius (ft); a torch is 20.' },
  lightColor: { type: 'string', description: 'update: light color, "#ff9329".' },
  lightAnimation: { type: 'string', description: 'update: torch, pulse, flame...' },
};

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
 *
 * `plan-token-change` (F5 L2) does the same for token moves, a fixed list of
 * token fields (vision and light included) and deletes (the token's
 * combatants first, so undo restores their initiative). Replaces move-token,
 * update-token, set-token-vision-light and delete-tokens. Token plans never
 * auto-apply (D-083 keeps the confirm for tokens); a delete is destructive.
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
          'Plan damage, healing, temp HP, a condition or a resource change for one or more tokens or actors; apply it with apply-planned-change, revert it with undo-change. dnd5e works out resistances, vulnerabilities, immunities and temp HP; the result previews each target ("Wolf 2: 12 fire damage, 6 taken, HP 11 to 5"). If the result says autoApply: true, the GM chose to skip confirming: apply it at once. If the GM\'s request says "go ahead", apply it in the same turn. D&D 5e only. It does not level up characters: a level-up happens on the character sheet in Foundry, so say that.',
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
      {
        name: 'plan-token-change',
        description:
          'Plan moving, changing or deleting tokens on the current scene; apply it with apply-planned-change, revert it with undo-change. "move": one token to gridX/gridY (a square) or x/y (pixels), or any tokens by dx/dy squares. "update": set the listed fields (vision and light too). "delete": removes the tokens and their place in the encounter (destructive; undo restores both). If the request says "go ahead", apply it in the same turn (a delete still needs the destructive confirm).',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [...LIVE_TOKEN_ACTIONS],
              description: 'move, update or delete.',
            },
            tokens: {
              type: 'array',
              items: { type: 'string' },
              description: 'Token names or ids on the current scene.',
              ...toolRef('token', 'name'),
            },
            gridX: { type: 'integer', description: 'move: grid column.' },
            gridY: { type: 'integer', description: 'move: grid row.' },
            x: { type: 'number', description: 'move: pixels from the left.' },
            y: { type: 'number', description: 'move: pixels from the top.' },
            dx: { type: 'integer', description: 'move: squares right (negative: left).' },
            dy: { type: 'integer', description: 'move: squares down (negative: up).' },
            ...TOKEN_FIELD_SCHEMA,
          },
          required: ['action', 'tokens'],
        },
      },
    ];
  }

  async handlePlanTokenChange(args: unknown): Promise<PlanView & LiveActorPlanResult> {
    const params = tokenParams.parse(args ?? {});
    const changes: Partial<Record<LiveTokenField, string | number | boolean>> = {};
    for (const field of Object.keys(LIVE_TOKEN_FIELDS) as LiveTokenField[]) {
      const value = params[field];
      if (value !== undefined) changes[field] = value;
    }
    const { action, tokens, x, y, gridX, gridY, dx, dy } = params;
    const request = {
      scope: 'token',
      ...stripUndefined({ action, tokens, x, y, gridX, gridY, dx, dy }),
      ...(Object.keys(changes).length > 0 ? { changes } : {}),
    } as LiveTokenRequest;
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
      // D-083: "apply without confirming" covers damage, conditions and resources, not tokens.
      return { ...plan, targets: built.targets, autoApply: false };
    } catch (error) {
      this.logger.warn('Token plan not created', {
        action: params.action,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
