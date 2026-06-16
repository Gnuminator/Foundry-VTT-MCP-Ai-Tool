/**
 * D&D 5e static data tables and pure helper functions.
 *
 * Module-level constants (canonical damage/condition/property/size/skill sets,
 * spell-slot progression tables) and stateless string/number helpers used by the
 * dnd5e actor-building domain. No Foundry globals, no state — pure data + pure fns.
 */

export function slugify(name: string, fallback = 'feature'): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '') || fallback
  );
}

// =============================================================================
// NPC creation helpers — module-level, used exclusively by createNpcActor
// =============================================================================

export const NPC_DAMAGE_CANONICAL = new Set([
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

export const NPC_CONDITION_CANONICAL = new Set([
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
]);

export const NPC_SIZE_MAP: Record<string, string> = {
  tiny: 'tiny',
  small: 'sm',
  medium: 'med',
  large: 'lg',
  huge: 'huge',
  gargantuan: 'grg',
};

export const NPC_SKILL_MAP: Record<string, string> = {
  Acrobatics: 'acr',
  'Animal Handling': 'ani',
  Arcana: 'arc',
  Athletics: 'ath',
  Deception: 'dec',
  History: 'his',
  Insight: 'ins',
  Intimidation: 'itm',
  Investigation: 'inv',
  Medicine: 'med',
  Nature: 'nat',
  Perception: 'prc',
  Performance: 'prf',
  Persuasion: 'per',
  Religion: 'rel',
  'Sleight of Hand': 'slt',
  Stealth: 'ste',
  Survival: 'sur',
};

export function npcNormalizeCR(input: string | number): number {
  if (typeof input === 'number') return input;
  if (input.includes('/')) {
    const [num, den] = input.split('/').map(Number);
    return num / den;
  }
  return parseInt(input, 10);
}

export function npcFormatCR(value: number): string {
  if (value === 0) return '0';
  if (value === 0.125) return '1/8';
  if (value === 0.25) return '1/4';
  if (value === 0.5) return '1/2';
  return String(Math.round(value));
}

export function npcBuildSkillsBlock(
  skills: Array<{ skill: string; proficiency: string }>
): Record<string, { value: number }> {
  const result: Record<string, { value: number }> = {};
  for (const { skill, proficiency } of skills) {
    const key = NPC_SKILL_MAP[skill];
    if (key) {
      result[key] = { value: proficiency === 'expert' ? 2 : 1 };
    }
  }
  return result;
}

// =============================================================================
// Attack feature helpers — module-level, used exclusively by addAttackToActor
// =============================================================================

export const ATTACK_DAMAGE_CANONICAL = new Set([
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

export const ATTACK_PROPERTY_CANONICAL = new Set([
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

// =============================================================================
// Aura feature helpers — module-level, used exclusively by addAuraToActor
// =============================================================================

export const AURA_DAMAGE_CANONICAL = new Set([
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

// =============================================================================
// Attack+save helpers — module-level, used exclusively by addAttackWithSaveToActor
// =============================================================================

export const ATTACK_WITH_SAVE_DAMAGE_CANONICAL = new Set([
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

// =============================================================================
// Spellcasting slot tables — module-level, used by setActorSpellcasting
//
// Each array has 20 entries (index 0 = level 1 … index 19 = level 20).
// Each entry is a 9-element tuple: [L1, L2, L3, L4, L5, L6, L7, L8, L9].
// Source: SRD 5.1 spell slot tables.
// =============================================================================

// prettier-ignore
export const FULL_CASTER_SLOTS: number[][] = [
  //  L1  L2  L3  L4  L5  L6  L7  L8  L9
  [   2,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  1
  [   3,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  2
  [   4,   2,   0,   0,   0,   0,   0,   0,   0 ], // level  3
  [   4,   3,   0,   0,   0,   0,   0,   0,   0 ], // level  4
  [   4,   3,   2,   0,   0,   0,   0,   0,   0 ], // level  5
  [   4,   3,   3,   0,   0,   0,   0,   0,   0 ], // level  6
  [   4,   3,   3,   1,   0,   0,   0,   0,   0 ], // level  7
  [   4,   3,   3,   2,   0,   0,   0,   0,   0 ], // level  8
  [   4,   3,   3,   3,   1,   0,   0,   0,   0 ], // level  9
  [   4,   3,   3,   3,   2,   0,   0,   0,   0 ], // level 10
  [   4,   3,   3,   3,   2,   1,   0,   0,   0 ], // level 11
  [   4,   3,   3,   3,   2,   1,   0,   0,   0 ], // level 12
  [   4,   3,   3,   3,   2,   1,   1,   0,   0 ], // level 13
  [   4,   3,   3,   3,   2,   1,   1,   0,   0 ], // level 14
  [   4,   3,   3,   3,   2,   1,   1,   1,   0 ], // level 15
  [   4,   3,   3,   3,   2,   1,   1,   1,   0 ], // level 16
  [   4,   3,   3,   3,   2,   1,   1,   1,   1 ], // level 17
  [   4,   3,   3,   3,   3,   1,   1,   1,   1 ], // level 18
  [   4,   3,   3,   3,   3,   2,   1,   1,   1 ], // level 19
  [   4,   3,   3,   3,   3,   2,   2,   1,   1 ], // level 20
];

// prettier-ignore
/** Paladin / Ranger — half-caster (rounds down). Level 1 = no slots. */
export const HALF_CASTER_SLOTS: number[][] = [
  //  L1  L2  L3  L4  L5  L6  L7  L8  L9
  [   0,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  1 — no slots
  [   2,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  2
  [   3,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  3
  [   3,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  4
  [   4,   2,   0,   0,   0,   0,   0,   0,   0 ], // level  5
  [   4,   2,   0,   0,   0,   0,   0,   0,   0 ], // level  6
  [   4,   3,   0,   0,   0,   0,   0,   0,   0 ], // level  7
  [   4,   3,   0,   0,   0,   0,   0,   0,   0 ], // level  8
  [   4,   3,   2,   0,   0,   0,   0,   0,   0 ], // level  9
  [   4,   3,   2,   0,   0,   0,   0,   0,   0 ], // level 10
  [   4,   3,   3,   0,   0,   0,   0,   0,   0 ], // level 11
  [   4,   3,   3,   0,   0,   0,   0,   0,   0 ], // level 12
  [   4,   3,   3,   1,   0,   0,   0,   0,   0 ], // level 13
  [   4,   3,   3,   1,   0,   0,   0,   0,   0 ], // level 14
  [   4,   3,   3,   2,   0,   0,   0,   0,   0 ], // level 15
  [   4,   3,   3,   2,   0,   0,   0,   0,   0 ], // level 16
  [   4,   3,   3,   3,   1,   0,   0,   0,   0 ], // level 17
  [   4,   3,   3,   3,   1,   0,   0,   0,   0 ], // level 18
  [   4,   3,   3,   3,   2,   0,   0,   0,   0 ], // level 19
  [   4,   3,   3,   3,   2,   0,   0,   0,   0 ], // level 20
];

// prettier-ignore
/** Artificer — half-caster (rounds UP). Starts at level 1. Max 5th-level slots. */
export const ARTIFICER_SLOTS: number[][] = [
  //  L1  L2  L3  L4  L5  L6  L7  L8  L9
  [   2,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  1
  [   2,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  2
  [   3,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  3
  [   3,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  4
  [   4,   2,   0,   0,   0,   0,   0,   0,   0 ], // level  5
  [   4,   2,   0,   0,   0,   0,   0,   0,   0 ], // level  6
  [   4,   3,   0,   0,   0,   0,   0,   0,   0 ], // level  7
  [   4,   3,   0,   0,   0,   0,   0,   0,   0 ], // level  8
  [   4,   3,   2,   0,   0,   0,   0,   0,   0 ], // level  9
  [   4,   3,   2,   0,   0,   0,   0,   0,   0 ], // level 10
  [   4,   3,   3,   0,   0,   0,   0,   0,   0 ], // level 11
  [   4,   3,   3,   0,   0,   0,   0,   0,   0 ], // level 12
  [   4,   3,   3,   1,   0,   0,   0,   0,   0 ], // level 13
  [   4,   3,   3,   1,   0,   0,   0,   0,   0 ], // level 14
  [   4,   3,   3,   2,   0,   0,   0,   0,   0 ], // level 15
  [   4,   3,   3,   2,   0,   0,   0,   0,   0 ], // level 16
  [   4,   3,   3,   3,   1,   0,   0,   0,   0 ], // level 17
  [   4,   3,   3,   3,   1,   0,   0,   0,   0 ], // level 18
  [   4,   3,   3,   3,   2,   0,   0,   0,   0 ], // level 19
  [   4,   3,   3,   3,   2,   0,   0,   0,   0 ], // level 20
];

// prettier-ignore
/** Warlock Pact Magic — slot count and slot level per warlock level. */
export const WARLOCK_PACT_TABLE: Array<{ max: number; level: number }> = [
  { max: 1, level: 1 }, // level  1
  { max: 2, level: 1 }, // level  2
  { max: 2, level: 2 }, // level  3
  { max: 2, level: 2 }, // level  4
  { max: 2, level: 3 }, // level  5
  { max: 2, level: 3 }, // level  6
  { max: 2, level: 4 }, // level  7
  { max: 2, level: 4 }, // level  8
  { max: 2, level: 5 }, // level  9
  { max: 2, level: 5 }, // level 10
  { max: 3, level: 5 }, // level 11
  { max: 3, level: 5 }, // level 12
  { max: 3, level: 5 }, // level 13
  { max: 3, level: 5 }, // level 14
  { max: 3, level: 5 }, // level 15
  { max: 3, level: 5 }, // level 16
  { max: 4, level: 5 }, // level 17
  { max: 4, level: 5 }, // level 18
  { max: 4, level: 5 }, // level 19
  { max: 4, level: 5 }, // level 20
];
