/**
 * The fake's origins (slice 3c): a few invented species, backgrounds and feats, and the fake's twins
 * of listOrigins, describeOrigin, cloneHero and the origin side of createHero (a species, a
 * background, an existing hero that takes a feat or a second class). Numbers follow the rules the
 * origin checks (lib/origins.mjs) use, so a clean fake run proves the plumbing, not dnd5e. A test
 * breaks something by naming a quirk in `world.faults.origin` ("<quirk>" or "<quirk>:<name>"):
 *
 *   speed:<species>       the species' walking speed is wrong on the actor
 *   size:<species>        the actor's size is not one the species allows
 *   noGrant:<name>        a species, background or feat grants no feature item
 *   noTrait:<name>        a trait grant is not held
 *   asiTooMuch:<name>     an ability score goes up by more than it was asked
 *   dropItem:<feat>       taking the feat removes an item the host had
 *   saves:<class>         a class added as a second class gives its saving throws
 *   slots                 the multiclass slot table is wrong
 *   pact                  Pact Magic merges into the slot table
 */
import { RULES, stepValue } from '../features.mjs';
import { describe, featureUuid, findClass, findSubclass, slotsFor, uuidOf } from './classes.mjs';
import { ToolFailure, newId } from './state.mjs';

/** @typedef {import('./state.mjs').World} World */

const ORIGINS_PACK = 'dnd5e.origins24';
const FEATS_PACK = 'dnd5e.feats24';
export const FAKE_ORIGIN_PACKS = [ORIGINS_PACK, FEATS_PACK];

/**
 * @typedef {object} FakeOrigin
 * @property {string} id
 * @property {string} name
 * @property {'race'|'background'|'feat'} type
 * @property {string[]} [sizes]
 * @property {Record<string, number>} [movement]
 * @property {Record<string, number>} [senses]
 * @property {string[]} [grants]            fixed trait keys
 * @property {{count: number, pool: string[]}} [choice]
 * @property {Array<{name: string, uses?: number, type?: string}>} [features]
 * @property {{points: number, cap: number, locked: string[]}} [asi]
 * @property {string} [feat]                a background's origin feat (by name)
 * @property {'origin'|'general'|'fightingStyle'|'epicBoon'} [featType]
 * @property {{level?: number, ability?: Record<string, number>, spellcasting?: boolean, classes?: string[]}} [prereq]
 */

/** @type {FakeOrigin[]} */
export const FAKE_SPECIES = [
  {
    id: 'fakeSpHuman0000001',
    name: 'Human',
    type: 'race',
    sizes: ['sm', 'med'],
    movement: { walk: 30 },
    grants: ['languages:standard:common'],
    choice: { count: 1, pool: ['skills:prc', 'skills:ins', 'skills:sur'] },
    features: [{ name: 'Resourceful', uses: 1, type: 'utility' }],
  },
  {
    id: 'fakeSpElf000000001',
    name: 'Elf',
    type: 'race',
    sizes: ['med'],
    movement: { walk: 30 },
    senses: { darkvision: 60 },
    grants: ['languages:standard:elvish'],
    choice: { count: 1, pool: ['skills:prc', 'skills:ins', 'skills:sur'] },
    features: [{ name: 'Fey Ancestry' }, { name: 'Trance', uses: 1, type: 'utility' }],
  },
  {
    id: 'fakeSpDwarf0000001',
    name: 'Dwarf',
    type: 'race',
    sizes: ['med'],
    movement: { walk: 25 },
    senses: { darkvision: 120 },
    grants: ['dr:poison', 'languages:standard:dwarvish'],
    features: [{ name: 'Stonecunning', uses: 2, type: 'utility' }],
  },
];

/** @type {FakeOrigin[]} */
export const FAKE_BACKGROUNDS = [
  {
    id: 'fakeBgSoldier00001',
    name: 'Soldier',
    type: 'background',
    asi: { points: 3, cap: 2, locked: ['con', 'int', 'wis', 'cha'] },
    grants: ['skills:ath', 'tool:game:card'],
    feat: 'Savage Blow',
    features: [],
  },
  {
    id: 'fakeBgAcolyte00001',
    name: 'Acolyte',
    type: 'background',
    asi: { points: 3, cap: 2, locked: ['str', 'dex', 'con'] },
    grants: ['skills:ins', 'skills:rel', 'tool:art:calligrapher'],
    feat: 'Initiate',
    features: [],
  },
];

