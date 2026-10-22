import { z } from 'zod';
import {
  PAPER_SYNC_COINS,
  PAPER_SYNC_FEATURE_ID,
  PAPER_SYNC_QUERY,
  PAPER_SYNC_SLOT_KEYS,
  toolRef,
  unwrapBridgeReply,
  type PaperSyncPlan,
  type PaperSyncPlanResult,
  type PaperSyncRequest,
} from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import { Logger } from '../logger.js';

export interface PaperSyncToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const whole = z.number().int().min(0);

/**
 * Strict: a key that is not a paper sync field (xp, level, class, max HP) is refused with a
 * clear error instead of being dropped, so nobody believes it was synced.
 */
const planParams = z
  .object({
    actor: z.string().min(1),
    hp: whole.optional(),
    tempHp: whole.optional(),
    slots: z
      .object(Object.fromEntries(PAPER_SYNC_SLOT_KEYS.map(k => [k, whole.optional()])))
      .strict()
      .optional(),
    hitDice: z
      .array(z.object({ class: z.string().min(1).optional(), left: whole }).strict())
      .max(20)
      .optional(),
    resources: z
      .array(z.object({ name: z.string().min(1), value: whole }).strict())
      .max(40)
      .optional(),
    coins: z
      .object(Object.fromEntries(PAPER_SYNC_COINS.map(c => [c, whole.optional()])))
      .strict()
      .optional(),
    exhaustion: whole.max(10).optional(),
    conditions: z.array(z.string().min(1)).max(20).optional(),
    inspiration: z.boolean().optional(),
    resetDeathSaves: z.boolean().optional(),
    inventory: z
      .array(
        z
          .object({
            item: z.string().min(1).optional(),
            uuid: z.string().min(1).optional(),
            quantity: whole,
          })
          .strict()
          .refine(line => (line.item === undefined) !== (line.uuid === undefined), {
            message: 'give either "item" (on the sheet) or "uuid" (a compendium item to add)',
          })
      )
      .max(100)
      .optional(),
  })
  .strict();

/** What `plan-paper-sync` returns: the guarded plan plus what it changes. */
export type PaperSyncResult = PlanView & PaperSyncPlanResult;

const slotProperties = Object.fromEntries(
  PAPER_SYNC_SLOT_KEYS.map(k => [k, { type: 'integer', minimum: 0 }])
);

const coinProperties = Object.fromEntries(
  PAPER_SYNC_COINS.map(c => [c, { type: 'integer', minimum: 0 }])
);

/**
 * Paper sync (Paper nights A). `plan-paper-sync` writes the numbers on one paper sheet back into
 * Foundry as one guarded plan (feature `paper-sync`, off by default, never auto-applied); apply it
 * with apply-planned-change and revert it with undo-change. The module builds the ops in Foundry
 * (`planPaperSync`) from absolute values and only for fields that differ; a value above the
 * maximum refuses the whole request. Removing an item (quantity 0) makes the plan destructive.
 * One plan per character: call it once per sheet.
 */
