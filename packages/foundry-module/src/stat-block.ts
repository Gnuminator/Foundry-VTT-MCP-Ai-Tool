/**
 * An NPC's stat block for the Obsidian mirror and Library (docs/design/OBSIDIAN-O4-DESIGN.md
 * section 13). It follows the layout dnd5e itself uses for its stat block embed
 * (`NPCData#_prepareEmbedContext`, dnd5e 6.0.5 `dnd5e.mjs:85837-86110`): the creature tag, the
 * upper lines (AC, initiative in 2024, HP, speed), the ability scores, the lower lines (saves,
 * skills, damage and condition traits, senses, languages, challenge, proficiency bonus) and the
 * feature sections (traits, actions, bonus actions, reactions, legendary and mythic actions).
 *
 * Unlike dnd5e's embed it never enriches: feature descriptions go out as the raw HTML the
 * document stores, and the backend rewrites the enrichers into words and links. That keeps it
 * cheap (no document loads per link) and deterministic (the signature only moves when the
 * document does). Everything is read defensively; a missing dnd5e helper falls back to plain
 * values.
 */
import type { ExportStatBlock, RulesTag, StatBlockLine } from '@gnuminator/shared';

import {
  contentsOf,
  dig,
  fitJsonBytes,
  identifierOf,
  jsonStringBytes,
  nonEmpty,
  num,
  rec,
  sourceName,
  str,
  type Rec,
} from './doc-read.js';

type Labelled = Record<string, { label?: unknown; abbreviation?: unknown; hidden?: unknown }>;

interface Dnd5eUtils {
  formatCR?: (value: number, options?: { narrow?: boolean }) => string;
  formatNumber?: (value: number, options?: { signDisplay?: string }) => string;
  formatLength?: (value: number, units: string) => string;
}

function dnd5eConfig(): Rec | null {
  const config = rec((globalThis as unknown as { CONFIG?: unknown }).CONFIG);
  return rec(config?.DND5E);
}

function dnd5eUtils(): Dnd5eUtils {
  return (rec(dig(globalThis, 'dnd5e', 'utils')) ?? {}) as Dnd5eUtils;
}

/** `game.i18n.localize`; `fallback` (default the key) when Foundry has no such string. */
function localize(key: string, fallback: string = key): string {
  const i18n = rec(dig(globalThis, 'game', 'i18n'));
  const fn = i18n?.localize;
  if (typeof fn === 'function') {
    const text = (fn as (k: string) => unknown).call(i18n, key);
    if (typeof text === 'string' && text !== key) return text;
  }
  return fallback;
}

/** A label from a dnd5e config table entry (`{label}` or a plain string), localized. */
function configLabel(table: string, key: string): string | null {
  const entry = rec(dnd5eConfig()?.[table])?.[key];
  const label = typeof entry === 'string' ? entry : str(rec(entry)?.label);
  return label ? localize(label) : null;
}

function signed(value: number): string {
  const format = dnd5eUtils().formatNumber;
  if (typeof format === 'function') {
    try {
      return format(value, { signDisplay: 'always' });
    } catch {
      // fall through
    }
  }
  return value >= 0 ? `+${value}` : `${value}`;
}

function grouped(value: number): string {
  const format = dnd5eUtils().formatNumber;
  if (typeof format === 'function') {
    try {
      return format(value);
    } catch {
      // fall through
    }
  }
  return String(value);
}

function length(value: number, units: string): string {
  const format = dnd5eUtils().formatLength;
  if (typeof format === 'function') {
    try {
      return format(value, units);
    } catch {
      // fall through
    }
  }
  return `${value} ${units}`;
}

function crText(cr: number): string {
  const format = dnd5eUtils().formatCR;
  if (typeof format === 'function') {
    try {
      return format(cr, { narrow: false });
    } catch {
      // fall through
    }
  }
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}

/** Members of a Set or an array of strings. */
function setValues(value: unknown): string[] {
  if (value instanceof Set) return [...(value as Set<unknown>)].filter(v => typeof v === 'string');
  if (Array.isArray(value))
    return (value as unknown[]).filter((v): v is string => typeof v === 'string');
  return [];
}

function splitSemicolons(text: unknown): string[] {
  return typeof text === 'string'
    ? text
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
    : [];
}