/** @type {FakeOrigin[]} */
export const FAKE_FEATS = [
  {
    id: 'fakeFtAlert0000001',
    name: 'Alert',
    type: 'feat',
    featType: 'origin',
    features: [{ name: 'Initiative Swap', uses: 1, type: 'utility' }],
  },
  {
    id: 'fakeFtInitiate0001',
    name: 'Initiate',
    type: 'feat',
    featType: 'origin',
    features: [{ name: 'Initiate Cantrip' }],
  },
  {
    id: 'fakeFtSavage000001',
    name: 'Savage Blow',
    type: 'feat',
    featType: 'origin',
    features: [{ name: 'Extra Damage Die', uses: 1, type: 'damage' }],
  },
  {
    id: 'fakeFtSkilled00001',
    name: 'Skilled',
    type: 'feat',
    featType: 'origin',
    choice: {
      count: 3,
      pool: ['skills:acr', 'skills:ani', 'skills:arc', 'skills:ath', 'skills:dec'],
    },
  },
  {
    id: 'fakeFtBoost0000001',
    name: 'Ability Boost',
    type: 'feat',
    featType: 'general',
    asi: { points: 2, cap: 1, locked: [] },
    prereq: { level: 4 },
  },
  {
    id: 'fakeFtWrestler0001',
    name: 'Wrestler',
    type: 'feat',
    featType: 'general',
    asi: { points: 1, cap: 1, locked: ['int', 'wis', 'cha', 'con', 'dex'] },
    prereq: { level: 4, ability: { str: 13 } },
    features: [{ name: 'Punch and Grab' }],
  },
  {
    id: 'fakeFtSniper000001',
    name: 'Far Caster',
    type: 'feat',
    featType: 'general',
    asi: { points: 1, cap: 1, locked: ['str', 'dex', 'con', 'wis', 'cha'] },
    prereq: { level: 4, spellcasting: true },
    features: [{ name: 'Far Cantrip', uses: 1, type: 'utility' }],
  },
  {
    id: 'fakeFtArchery00001',
    name: 'Archery',
    type: 'feat',
    featType: 'fightingStyle',
    prereq: { classes: ['fighter', 'paladin'] },
    features: [{ name: 'Archery Bonus' }],
  },
  {
    id: 'fakeFtFortitude001',
    name: 'Boon of Vigor',
    type: 'feat',
    featType: 'epicBoon',
    asi: { points: 1, cap: 1, locked: [] },
    prereq: { level: 19 },
  },
  {
    id: 'fakeFtImpossible01',
    name: 'Mighty Charisma',
    type: 'feat',
    featType: 'general',
    prereq: { level: 4, ability: { cha: 17 } },
  },
];

const ALL_ORIGINS = [...FAKE_SPECIES, ...FAKE_BACKGROUNDS, ...FAKE_FEATS];

/** @param {string} uuid */
export function findOrigin(uuid) {
  return ALL_ORIGINS.find(o => uuidOf(originPack(o), o.id) === uuid);
}
/** @param {FakeOrigin} o */
const originPack = o => (o.type === 'feat' ? FEATS_PACK : ORIGINS_PACK);
/** @param {string} name */
const featByName = name => FAKE_FEATS.find(f => f.name === name);

/** What each fake class asks of a second-class hero (primary abilities, the multiclass-only grants). */
const FAKE_CLASS_FACTS =
  /** @type {Record<string, {primary: string[], all?: boolean, multi: string[], multiChoice?: {count: number, pool: string[]}}>} */ ({
    fighter: {
      primary: ['str', 'dex'],
      multi: ['armor:lgt', 'armor:med', 'armor:shl', 'weapon:sim', 'weapon:mar'],
    },
    paladin: {
      primary: ['str', 'cha'],
      all: true,
      multi: ['armor:lgt', 'armor:med', 'armor:shl', 'weapon:sim', 'weapon:mar'],
    },
    cleric: { primary: ['wis'], multi: ['armor:lgt', 'armor:med', 'armor:shl'] },
    rogue: {
      primary: ['dex'],
      multi: ['armor:lgt', 'weapon:sim'],
      multiChoice: { count: 1, pool: ['skills:ste', 'skills:acr', 'skills:per'] },
    },
    wizard: { primary: ['int'], multi: [] },
    warlock: { primary: ['cha'], multi: ['armor:lgt', 'weapon:sim'] },
  });

const STANDARD = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
const mod = (/** @type {number} */ v) => Math.floor((v - 10) / 2);
const has = (
  /** @type {World} */ w,
  /** @type {string} */ quirk,
  /** @type {string} */ name = ''
) => w.faults.origin.has(name ? `${quirk}:${name}` : quirk);

/* -------------------------------------------- */
/*  Listing and describing                        */
/* -------------------------------------------- */

/** @param {World} _w @param {{packIds: string[], kind: string}} args */
export function fakeListOrigins(_w, args) {
  const want = { species: 'race', background: 'background', feat: 'feat' }[args.kind];
  if (!want) throw new ToolFailure(`listOrigins: unknown kind "${args.kind}"`);
  /** @type {any[]} */
  const entries = [];
  /** @type {string[]} */
  const missing = [];
  for (const packId of args.packIds ?? []) {
    if (!FAKE_ORIGIN_PACKS.includes(packId)) {
      missing.push(packId);
      continue;
    }
    for (const o of ALL_ORIGINS) {
      if (o.type !== want || originPack(o) !== packId) continue;
      entries.push({
        packId,
        id: o.id,
        uuid: uuidOf(packId, o.id),
        name: o.name,
        type: o.type,
        identifier: o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        rules: '2024',
        book: '',
        ...(o.type === 'feat' ? { featType: o.featType ?? 'general' } : {}),
      });
    }
  }
  return { entries, missing };
}

