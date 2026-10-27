/**
 * D&D 5e System Adapter
 *
 * Implements SystemAdapter interface for D&D 5th Edition support.
 * Handles creature indexing, filtering, formatting, and data extraction.
 */

import type {
  SystemAdapter,
  SystemMetadata,
  SystemCreatureIndex,
  DnD5eCreatureIndex,
} from '../types.js';
import { arr, at, rec, type Rec } from '../data.js';
import { DnD5eFiltersSchema, matchesDnD5eFilters, describeDnD5eFilters } from './filters.js';

/** Narrow an unknown value to a plain object record, or undefined otherwise. */
function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

/** True when the value is a finite number greater than zero. */
function isPositiveNumber(v: unknown): boolean {
  return typeof v === 'number' && v > 0;
}

/**
 * D&D 5e system adapter
 */
export class DnD5eAdapter implements SystemAdapter {
  getMetadata(): SystemMetadata {
    return {
      id: 'dnd5e',
      name: 'dnd5e',
      displayName: 'Dungeons & Dragons 5th Edition',
      version: '1.0.0',
      description:
        'Support for D&D 5e game system with Challenge Rating, creature types, and legendary actions',
      supportedFeatures: {
        creatureIndex: true,
        characterStats: true,
        spellcasting: true,
        powerLevel: true, // Uses Challenge Rating
      },
    };
  }

  canHandle(systemId: string): boolean {
    return systemId.toLowerCase() === 'dnd5e';
  }

  /**
   * Creature-index extraction runs in the Foundry module's browser context
   * (packages/foundry-module/src/data-access.ts), where the live compendium
   * documents are available — not in this MCP-server adapter. This method
   * exists only to satisfy the SystemAdapter interface and always throws.
   */
  extractCreatureData(
    _doc: unknown,
    _pack: unknown
  ): { creature: SystemCreatureIndex; errors: number } | null {
    throw new Error(
      'extractCreatureData runs in the Foundry module browser index builder, not the MCP-server adapter'
    );
  }

  getFilterSchema(): typeof DnD5eFiltersSchema {
    return DnD5eFiltersSchema;
  }

  matchesFilters(creature: SystemCreatureIndex, filters: Record<string, unknown>): boolean {
    // Validate filters match D&D 5e schema
    const validated = DnD5eFiltersSchema.safeParse(filters);
    if (!validated.success) {
      return false;
    }

    return matchesDnD5eFilters(creature, validated.data);
  }

  getDataPaths(): Record<string, string | null> {
    return {
      // D&D 5e specific paths
      challengeRating: 'system.details.cr',
      creatureType: 'system.details.type.value',
      size: 'system.traits.size',
      alignment: 'system.details.alignment',
      level: 'system.details.level.value', // For NPCs/characters
      hitPoints: 'system.attributes.hp',
      armorClass: 'system.attributes.ac.value',
      abilities: 'system.abilities',
      skills: 'system.skills',
      spells: 'system.spells',
      legendaryActions: 'system.resources.legact',
      legendaryResistances: 'system.resources.legres',
      // PF2e-specific paths don't exist in D&D 5e
      perception: null,
      saves: null,
      rarity: null,
    };
  }

