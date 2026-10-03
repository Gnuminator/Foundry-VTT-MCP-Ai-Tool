/**
 * Readable text for Foundry and dnd5e enrichers in mirrored notes (the Obsidian mirror and
 * Library). Foundry shows `[[/save dex 15 format=long]]` as a button; a note shows the words the
 * button would show ("DC 15 Dexterity saving throw"), never the raw code.
 *
 * Patterns follow dnd5e 6.0.5 (`enrichers.mjs` in `dnd5e.mjs`): `[[/check ...]]`, `[[/skill ...]]`,
 * `[[/tool ...]]`, `[[/save ...]]`, `[[/damage ...]]`, `[[/heal ...]]`, `[[/attack ...]]`,
 * `[[/item ...]]`, `[[/award ...]]`, `[[lookup ...]]`, `&Reference[...]`, plus Foundry's own inline
 * rolls `[[/r ...]]` and `[[...]]`. Everything returned here is plain text; the caller escapes it.
 */

export const ABILITY_NAMES: Readonly<Record<string, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/** dnd5e skill keys: label and default ability. */
export const SKILLS: Readonly<Record<string, { label: string; ability: string }>> = {
  acr: { label: 'Acrobatics', ability: 'dex' },
  ani: { label: 'Animal Handling', ability: 'wis' },
  arc: { label: 'Arcana', ability: 'int' },
  ath: { label: 'Athletics', ability: 'str' },
  dec: { label: 'Deception', ability: 'cha' },
  his: { label: 'History', ability: 'int' },
  ins: { label: 'Insight', ability: 'wis' },
  itm: { label: 'Intimidation', ability: 'cha' },
  inv: { label: 'Investigation', ability: 'int' },
  med: { label: 'Medicine', ability: 'wis' },
  nat: { label: 'Nature', ability: 'int' },
  prc: { label: 'Perception', ability: 'wis' },
  prf: { label: 'Performance', ability: 'cha' },
  per: { label: 'Persuasion', ability: 'cha' },
  rel: { label: 'Religion', ability: 'int' },
  slt: { label: 'Sleight of Hand', ability: 'dex' },
  ste: { label: 'Stealth', ability: 'dex' },
  sur: { label: 'Survival', ability: 'wis' },
};