/** @param {FakeOrigin} o */
function originAdvancements(o) {
  /** @type {any[]} */
  const out = [];
  let n = 0;
  const id = () => `adv${(n += 1)}`;
  if (o.sizes)
    out.push({
      id: id(),
      type: 'Size',
      title: 'Size',
      levels: [0],
      classRestriction: '',
      sizes: o.sizes,
    });
  if (o.grants?.length)
    out.push({
      id: id(),
      type: 'Trait',
      title: 'Proficiencies',
      levels: [0],
      classRestriction: '',
      mode: 'default',
      grants: o.grants,
      choices: [],
    });
  if (o.choice)
    out.push({
      id: id(),
      type: 'Trait',
      title: 'Choose',
      levels: [0],
      classRestriction: '',
      mode: 'default',
      grants: [],
      choices: [{ count: o.choice.count, pool: o.choice.pool }],
    });
  if (o.features?.length)
    out.push({
      id: id(),
      type: 'ItemGrant',
      title: 'Features',
      levels: [0],
      classRestriction: '',
      optional: false,
      items: o.features.map(f => ({
        uuid: featureUuid(f.name),
        name: f.name,
        resolved: true,
        optional: false,
      })),
    });
  if (o.feat) {
    const f = featByName(o.feat);
    if (f)
      out.push({
        id: id(),
        type: 'ItemGrant',
        title: 'Origin Feat',
        levels: [0],
        classRestriction: '',
        optional: false,
        items: [
          {
            uuid: uuidOf(FEATS_PACK, f.id),
            name: f.name,
            resolved: true,
            optional: false,
            playerFeat: true,
          },
        ],
      });
  }
  if (o.asi)
    out.push({
      id: id(),
      type: 'AbilityScoreImprovement',
      title: 'Ability Score Improvement',
      levels: [0],
      classRestriction: '',
      asi: {
        points: o.asi.points,
        cap: o.asi.cap,
        fixed: {},
        locked: o.asi.locked,
        max: o.featType === 'epicBoon' ? 30 : null,
      },
    });
  return out;
}

/** @param {World} w @param {string} name */
const stripped = (w, name) => w.faults.origin.has(`noGrant:${name}`);

/**
 * Whether an actor model meets a fake feat's prerequisites.
 * @param {any} actor
 * @param {FakeOrigin} f
 * @returns {string} '' when met, else what is missing
 */
function prerequisiteGap(actor, f) {
  const p = f.prereq;
  if (!p) return '';
  const o = actor.origin;
  const missing = [];
  if (p.level && actor.level < p.level) missing.push(`level ${p.level}`);
  for (const [a, v] of Object.entries(p.ability ?? {}))
    if ((o?.ab?.[a] ?? 0) < v) missing.push(`${a} ${v}`);
  if (p.spellcasting && !(o?.classes ?? []).some((/** @type {any} */ c) => c.spell))
    missing.push('spellcasting');
  if (
    p.classes &&
    !(o?.classes ?? []).some((/** @type {any} */ c) => p.classes?.includes(c.identifier))
  )
    missing.push(`a ${p.classes.join(' or ')} level`);
  return missing.join(', ');
}

