/**
 * Tests for the D&D 5e filters module — pure functions, no FoundryClient, no bridge.
 *
 * Exports under test:
 *   DnD5eCreatureTypes  — const array of creature-type strings
 *   CreatureSizes       — const array of size strings
 *   DnD5eFiltersSchema  — zod schema (no coercions / no defaults in the schema itself)
 *   matchesDnD5eFilters — core predicate (reads creature.systemData.*)
 *   describeDnD5eFilters — human-readable summary
 *   isValidDnD5eCreatureType — simple inclusion check
 */

import { describe, expect, it } from 'vitest';

import {
  CreatureSizes,
  DnD5eCreatureTypes,
  DnD5eFiltersSchema,
  describeDnD5eFilters,
  isValidDnD5eCreatureType,
  matchesDnD5eFilters,
} from './filters.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal creature object with only the fields matchesDnD5eFilters reads. */
function makeCreature(
  overrides: Partial<{
    challengeRating: number;
    creatureType: string;
    size: string;
    alignment: string;
    hasLegendaryActions: boolean;
    hasSpellcasting: boolean;
  }> = {}
) {
  return { systemData: overrides };
}

// ---------------------------------------------------------------------------
// DnD5eCreatureTypes
// ---------------------------------------------------------------------------

describe('DnD5eCreatureTypes', () => {
  it('is a non-empty readonly array', () => {
    expect(DnD5eCreatureTypes).toBeDefined();
    expect(DnD5eCreatureTypes.length).toBeGreaterThan(0);
  });

  it('contains known canonical values', () => {
    expect(DnD5eCreatureTypes).toContain('dragon');
    expect(DnD5eCreatureTypes).toContain('humanoid');
    expect(DnD5eCreatureTypes).toContain('undead');
    expect(DnD5eCreatureTypes).toContain('fiend');
    expect(DnD5eCreatureTypes).toContain('beast');
  });

  it('contains exactly 14 types', () => {
    expect(DnD5eCreatureTypes).toHaveLength(14);
  });
});

// ---------------------------------------------------------------------------
// CreatureSizes
// ---------------------------------------------------------------------------

describe('CreatureSizes', () => {
  it('contains the standard 6 sizes', () => {
    expect(CreatureSizes).toHaveLength(6);
    expect(CreatureSizes).toContain('tiny');
    expect(CreatureSizes).toContain('small');
    expect(CreatureSizes).toContain('medium');
    expect(CreatureSizes).toContain('large');
    expect(CreatureSizes).toContain('huge');
    expect(CreatureSizes).toContain('gargantuan');
  });
});

// ---------------------------------------------------------------------------
// DnD5eFiltersSchema — valid parse
// ---------------------------------------------------------------------------

