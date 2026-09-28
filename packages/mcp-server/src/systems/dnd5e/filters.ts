/**
 * D&D 5e Filter Schemas
 *
 * Extracted from compendium-filters.ts for modular system support.
 */

import { z } from 'zod';

/**
 * D&D 5e creature types
 */
export const DnD5eCreatureTypes = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const;

export type DnD5eCreatureType = (typeof DnD5eCreatureTypes)[number];

/**
 * Common creature sizes — the display words tool callers naturally write.
 */
export const CreatureSizes = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export type CreatureSize = (typeof CreatureSizes)[number];

/**
 * dnd5e's own storage keys for size, as `system.traits.size` (and the
 * enhanced creature index built from it, see `creature-index.ts`) actually
 * hold them. Pre-existing bug (plan `filters.ts:34`): the index stores the
 * dnd5e key ('med') while this filter only accepted the display word
 * ('medium'), so a `size: 'medium'` filter never matched a medium creature.
 * verified: dnd5e.mjs 6.0.5 — `CONFIG.DND5E.actorSizes` keys are
 * tiny/sm/med/lg/huge/grg (fullKey small/medium/large/gargantuan; tiny/huge
 * have no separate fullKey — the key already is the full word). Unchanged
 * from dnd5e 5.3's actorSizes keys.
 */
export const DnD5eSizeKeys = ['tiny', 'sm', 'med', 'lg', 'huge', 'grg'] as const;
export type DnD5eSizeKey = (typeof DnD5eSizeKeys)[number];

/** Every spelling of size accepted as filter input: display words plus dnd5e's own keys. */
export const SizeFilterInputs = [
  'tiny',
  'small',
  'sm',
  'medium',
  'med',
  'large',
  'lg',
  'huge',
  'gargantuan',
  'grg',
] as const;
export type SizeFilterInput = (typeof SizeFilterInputs)[number];

const SIZE_INPUT_TO_KEY: Record<SizeFilterInput, DnD5eSizeKey> = {
  tiny: 'tiny',
  small: 'sm',
  sm: 'sm',
  medium: 'med',
  med: 'med',
  large: 'lg',
  lg: 'lg',
  huge: 'huge',
  gargantuan: 'grg',
  grg: 'grg',
};

/**
 * Normalize either a display word ('medium') or a dnd5e size key ('med') to
 * the dnd5e key, so a filter and a stored index value compare equal
 * regardless of which spelling either side used. Exact match only (same
 * case-sensitivity contract as the rest of this schema); returns undefined
 * for anything unrecognized.
 */
export function normalizeDnD5eSizeKey(size: string): DnD5eSizeKey | undefined {
  const lower = size.toLowerCase();
  return Object.prototype.hasOwnProperty.call(SIZE_INPUT_TO_KEY, lower)
    ? SIZE_INPUT_TO_KEY[lower as SizeFilterInput]
    : undefined;
}

/**
 * D&D 5e filter schema
 */
export const DnD5eFiltersSchema = z.object({
  challengeRating: z
    .union([
      z.number(),
      z.object({
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    ])
    .optional(),
  creatureType: z.enum(DnD5eCreatureTypes).optional(),
  size: z.enum(SizeFilterInputs).optional(),
  alignment: z.string().optional(),
  hasLegendaryActions: z.boolean().optional(),
  spellcaster: z.boolean().optional(),
});

export type DnD5eFilters = z.infer<typeof DnD5eFiltersSchema>;

/**
 * Check if a creature matches D&D 5e filters
 */
export function matchesDnD5eFilters(creature: any, filters: DnD5eFilters): boolean {
  // Challenge Rating filter
  if (filters.challengeRating !== undefined) {
    const cr = creature.systemData?.challengeRating;
    if (cr === undefined) return false;

    if (typeof filters.challengeRating === 'number') {
      if (cr !== filters.challengeRating) return false;
    } else {
      const min = filters.challengeRating.min ?? 0;
      const max = filters.challengeRating.max ?? 30;
      if (cr < min || cr > max) return false;
    }
  }

  // Creature Type filter
  if (filters.creatureType) {
    const creatureType = creature.systemData?.creatureType;
    if (!creatureType || creatureType.toLowerCase() !== filters.creatureType.toLowerCase()) {
      return false;
    }
  }

  // Size filter — compare via the dnd5e size key so a filter written as the
  // display word ('medium') matches a stored dnd5e key ('med') and vice versa
  // (see normalizeDnD5eSizeKey / DnD5eSizeKeys above).
  if (filters.size) {
    const rawSize = creature.systemData?.size;
    if (!rawSize) return false;
    const size = String(rawSize);
    const wantKey = normalizeDnD5eSizeKey(filters.size);
    const haveKey = normalizeDnD5eSizeKey(size) ?? size.toLowerCase();
    if (!wantKey || haveKey !== wantKey) {
      return false;
    }
  }

  // Alignment filter
  if (filters.alignment) {
    const alignment = creature.systemData?.alignment;
    if (!alignment?.toLowerCase().includes(filters.alignment.toLowerCase())) {
      return false;
    }
  }

  // Legendary Actions filter
  if (filters.hasLegendaryActions !== undefined) {
    const hasLegendary = creature.systemData?.hasLegendaryActions || false;
    if (hasLegendary !== filters.hasLegendaryActions) {
      return false;
    }
  }

  // Spellcaster filter
  if (filters.spellcaster !== undefined) {
    const hasSpells = creature.systemData?.hasSpellcasting || false;
    if (hasSpells !== filters.spellcaster) {
      return false;
    }
  }

  return true;
}

/**
 * Generate human-readable description of D&D 5e filters
 */
export function describeDnD5eFilters(filters: DnD5eFilters): string {
  const parts: string[] = [];

  if (filters.challengeRating !== undefined) {
    if (typeof filters.challengeRating === 'number') {
      parts.push(`CR ${filters.challengeRating}`);
    } else {
      const min = filters.challengeRating.min ?? 0;
      const max = filters.challengeRating.max ?? 30;
      parts.push(`CR ${min}-${max}`);
    }
  }

  if (filters.creatureType) parts.push(filters.creatureType);
  if (filters.size) parts.push(filters.size);
  if (filters.alignment) parts.push(filters.alignment);
  if (filters.hasLegendaryActions) parts.push('legendary');
  if (filters.spellcaster) parts.push('spellcaster');

  return parts.length > 0 ? parts.join(', ') : 'no filters';
}

/**
 * Validate creature type
 */
export function isValidDnD5eCreatureType(creatureType: string): boolean {
  return DnD5eCreatureTypes.includes(creatureType as DnD5eCreatureType);
}