function listText(values: string[]): string {
  return [...values].sort((a, b) => a.localeCompare(b)).join(', ');
}

/** `Trait.keyLabel` when dnd5e has it, else the config tables. */
function traitLabel(key: string, trait: string): string {
  const keyLabel = dig(globalThis, 'dnd5e', 'documents', 'Trait', 'keyLabel');
  if (typeof keyLabel === 'function') {
    try {
      const label = (keyLabel as (k: string, o: { trait: string }) => unknown)(key, { trait });
      if (typeof label === 'string' && label) return label;
    } catch {
      // fall through
    }
  }
  const table = trait === 'ci' ? 'conditionTypes' : 'damageTypes';
  return configLabel(table, key) ?? key;
}

/** A list in the browser's list style, for "a, b, and c" and "a, b, or c". */
function formatList(values: string[], type: 'unit' | 'conjunction' | 'disjunction'): string {
  const i18n = rec(dig(globalThis, 'game', 'i18n'));
  const getter = i18n?.getListFormatter;
  if (typeof getter === 'function') {
    try {
      const formatter = (getter as (o: object) => unknown).call(
        i18n,
        type === 'unit' ? { type } : { style: 'long', type }
      );
      const format = rec(formatter)?.format;
      if (typeof format === 'function') {
        const text = (format as (v: string[]) => unknown).call(formatter, values);
        if (typeof text === 'string') return text;
      }
    } catch {
      // fall through
    }
  }
  if (type === 'unit') return values.join(', ');
  if (values.length <= 1) return values.join('');
  const word = type === 'conjunction' ? 'and' : 'or';
  if (values.length === 2) return `${values[0]} ${word} ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, ${word} ${values[values.length - 1]}`;
}

/**
 * One trait as dnd5e's embed writes it (`dnd5e.mjs:85989-86010`): the standard values and custom
 * text sorted, then a "physical damage from attacks that are not magical" entry for physical
 * damage types that carry bypasses.
 */
function traitEntries(system: unknown, trait: string): string[] {
  const data = rec(dig(system, 'traits', trait));
  if (!data) return [];
  const bypasses = setValues(data.bypasses);
  const damageTypes = rec(dnd5eConfig()?.damageTypes);
  const plain: string[] = [];
  const physical: string[] = [];
  for (const key of setValues(data.value)) {
    if (bypasses.length > 0 && rec(damageTypes?.[key])?.isPhysical === true) physical.push(key);
    else plain.push(key);
  }
  const entries: string[] = [];
  const list = listText([
    ...plain.map(key => traitLabel(key, trait)),
    ...splitSemicolons(data.custom),
  ]);
  if (list) entries.push(list);
  if (physical.length > 0) {
    const properties = rec(dnd5eConfig()?.itemProperties);
    const bypassLabels = bypasses
      .map(key => str(rec(properties?.[key])?.label))
      .filter((label): label is string => label !== null)
      .map(label => localize(label));
    const typeLabels = physical.map(
      key => configLabel('damageTypes', key) ?? traitLabel(key, trait)
    );
    entries.push(
      localize(
        'DND5E.DAMAGE.PhysicalBypass.Description',
        '{damageTypes} from attacks that are not {bypassTypes}'
      )
        .replace('{damageTypes}', formatList(typeLabels, 'conjunction'))
        .replace('{bypassTypes}', formatList(bypassLabels, 'disjunction'))
    );
  }
  return entries;
}

function creatureTypeText(system: unknown): string {
  const actorClass = dig(globalThis, 'dnd5e', 'documents', 'Actor5e', 'formatCreatureType');
  const typeData = dig(system, 'details', 'type');
  if (typeof actorClass === 'function') {
    try {
      const text = (actorClass as (t: unknown) => unknown)(typeData);
      if (typeof text === 'string') return text;
    } catch {
      // fall through
    }
  }
  const value = nonEmpty(dig(typeData, 'value'));
  const custom = nonEmpty(dig(typeData, 'custom'));
  const subtype = nonEmpty(dig(typeData, 'subtype'));
  const base =
    value && value !== 'custom' ? (configLabel('creatureTypes', value) ?? value) : custom;
  return [base, subtype ? `(${subtype})` : null].filter(Boolean).join(' ');
}

