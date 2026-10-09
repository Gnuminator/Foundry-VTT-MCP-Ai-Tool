/**
 * Output-side helpers for creature records the module returns (M3, lane F).
 *
 * The module's creature index (`listCreaturesByCriteria`) returns FLAT records
 * (`challengeRating`, `creatureType`, `size`, `hasSpells`, `hasLegendaryActions`),
 * and stores the dnd5e size KEY (`med`). Older modules and the compendium
 * document reads return raw actor data (`system.details.cr`, `system.traits.size`).
 * These helpers read the new flat value first and fall back to the old shape, so
 * a formatter works against either module version.
 *
 * dnd5e 6.0.5 verified (dnd5e.mjs): `CONFIG.DND5E.actorSizes` keys are
 * `tiny, sm, med, lg, huge, grg`; NPCData.resources.legact = { max, spent }.
 */

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' ? (value as UnknownRecord) : undefined;
}

const SIZE_WORDS: Readonly<Record<string, string>> = {
  tiny: 'tiny',
  sm: 'small',
  small: 'small',
  med: 'medium',
  medium: 'medium',
  lg: 'large',
  large: 'large',
  huge: 'huge',
  grg: 'gargantuan',
  gargantuan: 'gargantuan',
};

/**
 * The display word for a creature size given as a dnd5e key ("med") or a word
 * ("medium"), any case. An unknown string (a size a module added) comes back
 * unchanged; anything that is not a string gives undefined.
 */
export function sizeWord(size: unknown): string | undefined {
  if (typeof size !== 'string') return undefined;
  const lower = size.trim().toLowerCase();
  if (lower === '') return undefined;
  return Object.prototype.hasOwnProperty.call(SIZE_WORDS, lower) ? SIZE_WORDS[lower] : size;
}

/** A creature's size as a display word: the flat `size` field first, then `system.traits.size`. */
export function creatureSizeWord(creature: unknown): string | undefined {
  const c = asRecord(creature);
  if (!c) return undefined;
  const system = asRecord(c.system);
  const traits = asRecord(system?.traits);
  const traitSize = asRecord(traits?.size);
  return (
    sizeWord(c.size) ??
    sizeWord(traitSize?.value) ??
    sizeWord(traits?.size) ??
    sizeWord(system?.size)
  );
}

function positiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Whether a creature has legendary actions. The flat `hasLegendaryActions` flag
 * the module computes wins. Otherwise the raw system data decides: a positive
 * `system.resources.legact.max` (or `.value`), or a legacy positive numeric
 * `system.legendary`. The mere presence of the `legact` container does NOT count
 * (every dnd5e NPC has one, default max 0), and `legres` (legendary
 * resistance) is a different trait and is not read.
 */
export function hasLegendaryActions(creature: unknown): boolean {
  const c = asRecord(creature);
  if (!c) return false;
  if (typeof c.hasLegendaryActions === 'boolean') return c.hasLegendaryActions;
  const system = asRecord(c.system);
  const legact = asRecord(asRecord(system?.resources)?.legact);
  return (
    positiveNumber(legact?.max) ||
    positiveNumber(legact?.value) ||
    positiveNumber(system?.legendary)
  );
}

/** Whether a creature casts spells: the flat `hasSpells` flag first, else the caller's raw-data check. */
export function flatHasSpells(creature: unknown): boolean | undefined {
  const c = asRecord(creature);
  return c && typeof c.hasSpells === 'boolean' ? c.hasSpells : undefined;
}

const SPELL_SCHOOL_NAMES: Readonly<Record<string, string>> = {
  abj: 'Abjuration',
  con: 'Conjuration',
  div: 'Divination',
  enc: 'Enchantment',
  evo: 'Evocation',
  ill: 'Illusion',
  nec: 'Necromancy',
  trs: 'Transmutation',
};

/**
 * A spell school as a display name. dnd5e stores a 3-letter key (`evo`);
 * verified against `CONFIG.DND5E.spellSchools` in dnd5e 6.0.5. Anything else
 * (a school a module added, or an already-spelled-out name) comes back unchanged.
 */
export function spellSchoolName(school: unknown): string | undefined {
  if (typeof school !== 'string' || school.trim() === '') return undefined;
  const lower = school.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SPELL_SCHOOL_NAMES, lower)
    ? SPELL_SCHOOL_NAMES[lower]
    : school;
}

function speedValue(value: unknown): number | string | undefined {
  if (typeof value === 'number') return value > 0 ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '' && value.trim() !== '0') return value.trim();
  return undefined;
}