/** @param {World} w @param {{uuid: string, actorId?: string}} args */
export function fakeDescribeOrigin(w, args) {
  const k = findClass(args.uuid);
  const o = findOrigin(args.uuid);
  if (!k && !o) throw new ToolFailure(`describeOrigin: no document ${args.uuid}`);
  /** @type {any} */
  let out;
  if (k) {
    const facts = FAKE_CLASS_FACTS[k.identifier] ?? { primary: ['str'], multi: [] };
    /** @type {any[]} */
    const adv = [
      {
        id: 'p1',
        type: 'Trait',
        title: 'Saving Throws',
        levels: [1],
        classRestriction: 'primary',
        mode: 'default',
        grants: k.saves.map(s => `saves:${s}`),
        choices: [],
      },
      {
        id: 'p2',
        type: 'Trait',
        title: 'Skills',
        levels: [1],
        classRestriction: 'primary',
        mode: 'default',
        grants: [],
        choices: [{ count: k.skillsChosen, pool: k.skillPool.map(s => `skills:${s}`) }],
      },
    ];
    if (facts.multi.length || facts.multiChoice)
      adv.push({
        id: 's1',
        type: 'Trait',
        title: 'Multiclass Proficiencies',
        levels: [1],
        classRestriction: 'secondary',
        mode: 'default',
        grants: facts.multi,
        choices: facts.multiChoice
          ? [{ count: facts.multiChoice.count, pool: facts.multiChoice.pool }]
          : [],
      });
    out = {
      name: k.name,
      type: 'class',
      rules: k.rules,
      featType: '',
      movement: null,
      senses: null,
      creatureType: '',
      advancements: adv,
      effects: [],
      activities: [],
      uses: null,
      startingEquipment: 0,
      primaryAbility: facts.primary,
      primaryAll: !!facts.all,
      hitDie: `d${k.hitDie}`,
      spellcasting: k.spell,
      prerequisites: null,
    };
  } else if (o) {
    out = {
      name: o.name,
      type: o.type,
      rules: '2024',
      featType: o.type === 'feat' ? (o.featType ?? 'general') : '',
      movement: o.type === 'race' ? (o.movement ?? {}) : null,
      senses: o.type === 'race' ? (o.senses ?? {}) : null,
      creatureType: o.type === 'race' ? 'humanoid' : '',
      advancements: originAdvancements(o),
      effects: [],
      activities: (o.features ?? []).filter(f => f.type).map(f => ({ type: f.type, name: f.name })),
      uses: null,
      startingEquipment: o.type === 'background' ? 3 : 0,
      primaryAbility: [],
      primaryAll: false,
      hitDie: '',
      spellcasting: null,
      prerequisites:
        o.type === 'feat' ? { level: o.prereq?.level ?? null, repeatable: false } : null,
    };
  }
  if (args.actorId) {
    const actor = w.actors.get(args.actorId);
    if (!actor) throw new ToolFailure(`describeOrigin: no actor ${args.actorId}`);
    const gap = o?.type === 'feat' ? prerequisiteGap(actor, o) : '';
    out.actor = { prerequisitesMet: !gap, detail: gap ? `needs ${gap}` : '' };
  }
  return out;
}

/* -------------------------------------------- */
/*  The hero model                                */
/* -------------------------------------------- */

/**
 * Builds the origin model of a hero the base createHero made, then applies the species and
 * background asked for.
 * @param {World} w
 * @param {any} args
 * @param {any} result  the base createHero reply
 */
export function fakeDecorateHero(w, args, result) {
  const actor = /** @type {any} */ (w.actors.get(result.actorId));
  const k = /** @type {any} */ (findClass(String(args.classUuid)));
  const s = args.subclassUuid ? findSubclass(String(args.subclassUuid)) : null;
  const ab = { ...STANDARD, ...(args.abilities ?? {}) };
  actor.origin = {
    base: { ...ab },
    ab: { ...ab },
    skills: new Set(
      Object.entries(actor.sheet.skills)
        .filter(([, v]) => v)
        .map(([id]) => id)
    ),
    saves: new Set(k.saves),
    langs: new Set(),
    weapons: new Set(),
    armor: new Set(),
    tools: new Set(),
    dr: new Set(),
    senses: {},
    movement: { walk: 30 },
    size: 'med',
    classes: [
      {
        identifier: k.identifier,
        name: k.name,
        levels: result.level,
        subclass: result.subclassIdentifier || null,
        subclassUuid: s && result.subclassIdentifier ? args.subclassUuid : null,
        rules: k.rules,
        hitDie: k.hitDie,
        spell: k.spell,
        subSpell: s?.spell ?? null,
        uuid: String(args.classUuid),
        first: true,
      },
    ],
    // Item origins by actor item id.
    origins: /** @type {Record<string, any>} */ ({}),
    abilityPicks: /** @type {Record<string, number>} */ ({}),
  };
  const picks = /** @type {any[]} */ (result.picks).filter(
    p => !String(p.title).startsWith('Soldier: ')
  );
  for (const p of picks)
    for (const a of p.advancement === 'AbilityScoreImprovement' ? p.chosen : [])
      addIncrease(actor, a);
  // The base hero's items get no origin, except its class features.
  const rotation = Math.max(0, Math.floor(Number(args.rotation ?? 0)));
  const ctx = {
    w,
    actor,
    rotation,
    k: 0,
    picks,
    warnings: /** @type {string[]} */ (result.warnings),
  };
  const species =
    (args.speciesUuid ? findOrigin(String(args.speciesUuid)) : null) ?? FAKE_SPECIES[0];
  const background =
    (args.backgroundUuid ? findOrigin(String(args.backgroundUuid)) : null) ?? FAKE_BACKGROUNDS[0];
  // Drop the base's own Human and Soldier items: the model adds them with their grants.
  actor.items = actor.items.filter(
    (/** @type {any} */ i) => i.type !== 'race' && i.type !== 'background'
  );
  applyOrigin(ctx, species, args.chooseSize === true);
  applyOrigin(ctx, background, false);
  sync(w, actor);
  return { ...result, picks, hp: { ...actor.hp }, classes: classRows(actor), added: [] };
}

