/**
 * Compendium Search Filter Schemas
 *
 * Defines the D&D 5e creature/actor search-filter schema used by the compendium
 * tools. This build targets D&D 5e only.
 */

import { z } from 'zod';
import type { GameSystem } from './system-detection.js';

/**
 * Common creature sizes
 */
export const CreatureSizes = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export type CreatureSize = (typeof CreatureSizes)[number];

/**
 * D&D 5e creature/actor filter schema, used as the optional `filters` input on
 * the compendium search tool.
 */
export const GenericFiltersSchema = z.object({
  challengeRating: z
    .union([
      z.number(),
      z.object({
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    ])
    .optional(),
  creatureType: z.string().optional(),
  size: z.enum(CreatureSizes).optional(),
  alignment: z.string().optional(),
  hasLegendaryActions: z.boolean().optional(),
  spellcaster: z.boolean().optional(),
});

export type GenericFilters = z.infer<typeof GenericFiltersSchema>;

/**
 * Build a human-readable filter description for tool responses.
 *
 * Only D&D 5e filters are described; any non-dnd5e system yields 'no filters'
 * (this build supports D&D 5e only).
 */
export function describeFilters(filters: GenericFilters, system: GameSystem): string {
  const parts: string[] = [];

  if (system === 'dnd5e') {
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
  }

  return parts.length > 0 ? parts.join(', ') : 'no filters';
}