describe('DnD5eFiltersSchema — valid inputs', () => {
  it('accepts an empty object (all fields optional)', () => {
    const result = DnD5eFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts an exact numeric challengeRating', () => {
    const result = DnD5eFiltersSchema.safeParse({ challengeRating: 5 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.challengeRating).toBe(5);
  });

  it('accepts a challengeRating range object with min and max', () => {
    const result = DnD5eFiltersSchema.safeParse({ challengeRating: { min: 1, max: 10 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.challengeRating).toEqual({ min: 1, max: 10 });
  });

  it('accepts a challengeRating range object with only min', () => {
    const result = DnD5eFiltersSchema.safeParse({ challengeRating: { min: 3 } });
    expect(result.success).toBe(true);
  });

  it('accepts a challengeRating range object with only max', () => {
    const result = DnD5eFiltersSchema.safeParse({ challengeRating: { max: 15 } });
    expect(result.success).toBe(true);
  });

  it('accepts a valid creatureType enum value', () => {
    const result = DnD5eFiltersSchema.safeParse({ creatureType: 'dragon' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.creatureType).toBe('dragon');
  });

  it('accepts a valid size enum value', () => {
    const result = DnD5eFiltersSchema.safeParse({ size: 'huge' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.size).toBe('huge');
  });

  it('accepts alignment as a free-form string', () => {
    const result = DnD5eFiltersSchema.safeParse({ alignment: 'chaotic evil' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.alignment).toBe('chaotic evil');
  });

  it('accepts hasLegendaryActions as boolean', () => {
    const result = DnD5eFiltersSchema.safeParse({ hasLegendaryActions: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.hasLegendaryActions).toBe(true);
  });

  it('accepts spellcaster as boolean', () => {
    const result = DnD5eFiltersSchema.safeParse({ spellcaster: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.spellcaster).toBe(false);
  });

  it('accepts all filters simultaneously', () => {
    const input = {
      challengeRating: { min: 5, max: 15 },
      creatureType: 'fiend',
      size: 'large',
      alignment: 'lawful evil',
      hasLegendaryActions: true,
      spellcaster: true,
    };
    const result = DnD5eFiltersSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('accepts challengeRating of 0 (CR 0 is valid)', () => {
    const result = DnD5eFiltersSchema.safeParse({ challengeRating: 0 });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DnD5eFiltersSchema — rejection of invalid inputs
// ---------------------------------------------------------------------------

describe('DnD5eFiltersSchema — invalid inputs', () => {
  it('rejects an invalid creatureType string', () => {
    const result = DnD5eFiltersSchema.safeParse({ creatureType: 'dragon-turtle' });
    expect(result.success).toBe(false);
  });

  it('rejects creatureType in upper-case (enum is lower-case only)', () => {
    const result = DnD5eFiltersSchema.safeParse({ creatureType: 'Dragon' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid size string', () => {
    const result = DnD5eFiltersSchema.safeParse({ size: 'colossal' });
    expect(result.success).toBe(false);
  });

  it('rejects size in upper-case', () => {
    const result = DnD5eFiltersSchema.safeParse({ size: 'Large' });
    expect(result.success).toBe(false);
  });

  it('rejects challengeRating as a non-numeric string', () => {
    const result = DnD5eFiltersSchema.safeParse({ challengeRating: 'five' });
    expect(result.success).toBe(false);
  });

  it('rejects hasLegendaryActions as a non-boolean', () => {
    const result = DnD5eFiltersSchema.safeParse({ hasLegendaryActions: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects spellcaster as a non-boolean', () => {
    const result = DnD5eFiltersSchema.safeParse({ spellcaster: 1 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesDnD5eFilters — empty filters
// ---------------------------------------------------------------------------

describe('matchesDnD5eFilters — empty filters', () => {
  it('matches any creature when filters are empty', () => {
    const creature = makeCreature({ challengeRating: 10, creatureType: 'dragon' });
    expect(matchesDnD5eFilters(creature, {})).toBe(true);
  });

  it('matches a creature with no systemData fields when all filters are absent', () => {
    expect(matchesDnD5eFilters(makeCreature(), {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesDnD5eFilters — challengeRating (exact number)
// ---------------------------------------------------------------------------

describe('matchesDnD5eFilters — challengeRating exact', () => {
  it('matches when CR equals the exact filter value', () => {
    const creature = makeCreature({ challengeRating: 5 });
    expect(matchesDnD5eFilters(creature, { challengeRating: 5 })).toBe(true);
  });

  it('does not match when CR differs from the exact filter value', () => {
    const creature = makeCreature({ challengeRating: 6 });
    expect(matchesDnD5eFilters(creature, { challengeRating: 5 })).toBe(false);
  });

  it('does not match when creature has no CR (systemData.challengeRating is undefined)', () => {
    const creature = makeCreature(); // no challengeRating field
    expect(matchesDnD5eFilters(creature, { challengeRating: 5 })).toBe(false);
  });

  it('matches CR 0 exactly', () => {
    const creature = makeCreature({ challengeRating: 0 });
    expect(matchesDnD5eFilters(creature, { challengeRating: 0 })).toBe(true);
  });

  it('does not match CR 0 when filter is 1', () => {
    const creature = makeCreature({ challengeRating: 0 });
    expect(matchesDnD5eFilters(creature, { challengeRating: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesDnD5eFilters — challengeRating (range {min, max})
// ---------------------------------------------------------------------------

describe('matchesDnD5eFilters — challengeRating range', () => {
  it('matches when CR is within [min, max]', () => {
    const creature = makeCreature({ challengeRating: 8 });
    expect(matchesDnD5eFilters(creature, { challengeRating: { min: 5, max: 10 } })).toBe(true);
  });

  it('matches when CR equals min (inclusive lower boundary)', () => {
    const creature = makeCreature({ challengeRating: 5 });
    expect(matchesDnD5eFilters(creature, { challengeRating: { min: 5, max: 10 } })).toBe(true);
  });

  it('matches when CR equals max (inclusive upper boundary)', () => {
    const creature = makeCreature({ challengeRating: 10 });
    expect(matchesDnD5eFilters(creature, { challengeRating: { min: 5, max: 10 } })).toBe(true);
  });

  it('does not match when CR is below min', () => {
    const creature = makeCreature({ challengeRating: 4 });
    expect(matchesDnD5eFilters(creature, { challengeRating: { min: 5, max: 10 } })).toBe(false);
  });

  it('does not match when CR is above max', () => {
    const creature = makeCreature({ challengeRating: 11 });
    expect(matchesDnD5eFilters(creature, { challengeRating: { min: 5, max: 10 } })).toBe(false);
  });

  it('defaults min to 0 when omitted — CR 0 still matches', () => {
    const creature = makeCreature({ challengeRating: 0 });
    expect(matchesDnD5eFilters(creature, { challengeRating: { max: 5 } })).toBe(true);
  });

  it('defaults max to 30 when omitted — CR 30 still matches', () => {
    const creature = makeCreature({ challengeRating: 30 });
    expect(matchesDnD5eFilters(creature, { challengeRating: { min: 1 } })).toBe(true);
  });

  it('does not match when creature has no CR and range filter is set', () => {
    const creature = makeCreature();
    expect(matchesDnD5eFilters(creature, { challengeRating: { min: 1, max: 5 } })).toBe(false);
  });

  it('matches an empty range object (defaults: min=0 max=30) for any CR in [0,30]', () => {
    const creature = makeCreature({ challengeRating: 15 });
    expect(matchesDnD5eFilters(creature, { challengeRating: {} })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesDnD5eFilters — creatureType
// ---------------------------------------------------------------------------

describe('matchesDnD5eFilters — creatureType', () => {
  it('matches when creatureType matches exactly (case-insensitive in source)', () => {
    const creature = makeCreature({ creatureType: 'dragon' });
    expect(matchesDnD5eFilters(creature, { creatureType: 'dragon' })).toBe(true);
  });

  it('matches when creature type is stored in different case', () => {
    // matchesDnD5eFilters lowercases both sides
    const creature = makeCreature({ creatureType: 'Dragon' });
    expect(matchesDnD5eFilters(creature, { creatureType: 'dragon' })).toBe(true);
  });

  it('does not match when creatureType differs', () => {
    const creature = makeCreature({ creatureType: 'beast' });
    expect(matchesDnD5eFilters(creature, { creatureType: 'dragon' })).toBe(false);
  });

  it('does not match when creature has no creatureType', () => {
    const creature = makeCreature();
    expect(matchesDnD5eFilters(creature, { creatureType: 'humanoid' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesDnD5eFilters — size
// ---------------------------------------------------------------------------

describe('matchesDnD5eFilters — size', () => {
  it('matches when size equals the filter (case-insensitive)', () => {
    const creature = makeCreature({ size: 'large' });
    expect(matchesDnD5eFilters(creature, { size: 'large' })).toBe(true);
  });

  it('matches when creature size is stored in different case', () => {
    const creature = makeCreature({ size: 'Large' });
    expect(matchesDnD5eFilters(creature, { size: 'large' })).toBe(true);
  });

  it('does not match when size differs', () => {
    const creature = makeCreature({ size: 'small' });
    expect(matchesDnD5eFilters(creature, { size: 'huge' })).toBe(false);
  });

  it('does not match when creature has no size', () => {
    const creature = makeCreature();
    expect(matchesDnD5eFilters(creature, { size: 'medium' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesDnD5eFilters — alignment
// ---------------------------------------------------------------------------

describe('matchesDnD5eFilters — alignment', () => {
  it('matches when alignment contains the filter string (substring, case-insensitive)', () => {
    const creature = makeCreature({ alignment: 'chaotic evil' });
    expect(matchesDnD5eFilters(creature, { alignment: 'evil' })).toBe(true);
  });

  it('matches full alignment string', () => {
    const creature = makeCreature({ alignment: 'lawful good' });
    expect(matchesDnD5eFilters(creature, { alignment: 'lawful good' })).toBe(true);
  });

  it('is case-insensitive for substring match', () => {
    const creature = makeCreature({ alignment: 'Neutral Evil' });
    expect(matchesDnD5eFilters(creature, { alignment: 'neutral evil' })).toBe(true);
  });

  it('does not match when alignment does not contain the filter', () => {
    const creature = makeCreature({ alignment: 'lawful good' });
    expect(matchesDnD5eFilters(creature, { alignment: 'evil' })).toBe(false);
  });

  it('does not match when creature has no alignment', () => {
    const creature = makeCreature();
    expect(matchesDnD5eFilters(creature, { alignment: 'evil' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesDnD5eFilters — hasLegendaryActions
// ---------------------------------------------------------------------------

describe('matchesDnD5eFilters — hasLegendaryActions', () => {
  it('matches when creature has legendary actions and filter is true', () => {
    const creature = makeCreature({ hasLegendaryActions: true });
    expect(matchesDnD5eFilters(creature, { hasLegendaryActions: true })).toBe(true);
  });

  it('matches when creature has no legendary actions and filter is false', () => {
    const creature = makeCreature({ hasLegendaryActions: false });
    expect(matchesDnD5eFilters(creature, { hasLegendaryActions: false })).toBe(true);
  });

  it('does not match when creature has legendary actions but filter is false', () => {
    const creature = makeCreature({ hasLegendaryActions: true });
    expect(matchesDnD5eFilters(creature, { hasLegendaryActions: false })).toBe(false);
  });

  it('does not match when creature has no legendary actions but filter is true', () => {
    const creature = makeCreature({ hasLegendaryActions: false });
    expect(matchesDnD5eFilters(creature, { hasLegendaryActions: true })).toBe(false);
  });

  it('defaults to false when creature has no hasLegendaryActions field — matches filter false', () => {
    const creature = makeCreature(); // field absent → code defaults to false
    expect(matchesDnD5eFilters(creature, { hasLegendaryActions: false })).toBe(true);
  });

  it('defaults to false when field absent — does not match filter true', () => {
    const creature = makeCreature();
    expect(matchesDnD5eFilters(creature, { hasLegendaryActions: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesDnD5eFilters — spellcaster (reads systemData.hasSpellcasting)
// ---------------------------------------------------------------------------

describe('matchesDnD5eFilters — spellcaster', () => {
  it('matches when creature has spellcasting and filter is true', () => {
    const creature = makeCreature({ hasSpellcasting: true });
    expect(matchesDnD5eFilters(creature, { spellcaster: true })).toBe(true);
  });

  it('matches when creature has no spellcasting and filter is false', () => {
    const creature = makeCreature({ hasSpellcasting: false });
    expect(matchesDnD5eFilters(creature, { spellcaster: false })).toBe(true);
  });

  it('does not match when creature has spellcasting but filter is false', () => {
    const creature = makeCreature({ hasSpellcasting: true });
    expect(matchesDnD5eFilters(creature, { spellcaster: false })).toBe(false);
  });

  it('does not match when creature has no spellcasting but filter is true', () => {
    const creature = makeCreature({ hasSpellcasting: false });
    expect(matchesDnD5eFilters(creature, { spellcaster: true })).toBe(false);
  });

  it('defaults to false when hasSpellcasting field is absent — matches filter false', () => {
    const creature = makeCreature();
    expect(matchesDnD5eFilters(creature, { spellcaster: false })).toBe(true);
  });

  it('defaults to false when field absent — does not match filter true', () => {
    const creature = makeCreature();
    expect(matchesDnD5eFilters(creature, { spellcaster: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesDnD5eFilters — combined filters (AND semantics)
// ---------------------------------------------------------------------------

describe('matchesDnD5eFilters — combined filters', () => {
  const fullCreature = makeCreature({
    challengeRating: 8,
    creatureType: 'fiend',
    size: 'large',
    alignment: 'lawful evil',
    hasLegendaryActions: true,
    hasSpellcasting: true,
  });

  it('matches when every filter dimension matches', () => {
    expect(
      matchesDnD5eFilters(fullCreature, {
        challengeRating: { min: 5, max: 10 },
        creatureType: 'fiend',
        size: 'large',
        hasLegendaryActions: true,
        spellcaster: true,
      })
    ).toBe(true);
  });

  it('does not match when one filter fails (wrong creatureType)', () => {
    expect(
      matchesDnD5eFilters(fullCreature, {
        challengeRating: { min: 5, max: 10 },
        creatureType: 'undead', // mismatch
        size: 'large',
      })
    ).toBe(false);
  });

  it('does not match when one filter fails (CR out of range)', () => {
    expect(
      matchesDnD5eFilters(fullCreature, {
        challengeRating: { min: 1, max: 5 }, // mismatch (CR is 8)
        creatureType: 'fiend',
      })
    ).toBe(false);
  });

  it('does not match when one filter fails (wrong size)', () => {
    expect(
      matchesDnD5eFilters(fullCreature, {
        size: 'tiny', // mismatch
        creatureType: 'fiend',
      })
    ).toBe(false);
  });

  it('does not match when spellcaster filter fails but all others pass', () => {
    expect(
      matchesDnD5eFilters(fullCreature, {
        challengeRating: 8,
        creatureType: 'fiend',
        spellcaster: false, // mismatch — creature has spellcasting
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describeDnD5eFilters
// ---------------------------------------------------------------------------

describe('describeDnD5eFilters', () => {
  it('returns "no filters" when all filters are absent', () => {
    expect(describeDnD5eFilters({})).toBe('no filters');
  });

  it('includes "CR <n>" for an exact numeric challengeRating', () => {
    const desc = describeDnD5eFilters({ challengeRating: 5 });
    expect(desc).toContain('CR 5');
  });

  it('includes "CR min-max" for a range challengeRating', () => {
    const desc = describeDnD5eFilters({ challengeRating: { min: 3, max: 12 } });
    expect(desc).toContain('CR 3-12');
  });

  it('defaults range min to 0 and max to 30 in the description when omitted', () => {
    const descMinOnly = describeDnD5eFilters({ challengeRating: { min: 5 } });
    expect(descMinOnly).toContain('CR 5-30');

    const descMaxOnly = describeDnD5eFilters({ challengeRating: { max: 10 } });
    expect(descMaxOnly).toContain('CR 0-10');
  });

  it('includes the creatureType when set', () => {
    const desc = describeDnD5eFilters({ creatureType: 'undead' });
    expect(desc).toContain('undead');
  });

  it('includes the size when set', () => {
    const desc = describeDnD5eFilters({ size: 'gargantuan' });
    expect(desc).toContain('gargantuan');
  });

  it('includes the alignment string when set', () => {
    const desc = describeDnD5eFilters({ alignment: 'neutral evil' });
    expect(desc).toContain('neutral evil');
  });

  it('includes "legendary" when hasLegendaryActions is true', () => {
    const desc = describeDnD5eFilters({ hasLegendaryActions: true });
    expect(desc).toContain('legendary');
  });

  it('does NOT include "legendary" when hasLegendaryActions is false', () => {
    // Only truthy values are pushed to parts[]
    const desc = describeDnD5eFilters({ hasLegendaryActions: false });
    expect(desc).not.toContain('legendary');
  });

  it('includes "spellcaster" when spellcaster is true', () => {
    const desc = describeDnD5eFilters({ spellcaster: true });
    expect(desc).toContain('spellcaster');
  });

  it('does NOT include "spellcaster" when spellcaster is false', () => {
    const desc = describeDnD5eFilters({ spellcaster: false });
    expect(desc).not.toContain('spellcaster');
  });

  it('joins multiple active filters with ", "', () => {
    const desc = describeDnD5eFilters({ creatureType: 'fiend', size: 'large' });
    expect(desc).toContain('fiend');
    expect(desc).toContain('large');
    expect(desc).toContain(', ');
  });

  it('is not "no filters" when at least one filter is active', () => {
    expect(describeDnD5eFilters({ challengeRating: 1 })).not.toBe('no filters');
  });
});

// ---------------------------------------------------------------------------
// isValidDnD5eCreatureType
// ---------------------------------------------------------------------------

describe('isValidDnD5eCreatureType', () => {
  it('returns true for every value in DnD5eCreatureTypes', () => {
    for (const type of DnD5eCreatureTypes) {
      expect(isValidDnD5eCreatureType(type)).toBe(true);
    }
  });

  it('returns true for a known type: "dragon"', () => {
    expect(isValidDnD5eCreatureType('dragon')).toBe(true);
  });

  it('returns true for "humanoid"', () => {
    expect(isValidDnD5eCreatureType('humanoid')).toBe(true);
  });

  it('returns true for "aberration"', () => {
    expect(isValidDnD5eCreatureType('aberration')).toBe(true);
  });

  it('returns false for a completely bogus type', () => {
    expect(isValidDnD5eCreatureType('dragon-turtle')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValidDnD5eCreatureType('')).toBe(false);
  });

  it('returns false for a type in wrong case ("Dragon" vs "dragon")', () => {
    // DnD5eCreatureTypes entries are all lower-case; includes() is exact-match
    expect(isValidDnD5eCreatureType('Dragon')).toBe(false);
  });

  it('returns false for a type that is a substring of a valid type ("drag")', () => {
    expect(isValidDnD5eCreatureType('drag')).toBe(false);
  });

  it('returns false for "undead_lich" (invalid extension of valid type)', () => {
    expect(isValidDnD5eCreatureType('undead_lich')).toBe(false);
  });
});