/** @param {any} actor @param {string} chosen "str +2" */
function addIncrease(actor, chosen) {
  const m = /^([a-z]+) \+(\d+)$/.exec(String(chosen));
  if (!m) return;
  actor.origin.abilityPicks[m[1]] = (actor.origin.abilityPicks[m[1]] ?? 0) + Number(m[2]);
  actor.origin.ab[m[1]] = Math.min(20, actor.origin.ab[m[1]] + Number(m[2]));
}

/** @param {any} actor */
const classRows = actor =>
  actor.origin.classes.map((/** @type {any} */ c) => ({
    identifier: c.identifier,
    levels: c.levels,
    subclass: c.subclass,
  }));

/**
 * Applies a species, background or feat to the model: its item, its grants, its picks.
 * @param {{w: World, actor: any, rotation: number, k: number, picks: any[], warnings: string[]}} ctx
 * @param {FakeOrigin} o
 * @param {boolean} chooseSize
 */
function applyOrigin(ctx, o, chooseSize) {
  const { w, actor } = ctx;
  const m = actor.origin;
  const label = `${o.type}:${o.name}`;
  const rootId = newId(w, 'itm');
  actor.items.push({
    id: rootId,
    name: o.name,
    type: o.type,
    sourceUuid: uuidOf(originPack(o), o.id),
  });
  m.origins[rootId] = { item: null };
  const sub = (
    /** @type {string} */ name,
    /** @type {string} */ type = 'feat',
    /** @type {string} */ uuid = featureUuid(name)
  ) => {
    const id = newId(w, 'itm');
    actor.items.push({ id, name, type, sourceUuid: uuid });
    m.origins[id] = { item: label, advancement: 'adv', title: 'Features' };
    return id;
  };
  const pick = (/** @type {string[]} */ list) => list[(ctx.rotation + ctx.k++) % list.length];
  const quirkSkip = (/** @type {string} */ q) => w.faults.origin.has(`${q}:${o.name}`);

  if (o.type === 'race') {
    const size =
      chooseSize && (o.sizes?.length ?? 0) > 1
        ? /** @type {string[]} */ (o.sizes)[ctx.rotation % /** @type {string[]} */ (o.sizes).length]
        : (o.sizes?.[0] ?? 'med');
    m.size = quirkSkip('size') ? 'grg' : size;
    if (chooseSize && (o.sizes?.length ?? 0) > 1)
      ctx.picks.push({ level: 0, advancement: 'Size', title: `${o.name}: Size`, chosen: [m.size] });
    m.movement = { ...(o.movement ?? {}) };
    if (quirkSkip('speed')) m.movement.walk = (m.movement.walk ?? 30) + 5;
    m.senses = { ...(o.senses ?? {}) };
  }
  if (o.grants && !quirkSkip('noTrait')) holdKeys(m, o.grants);
  if (o.choice) {
    const chosen = [];
    const pool = o.choice.pool.filter(key => !heldKey(m, key));
    for (let i = 0; i < o.choice.count && pool.length; i += 1) {
      const key = pick(pool.filter(x => !chosen.includes(x)));
      if (!key) break;
      chosen.push(key);
    }
    if (!quirkSkip('noTrait')) holdKeys(m, chosen);
    if (chosen.length)
      ctx.picks.push({ level: 0, advancement: 'Trait', title: `${o.name}: Choose`, chosen });
  }
  if (o.asi) {
    const keys = ABILITIES.filter(a => !o.asi?.locked.includes(a));
    const ask = w.faults.origin.has(`asiTooMuch:${o.name}`) ? o.asi.points + 1 : o.asi.points;
    let left = ask;
    const done = /** @type {string[]} */ ([]);
    for (let i = 0; i < keys.length && left > 0; i += 1) {
      const key = keys[(ctx.rotation + ctx.k + i) % keys.length];
      const give = Math.min(o.asi.cap, left);
      done.push(`${key} +${give}`);
      left -= give;
    }
    ctx.k += 1;
    if (done.length) {
      ctx.picks.push({
        level: 0,
        advancement: 'AbilityScoreImprovement',
        title: `${o.name}: Ability Score Improvement`,
        chosen: done,
      });
      // The model applies what the pick says, except for a quirk that keeps one point back.
      for (const d of done) addIncrease(actor, d);
    }
  }
  if (!stripped(w, o.name)) {
    for (const f of o.features ?? []) {
      sub(f.name);
      addFeature(actor, f, label);
    }
  }
  if (o.feat) {
    const f = featByName(o.feat);
    if (f) applyOrigin(ctx, f, false);
  }
}

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** @param {any} m @param {string[]} keys */
function holdKeys(m, keys) {
  for (const key of keys) {
    const [kind, ...rest] = key.split(':');
    const last = rest[rest.length - 1];
    if (kind === 'skills') m.skills.add(last);
    else if (kind === 'saves') m.saves.add(last);
    else if (kind === 'languages') m.langs.add(last);
    else if (kind === 'weapon') m.weapons.add(last);
    else if (kind === 'armor') m.armor.add(last);
    else if (kind === 'tool') m.tools.add(last);
    else if (kind === 'dr') m.dr.add(last);
  }
}

