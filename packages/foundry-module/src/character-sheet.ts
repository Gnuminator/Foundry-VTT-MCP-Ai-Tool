/**
 * "My character" (I-096): the sheets of the character actors one player owns, for the
 * dashboard's `/me` page. Read-only; an allowlist of dnd5e fields, nothing GM-only (no flags,
 * no GM notes, no secret blocks; an unidentified item shows only its unidentified name and
 * description).
 *
 * The dashboard maps the player's private link key to a Foundry user id on its own side and
 * asks through the bridge's control method `character_sheet`; this query is never an MCP tool.
 * It only answers for a known non-GM user, and only with actors that user OWNS (Observer or
 * Limited is not enough). GM client only.
 */
import type {
  CharacterSheet,
  CharacterSheetsResult,
  SheetFeature,
  SheetItem,
  SheetSpell,
} from '@gnuminator/shared';

import {
  type Rec,
  configLabel,
  dnd5eConfig,
  keysOf,
  labelText,
  num,
  numOrNull,
  plainText,
  rec,
  str,
  strOrNull,
  spellPrepared,
  usesOf,
} from './character-sheet-fields.js';

/** Query name (shared's CHARACTER_SHEET_QUERY; a module file imports types only). */
export const CHARACTER_SHEET_QUERY = 'characterSheet';

const INVENTORY_TYPES = [
  'weapon',
  'equipment',
  'consumable',
  'tool',
  'loot',
  'container',
  'backpack',
];
const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** The parts of an actor and its items the projection reads (a Foundry Actor satisfies it). */
export interface SheetActor {
  id: string;
  name: string;
  type: string;
  system: unknown;
  items: Iterable<SheetActorItem>;
  statuses?: Iterable<string>;
  effects?: Iterable<{
    name?: string;
    disabled?: boolean;
    isTemporary?: boolean;
    statuses?: Iterable<string>;
  }>;
}

export interface SheetActorItem {
  id: string;
  name: string;
  type: string;
  system: unknown;
  labels?: Rec;
  subclass?: { name?: string } | null;
}