/** dnd5e `prepareMeasured`: 2024 keeps a label's case, 2014 writes it in lower case. */
function measured(value: number, units: string, label: string | null, lower2014: boolean): string {
  if (!label) return length(value, units);
  return `${lower2014 ? label.toLowerCase() : label} ${length(value, units)}`;
}

function speedText(system: unknown, lower2014: boolean): string {
  const movement = rec(dig(system, 'attributes', 'movement'));
  if (!movement) return '';
  const units = str(movement.units) ?? 'ft';
  const speeds = rec(movement.speeds) ?? movement;
  const parts: string[] = [];
  const walk = num(speeds.walk);
  if (walk !== null) parts.push(measured(walk, units, null, lower2014));
  const types = (rec(dnd5eConfig()?.movementTypes) ?? {}) as Labelled;
  const keys = Object.keys(types).length ? Object.keys(types) : ['burrow', 'climb', 'fly', 'swim'];
  for (const key of keys) {
    if (key === 'walk' || types[key]?.hidden === true) continue;
    const value = num(speeds[key]);
    if (!value) continue;
    const label = str(types[key]?.label);
    let text = measured(value, units, label ? localize(label) : key, lower2014);
    if (key === 'fly' && movement.hover === true) {
      text = localize('DND5E.MOVEMENT.HoverSpeed', '{speed} (hover)').replace('{speed}', text);
    }
    parts.push(text);
  }
  const special = formatList(splitSemicolons(movement.special), 'unit');
  const standard = formatList(parts, 'unit');
  return special ? `${standard} (${special})` : standard;
}

function sensesText(system: unknown, skills: unknown, lower2014: boolean): string {
  const senses = rec(dig(system, 'attributes', 'senses'));
  const ranges = rec(senses?.ranges) ?? senses ?? {};
  const units = str(senses?.units) ?? 'ft';
  const parts: string[] = [];
  const configured = Object.keys(rec(dnd5eConfig()?.senses) ?? {});
  const keys = configured.length
    ? configured
    : ['blindsight', 'darkvision', 'tremorsense', 'truesight'];
  for (const key of keys) {
    const value = num(ranges[key]);
    if (!value) continue;
    parts.push(measured(value, units, configLabel('senses', key) ?? key, lower2014));
  }
  parts.push(...splitSemicolons(senses?.special));
  const passive = num(dig(skills, 'prc', 'passive'));
  const list = listText(parts);
  const passiveText =
    passive === null
      ? null
      : `${localize('DND5E.PassivePerception', 'Passive Perception')} ${grouped(passive)}`;
  return [list || null, passiveText].filter(Boolean).join('; ');
}

function languagesText(system: unknown, lower2014: boolean): string {
  const labels = rec(dig(system, 'traits', 'languages', 'labels'));
  const languages = setValues(labels?.languages);
  const ranged = setValues(labels?.ranged).map(r => (lower2014 ? r.toLowerCase() : r));
  if (languages.length || ranged.length) {
    return [languages.join(', '), ranged.join(', ')].filter(Boolean).join('; ');
  }
  const data = rec(dig(system, 'traits', 'languages'));
  const list = [
    ...setValues(data?.value).map(key => configLabel('languages', key) ?? key),
    ...splitSemicolons(data?.custom),
  ];
  return list.length ? listText(list) : '';
}

function abilityRows(system: unknown): ExportStatBlock['abilities'] {
  const abilities = rec(dig(system, 'abilities')) ?? {};
  const config = (rec(dnd5eConfig()?.abilities) ?? {}) as Labelled;
  const keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  return keys
    .filter(key => rec(abilities[key]))
    .map(key => {
      const ability = rec(abilities[key]) ?? {};
      const score = num(ability.value) ?? 10;
      const mod = num(ability.mod) ?? Math.floor((score - 10) / 2);
      const save = num(dig(ability, 'save', 'value')) ?? num(ability.save) ?? mod;
      const abbreviation = str(config[key]?.abbreviation);
      return {
        key,
        label: (abbreviation ? localize(abbreviation) : key).toUpperCase(),
        score,
        mod,
        save,
      };
    });
}