/** @param {any} m @param {string} key */
function heldKey(m, key) {
  const [kind, ...rest] = key.split(':');
  const last = rest[rest.length - 1];
  const set = {
    skills: m.skills,
    saves: m.saves,
    languages: m.langs,
    weapon: m.weapons,
    armor: m.armor,
    tool: m.tools,
    dr: m.dr,
  }[kind];
  return set ? set.has(last) : false;
}

/** A feature item with activities in the fake's feature list. @param {any} actor @param {{name: string, uses?: number, type?: string}} f @param {string} label */
function addFeature(actor, f, label) {
  const identifier = `${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const list = actor.sheet.features.items;
  if (list.some((/** @type {any} */ i) => i.identifier === identifier)) return;
  list.push({
    id: `${actor.id}.${identifier}`,
    name: f.name,
    type: 'feat',
    identifier,
    sourceUuid: null,
    equipped: false,
    uses: f.uses
      ? { max: f.uses, spent: 0, recovery: [{ period: 'lr', type: 'recoverAll', formula: '' }] }
      : null,
    activities: f.type
      ? [
          {
            id: 'act0',
            type: f.type,
            name: '',
            activation: 'bonus',
            canUse: true,
            consumption: f.uses ? [{ type: 'itemUses', target: '', value: '1' }] : [],
          },
        ]
      : [],
    effects: [],
    label,
  });
}

/**
 * Copies the model onto the fields the fake's other inspect actions read, and works out hit points,
 * slots, proficiency bonus and hit dice from the classes.
 * @param {World} w
 * @param {any} actor
 */
function sync(w, actor) {
  const m = actor.origin;
  const total = m.classes.reduce(
    (/** @type {number} */ n, /** @type {any} */ c) => n + c.levels,
    0
  );
  actor.level = total;
  actor.sheet.abilities = Object.fromEntries(
    ABILITIES.map(a => [a, { value: m.ab[a], mod: mod(m.ab[a]) }])
  );
  actor.sheet.skills = Object.fromEntries(
    Object.keys(actor.sheet.skills).map(id => [id, m.skills.has(id) ? 1 : 0])
  );
  for (const id of m.skills) actor.sheet.skills[id] = 1;
  actor.sheet.saves = Object.fromEntries(ABILITIES.map(a => [a, m.saves.has(a) ? 1 : 0]));
  actor.sheet.classes = m.classes.map((/** @type {any} */ c) => ({
    identifier: c.identifier,
    levels: c.levels,
    subclass: c.subclass,
  }));
  // Hit points: the first class at full first level, every other level the average, plus Constitution.
  let hp = 0;
  for (const c of m.classes) {
    hp += c.first ? c.hitDie : c.hitDie / 2 + 1;
    hp += (c.levels - 1) * (c.hitDie / 2 + 1);
  }
  hp += mod(m.ab.con) * total;
  actor.hp = { value: hp, max: hp, temp: 0 };
  // Slots by the multiclass rules (the table the checks use), with quirks.
  const casting = m.classes.map((/** @type {any} */ c) => ({
    progression: c.spell?.progression ?? (c.subSpell && c.subclass ? c.subSpell.progression : null),
    levels: c.levels,
  }));
  let caster = 0;
  for (const c of casting) {
    if (c.progression === 'full') caster += c.levels;
    else if (c.progression === 'half') caster += Math.ceil(c.levels / 2);
    else if (c.progression === 'third') caster += Math.floor(c.levels / 3);
  }
  if (w.faults.origin.has('slots') && caster > 1) caster -= 1;
  /** @type {Record<string, any>} */
  const spells = {};
  const leveled = caster ? slotsFor('full', caster).leveled : {};
  for (const [n, max] of Object.entries(leveled)) spells[`spell${n}`] = { max };
  const warlock = casting
    .filter((/** @type {any} */ c) => c.progression === 'pact')
    .reduce((/** @type {number} */ n, /** @type {any} */ c) => n + c.levels, 0);
  if (warlock) {
    const pact = slotsFor('pact', warlock).pact;
    if (pact && w.faults.origin.has('pact'))
      spells.spell1 = { max: (spells.spell1?.max ?? 0) + pact.max };
    else if (pact) spells.pact = pact;
  }
  actor.sheet.spells = spells;
  const f = actor.sheet.features;
  f.prof = 2 + Math.floor((total - 1) / 4);
  f.hd = {
    value: total,
    max: total,
    classes: m.classes.map((/** @type {any} */ c) => ({
      identifier: c.identifier,
      denomination: `d${c.hitDie}`,
      levels: c.levels,
      spent: 0,
    })),
  };
}

/* -------------------------------------------- */
/*  Adding to an existing hero                    */
/* -------------------------------------------- */

/**
 * createHero on an existing hero: `items` are feats or classes (a second class at its level).
 * @param {World} w
 * @param {any} args
 */
export function fakeAddToHero(w, args) {
  const actor = w.actors.get(args.actorId);
  if (!actor?.origin) throw new ToolFailure(`createHero: no kit hero ${args.actorId}`);
  const rotation = Math.max(0, Math.floor(Number(args.rotation ?? 0)));
  const ctx = {
    w,
    actor,
    rotation,
    k: 0,
    picks: /** @type {any[]} */ ([]),
    warnings: /** @type {string[]} */ ([]),
  };
  /** @type {any[]} */
  const added = [];
  const m = actor.origin;
  if (args.speciesUuid) {
    const o = findOrigin(String(args.speciesUuid));
    if (o) applyOrigin(ctx, o, args.chooseSize === true);
  }
  if (args.abilities)
    for (const [a, v] of Object.entries(args.abilities)) m.ab[a] = /** @type {number} */ (v);
  for (const extra of args.items ?? []) {
    const k = findClass(String(extra.uuid));
    const o = findOrigin(String(extra.uuid));
    if (k) {
      const level = Math.max(1, Math.min(20, Number(extra.level ?? 1)));
      const s = extra.subclassUuid ? findSubclass(String(extra.subclassUuid)) : null;
      const hasSub = Boolean(s && level >= k.subclassAt);
      const expected = describe(k, hasSub ? s : null, level, w.faults.unresolved);
      m.classes.push({
        identifier: k.identifier,
        name: k.name,
        levels: level,
        subclass: hasSub && s ? s.identifier : null,
        subclassUuid: hasSub ? String(extra.subclassUuid) : null,
        rules: k.rules,
        hitDie: k.hitDie,
        spell: k.spell,
        subSpell: s?.spell ?? null,
        uuid: String(extra.uuid),
        first: false,
      });
      actor.items.push({
        id: newId(w, 'itm'),
        name: k.name,
        type: 'class',
        sourceUuid: String(extra.uuid),
      });
      if (hasSub && s) {
        actor.items.push({
          id: newId(w, 'itm'),
          name: s.name,
          type: 'subclass',
          sourceUuid: String(extra.subclassUuid),
        });
        ctx.picks.push({
          level: k.subclassAt,
          advancement: 'Subclass',
          title: `${k.name}: Subclass`,
          chosen: [s.name],
        });
      }
      for (const g of expected.grants)
        actor.items.push({ id: newId(w, 'itm'), name: g.name, type: 'feat', sourceUuid: g.uuid });
      actor.sheet.scale[k.identifier] = Object.fromEntries(
        expected.scale.map((/** @type {any} */ x) => [x.identifier, x.value])
      );
      for (const c of k.itemChoices.filter((/** @type {any} */ x) => x.level <= level)) {
        const chosen = [];
        for (let i = 0; i < c.count; i += 1)
          chosen.push(c.options[(rotation + ctx.k++) % c.options.length]);
        for (const name of chosen)
          actor.items.push({
            id: newId(w, 'itm'),
            name,
            type: 'feat',
            sourceUuid: featureUuid(name),
          });
        ctx.picks.push({
          level: c.level,
          advancement: 'ItemChoice',
          title: `${k.name}: Choose a style`,
          chosen,
        });
      }
      for (const l of k.asi.filter((/** @type {number} */ x) => x <= level)) {
        const key = ABILITIES[(rotation + ctx.k++) % ABILITIES.length];
        ctx.picks.push({
          level: l,
          advancement: 'AbilityScoreImprovement',
          title: `${k.name}: Ability Score Improvement`,
          chosen: [`${key} +2`],
        });
        addIncrease(actor, `${key} +2`);
      }
      // The multiclass-only grants, never the first-class set.
      const facts = FAKE_CLASS_FACTS[k.identifier] ?? { multi: [] };
      holdKeys(m, facts.multi);
      if (facts.multiChoice) {
        const pool = facts.multiChoice.pool.filter((/** @type {string} */ key) => !heldKey(m, key));
        const chosen = pool.slice(0, facts.multiChoice.count);
        holdKeys(m, chosen);
        if (chosen.length)
          ctx.picks.push({
            level: 1,
            advancement: 'Trait',
            title: `${k.name}: Multiclass Skills`,
            chosen,
          });
      }
      if (w.faults.origin.has(`saves:${k.identifier}`))
        holdKeys(
          m,
          k.saves.map((/** @type {string} */ x) => `saves:${x}`)
        );
      const feats = fakeFeaturesFor(k, level, actor);
      for (const f of feats) addFeature(actor, f, `class:${k.name}`);
      added.push({ uuid: String(extra.uuid), name: k.name, type: 'class' });
    } else if (o?.type === 'feat') {
      const dropped = w.faults.origin.has(`dropItem:${o.name}`);
      applyOrigin(ctx, o, false);
      if (dropped) {
        const victim = actor.items.find(
          (/** @type {any} */ i) => i.type === 'feat' && i.name !== o.name
        );
        if (victim) actor.items = actor.items.filter((/** @type {any} */ i) => i !== victim);
      }
      added.push({ uuid: String(extra.uuid), name: o.name, type: 'feat' });
    } else throw new ToolFailure(`createHero: no item ${extra.uuid}`);
  }
  sync(w, actor);
  const first = m.classes[0];
  const sub = m.classes.find((/** @type {any} */ c) => c.subclass);
  return {
    actorId: actor.id,
    name: actor.name,
    classIdentifier: first.identifier,
    subclassIdentifier: sub?.subclass ?? '',
    level: actor.level,
    hp: { ...actor.hp },
    picks: ctx.picks,
    warnings: ctx.warnings,
    classes: classRows(actor),
    added,
  };
}

/** The class features a second class adds to the fake's feature list (a few, like fakeFeatures). @param {any} k @param {number} level @param {any} actor */
function fakeFeaturesFor(k, level, actor) {
  /** @type {Array<{name: string, uses?: number, type?: string}>} */
  const out = [];
  if (k.identifier === 'fighter')
    out.push({ name: 'Second Wind', uses: stepValue(RULES.secondWind, level) ?? 2, type: 'heal' });
  if (k.identifier === 'wizard') out.push({ name: 'Arcane Recovery', uses: 1, type: 'utility' });
  if (k.identifier === 'cleric' && level >= 2)
    out.push({
      name: 'Channel Divinity',
      uses: stepValue(RULES.channelCleric, level) ?? 2,
      type: 'utility',
    });
  void actor;
  return out;
}

/* -------------------------------------------- */
/*  Cloning and inspecting                        */
/* -------------------------------------------- */

/** @param {World} w @param {{actorId: string, name?: string, abilityFloor?: number, drop?: string[]}} args */
export function fakeCloneHero(w, args) {
  const source = w.actors.get(args.actorId);
  if (!source?.origin) throw new ToolFailure(`cloneHero: no kit hero ${args.actorId}`);
  const id = newId(w, 'hero');
  const copy = structuredClone({ ...source, origin: undefined });
  copy.id = id;
  copy.name = args.name ?? `${source.name} copy`;
  copy.origin = structuredClone({
    ...source.origin,
    skills: [...source.origin.skills],
    saves: [...source.origin.saves],
    langs: [...source.origin.langs],
    weapons: [...source.origin.weapons],
    armor: [...source.origin.armor],
    tools: [...source.origin.tools],
    dr: [...source.origin.dr],
  });
  for (const key of ['skills', 'saves', 'langs', 'weapons', 'armor', 'tools', 'dr'])
    copy.origin[key] = new Set(copy.origin[key]);
  // The feature items keep their ids' actor prefix.
  for (const item of copy.sheet.features.items) item.id = item.id.replace(source.id, id);
  if (args.drop?.length) {
    const drop = new Set(args.drop.map(n => n.toLowerCase()));
    copy.items = copy.items.filter((/** @type {any} */ i) => !drop.has(i.name.toLowerCase()));
  }
  const floor = Number(args.abilityFloor ?? 0);
  if (floor) for (const a of ABILITIES) copy.origin.ab[a] = Math.max(copy.origin.ab[a], floor);
  w.actors.set(id, copy);
  sync(w, copy);
  return { actorId: id, name: copy.name };
}

/** The origin side of inspectBuild. @param {World} _w @param {any} actor */
export function fakeInspectBuild(_w, actor) {
  const m = actor.origin;
  const labelOf = (/** @type {any} */ i) => `${i.type}:${i.name}`;
  const byId = new Map(actor.items.map((/** @type {any} */ i) => [i.id, i]));
  void byId;
  return {
    name: actor.name,
    level: actor.level,
    items: actor.items.map((/** @type {any} */ i) => {
      const o = m.origins[i.id];
      return {
        type: i.type,
        name: i.name,
        identifier: i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        sourceUuid: i.sourceUuid ?? '',
        origin: o?.item ? { item: o.item, advancement: o.advancement, title: o.title } : null,
        root: null,
        prepared: null,
        quantity: null,
        level: null,
      };
    }),
    advancements: [],
    skills: Object.fromEntries(
      Object.keys(actor.sheet.skills).map(id => [id, m.skills.has(id) ? 1 : 0])
    ),
    saves: Object.fromEntries(ABILITIES.map(a => [a, m.saves.has(a)])),
    proficiencies: {
      languages: [...m.langs].sort(),
      weapons: [...m.weapons].sort(),
      armor: [...m.armor].sort(),
      tools: [...m.tools].sort(),
      damageResistances: [...m.dr].sort(),
      damageImmunities: [],
      conditionImmunities: [],
    },
    senses: { ...m.senses },
    movement: { ...m.movement },
    size: m.size,
    hp: { max: actor.hp.max, bonuses: {} },
    ac: { value: 10, calc: 'default' },
    labels: actor.items.map(labelOf),
  };
}