  formatCreatureForList(creature: SystemCreatureIndex): Rec {
    const dnd5eCreature = creature as DnD5eCreatureIndex;
    const formatted: Rec = {
      id: creature.id,
      name: creature.name,
      type: creature.type,
      pack: {
        id: creature.packName,
        label: creature.packLabel,
      },
    };

    // Add D&D 5e specific stats
    if (dnd5eCreature.systemData) {
      const stats: Rec = {};

      if (dnd5eCreature.systemData.challengeRating !== undefined) {
        stats.challengeRating = dnd5eCreature.systemData.challengeRating;
      }

      if (dnd5eCreature.systemData.creatureType) {
        stats.creatureType = dnd5eCreature.systemData.creatureType;
      }

      if (dnd5eCreature.systemData.size) {
        stats.size = dnd5eCreature.systemData.size;
      }

      if (dnd5eCreature.systemData.alignment) {
        stats.alignment = dnd5eCreature.systemData.alignment;
      }

      if (dnd5eCreature.systemData.hitPoints) {
        stats.hitPoints = dnd5eCreature.systemData.hitPoints;
      }

      if (dnd5eCreature.systemData.armorClass) {
        stats.armorClass = dnd5eCreature.systemData.armorClass;
      }

      if (dnd5eCreature.systemData.hasLegendaryActions) {
        stats.hasLegendaryActions = true;
      }

      if (dnd5eCreature.systemData.hasSpellcasting) {
        stats.spellcaster = true;
      }

      if (Object.keys(stats).length > 0) {
        formatted.stats = stats;
      }
    }

    if (creature.img) {
      formatted.hasImage = true;
    }

    return formatted;
  }

  formatCreatureForDetails(creature: SystemCreatureIndex): Rec {
    const dnd5eCreature = creature as DnD5eCreatureIndex;
    const formatted = this.formatCreatureForList(creature);

    // Add additional details
    if (dnd5eCreature.systemData) {
      formatted.detailedStats = {
        challengeRating: dnd5eCreature.systemData.challengeRating,
        creatureType: dnd5eCreature.systemData.creatureType,
        size: dnd5eCreature.systemData.size,
        alignment: dnd5eCreature.systemData.alignment,
        level: dnd5eCreature.systemData.level,
        hitPoints: dnd5eCreature.systemData.hitPoints,
        armorClass: dnd5eCreature.systemData.armorClass,
        hasSpellcasting: dnd5eCreature.systemData.hasSpellcasting,
        hasLegendaryActions: dnd5eCreature.systemData.hasLegendaryActions,
      };
    }

    if (creature.img) {
      formatted.img = creature.img;
    }

    return formatted;
  }

  describeFilters(filters: Record<string, unknown>): string {
    const validated = DnD5eFiltersSchema.safeParse(filters);
    if (!validated.success) {
      return 'invalid filters';
    }

    return describeDnD5eFilters(validated.data);
  }

  getPowerLevel(creature: SystemCreatureIndex): number | undefined {
    const dnd5eCreature = creature as DnD5eCreatureIndex;

    // D&D 5e: Try CR first, then character level
    if (dnd5eCreature.systemData?.challengeRating !== undefined) {
      return dnd5eCreature.systemData.challengeRating;
    }

    if (dnd5eCreature.systemData?.level !== undefined) {
      return dnd5eCreature.systemData.level;
    }

    return undefined;
  }