export class PaperSyncTools {
  constructor(private readonly options: PaperSyncToolsOptions) {
    this.options = { ...options, logger: options.logger.child({ component: 'PaperSyncTools' }) };
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'plan-paper-sync',
        description:
          'GM ONLY. After a paper night: plan the numbers on ONE paper sheet as one guarded change for that character (apply-planned-change, undo-change; the "AI Tool: Paper sync (writes)" switch must be on, off by default). Compare with get-character first. Every value is the absolute number on the sheet now. Only differing fields change; a value above the maximum refuses the whole request, listing every problem. Quantity 0 removes an item (destructive: second confirm). Never changes XP (milestones), level, class or max HP. D&D 5e only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            actor: {
              type: 'string',
              description: 'The player character: name or id.',
              ...toolRef('actor', 'name', { filter: { types: ['character'], playerOwned: true } }),
            },
            hp: { type: 'integer', minimum: 0, description: 'Current hit points.' },
            tempHp: { type: 'integer', minimum: 0 },
            slots: {
              type: 'object',
              additionalProperties: false,
              description: 'Spell slots left by level "1" to "9", and "pact".',
              properties: slotProperties,
            },
            hitDice: {
              type: 'array',
              description: 'Hit dice left per class (class may be left out with one class).',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  class: {
                    type: 'string',
                    ...toolRef('actor-item', 'name', {
                      parent: 'actor',
                      filter: { types: ['class'] },
                    }),
                  },
                  left: { type: 'integer', minimum: 0 },
                },
                required: ['left'],
              },
            },
            resources: {
              type: 'array',
              description: 'Class resources and item uses left ("Ki Points", "Wand of Fireballs").',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', ...toolRef('actor-item', 'name', { parent: 'actor' }) },
                  value: { type: 'integer', minimum: 0 },
                },
                required: ['name', 'value'],
              },
            },
            coins: {
              type: 'object',
              additionalProperties: false,
              description: 'Coins now; leave out the unchanged ones.',
              properties: coinProperties,
            },
            exhaustion: { type: 'integer', minimum: 0, description: 'Level 0 to 6.' },
            conditions: {
              type: 'array',
              items: { type: 'string' },
              description: 'The exact set now (empty clears them); leave out to keep them.',
              ...toolRef('condition', 'id'),
            },
            inspiration: { type: 'boolean' },
            resetDeathSaves: { type: 'boolean', description: 'true: successes and failures to 0.' },
            inventory: {
              type: 'array',
              description:
                'Item quantities now; 0 removes. To add an item give its compendium uuid.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  item: { type: 'string', ...toolRef('actor-item', 'name', { parent: 'actor' }) },
                  uuid: {
                    type: 'string',
                    ...toolRef('compendium-entry', 'uuid', { filter: { documentName: 'Item' } }),
                  },
                  quantity: { type: 'integer', minimum: 0 },
                },
                required: ['quantity'],
              },
            },
          },
          required: ['actor'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<PaperSyncResult> {
    if (name !== 'plan-paper-sync') throw new Error(`Unknown paper sync tool: ${name}`);
    try {
      return await this.planPaperSync(args);
    } catch (error) {
      this.options.logger.warn('Paper sync plan not created', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async planPaperSync(args: unknown): Promise<PaperSyncResult> {
    const parsed = planParams.safeParse(args ?? {});
    if (!parsed.success) {
      throw new Error(
        `Not planned: ${parsed.error.issues
          .map(i => `${i.path.join('.') || 'request'}: ${i.message}`)
          .join('; ')}. Paper sync never changes XP, level, class or max HP.`
      );
    }
    const params = parsed.data;
    const { foundryClient, guardedWrites } = this.options;

    // Fail early and plainly while the switch is off (the module would refuse the apply anyway).
    const features = unwrapBridgeReply(
      await foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    const feature = features.find(f => f.id === PAPER_SYNC_FEATURE_ID);
    if (!feature?.enabled) {
      throw new Error(
        'Paper sync is switched off. In Foundry, open Game Settings, Configure Settings, AI Tool and turn on "AI Tool: Paper sync (writes)".'
      );
    }

    const built = unwrapBridgeReply(
      (await foundryClient.query(
        `foundry-mcp-bridge.${PAPER_SYNC_QUERY}`,
        params as PaperSyncRequest
      )) as PaperSyncPlan,
      'Could not plan the paper sync'
    );
    const plan = await guardedWrites.createPlan({
      feature: PAPER_SYNC_FEATURE_ID,
      summary: built.summary,
      ops: built.ops,
    });
    return {
      ...plan,
      actor: built.actor,
      changes: built.changes,
      unchanged: built.unchanged,
      warnings: built.warnings,
      autoApply: false,
    };
  }
}