/**
 * One-line speed summary ("40 ft, fly 80 ft") from a `system.attributes.movement`
 * block. dnd5e 6 keeps the speeds under `movement.speeds.<type>` (verified:
 * dnd5e.mjs 6.0.5 `MovementField`, which also migrates the old top-level
 * `movement.walk`); older data has them at `movement.<type>`. Reads the new
 * place first, falls back to the old.
 */
export function movementSummary(movement: unknown): string | undefined {
  const m = asRecord(movement);
  if (!m) return undefined;
  const speeds = asRecord(m.speeds);
  const units = typeof m.units === 'string' && m.units.trim() !== '' ? m.units.trim() : 'ft';
  const parts: string[] = [];
  const walk = speedValue(speeds?.walk) ?? speedValue(m.walk);
  if (walk !== undefined) parts.push(`${walk} ${units}`);
  for (const type of ['fly', 'swim', 'climb', 'burrow'] as const) {
    const value = speedValue(speeds?.[type]) ?? speedValue(m[type]);
    if (value !== undefined) parts.push(`${type} ${value} ${units}`);
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * "1d8 slashing damage" for a weapon's system data. dnd5e 4 and later keep the
 * damage in `system.damage.base` ({number, denomination, bonus, types[], custom});
 * dnd5e 3 kept `system.damage.parts[[formula, type], ...]`. New shape first.
 */
export function weaponDamageSummary(system: unknown): string | undefined {
  const sys = asRecord(system);
  const damage = asRecord(sys?.damage);
  if (!damage) return undefined;

  const base = asRecord(damage.base);
  if (base) {
    const custom = asRecord(base.custom);
    let formula = '';
    if (custom?.enabled === true && typeof custom.formula === 'string') {
      formula = custom.formula.trim();
    } else if (positiveNumber(base.number) && positiveNumber(base.denomination)) {
      formula = `${String(base.number)}d${String(base.denomination)}`;
      const bonus = typeof base.bonus === 'string' ? base.bonus.trim() : '';
      if (bonus !== '') formula += /^[+-]/.test(bonus) ? bonus : `+${bonus}`;
    }
    if (formula !== '') {
      const types = Array.isArray(base.types)
        ? base.types.filter((t): t is string => typeof t === 'string' && t !== '')
        : [];
      return `${formula}${types.length > 0 ? ` ${types.join('/')}` : ''} damage`;
    }
  }

  const parts = damage.parts;
  if (Array.isArray(parts) && parts.length > 0 && Array.isArray(parts[0])) {
    return `${String(parts[0][0])} ${String(parts[0][1])} damage`;
  }
  return undefined;
}

/** dnd5e 6 `CONFIG.DND5E.armorTypes` keys: armor and shields are `equipment` items. */
const ARMOR_TYPES = new Set(['light', 'medium', 'heavy', 'natural', 'shield']);

/** The armor type of an `equipment` item's system data (dnd5e 6 `type.value`), else undefined. */
function armorType(system: unknown): string | undefined {
  const value = asRecord(asRecord(system)?.type)?.value;
  return typeof value === 'string' && ARMOR_TYPES.has(value) ? value : undefined;
}

/** True when an `equipment` item's system data is armor or a shield. */
export function isArmorEquipment(system: unknown): boolean {
  return armorType(system) !== undefined;
}

/** "AC 16" for armor, "AC +2" for a shield; undefined for other equipment. */
export function armorClassSummary(system: unknown): string | undefined {
  const type = armorType(system);
  const ac = asRecord(asRecord(system)?.armor)?.value;
  if (!type || !positiveNumber(ac)) return undefined;
  return `AC ${type === 'shield' ? '+' : ''}${String(ac)}`;
}

/**
 * Armor details of an `equipment` item's system data: type, the `armor` block (value, dex,
 * magicalBonus), the strength requirement and stealth disadvantage (a dnd5e 6 item property).
 * Undefined for equipment that is not armor.
 */
export function armorProperties(system: unknown): Record<string, unknown> | undefined {
  const type = armorType(system);
  if (!type) return undefined;
  const sys = asRecord(system);
  const props = sys?.properties;
  const tags: unknown[] = Array.isArray(props) ? props : props instanceof Set ? [...props] : [];
  return {
    armorType: type,
    ...(sys?.armor ? { armorClass: sys.armor } : {}),
    ...(positiveNumber(sys?.strength) ? { strengthRequirement: sys?.strength } : {}),
    ...(tags.includes('stealthDisadvantage') ? { stealthDisadvantage: true } : {}),
  };
}