function savesText(system: unknown): string {
  const abilities = rec(dig(system, 'abilities')) ?? {};
  const parts: string[] = [];
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const ability = rec(abilities[key]);
    if (!ability) continue;
    const multiplier = num(dig(ability, 'save', 'prof', 'multiplier')) ?? num(ability.proficient);
    if (!multiplier) continue;
    const value = num(dig(ability, 'save', 'value')) ?? num(ability.save);
    if (value === null) continue;
    parts.push(`${key.charAt(0).toUpperCase()}${key.slice(1)} ${signed(value)}`);
  }
  return parts.join(', ');
}

function skillsText(skills: unknown): string {
  const all = rec(skills) ?? {};
  const config = (rec(dnd5eConfig()?.skills) ?? {}) as Labelled;
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(all)) {
    const skill = rec(raw);
    if (!skill || !(num(skill.value) ?? 0)) continue;
    const label = str(config[key]?.label);
    const total = num(skill.total);
    if (total === null) continue;
    parts.push(`${label ? localize(label) : key} ${signed(total)}`);
  }
  return parts.sort((a, b) => a.localeCompare(b)).join(', ');
}

/** Read `item.system.activities` (a Collection) for the first activity's activation type. */
function firstActivation(item: Rec): string | null {
  const activities = dig(item, 'system', 'activities');
  const first = contentsOf(activities)[0] ?? null;
  return (
    nonEmpty(dig(first, 'activation', 'type')) ??
    nonEmpty(dig(item, 'system', 'activation', 'type'))
  );
}

function hasProperty(item: Rec, key: string): boolean {
  const properties = dig(item, 'system', 'properties');
  if (properties instanceof Set) return properties.has(key);
  return Array.isArray(properties) && (properties as unknown[]).includes(key);
}

const SECTION_ORDER: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'trait', label: 'Traits' },
  { key: 'action', label: 'Actions' },
  { key: 'bonus', label: 'Bonus Actions' },
  { key: 'reaction', label: 'Reactions' },
  { key: 'legendary', label: 'Legendary Actions' },
  { key: 'mythic', label: 'Mythic Actions' },
];

function rulesOfActor(actor: Rec, fallback: RulesTag | null): RulesTag {
  const rules = nonEmpty(dig(actor, 'system', 'source', 'rules'));
  if (rules === '2014' || rules === '2024') return rules;
  return fallback ?? '2014';
}

/** The legendary actions intro dnd5e writes when the actor has none of its own. */
function legendaryIntro(system: unknown): string | null {
  const fn = rec(system)?.getLegendaryActionsDescription;
  if (typeof fn === 'function') {
    try {
      const text = (fn as () => unknown).call(system);
      if (typeof text === 'string' && text) return `<p>${text}</p>`;
    } catch {
      // fall through
    }
  }
  return null;
}

/**
 * The stat block of an NPC actor (world or compendium). `budgetBytes` caps the feature and
 * description HTML together; later texts are cut (`truncated`).
 */