function sortByName<T extends { name: string }>(list: T[]): T[] {
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

function itemOf(item: SheetActorItem): SheetItem {
  const s = rec(item.system);
  const unidentified = s.identified === false;
  const hidden = rec(s.unidentified);
  const labels = rec(item.labels);
  return {
    id: item.id,
    name: unidentified ? (strOrNull(hidden.name) ?? 'Unidentified item') : item.name,
    type: item.type,
    quantity: num(s.quantity, 1),
    equipped: s.equipped === true,
    attuned: s.attuned === true,
    attunement: strOrNull(s.attunement),
    uses: usesOf(s),
    attack: unidentified ? null : labelText(labels.toHit),
    damage: unidentified ? null : labelText(labels.damages ?? labels.damage),
    description: unidentified ? plainText(hidden.description) : plainText(rec(s.description).value),
  };
}

function spellOf(item: SheetActorItem): SheetSpell {
  const s = rec(item.system);
  const props = keysOf(s.properties);
  const labels = rec(item.labels);
  const components = ['vocal', 'somatic', 'material']
    .filter(p => props.includes(p))
    .map(p => p[0].toUpperCase())
    .join(', ');
  const school = str(s.school);
  return {
    id: item.id,
    name: item.name,
    level: num(s.level, 0),
    school: school ? configLabel(dnd5eConfig().spellSchools, school) : null,
    prepared: spellPrepared(s),
    castingTime: labelText(labels.activation),
    range: labelText(labels.range),
    duration: labelText(labels.duration),
    concentration: props.includes('concentration'),
    ritual: props.includes('ritual'),
    components,
    material: strOrNull(rec(s.materials).value),
  };
}

function featureOf(item: SheetActorItem): SheetFeature {
  const s = rec(item.system);
  return {
    id: item.id,
    name: item.name,
    kind: str(rec(s.type).value) || 'other',
    uses: usesOf(s),
    description: plainText(rec(s.description).value),
  };
}

function traitList(trait: unknown, table: unknown): string[] {
  const t = rec(trait);
  const custom = str(t.custom)
    .split(/[;,]/)
    .map(x => x.trim())
    .filter(Boolean);
  return [...keysOf(t.value).map(k => configLabel(table, k)), ...custom];
}

/** Project one character actor into the player's sheet. */
export function projectCharacterSheet(actor: SheetActor): CharacterSheet {
  const sys = rec(actor.system);
  const attr = rec(sys.attributes);
  const details = rec(sys.details);
  const traits = rec(sys.traits);
  const cfg = dnd5eConfig();
  const items = [...actor.items];
  const ofType = (type: string): SheetActorItem[] => items.filter(i => i.type === type);

  const classes = ofType('class').map(c => {
    const s = rec(c.system);
    const identifier = str(s.identifier);
    const sub =
      c.subclass?.name ??
      ofType('subclass').find(x => str(rec(x.system).classIdentifier) === identifier)?.name ??
      null;
    const hd = rec(s.hd);
    return {
      name: c.name,
      levels: num(s.levels, 1),
      subclass: sub,
      hitDie: strOrNull(hd.denomination) ?? strOrNull(s.hitDice),
    };
  });

  const abilities = ABILITY_ORDER.filter(k => k in rec(sys.abilities)).map(key => {
    const a = rec(rec(sys.abilities)[key]);
    const save = typeof a.save === 'number' ? a.save : num(rec(a.save).value, num(a.mod));
    return {
      key,
      label: configLabel(cfg.abilities, key),
      score: num(a.value, 10),
      mod: num(a.mod),
      save,
      saveProficient: num(a.proficient) > 0,
    };
  });

  const skills = sortByName(
    Object.entries(rec(sys.skills)).map(([key, raw]) => {
      const sk = rec(raw);
      return {
        key,
        label: configLabel(cfg.skills, key),
        name: configLabel(cfg.skills, key),
        ability: str(sk.ability),
        total: num(sk.total, num(sk.mod)),
        passive: num(sk.passive, 10 + num(sk.total)),
        proficiency: num(sk.value),
      };
    })
  ).map(({ name: _name, ...rest }) => rest);

  const slots = [];
  for (let level = 1; level <= 9; level++) {
    const s = rec(rec(sys.spells)[`spell${level}`]);
    if (num(s.max) > 0) slots.push({ level, value: num(s.value), max: num(s.max), pact: false });
  }
  const pact = rec(rec(sys.spells).pact);
  if (num(pact.max) > 0) {
    slots.push({ level: num(pact.level), value: num(pact.value), max: num(pact.max), pact: true });
  }

  const spells = ofType('spell')
    .map(spellOf)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const spellAttr = rec(attr.spell);
  const castAbility = strOrNull(attr.spellcasting);
  const movement = rec(attr.movement);
  const speed: Record<string, number> = {};
  for (const mode of ['walk', 'fly', 'swim', 'climb', 'burrow']) {
    if (num(movement[mode]) > 0) speed[mode] = num(movement[mode]);
  }
  const senses = rec(attr.senses);
  const senseUnits = str(senses.units) || 'ft';
  const statusLabels = new Map(
    (
      ((globalThis as { CONFIG?: { statusEffects?: Array<{ id: string; name?: string }> } }).CONFIG
        ?.statusEffects ?? []) as Array<{ id: string; name?: string }>
    ).map(s => [s.id, s.name ?? s.id])
  );
  const effects = [...(actor.effects ?? [])].filter(e => !e.disabled);
  const concentrating = effects.find(e => [...(e.statuses ?? [])].includes('concentrating'));

  return {
    id: actor.id,
    name: actor.name,
    level: num(
      details.level,
      classes.reduce((sum, c) => sum + c.levels, 0)
    ),
    classes,
    species: ofType('race')[0]?.name ?? strOrNull(details.race),
    background: ofType('background')[0]?.name ?? strOrNull(details.background),
    alignment: strOrNull(details.alignment),
    xp: numOrNull(rec(details.xp).value),
    size: strOrNull(traits.size) ? configLabel(cfg.actorSizes, str(traits.size)) : null,
    ac: numOrNull(rec(attr.ac).value),
    hp: {
      value: num(rec(attr.hp).value),
      max: num(rec(attr.hp).max),
      temp: num(rec(attr.hp).temp),
    },
    hitDice: { value: num(rec(attr.hd).value), max: num(rec(attr.hd).max) },
    deathSaves: { success: num(rec(attr.death).success), failure: num(rec(attr.death).failure) },
    exhaustion: num(attr.exhaustion),
    inspiration: attr.inspiration === true,
    proficiencyBonus: numOrNull(attr.prof),
    initiative: numOrNull(rec(attr.init).total ?? rec(attr.init).mod),
    speed,
    speedUnits: strOrNull(movement.units),
    senses: ['darkvision', 'blindsight', 'tremorsense', 'truesight']
      .filter(k => num(senses[k]) > 0)
      .map(k => `${configLabel(cfg.senses, k)} ${num(senses[k])} ${senseUnits}`)
      .concat(strOrNull(senses.special) ? [str(senses.special)] : []),
    abilities,
    skills,
    passivePerception: numOrNull(rec(rec(sys.skills).prc).passive),
    conditions: [...new Set([...(actor.statuses ?? [])])].map(s => statusLabels.get(s) ?? s),
    concentration: concentrating?.name ?? null,
    // dnd5e gives every actor a spell DC and attack (Intelligence by default); a character with
    // no spells and no slots shows none.
    spellcasting:
      spells.length > 0 || slots.length > 0
        ? {
            ability: castAbility ? configLabel(cfg.abilities, castAbility) : null,
            dc: numOrNull(spellAttr.dc),
            attack: numOrNull(spellAttr.attack),
          }
        : { ability: null, dc: null, attack: null },
    slots,
    spells,
    features: sortByName(ofType('feat').map(featureOf)),
    inventory: sortByName(items.filter(i => INVENTORY_TYPES.includes(i.type)).map(itemOf)),
    currency: Object.fromEntries(Object.entries(rec(sys.currency)).map(([k, v]) => [k, num(v)])),
    languages: traitList(traits.languages, cfg.languages),
    armorProficiencies: traitList(traits.armorProf, cfg.armorProficiencies),
    weaponProficiencies: traitList(traits.weaponProf, cfg.weaponProficiencies),
    toolProficiencies: Object.entries(rec(sys.tools))
      .filter(([, t]) => num(rec(t).value) > 0)
      .map(([k]) => configLabel(cfg.tools, k)),
    resistances: traitList(traits.dr, cfg.damageTypes),
    immunities: traitList(traits.di, cfg.damageTypes),
    vulnerabilities: traitList(traits.dv, cfg.damageTypes),
    personality: {
      traits: plainText(details.trait, 1200),
      ideals: plainText(details.ideal, 1200),
      bonds: plainText(details.bond, 1200),
      flaws: plainText(details.flaw, 1200),
      appearance: plainText(details.appearance, 1200),
    },
  };
}

/** The query handler: `{ userId }`, the dashboard's mapping of the player's link key. */
export function characterSheets(data: unknown): Promise<CharacterSheetsResult> {
  const userId = str(rec(data).userId);
  interface SheetUser {
    isGM?: boolean;
    name?: string;
  }
  interface OwnedActor {
    type?: string;
    testUserPermission?: (user: SheetUser, level: string) => boolean;
  }
  const game = (
    globalThis as {
      game?: {
        users?: { get?: (id: string) => SheetUser | undefined };
        actors?: Iterable<OwnedActor>;
      };
    }
  ).game;
  const user = game?.users?.get?.(userId);
  if (!user || user.isGM) return Promise.reject(new Error('No such player'));
  const actors = [...(game?.actors ?? [])].filter(
    a => a.type === 'character' && a.testUserPermission?.(user, 'OWNER') === true
  );
  return Promise.resolve({
    userId,
    userName: String(user.name ?? ''),
    sheets: actors.map(a => projectCharacterSheet(a as unknown as SheetActor)),
  });
}
