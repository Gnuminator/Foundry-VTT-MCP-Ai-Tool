import { MODULE_ID, ERROR_MESSAGES } from '../constants.js';
import * as shared from './shared.js';
import { logInfo } from '../log.js';
import { isDnd5eV6 } from '../systems/dnd5e/version.js';
import {
  slugify,
  NPC_DAMAGE_CANONICAL,
  NPC_CONDITION_CANONICAL,
  NPC_SIZE_MAP,
  npcNormalizeCR,
  npcFormatCR,
  npcBuildSkillsBlock,
  ATTACK_DAMAGE_CANONICAL,
  ATTACK_PROPERTY_CANONICAL,
  AURA_DAMAGE_CANONICAL,
  ATTACK_WITH_SAVE_DAMAGE_CANONICAL,
  FULL_CASTER_SLOTS,
  HALF_CASTER_SLOTS,
  ARTIFICER_SLOTS,
  WARLOCK_PACT_TABLE,
} from './dnd5e-tables.js';

/** The use-like methods a dnd5e item may carry (none are in the core Item declaration). */
interface UsableItemMethods {
  use?: (...args: unknown[]) => Promise<unknown>;
  toChat?: () => Promise<unknown>;
  toMessage?: (...args: unknown[]) => Promise<unknown>;
  roll?: () => Promise<unknown>;
}

/** One damage dice part as the attack, aura and save-feature builders take it. */
export interface BuilderDamagePart {
  number: number;
  denomination: number;
  type: string;
}

/** Input of {@link ActorBuilderDataAccess.useItem}. */
export interface UseItemInput {
  actorIdentifier: string;
  itemIdentifier: string;
  targets?: string[] | undefined; // Target character/token names or IDs. "self" targets the caster.
  options?:
    | {
        consume?: boolean | undefined; // Whether to consume charges/uses
        configureDialog?: boolean | undefined; // Whether to show configuration dialog
        skipDialog?: boolean | undefined; // Skip confirmation dialogs (default: true for MCP)
        spellLevel?: number | undefined; // For spells: cast at higher level
        versatile?: boolean | undefined; // For versatile weapons: use versatile damage
      }
    | undefined;
}

/** Result of {@link ActorBuilderDataAccess.useItem}. */
export interface UseItemResult {
  success: boolean;
  status?: string;
  message: string;
  itemName?: string;
  actorName?: string;
  targets?: string[];
  requiresGMInteraction?: boolean;
}

/** Input of {@link ActorBuilderDataAccess.addSaveFeatureToActor}. */
export interface AddSaveFeatureToActorInput {
  actorIdentifier: string;
  featureName: string;
  description: string;
  activationType: string;
  saveAbility: string;
  saveDC: number;
  damageParts: BuilderDamagePart[];
  halfOnSave: boolean;
  areaType: string;
  areaSize?: number;
  areaUnits: string;
  affectsType: string;
}

/** Result of {@link ActorBuilderDataAccess.addSaveFeatureToActor}. */
export interface AddSaveFeatureToActorResult {
  success: boolean;
  item: { id: string; name: string };
  actor: { id: string; name: string };
}

/** Input of {@link ActorBuilderDataAccess.createNpcActor}. */
export interface CreateNpcActorInput {
  name: string;
  creatureType: string;
  creatureSubtype: string;
  size: string;
  alignment: string;
  cr: string | number;
  hpAverage: number;
  hpFormula: string;
  acMode: string;
  acValue?: number;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  savingThrows: string[];
  walkSpeed: number;
  flySpeed: number;
  swimSpeed: number;
  climbSpeed: number;
  burrowSpeed: number;
  hover: boolean;
  darkvision: number;
  blindsight: number;
  tremorsense: number;
  truesight: number;
  specialSenses: string;
  skills: Array<{ skill: string; proficiency: string }>;
  damageImmunities: string[];
  damageResistances: string[];
  damageVulnerabilities: string[];
  conditionImmunities: string[];
  languages: string[];
  languagesCustom: string;
  biography: string;
  sourceBook: string;
  sourcePage: string;
  sourceRules: string;
}

/** Result of {@link ActorBuilderDataAccess.createNpcActor}. */
export interface CreateNpcActorResult {
  success: boolean;
  actor: { id: string; name: string; cr: string; folder: string | null };
  warnings: string[];
}

/** Input of {@link ActorBuilderDataAccess.addAttackToActor}. */
export interface AddAttackToActorInput {
  actorIdentifier: string;
  featureName: string;
  damageParts: BuilderDamagePart[];
  properties: string[];
  attackType?: string;
  reachFt?: number;
  rangeFt?: number;
  longRangeFt?: number;
  sourceRules?: string;
  effectiveAbility?: string;
  description?: string;
  sourceBook?: string;
  sourcePage?: string;
  equipped?: boolean;
  activationType?: string;
  weaponClass?: string;
  attackBonus: number;
}

/** Result of {@link ActorBuilderDataAccess.addAttackToActor} and {@link ActorBuilderDataAccess.addAuraToActor}. */
export interface AddBuiltItemResult {
  success: boolean;
  actor: { id: string; name: string };
  item: { id: string; name: string; type: string };
  warnings: string[];
}

/** Input of {@link ActorBuilderDataAccess.addAuraToActor}. */
export interface AddAuraToActorInput {
  actorIdentifier: string;
  featureName: string;
  damageParts: BuilderDamagePart[];
  areaType: string;
  areaSize: number;
  areaUnits?: string;
  affectsType?: string;
  activationType?: string;
  description?: string;
  sourceRules?: string;
  sourceBook?: string;
  sourcePage?: string;
}

/**
 * Actor-builder domain (D&D 5e). Builds and populates combat-ready actors: NPC
 * stat blocks, weapon/feat activities (attack, attack+save, aura, save, passive),
 * spellcasting slot tables, and compendium spell/feature imports, plus using an
 * item or an NPC activity. Most builders emit large dnd5e item-schema literals
 * verified field-for-field against real dnd5e output — those literals are the
 * spec and are kept verbatim; the shared boilerplate (system guard, dup check,
 * compendium import, error formatting) is factored into the helpers below.
 */