export const DAMAGE_TYPES: ReadonlySet<string> = new Set([
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
const HEALING_TYPES: ReadonlySet<string> = new Set(['heal', 'healing', 'temphp', 'temp']);

/** dnd5e `&Reference` keys that are not conditions, skills or abilities. */
const REFERENCE_NAMES: Readonly<Record<string, string>> = {
  abj: 'abjuration',
  con: 'conjuration',
  div: 'divination',
  enc: 'enchantment',
  evo: 'evocation',
  ill: 'illusion',
  nec: 'necromancy',
  trs: 'transmutation',
};

function lowerKey(text: string): string {
  return text.trim().toLowerCase();
}

/** An ability key or name (`dex`, `Dexterity`) to its name, or null. */
export function abilityName(value: string): string | null {
  const key = lowerKey(value);
  if (ABILITY_NAMES[key]) return ABILITY_NAMES[key];
  return Object.values(ABILITY_NAMES).find(name => name.toLowerCase() === key) ?? null;
}

/** A skill key or name (`prc`, `perception`) to its key, or null. */
export function skillKey(value: string): string | null {
  const key = lowerKey(value);
  if (SKILLS[key]) return key;
  for (const [k, skill] of Object.entries(SKILLS)) {
    if (skill.label.toLowerCase() === key || skill.label.toLowerCase().replace(/ /g, '') === key) {
      return k;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

/** `2d6 + 3` style spacing for a dice formula. */
export function tidyFormula(formula: string): string {
  return formula
    .replace(/\s+/g, '')
    .replace(/([+\-*/])/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .replace(/^ ([+-]) /, '$1')
    .trim();
}

/** Average of a simple dice formula (`NdM`, numbers, `+` and `-`), floored like the books; null otherwise. */
export function averageOf(formula: string): number | null {
  const compact = formula.replace(/\s+/g, '');
  if (!/^[+-]?(\d+d\d+|\d+)([+-](\d+d\d+|\d+))*$/i.test(compact)) return null;
  let total = 0;
  for (const match of compact.matchAll(/([+-]?)(\d+)(?:d(\d+))?/gi)) {
    const sign = match[1] === '-' ? -1 : 1;
    const count = Number(match[2]);
    const faces = match[3] === undefined ? null : Number(match[3]);
    total += sign * (faces === null ? count : (count * (faces + 1)) / 2);
  }
  return Math.floor(total);
}

/**
 * An inline roll (`[[/r 1d20+2]]`, `[[2d6]]`) reads as its formula (`1d20 + 2`), as Foundry
 * shows it on the roll button; only the attack and check enrichers show a modifier.
 */
export function rollText(formula: string): string {
  const compact = formula.replace(/\s+/g, '');
  // Only a dice formula gets formula spacing; other text keeps its words.
  if (!/\d/.test(compact) || /[a-ce-z]{2,}/i.test(compact.replace(/@[\w.]+/g, ''))) {
    return formula.replace(/\s+/g, ' ').trim();
  }
  return tidyFormula(formula);
}

// ---------------------------------------------------------------------------
// Enricher configs
// ---------------------------------------------------------------------------

interface ParsedConfig {
  /** Bare words in order. */
  words: string[];
  /** `key=value` pairs (lowercased keys). */
  pairs: Map<string, string>;
}

/** dnd5e's config syntax: whitespace-separated words and `key=value` pairs (quotes allowed). */
export function parseConfig(config: string): ParsedConfig {
  const words: string[] = [];
  const pairs = new Map<string, string>();
  for (const match of config.matchAll(/(\w+)=("[^"]*"|'[^']*'|\S+)|("[^"]*"|\S+)/g)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      pairs.set(match[1].toLowerCase(), match[2].replace(/^["']|["']$/g, ''));
    } else if (match[3] !== undefined) {
      words.push(match[3].replace(/^"|"$/g, ''));
    }
  }
  return { words, pairs };
}

function isLong(config: ParsedConfig): boolean {
  return config.pairs.get('format') === 'long' || config.words.includes('format=long');
}

function dcOf(config: ParsedConfig): string | null {
  const dc = config.pairs.get('dc') ?? config.words.find(word => /^\d+$/.test(word)) ?? null;
  return dc && /^\d+$/.test(dc) ? dc : null;
}

function withDc(dc: string | null, text: string): string {
  return dc ? `DC ${dc} ${text}` : text;
}

function checkText(kind: 'check' | 'skill' | 'tool' | 'save', config: ParsedConfig): string {
  const long = isLong(config);
  const dc = dcOf(config);
  const abilityRaw = config.pairs.get('ability') ?? null;
  const skillRaw = config.pairs.get('skill') ?? null;
  const toolRaw = config.pairs.get('tool') ?? null;
  let ability: string | null = abilityRaw ? abilityName(abilityRaw.split(/[|,]/)[0] ?? '') : null;
  let skill: string | null = skillRaw ? skillKey(skillRaw.split(/[|,]/)[0] ?? '') : null;
  for (const word of config.words) {
    if (/^\d+$/.test(word)) continue;
    if (!ability && abilityName(word)) ability = abilityName(word);
    else if (!skill && kind !== 'save' && skillKey(word)) skill = skillKey(word);
  }
  if (kind === 'save') {
    const name = ability ?? 'saving throw';
    if (!ability) return withDc(dc, 'saving throw');
    return withDc(dc, long ? `${name} saving throw` : name);
  }
  if (skill) {
    const info = SKILLS[skill];
    const abilityLabel = ability ?? ABILITY_NAMES[info?.ability ?? ''] ?? '';
    const label = `${abilityLabel} (${info?.label ?? skill})`.trim();
    return withDc(dc, long ? `${label} check` : label);
  }
  if (kind === 'tool' || toolRaw) {
    const tool = (toolRaw ?? config.words.find(word => !/^\d+$/.test(word)) ?? 'tool').replace(
      /[-_]/g,
      ' '
    );
    const label = ability ? `${ability} (${tool})` : tool;
    return withDc(dc, long ? `${label} check` : label);
  }
  if (ability) return withDc(dc, long ? `${ability} check` : ability);
  return withDc(dc, 'ability check');
}

/** `[[/damage 2d6 acid average=true]]` reads as `7 (2d6) acid`. */
function damageText(config: string, healing: boolean): string {
  const parts = config.split(/\s*&\s*/).map(part => {
    const parsed = parseConfig(part);
    const average = parsed.pairs.get('average') === 'true' || parsed.words.includes('average');
    const types: string[] = [];
    const formulaWords: string[] = [];
    const rest: string[] = [];
    const typeValue = parsed.pairs.get('type');
    if (typeValue) types.push(...typeValue.split(/[|,/]/));
    const formulaValue = parsed.pairs.get('formula');
    if (formulaValue) formulaWords.push(formulaValue);
    for (const word of parsed.words) {
      const key = word.toLowerCase();
      if (key === 'average' || key === 'extended') continue;
      if (DAMAGE_TYPES.has(key) || HEALING_TYPES.has(key)) types.push(key);
      else if (
        formulaValue === undefined &&
        /^([+\-*/]|[\d@(][\w+\-*/().@]*)$/.test(word) &&
        rest.length === 0
      ) {
        formulaWords.push(word);
      } else rest.push(word);
    }
    const formula = tidyFormula(formulaWords.join(' '));
    const avg = average && formula ? averageOf(formula) : null;
    const amount = formula ? (avg !== null ? `${avg} (${formula})` : formula) : '';
    const typeWords = types
      .map(type => type.toLowerCase())
      .filter(type => !HEALING_TYPES.has(type) && !healing);
    return [amount, typeWords.join(' or '), rest.join(' ')].filter(Boolean).join(' ');
  });
  return parts.filter(Boolean).join(' plus ');
}

function attackText(config: ParsedConfig): string {
  const formula = config.pairs.get('formula') ?? config.words.find(w => /^[+-]?\d+$/.test(w));
  if (!formula) return 'attack';
  const bonus = /^[+-]/.test(formula) ? formula : `+${formula}`;
  return isLong(config) ? `${bonus} to hit` : bonus;
}

export interface EnricherContext {
  /** The document the text belongs to (`[[lookup @name]]`). */
  selfName?: string | null;
}

/**
 * The words for one `[[...]]` construct (the full match, brackets included, optionally
 * followed by `{label}`). Never returns the raw code.
 */
export function inlineRollText(raw: string, ctx: EnricherContext = {}): string {
  const labelMatch = /\]\]\]?\{([^}]*)\}$/.exec(raw);
  const label = labelMatch?.[1]?.trim() ?? null;
  const inner = raw
    .replace(/\{[^}]*\}$/, '')
    .replace(/^\[\[/, '')
    .replace(/\]\]\]?$/, '')
    .trim();
  const command = /^\/(\w+)\s*(.*)$/s.exec(inner);
  if (!command) {
    const lookup = /^lookup\s+(\S+)(.*)$/i.exec(inner);
    if (lookup) return lookupText(lookup[1] ?? '', lookup[2] ?? '', ctx);
    if (label) return label;
    // A plain inline roll `[[2d6]]`: the formula, flavor dropped.
    return rollText(inner.split('#')[0] ?? inner);
  }
  const name = (command[1] ?? '').toLowerCase();
  const rest = command[2] ?? '';
  if (label && !['damage', 'heal', 'healing'].includes(name)) return label;
  switch (name) {
    case 'r':
    case 'roll':
    case 'gmr':
    case 'gmroll':
    case 'br':
    case 'broll':
    case 'blindroll':
    case 'sr':
    case 'selfroll':
    case 'pr':
    case 'publicroll':
      return label ?? rollText(rest.split('#')[0] ?? rest);
    case 'check':
    case 'skill':
    case 'tool':
    case 'save':
      return checkText(name, parseConfig(rest));
    case 'concentration':
      return withDc(dcOf(parseConfig(rest)), 'Constitution saving throw');
    case 'damage':
      return label ?? damageText(rest, false);
    case 'heal':
    case 'healing':
      return label ?? damageText(rest, true);
    case 'attack':
      return attackText(parseConfig(rest));
    case 'award': {
      return rest
        .replace(/\b(\d+)(gp|sp|cp|ep|pp|xp)\b/gi, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
    }
    case 'item':
    case 'activity':
    case 'use': {
      const parsed = parseConfig(rest);
      return parsed.pairs.get('name') ?? parsed.words.join(' ').trim() ?? 'item';
    }
    default: {
      const parsed = parseConfig(rest);
      return parsed.words.join(' ').trim() || name;
    }
  }
}

function lookupText(path: string, rest: string, ctx: EnricherContext): string {
  const style = rest.toLowerCase();
  let value: string;
  if (/^@?name$/i.test(path)) value = ctx.selfName?.trim() ? ctx.selfName.trim() : 'the creature';
  else value = 'this value (see Foundry)';
  if (/\blowercase\b/.test(style)) return value.toLowerCase();
  if (/\buppercase\b/.test(style)) return value.toUpperCase();
  if (/\bcapitalize\b/.test(style)) return value.charAt(0).toUpperCase() + value.slice(1);
  return value;
}

/** `&Reference[prc]{Perception}` reads as its label, else the rule's name. */
export function referenceText(config: string, label: string | null): string {
  if (label?.trim()) return label.trim();
  const parsed = parseConfig(config);
  const value = parsed.words[0] ?? [...parsed.pairs.values()][0] ?? config;
  const key = value.toLowerCase();
  const skill = SKILLS[key];
  if (skill) return skill.label;
  const ability = ABILITY_NAMES[key];
  if (ability) return ability;
  return REFERENCE_NAMES[key] ?? value.replace(/[-_]/g, ' ');
}

/**
 * Older dnd5e and importer syntax `@Check[dex|dc:15]{label}`, `@Save[...]`, `@Damage[...]`,
 * `@Attack[...]`, `@Skill[...]`, `@Heal[...]`: the same words as the `[[/...]]` form.
 */
export function atEnricherText(type: string, config: string, label: string | null): string {
  if (label?.trim() && !/^(damage|heal)$/i.test(type)) return label.trim();
  const normalized = config
    .split('|')
    .map(part => part.replace(/^(\w+):/, '$1='))
    .join(' ');
  return inlineRollText(`[[/${type.toLowerCase()} ${normalized}]]`);
}
