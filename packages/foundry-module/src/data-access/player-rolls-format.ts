import { MODULE_ID } from '../constants.js';
import { dig, rec, type Rec } from '../doc-read.js';

/**
 * Build a `1d20`-based roll formula for the given roll type against a
 * character's roll data (dnd5e). Modifiers are coerced to finite numbers
 * (dnd5e v5 turned some flat fields into objects) and signed; an explicit
 * `rollModifier` is appended last.
 */
export function buildRollFormula(
  rollType: string,
  rollTarget: string,
  rollModifier: string,
  character?: Actor
): string {
  let baseFormula = '1d20';

  // Coerce a roll-data field to a finite number. In dnd5e v5 some fields that
  // were plain numbers are now objects (e.g. abilities.<x>.save), so a naive
  // `1d20+${field}` produced "1d20+[object Object]" and broke Roll parsing.
  const toMod = (v: unknown): number => {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'object') {
      const o = v as Rec;
      const inner = o.value ?? o.total ?? o.mod ?? o.bonus;
      const n = Number(inner);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  // Format a modifier with an explicit sign so negatives don't produce "+-2".
  const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n}`;

  if (character) {
    // Foundry's getRollData() gives calculated modifiers (incl. active effects).
    const rollData = character.getRollData();

    switch (rollType) {
      case 'ability': {
        const abilityMod = toMod(dig(rollData, 'abilities', rollTarget, 'mod'));
        baseFormula = `1d20${signed(abilityMod)}`;
        break;
      }

      case 'skill': {
        const skillCode = getSkillCode(rollTarget);
        const skillMod = toMod(dig(rollData, 'skills', skillCode, 'total'));
        baseFormula = `1d20${signed(skillMod)}`;
        break;
      }

      case 'save': {
        // dnd5e v5: abilities.<x>.save is an object (not a flat bonus), so we
        // compute the save modifier from ability mod + proficiency rather than
        // reading `.save` directly (which omitted save proficiency, e.g. a
        // creature's DEX save came out +2 instead of +7).
        const ability: Rec = rec(dig(rollData, 'abilities', rollTarget)) ?? {};
        const mod = toMod(ability.mod);
        const prof = toMod(dig(rollData, 'attributes', 'prof') ?? rollData.prof);
        const proficient = toMod(ability.proficient); // 0 / 0.5 / 1 / 2
        const computed = mod + Math.round(proficient * prof);
        // Prefer a directly-exposed numeric save total if it's larger (covers
        // misc save bonuses); otherwise use the computed value.
        const saveMod = Math.max(computed, toMod(ability.save));
        baseFormula = `1d20${signed(saveMod)}`;
        break;
      }

      case 'initiative': {
        const initMod = toMod(
          dig(rollData, 'attributes', 'init', 'mod') ?? dig(rollData, 'abilities', 'dex', 'mod')
        );
        baseFormula = `1d20${signed(initMod)}`;
        break;
      }

      case 'custom':
        baseFormula = rollTarget; // Use rollTarget as the formula directly
        break;

      default:
        baseFormula = '1d20';
    }
  } else {
    console.warn(`[${MODULE_ID}] No character provided for roll formula, using base 1d20`);
  }

  if (rollModifier?.trim()) {
    const modifier =
      rollModifier.startsWith('+') || rollModifier.startsWith('-')
        ? rollModifier
        : `+${rollModifier}`;
    baseFormula += modifier;
  }

  return baseFormula;
}

/** Map a (possibly spaced) D&D 5e skill name to its 3-letter code. */
export function getSkillCode(skillName: string): string {
  const skillMap: { [key: string]: string } = {
    acrobatics: 'acr',
    'animal handling': 'ani',
    animalhandling: 'ani',
    arcana: 'arc',
    athletics: 'ath',
    deception: 'dec',
    history: 'his',
    insight: 'ins',
    intimidation: 'itm',
    investigation: 'inv',
    medicine: 'med',
    nature: 'nat',
    perception: 'prc',
    performance: 'prf',
    persuasion: 'per',
    religion: 'rel',
    'sleight of hand': 'slt',
    sleightofhand: 'slt',
    stealth: 'ste',
    survival: 'sur',
  };

  const normalizedName = skillName.toLowerCase().replace(/\s+/g, '');
  return skillMap[normalizedName] || skillMap[skillName.toLowerCase()] || skillName.toLowerCase();
}

/** An ability's or skill's name in words ("Dexterity", "Perception") from dnd5e's config, else a readable fallback. */
function rollTargetName(rollType: string, rollTarget: string): string {
  const config = rec(rec((globalThis as { CONFIG?: unknown }).CONFIG)?.DND5E);
  const label = (v: unknown): string | undefined => {
    const l = rec(v)?.label;
    return typeof l === 'string' && l ? l : undefined;
  };
  if (rollType === 'skill') {
    const named = label(rec(config?.skills)?.[getSkillCode(rollTarget)]);
    return named ?? rollTarget.charAt(0).toUpperCase() + rollTarget.slice(1);
  }
  const named = label(rec(config?.abilities)?.[rollTarget.toLowerCase()]);
  return named ?? rollTarget.toUpperCase();
}

/** The card's heading: "Roll for Mara: Perception, DC 12". */
export function buildRollHeading(
  who: string,
  rollType: string,
  rollTarget: string,
  dc?: number
): string {
  let what: string;
  switch (rollType) {
    case 'ability':
      what = `${rollTargetName(rollType, rollTarget)} check`;
      break;
    case 'skill':
      what = rollTargetName(rollType, rollTarget);
      break;
    case 'save':
      what = `${rollTargetName(rollType, rollTarget)} saving throw`;
      break;
    case 'attack':
      what = `${rollTarget} attack`;
      break;
    case 'initiative':
      what = 'Initiative';
      break;
    default:
      what = 'Roll';
  }
  return `Roll for ${who}: ${what}${dc != null ? `, DC ${dc}` : ''}`;
}

/**
 * The completed card's heading: the one the request card showed (stored in its flags), else
 * rebuilt from the stored roll and character (cards posted before the heading was stored),
 * else the button label.
 */
export function completedRollHeading(
  state: Record<string, unknown> | undefined,
  rollLabel: string
): string {
  if (typeof state?.heading === 'string' && state.heading) return state.heading;
  const { rollType, rollTarget, characterId, dc } = state ?? {};
  const who =
    typeof characterId === 'string' && characterId
      ? game.actors?.get(characterId)?.name
      : undefined;
  if (who && typeof rollType === 'string' && typeof rollTarget === 'string') {
    return buildRollHeading(who, rollType, rollTarget, typeof dc === 'number' ? dc : undefined);
  }
  return rollLabel;
}

/** Human-readable button label for a roll request. */
export function buildRollButtonLabel(
  rollType: string,
  rollTarget: string,
  isPublic: boolean
): string {
  const visibility = isPublic ? 'Public' : 'Private';

  switch (rollType) {
    case 'ability':
      return `${rollTargetName(rollType, rollTarget)} Ability Check (${visibility})`;
    case 'skill':
      return `${rollTargetName(rollType, rollTarget)} Skill Check (${visibility})`;
    case 'save':
      return `${rollTargetName(rollType, rollTarget)} Saving Throw (${visibility})`;
    case 'attack':
      return `${rollTarget} Attack (${visibility})`;
    case 'initiative':
      return `Initiative Roll (${visibility})`;
    case 'custom':
      return `Custom Roll (${visibility})`;
    default:
      return `Roll (${visibility})`;
  }
}