export class ActorBuilderDataAccess {
  /**
   * Use an item on a character (cast spell, use ability, consume item, etc.)
   * This triggers the item's default use behavior in Foundry VTT
   */
  async useItem(params: UseItemInput): Promise<UseItemResult> {
    shared.validateFoundryState();

    const { actorIdentifier, itemIdentifier, targets, options = {} } = params;

    // Find the actor
    const actor = shared.findActorByIdentifier(actorIdentifier);
    if (!actor) {
      throw new Error(`Actor not found: ${actorIdentifier}`);
    }

    // Find the item on the actor
    const item = actor.items.find(
      i => i.id === itemIdentifier || i.name.toLowerCase() === itemIdentifier.toLowerCase()
    );

    if (!item) {
      throw new Error(`Item "${itemIdentifier}" not found on actor "${actor.name}"`);
    }

    const itemAny: Item & UsableItemMethods = item;
    const systemId = game.system.id;

    // Handle targeting if targets are specified
    const resolvedTargetNames: string[] = [];
    if (targets && targets.length > 0) {
      // Get all tokens on the current scene
      const scene = game.scenes?.active;
      if (!scene) {
        throw new Error('No active scene to find targets on');
      }

      const sceneTokens = scene.tokens;
      const tokenIds: string[] = [];

      for (const targetIdentifier of targets) {
        // Handle "self" - target the caster's token
        if (targetIdentifier.toLowerCase() === 'self') {
          // Find token for the caster actor
          const selfToken = sceneTokens.find(
            t => t.actor?.id === actor.id || t.actorId === actor.id
          );
          if (selfToken) {
            tokenIds.push(selfToken.id);
            resolvedTargetNames.push(actor.name);
          } else {
            console.warn(
              `[foundry-mcp-bridge] No token found on scene for actor "${actor.name}" (self)`
            );
          }
          continue;
        }

        // Find token by name or ID
        const targetToken = sceneTokens.find(
          t =>
            t.id === targetIdentifier ||
            t.name?.toLowerCase() === targetIdentifier.toLowerCase() ||
            t.actor?.name?.toLowerCase() === targetIdentifier.toLowerCase()
        );

        if (targetToken) {
          tokenIds.push(targetToken.id);
          resolvedTargetNames.push(targetToken.name || targetToken.actor?.name || targetIdentifier);
        } else {
          console.warn(`[foundry-mcp-bridge] Target not found: "${targetIdentifier}"`);
        }
      }

      // Set targets using Foundry's targeting system
      if (tokenIds.length > 0 && game.user) {
        await (game.user.updateTokenTargets(tokenIds) as unknown);
        logInfo(`[foundry-mcp-bridge] Set targets: ${resolvedTargetNames.join(', ')}`);
      }
    }

    try {
      // For items that may show dialogs (spells with choices, etc.),
      // we fire-and-forget to avoid timeout issues. The GM will interact
      // with the dialog in Foundry, and the result appears in chat.

      // Check if item has a use() method (D&D 5e)
      if (typeof itemAny.use === 'function') {
        let useArgs: unknown[];
        if (systemId === 'dnd5e') {
          // dnd5e 4+ (5.3.3 and 6.0.5 both): Item5e#use(usage, dialog, message) —
          // three config objects, not the old flat options bag. The old keys
          // (createMessage/consumeResource/consumeSpellSlot/consumeUsage/
          // configureDialog/slotLevel/level) are not read anywhere on this
          // signature, so they were silently ignored — a "use" that always ran
          // with dnd5e's own defaults regardless of what was passed.
          // verified: dnd5e.mjs:35504 (Item5e#use(config, dialog, message) delegates
          // to activity.use(usageConfig, dialogConfig, messageConfig)), :17856
          // (Activity#_prepareUsageConfig — `consume` must be `false` or left
          // unset; `config.consume ??= {}` then assigns properties onto it, which
          // throws in strict mode if `consume` is the boolean `true`).
          const usage: Record<string, unknown> = {};
          if (options.consume === false) {
            usage.consume = false;
          }
          // Upcast slot for spells. Best-effort: assumes a leveled slot key
          // (`spellN`); pact-caster slot ids aren't derivable without the
          // item's casting method, same limitation the old `slotLevel` had.
          if (options.spellLevel !== undefined) {
            usage.spell = { slot: `spell${options.spellLevel}` };
          }
          const dialog = { configure: true }; // Always show dialog so GM can make choices
          const message = { create: true };
          useArgs = [usage, dialog, message];
        } else {
          useArgs = [{ createMessage: true }];
        }
        // Fire and forget - don't await, as dialogs block the promise
        itemAny.use(...useArgs).catch((err: Error) => {
          console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
        });
      } else if (typeof itemAny.toChat === 'function') {
        if (typeof itemAny.toMessage === 'function') {
          itemAny.toMessage(undefined, { create: true }).catch((err: Error) => {
            console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
          });
        } else {
          itemAny.toChat().catch((err: Error) => {
            console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
          });
        }
      } else if (typeof itemAny.roll === 'function') {
        // Some items have a roll method
        itemAny.roll().catch((err: Error) => {
          console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
        });
      } else {
        // Generic fallback: create a chat message
        const chatData = {
          user: game.user?.id,
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<h3>${item.name}</h3><p>${actor.name} uses ${item.name}.</p>`,
        };
        ChatMessage.create(chatData).catch((err: Error) => {
          console.error(`[foundry-mcp-bridge] Error posting use of ${item.name}:`, err);
        });
      }

      const targetInfo =
        resolvedTargetNames.length > 0 ? ` targeting ${resolvedTargetNames.join(', ')}` : '';

      const result: UseItemResult = {
        success: true,
        status: 'initiated',
        message: `Item use initiated for ${actor.name} using ${item.name}${targetInfo}. If a dialog appeared in Foundry VTT, the GM should select options and confirm. The result will appear in chat.`,
        itemName: item.name,
        actorName: actor.name,
        requiresGMInteraction: true,
      };

      if (resolvedTargetNames.length > 0) {
        result.targets = resolvedTargetNames;
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to use item "${item.name}": ${this.errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  // ===== D&D 5E FEATURE CREATION =====

  /**
   * Add a save-attack feature (feat) to an existing D&D 5e actor.
   * Creates a single save Activity with damage and an optional area template.
   */
  async addSaveFeatureToActor(
    data: AddSaveFeatureToActorInput
  ): Promise<AddSaveFeatureToActorResult> {
    shared.validateFoundryState();

    try {
      // 1. Lookup actor
      const actor = shared.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. System guard
      if (game.system.id !== 'dnd5e') {
        throw new Error(
          `addSaveFeatureToActor requires D&D 5e. ` + `Current system: "${game.system.id}".`
        );
      }

      // 3. Duplicate check (by name only, regardless of item type)
      const existing = actor.items.find(i => i.name === data.featureName);
      if (existing) {
        throw new Error(
          `Feature "${data.featureName}" already exists on actor "${actor.name}" ` +
            `(id: ${existing.id}). Use a different name or remove the existing feature first.`
        );
      }

      // 4. Generate activity ID
      const activityId: string = foundry.utils.randomID(16);

      // 5. Slug identifier
      const identifier = slugify(data.featureName);

      // 5a. Map emanation → radius (Foundry uses "radius" for radial emanations)
      const mappedAreaType: string = data.areaType === 'emanation' ? 'radius' : data.areaType;

      // 6. Build item data — schema verified against dnd5e 5.1.8 real output
      const itemData = {
        name: data.featureName,
        type: 'feat',
        img: 'systems/dnd5e/icons/svg/items/feature.svg',
        system: {
          description: { value: data.description, chat: '' },
          identifier,
          source: { revision: 1, rules: '2024' },
          type: { value: 'monster', subtype: '' },
          uses: { spent: 0, recovery: [], max: '' },
          advancement: [],
          crewed: false,
          enchant: {},
          prerequisites: { items: [], repeatable: false, level: null },
          properties: [],
          requirements: '',
          activities: {
            [activityId]: {
              _id: activityId,
              type: 'save',
              sort: 0,
              name: '',
              activation: {
                type: data.activationType,
                override: false,
              },
              consumption: {
                scaling: { allowed: false },
                spellSlot: true,
                targets: [],
              },
              description: {},
              duration: { units: 'inst', concentration: false, override: false },
              effects: [],
              range: { units: 'self', override: false },
              uses: { spent: 0, recovery: [] },
              target: {
                template: {
                  contiguous: false,
                  units: data.areaUnits,
                  count: '',
                  type: mappedAreaType,
                  size: mappedAreaType ? String(data.areaSize) : '',
                },
                affects: {
                  choice: false,
                  count: '',
                  type: data.affectsType,
                  special: '',
                },
                override: false,
                prompt: true,
              },
              damage: {
                onSave: data.halfOnSave ? 'half' : 'none',
                parts: data.damageParts.map(p => ({
                  custom: { enabled: false, formula: '' },
                  number: p.number,
                  denomination: p.denomination,
                  bonus: '',
                  types: [p.type],
                  scaling: { mode: '', number: 1 },
                })),
              },
              save: {
                ability: [data.saveAbility],
                dc: {
                  calculation: '',
                  formula: String(data.saveDC),
                },
              },
            },
          },
        },
        effects: [],
      };

      // 7. Create embedded item
      const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as [Item];

      // 8. Return structured result
      return {
        success: true,
        item: { id: created.id, name: created.name },
        actor: { id: actor.id, name: actor.name },
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add save feature to actor`, error);
      throw error;
    }
  }

  // ===== CREATE NPC ACTOR (D&D 5e) =====

  async createNpcActor(data: CreateNpcActorInput): Promise<CreateNpcActorResult> {
    shared.validateFoundryState();

    try {
      // 1. System guard
      if (game.system.id !== 'dnd5e') {
        throw new Error(
          `createNpcActor requires D&D 5e. ` + `Current system: "${game.system.id}".`
        );
      }

      // 2. Duplicate check by name — only against other NPCs, so a player
      //    character sharing the name does not block NPC creation.
      const existingActor = game.actors?.find(a => a.name === data.name && a.type === 'npc');
      if (existingActor) {
        throw new Error(
          `NPC "${data.name}" already exists (id: ${existingActor.id}). ` +
            `Use a different name or remove the existing NPC first.`
        );
      }

      // 3. Soft validation — collect warnings, do NOT block creation
      const warnings: string[] = [];
      const allDamageValues: Array<{ field: string; value: string }> = [
        ...data.damageImmunities.map(v => ({ field: 'damageImmunities', value: v })),
        ...data.damageResistances.map(v => ({ field: 'damageResistances', value: v })),
        ...data.damageVulnerabilities.map(v => ({ field: 'damageVulnerabilities', value: v })),
      ];
      for (const { field, value } of allDamageValues) {
        if (!NPC_DAMAGE_CANONICAL.has(value)) {
          const msg = `Unknown damage type "${value}" in ${field} — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }
      for (const value of data.conditionImmunities) {
        if (!NPC_CONDITION_CANONICAL.has(value)) {
          const msg = `Unknown condition "${value}" in conditionImmunities — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Normalize CR to float
      const normalizedCR = npcNormalizeCR(data.cr);

      // 5. Folder
      const folderId = await shared.getOrCreateFolder('Foundry MCP Creatures', 'Actor');

      // 6. Ability scores with saving throw proficiency flags
      const savingThrowSet = new Set(data.savingThrows);
      const abilities = {
        str: { value: data.abilities.str, proficient: savingThrowSet.has('str') ? 1 : 0 },
        dex: { value: data.abilities.dex, proficient: savingThrowSet.has('dex') ? 1 : 0 },
        con: { value: data.abilities.con, proficient: savingThrowSet.has('con') ? 1 : 0 },
        int: { value: data.abilities.int, proficient: savingThrowSet.has('int') ? 1 : 0 },
        wis: { value: data.abilities.wis, proficient: savingThrowSet.has('wis') ? 1 : 0 },
        cha: { value: data.abilities.cha, proficient: savingThrowSet.has('cha') ? 1 : 0 },
      };

      // 7. AC block. dnd5e 6.0 made `calc` a derived, non-persisted field (an Active
      // Effect change target, recomputed every data-prep pass, not actor source data)
      // and moved the "flat AC" write target to `ac.override`; `ac.flat` stays as a
      // real persisted field alongside it. dnd5e 6's own migration would map the old
      // `{calc:'flat', flat}` shape onto `override` for us, but that migration shim
      // has no guaranteed lifetime, so write the version-native shape directly.
      // verified: dnd5e.mjs:9582 (`calc: new StringField(..., {persisted: false})`),
      // :9591 (`flat`, persisted), :9600 (`override`, persisted), :9725
      // (`_migrateArmorClass`: `case "flat": ac.override = ac.flat`).
      const dnd5eV6 = isDnd5eV6();
      const acBlock = dnd5eV6
        ? data.acMode === 'flat'
          ? { flat: data.acValue, override: data.acValue }
          : {}
        : data.acMode === 'flat'
          ? { calc: 'flat', flat: data.acValue }
          : { calc: 'default' };

      // dnd5e 6.0 moved the flat movement-type keys (`walk`/`fly`/...) into a
      // `speeds` map; the old keys remain as a shimmed getter/setter on the
      // *prepared* actor (assigning through the setter logs a compatibility
      // warning), so write `speeds` directly on 6.0 instead of relying on it.
      // verified: dnd5e.mjs:5471 (`MovementField` — `speeds: new MappingField(...)`),
      // :5478 (`_migrate`: old keys → `speeds.*`), :5521 (`_shim` — the setter
      // warns "movement.<key> has moved to movement.speeds.<key>", since 6.0 until
      // 7.0).
      const movementBlock = dnd5eV6
        ? {
            speeds: {
              walk: data.walkSpeed,
              fly: data.flySpeed,
              swim: data.swimSpeed,
              climb: data.climbSpeed,
              burrow: data.burrowSpeed,
            },
            units: 'ft',
            hover: data.hover,
            special: '',
          }
        : {
            walk: data.walkSpeed,
            fly: data.flySpeed,
            swim: data.swimSpeed,
            climb: data.climbSpeed,
            burrow: data.burrowSpeed,
            units: 'ft',
            hover: data.hover,
            special: '',
          };

      // dnd5e 6.0 moved `details.source` to a top-level `system.source` (NPCData no
      // longer has a `source` subfield under `details`). dnd5e's own migration
      // (`NPCData.#migrateSource`) folds an object at `details.source` back into
      // `system.source` for us, so the old shape is not silently dropped — but,
      // as with AC/movement, write the version-native location directly rather
      // than depend on that migration shim.
      // verified: dnd5e.mjs:85285 (`NPCData.defineSchema`: `source: new SourceField()`
      // at top level, `details: {...DetailsField.common, ...DetailsField.creature,
      // type, habitat, cr, treasure}` — no `source` key), :85472
      // (`NPCData.#migrateSource`).
      const sourceBlock = {
        revision: 1,
        rules: data.sourceRules,
        book: data.sourceBook,
        page: data.sourcePage,
        custom: '',
        license: '',
      };

      // 8. Build full actor data
      const actorData: Record<string, unknown> = {
        name: data.name,
        type: 'npc',
        system: {
          abilities,
          attributes: {
            ac: acBlock,
            hp: {
              value: data.hpAverage,
              max: data.hpAverage,
              temp: 0,
              tempmax: 0,
              formula: data.hpFormula,
            },
            movement: movementBlock,
            senses: {
              darkvision: data.darkvision,
              blindsight: data.blindsight,
              tremorsense: data.tremorsense,
              truesight: data.truesight,
              units: 'ft',
              special: data.specialSenses,
            },
          },
          ...(dnd5eV6 ? { source: sourceBlock } : {}),
          details: {
            cr: normalizedCR,
            type: {
              value: data.creatureType,
              subtype: data.creatureSubtype,
            },
            alignment: data.alignment,
            biography: {
              value: data.biography,
              public: '',
            },
            ...(dnd5eV6 ? {} : { source: sourceBlock }),
          },
          traits: {
            size: NPC_SIZE_MAP[data.size] ?? 'med',
            di: { value: data.damageImmunities, custom: '', bypasses: [] },
            dr: { value: data.damageResistances, custom: '', bypasses: [] },
            dv: { value: data.damageVulnerabilities, custom: '', bypasses: [] },
            ci: { value: data.conditionImmunities, custom: '' },
            languages: {
              value: data.languages,
              custom: data.languagesCustom,
              communication: {},
            },
          },
          skills: npcBuildSkillsBlock(data.skills),
        },
      };

      // 9. Assign folder if available
      if (folderId) {
        actorData.folder = folderId;
      }

      // 10. Create actor
      const actor = await Actor.create(actorData);
      if (!actor) {
        throw new Error(`Failed to create NPC actor "${data.name}"`);
      }

      // 11. Return structured result
      return {
        success: true,
        actor: {
          id: actor.id,
          name: actor.name,
          cr: npcFormatCR(normalizedCR),
          folder: folderId ?? null,
        },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to create NPC actor`, error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add weapon attack to an existing actor (dnd5e-add-attack-feature)
  // ---------------------------------------------------------------------------

  async addAttackToActor(data: AddAttackToActorInput): Promise<AddBuiltItemResult> {
    shared.validateFoundryState();

    shared.requireDnd5e('addAttackToActor');

    try {
      // 1. Resolve actor
      const actor = shared.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check
      this.requireNoExistingItem(actor, data.featureName);

      // 3. Soft validation — collect warnings, never block
      const warnings: string[] = [];

      for (const part of data.damageParts) {
        if (!ATTACK_DAMAGE_CANONICAL.has(part.type)) {
          const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }
      for (const prop of data.properties) {
        if (!ATTACK_PROPERTY_CANONICAL.has(prop)) {
          const msg = `Unknown weapon property "${prop}" — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Generate activity ID
      const activityId: string = foundry.utils.randomID(16);

      // 5. Damage parts for the activity (all except the first — which is system.damage.base)
      const activityDamageParts = data.damageParts.slice(1).map(p => ({
        types: [p.type],
        number: p.number,
        denomination: p.denomination,
        bonus: '',
        scaling: { mode: '', number: 1 },
        custom: { enabled: false },
      }));

      // 6. Range object (system-level — holds the real range/reach)
      const rangeObj =
        data.attackType === 'melee'
          ? { value: data.reachFt ?? 5, long: null, units: 'ft' }
          : { value: data.rangeFt, long: data.longRangeFt ?? null, units: 'ft' };

      // 7. Conditional 2024-only fields
      const sourceRules: string = data.sourceRules ?? '2014';
      const masteryField = sourceRules === '2024' ? { mastery: '' } : {};
      const abilityField = sourceRules === '2024' ? { ability: data.effectiveAbility } : {};
      const classification = sourceRules === '2014' ? 'weapon' : '';

      // 8. Build item data
      const firstPart = data.damageParts[0];
      const itemData: Record<string, unknown> = {
        name: data.featureName,
        type: 'weapon',
        system: {
          description: {
            value: data.description ?? '',
            chat: '',
            unidentified: '',
          },
          source: {
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
            rules: sourceRules,
          },
          quantity: 1,
          weight: { value: 0, units: 'lb' },
          price: { value: 0, denomination: 'gp' },
          attunement: '',
          equipped: data.equipped !== false,
          rarity: '',
          identified: true,
          activation: {
            type: data.activationType ?? 'action',
            value: 1,
            condition: '',
            override: false,
          },
          duration: { value: '', units: '' },
          cover: null,
          target: {
            template: {
              count: '',
              contiguous: false,
              type: '',
              size: '',
              width: '',
              height: '',
              units: '',
            },
            affects: { count: '', type: '', choice: false, special: '' },
            prompt: true,
            override: false,
          },
          range: rangeObj,
          uses: { value: null, max: '', recovery: [], prompt: true },
          damage: {
            base: {
              types: [firstPart.type],
              number: firstPart.number,
              denomination: firstPart.denomination,
              bonus: '',
              scaling: { mode: '', number: 1 },
              custom: { enabled: false },
            },
          },
          type: { value: data.weaponClass ?? 'natural', baseItem: '' },
          properties: data.properties,
          proficient: 1,
          magicalBonus: null,
          ...masteryField,
          activities: {
            [activityId]: {
              _id: activityId,
              type: 'attack',
              name: '',
              img: '',
              sort: 0,
              description: {},
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                condition: '',
                override: false,
              },
              duration: { units: '', value: '', override: false },
              target: {
                template: {
                  count: '',
                  contiguous: false,
                  type: '',
                  size: '',
                  width: '',
                  height: '',
                  units: '',
                },
                affects: { count: '', type: '', choice: false, special: '' },
                prompt: true,
                override: false,
              },
              range: { units: 'self', override: false },
              uses: { spent: 0, max: '', recovery: [] },
              consumption: {
                targets: [],
                scaling: { allowed: false, max: '' },
                spellSlot: true,
              },
              attack: {
                ability: '',
                bonus: data.attackBonus > 0 ? String(data.attackBonus) : '',
                critical: { threshold: null },
                flat: false,
                type: {
                  value: data.attackType ?? 'melee',
                  classification,
                },
                ...abilityField,
              },
              damage: {
                critical: { bonus: '' },
                includeBase: true,
                parts: activityDamageParts,
              },
              effects: [],
              save: { ability: '', dc: { formula: '', calculation: '' } },
            },
          },
        },
      };

      // 9. Create the item on the actor
      const created = (await actor.createEmbeddedDocuments('Item', [itemData]))[0] as
        | Item
        | undefined;
      if (!created) {
        throw new Error(
          `Failed to create attack item "${data.featureName}" on actor "${actor.name}"`
        );
      }

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'weapon' },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add attack to actor`, error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add automatic-damage aura/emanation feature to an existing actor
  // (dnd5e-add-aura-feature)
  // ---------------------------------------------------------------------------

  async addAuraToActor(data: AddAuraToActorInput): Promise<AddBuiltItemResult> {
    shared.validateFoundryState();

    shared.requireDnd5e('addAuraToActor');

    try {
      // 1. Resolve actor
      const actor = shared.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check (case-insensitive name match)
      this.requireNoExistingItem(actor, data.featureName);

      // 3. Soft validation — collect warnings, never block
      const warnings: string[] = [];

      for (const part of data.damageParts) {
        if (!AURA_DAMAGE_CANONICAL.has(part.type)) {
          const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Map areaType: Foundry uses "radius" internally for what 5e 2024 calls "emanation"
      //    <option value="radius">Emanation</option> — no "emanation" value exists in the dropdown
      const mappedAreaType: string = data.areaType === 'emanation' ? 'radius' : data.areaType;

      // 5. Generate activity ID
      const activityId: string = foundry.utils.randomID(16);

      // 6. Slug identifier
      const identifier = slugify(data.featureName);

      // 7. Build item data — schema verified against dnd5e 5.1.8 Banshee Wail
      const itemData = {
        name: data.featureName,
        type: 'feat',
        img: 'systems/dnd5e/icons/svg/items/feature.svg',
        system: {
          description: { value: data.description ?? '', chat: '' },
          identifier,
          source: {
            revision: 1,
            rules: data.sourceRules ?? '2014',
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
          },
          type: { value: 'monster', subtype: '' },
          uses: { spent: 0, recovery: [], max: '' },
          advancement: [],
          crewed: false,
          enchant: {},
          prerequisites: { items: [], repeatable: false, level: null },
          properties: [],
          requirements: '',
          activities: {
            [activityId]: {
              _id: activityId,
              type: 'damage', // activity type: damage — no attack roll, no save
              name: '',
              sort: 0,
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                override: false,
                // NO condition — not present in real dnd5e 5.1.8 schema
              },
              consumption: {
                scaling: { allowed: false },
                spellSlot: true, // confirmed: true in real Banshee Wail schema
                targets: [], // no uses management in V1
              },
              description: {}, // empty object — confirmed from real schema
              duration: {
                units: 'inst',
                concentration: false,
                override: false,
              },
              effects: [],
              range: { units: 'self', override: false }, // NO value, NO special
              uses: { spent: 0, recovery: [] }, // NO max field
              target: {
                template: {
                  contiguous: false,
                  units: data.areaUnits ?? 'ft',
                  count: '',
                  type: mappedAreaType,
                  size: String(data.areaSize),
                  width: '',
                  height: '',
                },
                affects: {
                  count: '',
                  type: data.affectsType ?? 'creature',
                  choice: false,
                  special: '',
                },
                override: false,
                prompt: true,
              },
              damage: {
                critical: { allow: false }, // only this key — no bonus, no dice
                parts: data.damageParts.map(p => ({
                  types: [p.type],
                  number: p.number,
                  denomination: p.denomination,
                  bonus: '',
                  scaling: { mode: '', number: 1 }, // mode: '' required — from real schema
                  custom: { enabled: false }, // NO formula field
                })),
                // NO onSave — damage activity has no save concept
              },
              // NO save block
              // NO attack block
            },
          },
        },
        effects: [],
      };

      // 7. Create embedded item
      const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as Item[];
      if (!created) {
        throw new Error(
          `Failed to create aura item "${data.featureName}" on actor "${actor.name}"`
        );
      }

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'feat' },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add aura to actor`, error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add passive/descriptive feature to an existing actor (dnd5e-add-passive-feature)
  // No activities, no mechanics — pure description displayed on the sheet.
  // ---------------------------------------------------------------------------

  async addPassiveFeatureToActor(
    data: AddPassiveFeatureToActorInput
  ): Promise<AddPassiveFeatureToActorResult> {
    shared.validateFoundryState();

    shared.requireDnd5e('addPassiveFeatureToActor');

    try {
      // 1. Resolve actor
      const actor = shared.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check (case-insensitive)
      this.requireNoExistingItem(actor, data.featureName);

      // 3. Slug identifier
      const identifier = slugify(data.featureName);

      // 4. Build item data — no activities, no activityId needed
      const itemData = {
        name: data.featureName,
        type: 'feat',
        img: 'systems/dnd5e/icons/svg/items/feature.svg',
        system: {
          description: { value: data.description ?? '', chat: '' },
          identifier,
          source: {
            revision: 1,
            rules: data.sourceRules ?? '2014',
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
          },
          type: { value: 'monster', subtype: '' },
          uses: { spent: 0, recovery: [], max: '' },
          advancement: [],
          crewed: false,
          enchant: {},
          prerequisites: { items: [], repeatable: false, level: null },
          properties: [],
          requirements: '',
          activities: {}, // empty — passive feature has no mechanical activity
        },
        effects: [],
      };

      // 5. Create embedded item
      const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as Item[];
      if (!created) {
        throw new Error(
          `Failed to create passive feature "${data.featureName}" on actor "${actor.name}"`
        );
      }

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'feat' },
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add passive feature to actor`, error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add weapon attack + save effect to an existing actor
  // (dnd5e-add-attack-with-save) — Tipo B
  // Two activities: attack (sort:0) + save (sort:1)
  // ---------------------------------------------------------------------------

  async addAttackWithSaveToActor(
    data: AddAttackWithSaveToActorInput
  ): Promise<AddAttackWithSaveToActorResult> {
    shared.validateFoundryState();

    shared.requireDnd5e('addAttackWithSaveToActor');

    try {
      // 1. Resolve actor
      const actor = shared.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check
      this.requireNoExistingItem(actor, data.featureName);

      // 3. Soft validation — both damage groups unified
      const warnings: string[] = [];
      const allParts = [...data.damageParts, ...data.saveDamageParts];
      for (const part of allParts) {
        if (!ATTACK_WITH_SAVE_DAMAGE_CANONICAL.has(part.type)) {
          const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
          if (!warnings.includes(msg)) warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Generate two distinct activity IDs
      const attackActivityId: string = foundry.utils.randomID(16);
      const saveActivityId: string = foundry.utils.randomID(16);

      // 5. Attack activity damage parts: damageParts[1+] (base is in system.damage.base)
      const activityDamageParts = data.damageParts.slice(1).map(p => ({
        types: [p.type],
        number: p.number,
        denomination: p.denomination,
        bonus: '',
        scaling: { mode: '', number: 1 },
        custom: { enabled: false },
      }));

      // 6. Save activity damage parts: ALL saveDamageParts (no base — independent)
      const saveActivityDamageParts = data.saveDamageParts.map(p => ({
        types: [p.type],
        number: p.number,
        denomination: p.denomination,
        bonus: '',
        scaling: { mode: '', number: 1 },
        custom: { enabled: false },
      }));

      // 7. System-level range (real reach/range — activity range is always 'self')
      const rangeObj =
        data.attackType === 'melee'
          ? { value: data.reachFt ?? 5, long: null, units: 'ft' }
          : { value: data.rangeFt, long: data.longRangeFt ?? null, units: 'ft' };

      // 8. Conditional 2024-only fields (same rules as Tipo A)
      const sourceRules: string = data.sourceRules ?? '2014';
      const masteryField = sourceRules === '2024' ? { mastery: '' } : {};
      const abilityField = sourceRules === '2024' ? { ability: data.effectiveAbility } : {};
      const classification = sourceRules === '2014' ? 'weapon' : '';

      // 9. Build item data
      const itemData: Record<string, unknown> = {
        name: data.featureName,
        type: 'weapon',
        system: {
          description: {
            value: data.description ?? '',
            chat: '',
            unidentified: '',
          },
          source: {
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
            rules: sourceRules,
          },
          quantity: 1,
          weight: { value: 0, units: 'lb' },
          price: { value: 0, denomination: 'gp' },
          attunement: '',
          equipped: data.equipped !== false,
          rarity: '',
          identified: true,
          activation: {
            type: data.activationType ?? 'action',
            value: 1,
            condition: '',
            override: false,
          },
          duration: { value: '', units: '' },
          cover: null,
          target: {
            template: {
              count: '',
              contiguous: false,
              type: '',
              size: '',
              width: '',
              height: '',
              units: '',
            },
            affects: { count: '', type: '', choice: false, special: '' },
            prompt: true,
            override: false,
          },
          range: rangeObj,
          uses: { value: null, max: '', recovery: [], prompt: true },
          damage: {
            base: {
              types: [data.damageParts[0].type],
              number: data.damageParts[0].number,
              denomination: data.damageParts[0].denomination,
              bonus: '',
              scaling: { mode: '', number: 1 },
              custom: { enabled: false },
            },
          },
          type: { value: data.weaponClass ?? 'natural', baseItem: '' },
          properties: data.properties,
          proficient: 1,
          magicalBonus: null,
          ...masteryField,
          activities: {
            // ── Activity 1: attack (sort 0) ───────────────────────────────
            [attackActivityId]: {
              _id: attackActivityId,
              type: 'attack',
              name: '',
              img: '',
              sort: 0,
              description: {},
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                condition: '',
                override: false,
              },
              duration: { units: '', value: '', override: false },
              target: {
                template: {
                  count: '',
                  contiguous: false,
                  type: '',
                  size: '',
                  width: '',
                  height: '',
                  units: '',
                },
                affects: { count: '', type: '', choice: false, special: '' },
                prompt: true,
                override: false,
              },
              range: { units: 'self', override: false },
              uses: { spent: 0, max: '', recovery: [] },
              consumption: { targets: [], scaling: { allowed: false, max: '' }, spellSlot: true },
              attack: {
                ability: '',
                bonus: data.attackBonus > 0 ? String(data.attackBonus) : '',
                critical: { threshold: null },
                flat: false,
                type: { value: data.attackType ?? 'melee', classification },
                ...abilityField,
              },
              damage: {
                critical: { bonus: '' },
                includeBase: true,
                parts: activityDamageParts,
              },
              effects: [],
              save: { ability: '', dc: { formula: '', calculation: '' } },
            },

            // ── Activity 2: save (sort 1) ─────────────────────────────────
            [saveActivityId]: {
              _id: saveActivityId,
              type: 'save',
              name: '',
              sort: 1,
              description: {}, // {} — not { chatFlavor: '' } (real schema confirmed)
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                override: false,
                // NO condition — per real schema
              },
              duration: { units: 'inst', concentration: false, override: false },
              effects: [],
              range: { units: 'self', override: false },
              uses: { spent: 0, recovery: [] }, // NO max
              consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] },
              target: {
                template: {
                  count: '',
                  contiguous: false,
                  type: '',
                  size: '',
                  width: '',
                  height: '',
                  units: '',
                },
                affects: { count: '1', type: 'creature', choice: false, special: '' },
                override: false,
                prompt: true,
              },
              damage: {
                onSave: data.saveOnSave ?? 'none',
                parts: saveActivityDamageParts,
                // NO includeBase — save damage is independent from weapon base damage
              },
              save: {
                ability: [data.saveAbility],
                dc: { calculation: '', formula: String(data.saveDC) },
              },
            },
          },
        },
      };

      // 10. Create the item on the actor
      const created = (await actor.createEmbeddedDocuments('Item', [itemData]))[0] as
        | Item
        | undefined;
      if (!created) {
        throw new Error(
          `Failed to create attack+save item "${data.featureName}" on actor "${actor.name}"`
        );
      }

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'weapon' },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add attack+save to actor`, error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Set actor spellcasting (ability + slot counts)
  // ---------------------------------------------------------------------------

  async setActorSpellcasting(data: SetActorSpellcastingInput): Promise<SetActorSpellcastingResult> {
    shared.validateFoundryState();

    shared.requireDnd5e('setActorSpellcasting');

    try {
      // 1. Resolve actor
      const actor = shared.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      const cls = data.spellcastingClass;
      const lvl = data.spellcastingLevel;
      const ability = data.effectiveAbility;
      const idx = lvl - 1; // 0-based index into slot tables
      const warnings: string[] = [];

      // 2. Build flat updates object for a single actor.update() call
      const updates: Record<string, unknown> = {};

      // Spellcasting ability
      updates['system.attributes.spellcasting'] = ability;

      // dnd5e 6 derives each slot's `max` (and the pact slot level) in data preparation:
      // max = `override` when set, else the class progression. Writing `max` is dropped,
      // so an NPC without classes kept max 0 (seen in the live write sweep). Set the
      // slot counts as overrides, and an NPC's spellcaster level, which dnd5e uses for
      // its progression and for the pact slot level. Verified: dnd5e 6.0.5
      // `prepareSlots` (leveled and single-level models) and NPCData `attributes.spell`.
      const isNpc = actor.type === 'npc';
      if (isNpc) updates['system.attributes.spell.level'] = lvl;

      if (cls === 'warlock') {
        // ── Pact Magic ────────────────────────────────────────────────────────
        // All regular slots set to 0; pact slots from table
        for (let i = 1; i <= 9; i++) {
          updates[`system.spells.spell${i}.override`] = 0;
          updates[`system.spells.spell${i}.value`] = 0;
        }
        const pact = WARLOCK_PACT_TABLE[idx];
        updates['system.spells.pact.override'] = pact.max;
        updates['system.spells.pact.value'] = pact.max;
        if (!isNpc) {
          warnings.push(
            "pact slot level comes from the actor's warlock class; only the slot count was set"
          );
        }
      } else {
        // ── Regular spell slots ───────────────────────────────────────────────
        let slotRow: number[];

        if (cls === 'artificer') {
          slotRow = ARTIFICER_SLOTS[idx];
        } else if (cls === 'paladin' || cls === 'ranger') {
          slotRow = HALF_CASTER_SLOTS[idx];
          if (lvl === 1) {
            warnings.push(
              `${cls} level 1 has no spell slots — use level 2+ to unlock spellcasting`
            );
          }
        } else {
          // Full casters: wizard, cleric, druid, sorcerer, bard
          slotRow = FULL_CASTER_SLOTS[idx];
        }

        for (let i = 1; i <= 9; i++) {
          const n = slotRow[i - 1];
          updates[`system.spells.spell${i}.override`] = n;
          updates[`system.spells.spell${i}.value`] = n;
        }
      }

      // 3. Single update call
      await actor.update(updates);

      // 4. Build response
      const slots: Record<string, unknown> = {};
      if (cls === 'warlock') {
        const pact = WARLOCK_PACT_TABLE[idx];
        slots['pact'] = { max: pact.max, level: pact.level };
      } else {
        const slotRow =
          cls === 'artificer'
            ? ARTIFICER_SLOTS[idx]
            : cls === 'paladin' || cls === 'ranger'
              ? HALF_CASTER_SLOTS[idx]
              : FULL_CASTER_SLOTS[idx];

        for (let i = 1; i <= 9; i++) {
          (slots as Record<string, number>)[`spell${i}`] = slotRow[i - 1];
        }
      }

      return {
        actor: { id: actor.id, name: actor.name },
        spellcasting: { ability, slots },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to set actor spellcasting`, error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add spells from compendium packs to an actor
  // ---------------------------------------------------------------------------

  async addSpellsToActor(data: AddSpellsToActorInput): Promise<CompendiumImportResult> {
    return this.importFromCompendium(data, data.spellNames, {
      defaultPacks: ['dnd5e.spells'],
      noValidPacksMessage:
        'No valid compendium packs available — check the compendiumPacks parameter. ' +
        'Valid pack IDs for D&D 5e: "dnd5e.spells" (2014) or "dnd5e.spells24" (2024).',
      // Only an existing item of type 'spell' counts as a duplicate.
      isDuplicate: (i: ImportableItem, normalizedName: string) =>
        i.type === 'spell' && i.name?.toLowerCase() === normalizedName,
      operation: 'addSpellsToActor',
    });
  }

  // ---------------------------------------------------------------------------
  // Add features from compendium packs to an actor
  // ---------------------------------------------------------------------------

  async addFeaturesFromCompendium(
    data: AddFeaturesFromCompendiumInput
  ): Promise<CompendiumImportResult> {
    return this.importFromCompendium(data, data.featureNames, {
      defaultPacks: ['dnd5e.monsterfeatures', 'dnd5e.classfeatures'],
      noValidPacksMessage:
        'No valid compendium packs available — check the compendiumPacks parameter. ' +
        'Valid pack IDs for D&D 5e: "dnd5e.monsterfeatures" or "dnd5e.classfeatures" (2014), ' +
        '"dnd5e.monsterfeatures24" (2024 monster features). ' +
        'Note: 2024 class features are embedded in class items and cannot be imported with this tool.',
      // A feature name is semantically unique on an actor regardless of item type.
      isDuplicate: (i: ImportableItem, normalizedName: string) =>
        i.name?.toLowerCase() === normalizedName,
      operation: 'addFeaturesFromCompendium',
    });
  }

  /**
   * Trigger an NPC's attack (or other item activity) and report the attack roll,
   * hit/miss vs an AC, crit, and damage. dnd5e v3 uses Item-level rollAttack/
   * rollDamage; v4/v5 use the Activity API.
   */
  async useNpcActivity(data: UseNpcActivityInput): Promise<UseNpcActivityResult> {
    shared.validateFoundryState();
    shared.requireDnd5e('use-npc-activity');

    // Token-aware: an unlinked token (a boss) spends its own uses and legendary actions.
    const actor = shared.resolveTargetActor(data.actorName) as NpcActivityActor | undefined;
    if (!actor) throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.actorName}`);
    const item = actor.items.find(
      i =>
        i.id === data.itemName ||
        i.name?.toLowerCase() === data.itemName.toLowerCase() ||
        i.name?.toLowerCase().includes(data.itemName.toLowerCase()) === true
    );
    if (!item) throw new Error(`Item "${data.itemName}" not found on "${actor.name}"`);

    const major = shared.systemMajor();
    let attackTotal: number | null = null;
    let isCritical = false;
    let damageTotal: number | null = null;
    let formula: string | null = null;
    let usedActivity = false;
    let attackSucceeded: boolean | null = null;

    if (major >= 4) {
      const activities = item.system?.activities;
      const attackAct =
        activities?.getByType?.('attack')?.[0] ||
        (activities?.contents ?? []).find(a => a.type === 'attack');
      // Public unless asked otherwise; dnd5e's message config names the visibility `rollMode`.
      const message = { create: true, rollMode: shared.rollModeFor(data.isPublic !== false) };
      if (attackAct) {
        usedActivity = true;
        const atkOut = await attackAct.rollAttack({}, { configure: false }, message);
        const atk = Array.isArray(atkOut) ? atkOut[0] : atkOut;
        attackTotal = atk?.total ?? null;
        isCritical = atk?.isCritical ?? false;
        formula = atk?.formula ?? null;
        // dnd5e auto-fills the attack's target from a targeted token's AC.
        attackSucceeded = typeof atk?.isSuccess === 'boolean' ? atk.isSuccess : null;
        const dmgOut = await attackAct.rollDamage({ isCritical }, { configure: false }, message);
        damageTotal = Array.isArray(dmgOut)
          ? dmgOut.reduce((s: number, r) => s + (r.total || 0), 0)
          : (dmgOut?.total ?? null);
      } else {
        // No attack activity — just use the item (posts its card).
        await item.use({}, { configure: false }, message);
      }
    } else {
      // dnd5e v3 — Item-level rolls
      const atkOpts: Record<string, unknown> = { fastForward: true };
      if (data.targetAC != null) atkOpts.targetValue = data.targetAC;
      const atk = await item.rollAttack(atkOpts);
      if (atk) {
        usedActivity = true;
        attackTotal = atk.total ?? null;
        isCritical = atk.isCritical ?? false;
        formula = atk.formula ?? null;
        attackSucceeded = typeof atk?.isSuccess === 'boolean' ? atk.isSuccess : null;
        const dmg = await item.rollDamage({
          critical: isCritical,
          options: { fastForward: true },
        });
        damageTotal = dmg?.total ?? null;
      } else {
        await item.use({}, { configureDialog: false, createMessage: true });
      }
    }

    // Resolve the target AC: explicit param wins, else the GM's targeted token.
    let targetAC = data.targetAC ?? null;
    let targetName: string | null = null;
    try {
      const userTargets = Array.from((game.user as User | undefined)?.targets ?? []);
      if (userTargets.length > 0) {
        const tt = userTargets[0];
        targetName = tt.name ?? null;
        targetAC ??= tt.actor?.system?.attributes?.ac?.value ?? null;
      }
    } catch {
      // no targeting available
    }

    const hit = targetAC != null && attackTotal != null ? attackTotal >= targetAC : attackSucceeded; // falls back to dnd5e's own target evaluation

    return {
      success: true,
      actor: actor.name,
      item: item.name,
      hadAttack: usedActivity,
      attackTotal,
      targetName,
      targetAC,
      hit,
      isCritical,
      damageTotal,
      formula,
    };
  }

  // ---- private helpers ------------------------------------------------------

  /** Extract a human-readable message from an unknown thrown value. */
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  /** Throw if the actor already carries an item with this name (case-insensitive). */
  private requireNoExistingItem(
    actor: { name: string; items: FoundryCollection<{ name: string }> },
    featureName: string
  ): void {
    const existing = actor.items.find(i => i.name.toLowerCase() === featureName.toLowerCase());
    if (existing) {
      throw new Error(
        `An item named "${featureName}" already exists on actor "${actor.name}". ` +
          `Remove or rename it first.`
      );
    }
  }

  /**
   * Shared compendium-import engine for {@link addSpellsToActor} /
   * {@link addFeaturesFromCompendium}. Deduplicates the requested names
   * (case-insensitive), indexes each requested Item-typed pack once, then per
   * name: skips on-actor duplicates (per `opts.isDuplicate`) and input
   * duplicates, resolves the name first-pack-wins, fetches the document, strips
   * its `_id`, and embeds it (per-item error isolation). Returns the
   * added/skipped/notFound/failed/warnings breakdown.
   */
  private async importFromCompendium(
    data: CompendiumImportTarget,
    names: string[],
    opts: {
      defaultPacks: string[];
      noValidPacksMessage: string;
      isDuplicate: (item: ImportableItem, normalizedName: string) => boolean;
      operation: string;
    }
  ): Promise<CompendiumImportResult> {
    shared.validateFoundryState();
    shared.requireDnd5e(opts.operation);

    try {
      const actor = shared.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      const compendiumPacks: string[] = data.compendiumPacks ?? opts.defaultPacks;
      const warnings: string[] = [];

      // Phase A: deduplicate input (case-insensitive).
      const seen = new Set<string>();
      const unique: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      for (const name of names) {
        const key = name.toLowerCase();
        if (seen.has(key)) {
          skipped.push({ name, reason: 'duplicate in input' });
        } else {
          seen.add(key);
          unique.push(name);
        }
      }

      // Phase B: index each valid Item-typed pack once (lowercase name → _id).
      const packMaps: Array<{ packId: string; packLabel: string; nameMap: Map<string, string> }> =
        [];
      for (const packId of compendiumPacks) {
        const pack = game.packs.get(packId);
        if (!pack) {
          warnings.push(`Compendium pack "${packId}" not found — skipped`);
          continue;
        }
        if (pack.metadata.type !== 'Item') {
          warnings.push(
            `Pack "${packId}" has type "${pack.metadata.type}", expected "Item" — skipped`
          );
          continue;
        }
        if (!pack.indexed) {
          await pack.getIndex({});
        }
        const nameMap = new Map<string, string>();
        for (const entry of pack.index.values()) {
          if (entry.name) {
            nameMap.set(entry.name.toLowerCase(), entry._id);
          }
        }
        packMaps.push({ packId, packLabel: pack.metadata.label, nameMap });
      }

      if (packMaps.length === 0) {
        throw new Error(opts.noValidPacksMessage);
      }

      // Phase C: per-name search + import.
      const added: Array<{ name: string; packId: string; packLabel: string; itemId: string }> = [];
      const notFound: string[] = [];
      const failed: Array<{ name: string; error: string }> = [];

      for (const name of unique) {
        const normalizedName = name.toLowerCase();

        const existing = actor.items.find(i => opts.isDuplicate(i, normalizedName));
        if (existing) {
          skipped.push({ name, reason: 'already on actor' });
          continue;
        }

        // Resolve first-pack-wins.
        let found: { packId: string; packLabel: string; entryId: string } | null = null;
        for (const pm of packMaps) {
          const entryId = pm.nameMap.get(normalizedName);
          if (entryId) {
            found = { packId: pm.packId, packLabel: pm.packLabel, entryId };
            break;
          }
        }
        if (!found) {
          notFound.push(name);
          continue;
        }

        const pack = game.packs.get(found.packId) as CompendiumCollection<Item>;
        const document = await pack.getDocument(found.entryId);
        if (!document) {
          // In the index but the document is missing (defensive).
          notFound.push(name);
          warnings.push(
            `"${name}" found in index but document missing in pack "${found.packId}" — skipped`
          );
          continue;
        }

        const itemData = document.toObject() as Record<string, unknown>;
        delete itemData._id; // Let Foundry assign a fresh local id; prevents id clash.

        try {
          const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as Item[];
          added.push({
            name,
            packId: found.packId,
            packLabel: found.packLabel,
            itemId: created.id,
          });
        } catch (embedErr) {
          failed.push({ name, error: this.errorMessage(embedErr) });
        }
      }

      return {
        actor: { id: actor.id, name: actor.name },
        added,
        skipped,
        notFound,
        failed,
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] ${opts.operation} failed`, error);
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Types of addPassiveFeatureToActor, addAttackWithSaveToActor, setActorSpellcasting,
// addSpellsToActor, addFeaturesFromCompendium and useNpcActivity.
// ---------------------------------------------------------------------------

/** Input of {@link ActorBuilderDataAccess.addPassiveFeatureToActor}. */
export interface AddPassiveFeatureToActorInput {
  actorIdentifier: string;
  featureName: string;
  description?: string | undefined;
  sourceRules?: string | undefined;
  sourceBook?: string | undefined;
  sourcePage?: string | undefined;
}

/** Result of {@link ActorBuilderDataAccess.addPassiveFeatureToActor}. */
export interface AddPassiveFeatureToActorResult {
  success: boolean;
  actor: { id: string; name: string };
  item: { id: string; name: string; type: string };
}

/** Input of {@link ActorBuilderDataAccess.addAttackWithSaveToActor}. */
export interface AddAttackWithSaveToActorInput {
  actorIdentifier: string;
  featureName: string;
  damageParts: BuilderDamagePart[];
  saveDamageParts: BuilderDamagePart[];
  saveAbility: string;
  saveDC: number | string;
  attackBonus: number;
  attackType?: string | undefined;
  reachFt?: number | undefined;
  rangeFt?: number | undefined;
  longRangeFt?: number | undefined;
  saveOnSave?: string | undefined;
  properties?: string[] | undefined;
  weaponClass?: string | undefined;
  equipped?: boolean | undefined;
  activationType?: string | undefined;
  effectiveAbility?: string | undefined;
  description?: string | undefined;
  sourceRules?: string | undefined;
  sourceBook?: string | undefined;
  sourcePage?: string | undefined;
}

/** Result of {@link ActorBuilderDataAccess.addAttackWithSaveToActor} (the shape {@link AddBuiltItemResult}). */
export type AddAttackWithSaveToActorResult = AddBuiltItemResult;

/** Input of {@link ActorBuilderDataAccess.setActorSpellcasting}. */
export interface SetActorSpellcastingInput {
  actorIdentifier: string;
  spellcastingClass: string;
  spellcastingLevel: number;
  effectiveAbility: string;
}

/** Result of {@link ActorBuilderDataAccess.setActorSpellcasting}. */
export interface SetActorSpellcastingResult {
  actor: { id: string; name: string };
  spellcasting: { ability: string; slots: Record<string, unknown> };
  warnings: string[];
}

/** What the compendium import needs to find the actor and the packs to search. */
export interface CompendiumImportTarget {
  actorIdentifier: string;
  compendiumPacks?: string[] | undefined;
}

/** Input of {@link ActorBuilderDataAccess.addSpellsToActor}. */
export interface AddSpellsToActorInput extends CompendiumImportTarget {
  spellNames: string[];
}

/** Input of {@link ActorBuilderDataAccess.addFeaturesFromCompendium}. */
export interface AddFeaturesFromCompendiumInput extends CompendiumImportTarget {
  featureNames: string[];
}

/** Result of {@link ActorBuilderDataAccess.addSpellsToActor} and {@link ActorBuilderDataAccess.addFeaturesFromCompendium}. */
export interface CompendiumImportResult {
  actor: { id: string; name: string };
  added: Array<{ name: string; packId: string; packLabel: string; itemId: string }>;
  skipped: Array<{ name: string; reason: string }>;
  notFound: string[];
  failed: Array<{ name: string; error: string }>;
  warnings: string[];
}

/** The part of an item the compendium import's duplicate check reads. */
interface ImportableItem {
  type?: string | undefined;
  name?: string | undefined;
}

/** Input of {@link ActorBuilderDataAccess.useNpcActivity}. */
export interface UseNpcActivityInput {
  actorName: string;
  itemName: string;
  targetAC?: number | undefined;
  isPublic?: boolean | undefined;
}

/** Result of {@link ActorBuilderDataAccess.useNpcActivity}. */
export interface UseNpcActivityResult {
  success: boolean;
  actor: string;
  item: string | undefined;
  hadAttack: boolean;
  attackTotal: number | null;
  targetName: string | null;
  targetAC: number | null;
  hit: boolean | null;
  isCritical: boolean;
  damageTotal: number | null;
  formula: string | null;
}

/** What a dnd5e attack or damage roll reports (an Activity returns one or a list, an Item one). */
interface NpcRollResult {
  total?: number | null | undefined;
  isCritical?: boolean | undefined;
  formula?: string | undefined;
  isSuccess?: unknown;
}

type NpcRollOutput = NpcRollResult | NpcRollResult[] | null | undefined;

/** A dnd5e activity as `useNpcActivity` drives it (v4+). */
interface NpcAttackActivity {
  type?: string | undefined;
  rollAttack(config: object, dialog: object, message: object): Promise<NpcRollOutput>;
  rollDamage(config: object, dialog: object, message: object): Promise<NpcRollOutput>;
}

interface NpcActivityCollection {
  getByType?(type: string): NpcAttackActivity[] | undefined;
  contents?: NpcAttackActivity[] | undefined;
}

/** A dnd5e item as `useNpcActivity` drives it: the roll and use methods are not in the core Item declaration. */
interface NpcActivityItem {
  id: string;
  name?: string | undefined;
  system?: { activities?: NpcActivityCollection | undefined } | undefined;
  use(config: object, dialog: object, message?: object): Promise<unknown>;
  rollAttack(options: object): Promise<NpcRollResult | null | undefined>;
  rollDamage(options: object): Promise<NpcRollResult | null | undefined>;
}

interface NpcActivityActor {
  name: string;
  items: FoundryCollection<NpcActivityItem>;
}
