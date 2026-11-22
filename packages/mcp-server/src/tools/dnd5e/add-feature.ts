import { freeText, NPCS_ONLY, toolRef } from '@gnuminator/shared';
import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { ErrorHandler } from '../../utils/error-handler.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';
import { toBridge } from './bridge-actor.js';
import type {
  AttackParams,
  AttackWithSaveParams,
  AuraParams,
  FeatureResult,
  PassiveParams,
  SaveParams,
  SpellcastingParams,
  SpellcastingResult,
  SpellsResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Canonical value sets for soft validation (warnings, not errors)
// ---------------------------------------------------------------------------

const DAMAGE_CANONICAL = new Set([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

const ATTACK_PROPERTY_CANONICAL = new Set([
  'ada',
  'amm',
  'fin',
  'fir',
  'foc',
  'hvy',
  'lgt',
  'lod',
  'mgc',
  'rch',
  'ret',
  'spc',
  'thr',
  'two',
  'ver',
]);

const CLASS_DEFAULT_ABILITY: Record<string, string> = {
  wizard: 'int',
  artificer: 'int',
  cleric: 'wis',
  druid: 'wis',
  ranger: 'wis',
  sorcerer: 'cha',
  warlock: 'cha',
  bard: 'cha',
  paladin: 'cha',
};

// ---------------------------------------------------------------------------
// Shared Zod building blocks
// ---------------------------------------------------------------------------

const damagePart = z.object({
  number: z.number().int().min(1),
  denomination: z
    .number()
    .int()
    .refine(d => [4, 6, 8, 10, 12, 20, 100].includes(d), {
      message: 'denomination must be one of 4, 6, 8, 10, 12, 20, 100',
    }),
  type: z.string().min(1, 'damage type cannot be empty'),
});

const damagePartSchema = {
  type: 'object',
  properties: {
    number: { type: 'number', minimum: 1 },
    denomination: { type: 'number', enum: [4, 6, 8, 10, 12, 20, 100] },
    type: { type: 'string', description: 'e.g. "fire"' },
  },
  required: ['number', 'denomination', 'type'],
};

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface DnD5eAddFeatureToolOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Tool class
// ---------------------------------------------------------------------------

export class DnD5eAddFeatureTool {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DnD5eAddFeatureToolOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DnD5eAddFeatureTool' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions(): { name: string; description: string; inputSchema: object }[] {
    return [
      {
        name: 'dnd5e-add-feature',
        description:
          'Direct write. D&D 5e only. Add a feature, attack, spellcasting setup or spells to an existing actor. ' +
          'featureType picks the mode. Parameters per mode (all need actor):\n' +
          '- passive (a trait with no roll): featureName, description\n' +
          '- save (breath weapon): featureName, saveAbility, saveDC, damageParts; area, halfOnSave optional\n' +
          '- attack (Claw, Bite): featureName, attackType, damageParts, rangeFt when ranged; weapon fields optional\n' +
          '- attack-with-save (hit plus save, Stinger): the attack ones plus saveAbility, saveDC, saveDamageParts\n' +
          '- aura (damage in range, no roll): featureName, damageParts, areaType, areaSize\n' +
          '- spellcasting (run before "spells"): spellcastingClass, spellcastingLevel\n' +
          '- spells (from the compendium): spellNames\n' +
          'Find the actor with list-characters or get-character.',
        inputSchema: {
          type: 'object',
          properties: {
            // ── Discriminator ─────────────────────────────────────────────────
            featureType: {
              type: 'string',
              enum: [
                'passive',
                'save',
                'attack',
                'attack-with-save',
                'aura',
                'spellcasting',
                'spells',
              ],
            },

            // ── Common ────────────────────────────────────────────────────────
            actor: {
              type: 'string',
              description: 'Name or ID of the target actor (partial name works).',
              ...toolRef('actor', 'id', { filter: NPCS_ONLY }),
            },
            featureName: {
              type: 'string',
              description: 'Name of the new feature; unique on the actor.',
              ...freeText('The name of the new feature item this call creates on the actor'),
            },
            description: {
              type: 'string',
              description: 'HTML description (optional).',
            },
            activationType: {
              type: 'string',
              enum: ['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'],
              description: 'Action economy type. Default "action".',
            },

            // ── Damage ────────────────────────────────────────────────────────
            damageParts: {
              type: 'array',
              minItems: 1,
              description:
                'Damage dice. attack: first entry is the base weapon die, extras stack. ' +
                'attack-with-save: the on-hit damage.',
              items: damagePartSchema,
            },

            // ── Save parameters ───────────────────────────────────────────────
            saveAbility: {
              type: 'string',
              enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
            },
            saveDC: {
              type: 'number',
              description: 'Saving throw DC (1–30).',
              minimum: 1,
              maximum: 30,
            },
            halfOnSave: {
              type: 'boolean',
              description: 'Half damage on a successful save (save mode). Default true.',
            },
            saveDamageParts: {
              type: 'array',
              minItems: 1,
              description: 'Damage on a failed save (attack-with-save).',
              items: damagePartSchema,
            },
            saveOnSave: {
              type: 'string',
              enum: ['half', 'none'],
              description: 'Damage on a successful save (attack-with-save). Default "none".',
            },

            // ── Area parameters ───────────────────────────────────────────────
            areaType: {
              type: 'string',
              enum: ['cone', 'cube', 'cylinder', 'emanation', 'line', 'radius', 'sphere', ''],
              description:
                'Template shape. save: optional, and areaSize is then required. aura: required ("emanation" or "sphere" for radial).',
            },
            areaSize: {
              type: 'number',
              description:
                'Template size in areaUnits (e.g. 30). Required for aura, and for save with areaType.',
              exclusiveMinimum: 0,
            },
            areaUnits: {
              type: 'string',
              enum: ['ft', 'm'],
              description: 'Units for areaSize. Default "ft".',
            },
            affectsType: {
              type: 'string',
              enum: ['creature', 'object', 'space', ''],
              description: 'What the area targets. Default "creature".',
            },

            // ── Attack parameters ─────────────────────────────────────────────
            attackType: {
              type: 'string',
              enum: ['melee', 'ranged'],
            },
            weaponClass: {
              type: 'string',
              enum: ['natural', 'simpleM', 'martialM', 'simpleR', 'martialR'],
              description: 'Weapon category; "natural" for claws, bite, touch. Default "natural".',
            },
            abilityModifier: {
              type: 'string',
              enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
              description: 'Ability for to-hit and damage. Default STR melee, DEX ranged.',
            },
            attackBonus: {
              type: 'number',
              description: 'Flat bonus to the attack roll only (not damage). Default 0.',
              minimum: 0,
              maximum: 10,
            },
            proficient: {
              type: 'boolean',
              description: 'Adds the proficiency bonus to hit. Default true.',
            },
            equipped: {
              type: 'boolean',
              description: 'Default true.',
            },
            reachFt: {
              type: 'number',
              description: 'Melee reach in feet. Default 5.',
              minimum: 5,
            },
            rangeFt: {
              type: 'number',
              description: 'Normal range in feet. Required when ranged.',
              minimum: 1,
            },
            longRangeFt: {
              type: 'number',
              description: 'Long range in feet (disadvantage beyond rangeFt); above rangeFt.',
              minimum: 1,
            },
            properties: {
              type: 'array',
              description:
                'Weapon property codes: ada, amm, fin, fir, foc, hvy, lgt, lod, mgc, rch, ret, spc, thr, two, ver.',
              items: { type: 'string' },
            },

            // ── Spellcasting parameters ───────────────────────────────────────
            spellcastingClass: {
              type: 'string',
              enum: [
                'artificer',
                'bard',
                'cleric',
                'druid',
                'paladin',
                'ranger',
                'sorcerer',
                'warlock',
                'wizard',
              ],
              description: 'Spellcasting class: sets the slot table and default ability.',
            },
            spellcastingLevel: {
              type: 'number',
              description: 'Class level (1–20); sets the slots.',
              minimum: 1,
              maximum: 20,
            },
            spellcastingAbility: {
              type: 'string',
              enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
              description: 'Casting ability. Default: the class default.',
            },

            // ── Spells parameters ─────────────────────────────────────────────
            spellNames: {
              type: 'array',
              description: 'English spell names (exact, case-insensitive), max 50.',
              minItems: 1,
              maxItems: 50,
              items: { type: 'string', minLength: 1 },
              ...toolRef('compendium-entry', 'name', {
                filter: { documentName: 'Item', types: ['spell'] },
              }),
            },
            compendiumPacks: {
              type: 'array',
              description:
                'Pack IDs in priority order. Default ["dnd5e.spells"] (2014); "dnd5e.spells24" for 2024.',
              items: { type: 'string', minLength: 1 },
              ...toolRef('compendium-pack', 'id', { filter: { documentName: 'Item' } }),
            },

            // ── Source metadata ───────────────────────────────────────────────
            sourceRules: {
              type: 'string',
              enum: ['2014', '2024'],
              description: 'Rules edition. Default "2014".',
            },
            sourceBook: {
              type: 'string',
              description: 'Source book abbreviation (e.g. "MM\'14").',
            },
            sourcePage: {
              type: 'string',
            },
          },
          required: ['featureType', 'actor'],
        },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // Master dispatcher
  // ---------------------------------------------------------------------------

  async handleAddFeature(args: unknown): Promise<unknown> {
    const { featureType } = z
      .object({
        featureType: z.enum([
          'passive',
          'save',
          'attack',
          'attack-with-save',
          'aura',
          'spellcasting',
          'spells',
        ]),
      })
      .parse(args);

    switch (featureType) {
      case 'passive':
        return this.handlePassive(args);
      case 'save':
        return this.handleSave(args);
      case 'attack':
        return this.handleAttack(args);
      case 'attack-with-save':
        return this.handleAttackWithSave(args);
      case 'aura':
        return this.handleAura(args);
      case 'spellcasting':
        return this.handleSpellcasting(args);
      case 'spells':
        return this.handleSpells(args);
    }
  }

  // ---------------------------------------------------------------------------
  // passive
  // ---------------------------------------------------------------------------

  private async handlePassive(args: unknown): Promise<unknown> {
    const schema = z.object({
      featureType: z.literal('passive'),
      actor: z.string().min(1, 'actor cannot be empty'),
      featureName: z.string().min(1, 'featureName cannot be empty'),
      description: z.string().default(''),
      sourceRules: z.enum(['2014', '2024']).default('2014'),
      sourceBook: z.string().default(''),
      sourcePage: z.string().default(''),
    });

    const parsed = schema.parse(args);

    this.logger.info('Adding passive feature to D&D 5e actor', {
      actor: parsed.actor,
      featureName: parsed.featureName,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-feature (passive) requires D&D 5e. ` +
            `Detected system: "${getCachedSystemId() ?? 'unknown'}".`
        );
      }

      const result = (await this.foundryClient.query(
        'foundry-mcp-bridge.addPassiveFeatureToActor',
        toBridge(parsed)
      )) as FeatureResult;

      this.logger.info('Passive feature added successfully', {
        actorId: result.actor?.id,
        itemId: result.item?.id,
      });

      return this.formatPassiveResponse(result, parsed);
    } catch (error) {
      this.errorHandler.handleToolError(error, 'dnd5e-add-feature', 'passive feature creation');
    }
  }

  private formatPassiveResponse(
    result: FeatureResult,
    params: PassiveParams
  ): Record<string, unknown> {
    const summary = `✅ Feature "${result.item.name}" added to "${result.actor.name}"`;
    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Feature:** ${result.item.name} (id: \`${result.item.id}\`)`,
      `**Type:** passive / descriptive (no activity)`,
      `**Rules:** ${params.sourceRules}${params.sourceBook ? `, ${params.sourceBook}` : ''}`,
    ].join('\n');
    return {
      summary,
      success: true,
      item: result.item,
      actor: result.actor,
      message: `${summary}\n\n${details}`,
    };
  }

  // ---------------------------------------------------------------------------
  // save
  // ---------------------------------------------------------------------------

  private async handleSave(args: unknown): Promise<unknown> {
    const schema = z
      .object({
        featureType: z.literal('save'),
        actor: z.string().min(1, 'actor cannot be empty'),
        featureName: z.string().min(1, 'featureName cannot be empty'),
        description: z.string().default(''),
        activationType: z
          .enum(['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'])
          .default('action'),
        saveAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
        saveDC: z.number().int().min(1).max(30),
        damageParts: z.array(damagePart).min(1, 'at least one damage part is required'),
        halfOnSave: z.boolean().default(true),
        areaType: z
          .enum(['cone', 'cube', 'cylinder', 'emanation', 'line', 'radius', 'sphere', ''])
          .default(''),
        areaSize: z.number().positive().optional(),
        areaUnits: z.enum(['ft', 'm']).default('ft'),
        affectsType: z.enum(['creature', 'object', 'space', '']).default('creature'),
      })
      .superRefine((data, ctx) => {
        if (data.areaType !== '' && data.areaSize === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['areaSize'],
            message: `areaSize is required when areaType is "${data.areaType}"`,
          });
        }
      });

    const parsed = schema.parse(args);

    this.logger.info('Adding save feature to D&D 5e actor', {
      actor: parsed.actor,
      featureName: parsed.featureName,
      saveAbility: parsed.saveAbility,
      saveDC: parsed.saveDC,
      areaType: parsed.areaType || 'none',
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-feature (save) requires D&D 5e. ` +
            `Detected system: "${getCachedSystemId() ?? 'unknown'}".`
        );
      }

      const result = (await this.foundryClient.query(
        'foundry-mcp-bridge.addSaveFeatureToActor',
        toBridge(parsed)
      )) as FeatureResult;

      this.logger.info('Save feature added successfully', {
        actorId: result.actor?.id,
        itemId: result.item?.id,
      });

      return this.formatSaveResponse(result, parsed);
    } catch (error) {
      this.errorHandler.handleToolError(error, 'dnd5e-add-feature', 'save feature creation');
    }
  }

  private formatSaveResponse(result: FeatureResult, params: SaveParams): Record<string, unknown> {
    const damageDesc = params.damageParts
      .map(p => `${p.number}d${p.denomination} ${p.type}`)
      .join(' + ');
    const areaDesc = params.areaType
      ? `, ${params.areaSize}${params.areaUnits} ${params.areaType}`
      : '';
    const saveDesc = `DC ${params.saveDC} ${String(params.saveAbility).toUpperCase()} save`;
    const onSaveDesc = params.halfOnSave ? 'half damage on save' : 'no damage on save';
    const summary = `✅ Feature "${result.item.name}" added to "${result.actor.name}"`;
    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Feature:** ${result.item.name} (id: \`${result.item.id}\`)`,
      `**Save:** ${saveDesc}, ${onSaveDesc}`,
      `**Damage:** ${damageDesc}${areaDesc}`,
      `**Activation:** ${params.activationType}`,
    ].join('\n');
    return {
      summary,
      success: true,
      item: result.item,
      actor: result.actor,
      message: `${summary}\n\n${details}`,
    };
  }

  // ---------------------------------------------------------------------------
  // attack
  // ---------------------------------------------------------------------------

  private async handleAttack(args: unknown): Promise<unknown> {
    const schema = z
      .object({
        featureType: z.literal('attack'),
        actor: z.string().min(1, 'actor cannot be empty'),
        featureName: z.string().min(1, 'featureName cannot be empty'),
        description: z.string().default(''),
        activationType: z
          .enum(['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'])
          .default('action'),
        attackType: z.enum(['melee', 'ranged']),
        weaponClass: z
          .enum(['natural', 'simpleM', 'martialM', 'simpleR', 'martialR'])
          .default('natural'),
        abilityModifier: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
        attackBonus: z.number().int().min(0).max(10).default(0),
        proficient: z.boolean().default(true),
        equipped: z.boolean().default(true),
        reachFt: z.number().int().min(5).default(5),
        rangeFt: z.number().int().min(1).optional(),
        longRangeFt: z.number().int().min(1).optional(),
        damageParts: z.array(damagePart).min(1, 'at least one damage part is required'),
        properties: z.array(z.string()).default([]),
        sourceRules: z.enum(['2014', '2024']).default('2014'),
        sourceBook: z.string().default(''),
        sourcePage: z.string().default(''),
      })
      .superRefine((data, ctx) => {
        if (data.attackType === 'ranged' && data.rangeFt === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rangeFt'],
            message: 'rangeFt is required when attackType is "ranged"',
          });
        }
        if (
          data.longRangeFt !== undefined &&
          data.rangeFt !== undefined &&
          data.longRangeFt <= data.rangeFt
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['longRangeFt'],
            message: `longRangeFt (${data.longRangeFt}) must be greater than rangeFt (${data.rangeFt})`,
          });
        }
      });

    const parsed = schema.parse(args);
    const effectiveAbility: string =
      parsed.abilityModifier ?? (parsed.attackType === 'melee' ? 'str' : 'dex');

    const warnings: string[] = [];
    for (const part of parsed.damageParts) {
      if (!DAMAGE_CANONICAL.has(part.type)) {
        const msg = `Unknown damage type "${part.type}", verify it matches dnd5e system values`;
        warnings.push(msg);
        this.logger.warn(msg, { value: part.type });
      }
    }
    for (const prop of parsed.properties) {
      if (!ATTACK_PROPERTY_CANONICAL.has(prop)) {
        const msg = `Unknown weapon property "${prop}", verify it matches dnd5e system values`;
        warnings.push(msg);
        this.logger.warn(msg, { value: prop });
      }
    }

    this.logger.info('Adding attack feature to D&D 5e actor', {
      actor: parsed.actor,
      featureName: parsed.featureName,
      attackType: parsed.attackType,
      ability: effectiveAbility,
      warnings: warnings.length,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-feature (attack) requires D&D 5e. ` +
            `Detected system: "${getCachedSystemId() ?? 'unknown'}".`
        );
      }

      const result = (await this.foundryClient.query('foundry-mcp-bridge.addAttackToActor', {
        ...toBridge(parsed),
        effectiveAbility,
      })) as FeatureResult;

      this.logger.info('Attack feature added successfully', {
        actorId: result.actor?.id,
        itemId: result.item?.id,
      });

      return this.formatAttackResponse(result, { ...parsed, effectiveAbility }, warnings);
    } catch (error) {
      this.errorHandler.handleToolError(error, 'dnd5e-add-feature', 'attack feature creation');
    }
  }

  private formatAttackResponse(
    result: FeatureResult,
    params: AttackParams,
    warnings: string[]
  ): Record<string, unknown> {
    const bonusStr = params.attackBonus > 0 ? ` +${params.attackBonus} to hit` : '';
    const damageDesc = params.damageParts
      .map(p => `${p.number}d${p.denomination} ${p.type}`)
      .join(' + ');
    const rangeDesc =
      params.attackType === 'melee'
        ? `reach ${params.reachFt ?? 5} ft.`
        : `range ${params.rangeFt}${params.longRangeFt ? `/${params.longRangeFt}` : ''} ft.`;
    const summary = `✅ Attack "${result.item.name}" added to "${result.actor.name}"`;
    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Item:** ${result.item.name} (id: \`${result.item.id}\`)`,
      `**Attack:** ${params.attackType}, ${String(params.effectiveAbility).toUpperCase()} modifier${bonusStr}`,
      `**Damage:** ${damageDesc}`,
      `**Range/Reach:** ${rangeDesc}`,
      `**Weapon class:** ${params.weaponClass}`,
    ].join('\n');
    const warningSection =
      warnings.length > 0
        ? `\n\n⚠️ **Warnings (${warnings.length}):**\n${warnings.map(w => `- ${w}`).join('\n')}`
        : '';
    return {
      summary,
      success: true,
      item: result.item,
      actor: result.actor,
      warnings,
      message: `${summary}\n\n${details}${warningSection}`,
    };
  }

  // ---------------------------------------------------------------------------
  // attack-with-save
  // ---------------------------------------------------------------------------

  private async handleAttackWithSave(args: unknown): Promise<unknown> {
    const schema = z
      .object({
        featureType: z.literal('attack-with-save'),
        actor: z.string().min(1, 'actor cannot be empty'),
        featureName: z.string().min(1, 'featureName cannot be empty'),
        description: z.string().default(''),
        activationType: z
          .enum(['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'])
          .default('action'),
        attackType: z.enum(['melee', 'ranged']),
        weaponClass: z
          .enum(['natural', 'simpleM', 'martialM', 'simpleR', 'martialR'])
          .default('natural'),
        abilityModifier: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
        attackBonus: z.number().int().min(0).max(10).default(0),
        proficient: z.boolean().default(true),
        equipped: z.boolean().default(true),
        reachFt: z.number().int().min(5).default(5),
        rangeFt: z.number().int().min(1).optional(),
        longRangeFt: z.number().int().min(1).optional(),
        damageParts: z.array(damagePart).min(1, 'at least one damage part is required'),
        properties: z.array(z.string()).default([]),
        saveAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
        saveDC: z.number().int().min(1).max(30),
        saveDamageParts: z.array(damagePart).min(1, 'at least one save damage part is required'),
        saveOnSave: z.enum(['half', 'none']).default('none'),
        sourceRules: z.enum(['2014', '2024']).default('2014'),
        sourceBook: z.string().default(''),
        sourcePage: z.string().default(''),
      })
      .superRefine((data, ctx) => {
        if (data.attackType === 'ranged' && data.rangeFt === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rangeFt'],
            message: 'rangeFt is required when attackType is "ranged"',
          });
        }
        if (
          data.longRangeFt !== undefined &&
          data.rangeFt !== undefined &&
          data.longRangeFt <= data.rangeFt
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['longRangeFt'],
            message: `longRangeFt (${data.longRangeFt}) must be greater than rangeFt (${data.rangeFt})`,
          });
        }
      });

    const parsed = schema.parse(args);
    const effectiveAbility: string =
      parsed.abilityModifier ?? (parsed.attackType === 'melee' ? 'str' : 'dex');

    const warnings: string[] = [];
    for (const part of [...parsed.damageParts, ...parsed.saveDamageParts]) {
      if (!DAMAGE_CANONICAL.has(part.type)) {
        const msg = `Unknown damage type "${part.type}", verify it matches dnd5e system values`;
        if (!warnings.includes(msg)) warnings.push(msg);
        this.logger.warn(msg, { value: part.type });
      }
    }

    this.logger.info('Adding attack+save feature to D&D 5e actor', {
      actor: parsed.actor,
      featureName: parsed.featureName,
      attackType: parsed.attackType,
      saveAbility: parsed.saveAbility,
      saveDC: parsed.saveDC,
      warnings: warnings.length,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-feature (attack-with-save) requires D&D 5e. ` +
            `Detected system: "${getCachedSystemId() ?? 'unknown'}".`
        );
      }

      const result = (await this.foundryClient.query(
        'foundry-mcp-bridge.addAttackWithSaveToActor',
        {
          ...toBridge(parsed),
          effectiveAbility,
        }
      )) as FeatureResult;

      this.logger.info('Attack+save feature added successfully', {
        actorId: result.actor?.id,
        itemId: result.item?.id,
      });

      return this.formatAttackWithSaveResponse(result, { ...parsed, effectiveAbility }, warnings);
    } catch (error) {
      this.errorHandler.handleToolError(error, 'dnd5e-add-feature', 'attack+save feature creation');
    }
  }

  private formatAttackWithSaveResponse(
    result: FeatureResult,
    params: AttackWithSaveParams,
    warnings: string[]
  ): Record<string, unknown> {
    const bonusStr = params.attackBonus > 0 ? ` +${params.attackBonus} to hit` : '';
    const attackDamageDesc = params.damageParts
      .map(p => `${p.number}d${p.denomination} ${p.type}`)
      .join(' + ');
    const saveDamageDesc = params.saveDamageParts
      .map(p => `${p.number}d${p.denomination} ${p.type}`)
      .join(' + ');
    const rangeDesc =
      params.attackType === 'melee'
        ? `reach ${params.reachFt ?? 5} ft.`
        : `range ${params.rangeFt}${params.longRangeFt ? `/${params.longRangeFt}` : ''} ft.`;
    const summary = `✅ Attack+Save "${result.item.name}" added to "${result.actor.name}"`;
    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Item:** ${result.item.name} (id: \`${result.item.id}\`)`,
      `**Attack:** ${params.attackType}, ${String(params.effectiveAbility).toUpperCase()} modifier${bonusStr}, ${rangeDesc}`,
      `**Attack damage:** ${attackDamageDesc}`,
      `**Save:** DC ${params.saveDC} ${String(params.saveAbility).toUpperCase()}, ${saveDamageDesc} (${params.saveOnSave === 'half' ? 'half on save' : 'no damage on save'})`,
    ].join('\n');
    const warningSection =
      warnings.length > 0
        ? `\n\n⚠️ **Warnings (${warnings.length}):**\n${warnings.map(w => `- ${w}`).join('\n')}`
        : '';
    return {
      summary,
      success: true,
      item: result.item,
      actor: result.actor,
      warnings,
      message: `${summary}\n\n${details}${warningSection}`,
    };
  }

  // ---------------------------------------------------------------------------
  // aura
  // ---------------------------------------------------------------------------

  private async handleAura(args: unknown): Promise<unknown> {
    const schema = z.object({
      featureType: z.literal('aura'),
      actor: z.string().min(1, 'actor cannot be empty'),
      featureName: z.string().min(1, 'featureName cannot be empty'),
      description: z.string().default(''),
      activationType: z
        .enum(['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'])
        .default('action'),
      damageParts: z.array(damagePart).min(1, 'at least one damage part is required'),
      areaType: z.enum(['cone', 'cube', 'cylinder', 'emanation', 'line', 'radius', 'sphere']),
      areaSize: z.number().positive('areaSize must be greater than 0'),
      areaUnits: z.enum(['ft', 'm']).default('ft'),
      affectsType: z.enum(['creature', 'object', 'space', '']).default('creature'),
      sourceRules: z.enum(['2014', '2024']).default('2014'),
      sourceBook: z.string().default(''),
      sourcePage: z.string().default(''),
    });

    const parsed = schema.parse(args);

    const warnings: string[] = [];
    for (const part of parsed.damageParts) {
      if (!DAMAGE_CANONICAL.has(part.type)) {
        const msg = `Unknown damage type "${part.type}", verify it matches dnd5e system values`;
        warnings.push(msg);
        this.logger.warn(msg, { value: part.type });
      }
    }

    this.logger.info('Adding aura feature to D&D 5e actor', {
      actor: parsed.actor,
      featureName: parsed.featureName,
      areaType: parsed.areaType,
      areaSize: parsed.areaSize,
      warnings: warnings.length,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-feature (aura) requires D&D 5e. ` +
            `Detected system: "${getCachedSystemId() ?? 'unknown'}".`
        );
      }

      const result = (await this.foundryClient.query(
        'foundry-mcp-bridge.addAuraToActor',
        toBridge(parsed)
      )) as FeatureResult;

      this.logger.info('Aura feature added successfully', {
        actorId: result.actor?.id,
        itemId: result.item?.id,
      });

      return this.formatAuraResponse(result, parsed, warnings);
    } catch (error) {
      this.errorHandler.handleToolError(error, 'dnd5e-add-feature', 'aura feature creation');
    }
  }

  private formatAuraResponse(
    result: FeatureResult,
    params: AuraParams,
    warnings: string[]
  ): Record<string, unknown> {
    const damageDesc = params.damageParts
      .map(p => `${p.number}d${p.denomination} ${p.type}`)
      .join(' + ');
    const areaDesc = `${params.areaSize}${params.areaUnits} ${params.areaType}`;
    const summary = `✅ Aura "${result.item.name}" added to "${result.actor.name}"`;
    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Feature:** ${result.item.name} (id: \`${result.item.id}\`)`,
      `**Damage:** ${damageDesc} (automatic, no attack roll, no saving throw)`,
      `**Area:** ${areaDesc}, affects: ${params.affectsType || 'any'}`,
      `**Activation:** ${params.activationType}`,
    ].join('\n');
    const warningSection =
      warnings.length > 0
        ? `\n\n⚠️ **Warnings (${warnings.length}):**\n${warnings.map(w => `- ${w}`).join('\n')}`
        : '';
    return {
      summary,
      success: true,
      item: result.item,
      actor: result.actor,
      warnings,
      message: `${summary}\n\n${details}${warningSection}`,
    };
  }

  // ---------------------------------------------------------------------------
  // spellcasting
  // ---------------------------------------------------------------------------

  private async handleSpellcasting(args: unknown): Promise<unknown> {
    const schema = z.object({
      featureType: z.literal('spellcasting'),
      actor: z.string().min(1, 'actor cannot be empty'),
      spellcastingClass: z.enum([
        'artificer',
        'bard',
        'cleric',
        'druid',
        'paladin',
        'ranger',
        'sorcerer',
        'warlock',
        'wizard',
      ]),
      spellcastingLevel: z.number().int().min(1).max(20),
      spellcastingAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
      sourceRules: z.enum(['2014', '2024']).default('2014'),
    });

    const parsed = schema.parse(args);
    const effectiveAbility =
      parsed.spellcastingAbility ?? CLASS_DEFAULT_ABILITY[parsed.spellcastingClass];

    this.logger.info('Setting actor spellcasting', {
      actor: parsed.actor,
      spellcastingClass: parsed.spellcastingClass,
      spellcastingLevel: parsed.spellcastingLevel,
      ability: effectiveAbility,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-feature (spellcasting) requires D&D 5e. ` +
            `Detected system: "${getCachedSystemId() ?? 'unknown'}".`
        );
      }

      const result = (await this.foundryClient.query('foundry-mcp-bridge.setActorSpellcasting', {
        ...toBridge(parsed),
        effectiveAbility,
      })) as SpellcastingResult;

      this.logger.info('Actor spellcasting set successfully', { actorId: result.actor?.id });

      return this.formatSpellcastingResponse(result, { ...parsed, effectiveAbility });
    } catch (error) {
      this.errorHandler.handleToolError(error, 'dnd5e-add-feature', 'spellcasting setup');
    }
  }

  private formatSpellcastingResponse(
    result: SpellcastingResult,
    params: SpellcastingParams
  ): Record<string, unknown> {
    const isWarlock = params.spellcastingClass === 'warlock';
    const slotsDesc = isWarlock
      ? `Pact Magic: ${result.spellcasting.slots.pact.max} slot(s) of level ${result.spellcasting.slots.pact.level}`
      : Object.entries(result.spellcasting.slots as Record<string, number>)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `L${k.replace('spell', '')}: ${n}`)
          .join(', ') || 'no slots';
    const summary = `✅ Spellcasting configured on "${result.actor.name}", ${params.spellcastingClass} level ${params.spellcastingLevel}`;
    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Class:** ${params.spellcastingClass}, level ${params.spellcastingLevel}`,
      `**Ability:** ${String(params.effectiveAbility).toUpperCase()}`,
      `**Slots:** ${slotsDesc}`,
    ].join('\n');
    const warningSection =
      result.warnings.length > 0
        ? `\n\n⚠️ **Warnings:**\n${result.warnings.map(w => `- ${w}`).join('\n')}`
        : '';
    return {
      summary,
      success: true,
      actor: result.actor,
      spellcasting: result.spellcasting,
      warnings: result.warnings,
      message: `${summary}\n\n${details}${warningSection}`,
    };
  }

  // ---------------------------------------------------------------------------
  // spells
  // ---------------------------------------------------------------------------

  private async handleSpells(args: unknown): Promise<unknown> {
    const schema = z.object({
      featureType: z.literal('spells'),
      actor: z.string().min(1, 'actor cannot be empty'),
      spellNames: z.array(z.string().min(1)).min(1).max(50),
      compendiumPacks: z.array(z.string().min(1)).default(['dnd5e.spells']),
    });

    const parsed = schema.parse(args);

    this.logger.info('Adding spells to D&D 5e actor', {
      actor: parsed.actor,
      spellCount: parsed.spellNames.length,
      packs: parsed.compendiumPacks,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-feature (spells) requires D&D 5e. ` +
            `Detected system: "${getCachedSystemId() ?? 'unknown'}".`
        );
      }

      const result = (await this.foundryClient.query(
        'foundry-mcp-bridge.addSpellsToActor',
        toBridge(parsed)
      )) as SpellsResult;

      this.logger.info('Spells import complete', {
        actorId: result.actor?.id,
        added: result.added?.length,
        skipped: result.skipped?.length,
        notFound: result.notFound?.length,
        failed: result.failed?.length,
      });

      return this.formatSpellsResponse(result, parsed);
    } catch (error) {
      this.errorHandler.handleToolError(error, 'dnd5e-add-feature', 'spell import');
    }
  }

  private formatSpellsResponse(
    result: SpellsResult,
    params: { spellNames: string[] }
  ): Record<string, unknown> {
    const { added, skipped, notFound, failed, warnings } = result;
    const total = params.spellNames.length;

    const parts: string[] = [];
    if (added.length > 0) parts.push(`${added.length} added`);
    if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
    if (notFound.length > 0) parts.push(`${notFound.length} not found`);
    if (failed.length > 0) parts.push(`${failed.length} failed`);

    const icon = failed.length > 0 ? '⚠️' : notFound.length > 0 ? '🔍' : '✅';
    const summary = `${icon} Spells imported to "${result.actor.name}", ${parts.length > 0 ? parts.join(', ') : 'nothing changed'}`;

    const lines: string[] = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Requested:** ${total}, Added: ${added.length}, Skipped: ${skipped.length}, Not found: ${notFound.length}${failed.length > 0 ? `, Failed: ${failed.length}` : ''}`,
    ];
    if (added.length > 0) {
      lines.push('\n✅ **Added:**');
      for (const s of added) lines.push(`  - ${s.name} *(${s.packLabel}, item \`${s.itemId}\`)*`);
    }
    if (skipped.length > 0) {
      lines.push('\n⏭️ **Skipped:**');
      for (const s of skipped) lines.push(`  - ${s.name}, *${s.reason}*`);
    }
    if (notFound.length > 0) {
      lines.push('\n❌ **Not found in compendium:**');
      for (const name of notFound) lines.push(`  - ${name}`);
    }
    if (failed.length > 0) {
      lines.push('\n⚠️ **Failed during import:**');
      for (const f of failed) lines.push(`  - ${f.name}, *${f.error}*`);
    }
    if (warnings.length > 0) {
      lines.push('\n⚠️ **Warnings:**');
      for (const w of warnings) lines.push(`  - ${w}`);
    }
    return {
      summary,
      success: added.length > 0 || (notFound.length === 0 && failed.length === 0),
      actor: result.actor,
      added,
      skipped,
      notFound,
      failed,
      warnings,
      message: `${summary}\n\n${lines.join('\n')}`,
    };
  }
}