  /**
   * Extract character statistics from actor data
   */
  extractCharacterStats(actorData: Rec): Rec {
    const system = rec(actorData.system);
    const stats: Rec = {};

    // Basic info
    stats.name = actorData.name;
    stats.type = actorData.type;

    // Challenge Rating or Level
    const cr = at(system, 'details', 'cr') ?? at(system, 'details', 'cr', 'value') ?? system.cr;
    if (cr !== undefined && cr !== null) {
      stats.challengeRating = Number(cr);
    }

    const level =
      at(system, 'details', 'level', 'value') ?? at(system, 'details', 'level') ?? system.level;
    if (level !== undefined && level !== null) {
      stats.level = Number(level);
    }

    // Hit Points
    const hp = at(system, 'attributes', 'hp');
    if (hp) {
      stats.hitPoints = {
        current: at(hp, 'value') ?? 0,
        max: at(hp, 'max') ?? 0,
        temp: at(hp, 'temp') ?? 0,
      };
    }

    // Armor Class
    const ac = at(system, 'attributes', 'ac', 'value') ?? at(system, 'attributes', 'ac');
    if (ac !== undefined) {
      stats.armorClass = ac;
    }

    // Abilities (STR, DEX, CON, INT, WIS, CHA)
    if (system.abilities) {
      const abilities: Rec = {};
      stats.abilities = abilities;
      for (const [key, ability] of Object.entries(rec(system.abilities))) {
        abilities[key] = {
          value: at(ability, 'value') ?? 10,
          modifier: at(ability, 'mod') ?? 0,
        };
      }
    }

    // Skills
    if (system.skills) {
      const skills: Rec = {};
      stats.skills = skills;
      for (const [key, skill] of Object.entries(rec(system.skills))) {
        skills[key] = {
          value: at(skill, 'value') ?? 0,
          modifier: at(skill, 'total') ?? at(skill, 'mod') ?? 0,
          proficient: at(skill, 'proficient') ?? 0,
        };
      }
    }

    // Creature-specific info
    if (actorData.type === 'npc') {
      // dnd5e 6 stores the type as an object ({value, subtype, custom, swarm});
      // an unset type has no usable `value` (blank, or stripped by sanitizing,
      // which used to leave the whole object, `{}`, in the output). Report only
      // a non-blank string; otherwise leave the field out like size/alignment.
      const rawType: unknown = at(system, 'details', 'type');
      const creatureType = typeof rawType === 'string' ? rawType : asRecord(rawType)?.value;
      if (typeof creatureType === 'string' && creatureType.trim() !== '') {
        stats.creatureType = creatureType;
      }

      const size =
        at(system, 'traits', 'size', 'value') ?? at(system, 'traits', 'size') ?? system.size;
      if (size) {
        stats.size = size;
      }

      const alignment =
        at(system, 'details', 'alignment', 'value') ?? at(system, 'details', 'alignment');
      if (alignment) {
        stats.alignment = alignment;
      }

      // Legendary actions — only report the block when the creature actually
      // has legendary actions. `system.resources.legact` is always a
      // `{max, spent}` container on every NPC in both dnd5e 5.3 and 6.0
      // (default max: 0), so its mere presence is not a signal; a positive
      // max is. Same pre-existing-bug family as creature-index.ts:520-535
      // (plan `creature-index.ts:520-535`).
      // verified: dnd5e.mjs 6.0.5 — NPCData.resources.legact SchemaField,
      // initial max: 0.
      const legact = asRecord(at(system, 'resources', 'legact'));
      const legactMax = typeof legact?.max === 'number' ? legact.max : 0;
      if (legactMax > 0) {
        stats.legendaryActions = {
          available: legact?.value ?? 0,
          max: legactMax,
        };
      }
    }

    // Spellcasting: a truthy `system.spells` container is not a caster signal:
    // dnd5e always populates `system.spells` (a fixed level map, each slot
    // defaulting to value: 0), and `attributes.spellcasting` (the ability) is
    // not one either (see below). Same pre-existing-bug family as creature-index.ts:520-535.
    // verified: dnd5e.mjs 6.0.5 — SpellcastingTemplate.spells (MappingField,
    // initialKeys spellLevels, value default 0); AttributesFields.creature
    // spellcasting (StringField, blank: true, default "").
    const spellsRecord = asRecord(system.spells);
    const hasSpellSlotValue = spellsRecord
      ? Object.values(spellsRecord).some(slot => {
          const s = asRecord(slot);
          return s
            ? isPositiveNumber(s.value) || isPositiveNumber(s.max) || isPositiveNumber(s.override)
            : typeof slot === 'number' && slot > 0;
        })
      : false;
    // A spell item is the real signal: the 2024 monsters (dnd5e.actors24) set a
    // casting ability on every NPC (a Wolf has "str") and their casters cast
    // from spell items, while a caster can have spell items and no ability.
    // dnd5e 6 models innate and at-will spells as spell items too.
    const items = arr(actorData.items);
    const hasSpellItem = items.some(item => asRecord(item)?.type === 'spell');
    const spellLevel = at(system, 'details', 'spellLevel');
    const hasSpells = !!(
      hasSpellSlotValue ||
      hasSpellItem ||
      (spellLevel && (spellLevel as number) > 0)
    );
    if (hasSpells) {
      stats.spellcasting = {
        hasSpells: true,
        spellLevel: spellLevel ?? 0,
      };
    }

    return stats;
  }
}