export function buildStatBlock(
  actor: Rec,
  rulesFallback: RulesTag | null,
  budgetBytes: number
): ExportStatBlock {
  const system = actor.system;
  const rules = rulesOfActor(actor, rulesFallback);
  const lower2014 = rules === '2014';
  const skills = dig(system, 'skills');
  let budget = budgetBytes;
  let truncated = false;
  const fit = (html: string): string => {
    if (budget <= 0) {
      truncated = truncated || html.length > 0;
      return '';
    }
    const fitted = fitJsonBytes(html, budget);
    budget -= jsonStringBytes(fitted.content);
    if (fitted.truncated) truncated = true;
    return fitted.content;
  };

  // The overrides dnd5e's embed reads (`flags.dnd5e.statBlockOverride`, `dnd5e.mjs:85846`).
  const overrides = rec(dig(actor, 'flags', 'dnd5e', 'statBlockOverride')) ?? {};
  const override = (key: string): string | null => {
    const value = overrides[key];
    if (typeof value === 'string') return value;
    const n = num(value);
    return n === null ? null : String(n);
  };
  const lowered = (text: string): string => (lower2014 ? text.toLowerCase() : text);

  // Tag: `Medium undead, neutral evil`.
  const size =
    override('size') ??
    configLabel('actorSizes', nonEmpty(dig(system, 'traits', 'size')) ?? '') ??
    '';
  const alignment = override('alignment') ?? str(dig(system, 'details', 'alignment')) ?? '';
  let tag =
    override('tag') ??
    [`${size} ${override('type') ?? creatureTypeText(system)}`.trim(), alignment]
      .filter(Boolean)
      .join(', ');
  if (lower2014) tag = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();

  // Upper lines.
  const ac = num(dig(system, 'attributes', 'ac', 'value'));
  const acLabel = nonEmpty(dig(system, 'attributes', 'ac', 'label'));
  const hpMax = num(dig(system, 'attributes', 'hp', 'max'));
  const hpFormula = nonEmpty(dig(system, 'attributes', 'hp', 'formula'));
  const upper: StatBlockLine[] = [];
  const acOverride = nonEmpty(override('ac'));
  if (acOverride !== null) {
    upper.push({ label: lower2014 ? 'Armor Class' : 'AC', value: lowered(acOverride) });
  } else if (ac !== null) {
    const label = acLabel && lower2014 ? ` (${acLabel.toLowerCase()})` : '';
    upper.push({ label: lower2014 ? 'Armor Class' : 'AC', value: `${ac}${label}` });
  }
  if (!lower2014) {
    const init = num(dig(system, 'attributes', 'init', 'total'));
    const score = num(dig(system, 'attributes', 'init', 'score'));
    const initOverride = override('initiative');
    if (initOverride !== null) {
      upper.push({ label: 'Initiative', value: initOverride });
    } else if (init !== null) {
      upper.push({
        label: 'Initiative',
        value: `${signed(init)}${score !== null ? ` (${score})` : ''}`,
      });
    }
  }
  const hpOverride = nonEmpty(override('hp'));
  if (hpOverride !== null) {
    upper.push({ label: lower2014 ? 'Hit Points' : 'HP', value: lowered(hpOverride) });
  } else if (hpMax !== null) {
    upper.push({
      label: lower2014 ? 'Hit Points' : 'HP',
      value: hpFormula ? `${hpMax} (${hpFormula})` : `${hpMax}`,
    });
  }
  const speed = override('speed') ?? speedText(system, lower2014);
  if (speed) upper.push({ label: 'Speed', value: lowered(speed) });

  // Lower lines.
  const lower: StatBlockLine[] = [];
  const push = (label: string, value: string): void => {
    if (value) lower.push({ label, value });
  };
  // 2014 stat blocks write damage and condition words in lower case (dnd5e's `lowerCase`).
  const traitLine = (type: string, entries: () => string[]): string => {
    if (type in overrides) return lowered(override(type) ?? '');
    return lowered(entries().join('; '));
  };
  if (lower2014) push('Saving Throws', savesText(system));
  push('Skills', override('skills') ?? skillsText(skills));
  push(
    lower2014 ? 'Damage Vulnerabilities' : 'Vulnerabilities',
    traitLine('vulnerabilities', () => traitEntries(system, 'dv'))
  );
  push(
    lower2014 ? 'Damage Resistances' : 'Resistances',
    traitLine('resistances', () => traitEntries(system, 'dr'))
  );
  if (lower2014) {
    push(
      'Damage Immunities',
      traitLine('immunities', () => traitEntries(system, 'di'))
    );
    push(
      'Condition Immunities',
      lowered(override('conditionImmunities') ?? traitEntries(system, 'ci').join('; '))
    );
  } else {
    push(
      'Immunities',
      traitLine('immunities', () => [...traitEntries(system, 'di'), ...traitEntries(system, 'ci')])
    );
  }
  push('Senses', override('senses') ?? sensesText(system, skills, lower2014));
  push(
    'Languages',
    override('languages') ??
      (languagesText(system, lower2014) || (lower2014 ? '\u2014' : localize('COMMON.None', 'None')))
  );
  const cr = num(dig(system, 'details', 'cr'));
  const prof = num(dig(system, 'attributes', 'prof'));
  const crOverride = override('cr');
  if (cr !== null || crOverride !== null) {
    const getExp = actor.getCRExp;
    const expFor = (c: number): number | null =>
      typeof getExp === 'function' ? num((getExp as (v: number) => unknown).call(actor, c)) : null;
    const xp = cr === null ? null : (expFor(cr) ?? num(dig(system, 'details', 'xp', 'value')));
    const lairXp =
      cr !== null && dig(system, 'resources', 'lair', 'value') === true ? expFor(cr + 1) : null;
    let xpText = override('xp');
    if (xpText === null && xp !== null) {
      if (lower2014) {
        xpText = localize('DND5E.ExperiencePoints.Format', '{value} XP').replace(
          '{value}',
          grouped(xp)
        );
      } else if (lairXp !== null) {
        xpText = localize('DND5E.ExperiencePoints.StatBlock.Lair', 'XP {value}, or {lair} in lair')
          .replace('{value}', grouped(xp))
          .replace('{lair}', grouped(lairXp));
      } else {
        xpText = localize('DND5E.ExperiencePoints.StatBlock.Standard', 'XP {value}').replace(
          '{value}',
          grouped(xp)
        );
      }
    }
    const pbText =
      override('pb') ??
      (prof === null
        ? null
        : lower2014
          ? signed(prof)
          : `${localize('DND5E.ProficiencyBonusAbbr', 'PB')} ${signed(prof)}`);
    const inner = [xpText, lower2014 ? null : pbText].filter(Boolean).join('; ');
    const crValue = crOverride ?? (cr === null ? '' : crText(cr));
    push(lower2014 ? 'Challenge' : 'CR', `${crValue}${inner ? ` (${inner})` : ''}`);
    if (lower2014 && pbText) push('Proficiency Bonus', pbText);
  } else if (lower2014 && prof !== null) {
    push('Proficiency Bonus', override('pb') ?? signed(prof));
  }

  // Feature sections, in dnd5e's grouping: feats and weapons, by the first activity's activation.
  const items = contentsOf(actor.items).sort(
    (a, b) => (num(a.sort) ?? 0) - (num(b.sort) ?? 0) || sourceName(a).localeCompare(sourceName(b))
  );
  const sections = new Map<
    string,
    { intro: string | null; entries: Array<{ name: string; html: string }> }
  >();
  for (const { key } of SECTION_ORDER) sections.set(key, { intro: null, entries: [] });
  for (const item of items) {
    if (item.type !== 'feat' && item.type !== 'weapon') continue;
    const category = hasProperty(item, 'trait') ? 'trait' : (firstActivation(item) ?? 'trait');
    const section = sections.get(category) ?? sections.get('trait');
    if (!section) continue;
    const html = str(dig(item, 'system', 'description', 'value')) ?? '';
    // dnd5e takes these two by `item.identifier` in any category (`dnd5e.mjs:86078-86082`).
    const identifier = identifierOf(item);
    if (identifier === 'legendary-actions') {
      const legendary = sections.get('legendary');
      if (legendary) legendary.intro = fit(html);
      continue;
    }
    if (identifier === 'mythic-actions') {
      const mythic = sections.get('mythic');
      if (mythic) mythic.intro = fit(html);
      continue;
    }
    const activities = contentsOf(dig(item, 'system', 'activities'));
    const uses =
      nonEmpty(dig(item, 'system', 'uses', 'label')) ??
      (activities.length === 1 ? nonEmpty(dig(activities[0], 'uses', 'label')) : null);
    const name = sourceName(item);
    section.entries.push({ name: uses ? `${name} (${uses})` : name, html: fit(html) });
  }
  const legendary = sections.get('legendary');
  if (legendary?.entries.length && !legendary.intro) {
    legendary.intro = legendaryIntro(system);
  }

  const spells = items
    .filter(item => item.type === 'spell')
    .map(item => ({
      name: sourceName(item),
      level: num(dig(item, 'system', 'level')) ?? 0,
      sourceUuid:
        nonEmpty(dig(item, '_stats', 'compendiumSource')) ??
        nonEmpty(dig(item, 'flags', 'core', 'sourceId')) ??
        null,
    }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  const biography = str(dig(system, 'details', 'biography', 'value')) ?? '';
  const description = biography.trim() ? fit(biography) : null;

  return {
    rules,
    tag,
    upper,
    abilities: abilityRows(system),
    lower,
    sections: SECTION_ORDER.flatMap(({ key, label }) => {
      const section = sections.get(key);
      if (!section || section.entries.length === 0) return [];
      return [{ key, label, intro: section.intro, entries: section.entries }];
    }),
    spells,
    description: description === '' ? null : description,
    truncated,
  };
}
