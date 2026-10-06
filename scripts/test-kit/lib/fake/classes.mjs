/**
 * The fake's class compendium: a few made-up and SRD-named classes and subclasses, in the shape
 * the builder reads (listCompendium), with just enough advancement data for the fake's
 * describeClass, createHero and inspectActor to agree with each other. Two legacy (2014) entries
 * are in it on purpose: a legacy subclass that a 2024 one replaces ("Champion"), a legacy pair
 * (Fighter 2014 with the Brawler) and a legacy class that has no 2024 version (Warlock, with a
 * subclass at level 1). Not dnd5e: names and numbers are invented, except the slot table.
 */

/** The standard slot table by caster level (index 0 is level 1), as the system lists it. */
const SLOT_TABLE = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
const PACT_TABLE = {
  1: [1, 1],
  2: [2, 1],
  3: [2, 2],
  5: [2, 3],
  7: [2, 4],
  9: [2, 5],
  11: [3, 5],
  17: [4, 5],
};

/** The slots a single-class caster of a progression has at a level. @param {string | null} progression @param {number} level */
export function slotsFor(progression, level) {
  if (!progression) return { leveled: {}, pact: null };
  if (progression === 'pact') {
    const key = Object.keys(PACT_TABLE)
      .map(Number)
      .filter(l => l <= level)
      .pop();
    const [max, slotLevel] = key ? PACT_TABLE[/** @type {1} */ (key)] : [0, 0];
    return { leveled: {}, pact: max ? { max, level: slotLevel } : null };
  }
  const divisor = progression === 'full' ? 1 : progression === 'half' ? 2 : 3;
  let caster = (progression === 'half' ? Math.ceil : Math.floor)(level / divisor);
  if (divisor > 1 && caster) caster = Math.ceil(level / divisor);
  /** @type {Record<string, number>} */
  const leveled = {};
  (SLOT_TABLE[Math.min(caster, 20) - 1] ?? []).forEach((n, i) => {
    leveled[String(i + 1)] = n;
  });
  return { leveled, pact: null };
}

/**
 * @typedef {object} FakeClass
 * @property {string} id
 * @property {string} pack
 * @property {string} name
 * @property {string} identifier
 * @property {'2024'|'2014'} rules
 * @property {number} hitDie
 * @property {string[]} saves
 * @property {number} subclassAt
 * @property {number} skillsChosen
 * @property {string[]} skillPool
 * @property {{progression: string, ability: string} | null} spell
 * @property {Array<[number, string]>} grants       [level, feature name]
 * @property {Array<{level: number, count: number, options: string[]}>} itemChoices
 * @property {number[]} asi                         levels of an ability score improvement
 * @property {Array<{identifier: string, base: number, step: number}>} scale
 */

const SKILLS = ['acr', 'ath', 'ste', 'sur', 'per', 'prc', 'ins', 'med'];

/** @returns {FakeClass} @param {Partial<FakeClass> & {id: string, name: string}} o */
function klass(o) {
  const identifier = o.identifier ?? o.name.toLowerCase();
  return {
    pack: 'dnd5e.classes24',
    identifier,
    rules: '2024',
    hitDie: 8,
    saves: ['str', 'con'],
    subclassAt: 3,
    skillsChosen: 2,
    skillPool: SKILLS,
    spell: null,
    grants: [
      [1, `${o.name} Training`],
      [2, `${o.name} Focus`],
      [5, `${o.name} Mastery`],
      [11, `${o.name} Expertise`],
    ],
    itemChoices: [
      {
        level: 1,
        count: 1,
        options: [`${o.name} Style A`, `${o.name} Style B`, `${o.name} Style C`],
      },
    ],
    asi: [4, 8, 12, 16, 19],
    scale: [{ identifier: `${identifier}-points`, base: 2, step: 4 }],
    ...o,
  };
}

/** @type {FakeClass[]} */
export const FAKE_CLASSES = [
  klass({
    id: 'fakeClsCleric0001',
    name: 'Cleric',
    hitDie: 8,
    saves: ['wis', 'cha'],
    spell: { progression: 'full', ability: 'wis' },
  }),
  klass({ id: 'fakeClsFighter001', name: 'Fighter', hitDie: 10, skillsChosen: 2 }),
  klass({
    id: 'fakeClsPaladin001',
    name: 'Paladin',
    hitDie: 10,
    saves: ['wis', 'cha'],
    spell: { progression: 'half', ability: 'cha' },
  }),
  klass({
    id: 'fakeClsRogue00001',
    name: 'Rogue',
    hitDie: 8,
    saves: ['dex', 'int'],
    skillsChosen: 4,
  }),
  klass({
    id: 'fakeClsWizard0001',
    name: 'Wizard',
    hitDie: 6,
    saves: ['int', 'wis'],
    spell: { progression: 'full', ability: 'int' },
  }),
  // Legacy (2014): the Fighter has a 2024 twin, the Warlock has none.
  klass({
    id: 'fakeLegFighter001',
    name: 'Fighter',
    pack: 'dnd5e.classes',
    rules: '2014',
    hitDie: 10,
  }),
  klass({
    id: 'fakeLegWarlock001',
    name: 'Warlock',
    pack: 'dnd5e.classes',
    rules: '2014',
    saves: ['wis', 'cha'],
    subclassAt: 1,
    spell: { progression: 'pact', ability: 'cha' },
  }),
];

/**
 * @typedef {object} FakeSubclass
 * @property {string} id
 * @property {string} pack
 * @property {string} name
 * @property {string} identifier
 * @property {string} classIdentifier
 * @property {'2024'|'2014'} rules
 * @property {Array<[number, string]>} grants
 * @property {{progression: string, ability: string} | null} spell
 */

/** @returns {FakeSubclass} @param {Partial<FakeSubclass> & {id: string, name: string, classIdentifier: string}} o */
function sub(o) {
  return {
    pack: 'dnd5e.classes24',
    identifier: o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    rules: '2024',
    grants: [
      [3, `${o.name} Gift`],
      [11, `${o.name} Surge`],
    ],
    spell: null,
    ...o,
  };
}

/** @type {FakeSubclass[]} */
export const FAKE_SUBCLASSES = [
  sub({ id: 'fakeSubChampion001', name: 'Champion', classIdentifier: 'fighter' }),
  sub({ id: 'fakeSubLifeDomain01', name: 'Life Domain', classIdentifier: 'cleric' }),
  sub({ id: 'fakeSubDevotion001', name: 'Oath of Devotion', classIdentifier: 'paladin' }),
  sub({ id: 'fakeSubThief0000001', name: 'Thief', classIdentifier: 'rogue' }),
  sub({ id: 'fakeSubEvoker000001', name: 'Evoker', classIdentifier: 'wizard' }),
  // Legacy: a Champion a 2024 entry replaces, a Brawler for the legacy Fighter, the Fiend patron.
  sub({
    id: 'fakeLegChampion001',
    name: 'Champion',
    classIdentifier: 'fighter',
    pack: 'dnd5e.subclasses',
    rules: '2014',
  }),
  sub({
    id: 'fakeLegBrawler0001',
    name: 'Brawler',
    classIdentifier: 'fighter',
    pack: 'dnd5e.subclasses',
    rules: '2014',
  }),
  sub({
    id: 'fakeLegFiend000001',
    name: 'The Fiend',
    classIdentifier: 'warlock',
    pack: 'dnd5e.subclasses',
    rules: '2014',
    grants: [
      [1, 'Dark One Luck'],
      [6, 'Fiendish Resilience'],
    ],
  }),
];

/** Origins the builder picks by default (species Human, background Soldier). */
export const FAKE_ORIGINS = [
  { id: 'fakeSpHuman0000001', name: 'Human', type: 'race' },
  { id: 'fakeBgSoldier00001', name: 'Soldier', type: 'background' },
];

/** The packs the fake knows. */
export const FAKE_PACKS = [
  'dnd5e.classes24',
  'dnd5e.classes',
  'dnd5e.subclasses',
  'dnd5e.origins24',
];

/** @param {string} pack @param {string} id */
export const uuidOf = (pack, id) => `Compendium.${pack}.Item.${id}`;

/** @param {string} uuid */
export function findClass(uuid) {
  return FAKE_CLASSES.find(c => uuidOf(c.pack, c.id) === uuid);
}

/** @param {string} uuid */
export function findSubclass(uuid) {
  return FAKE_SUBCLASSES.find(c => uuidOf(c.pack, c.id) === uuid);
}

/** A fake feature's uuid, stable per name. @param {string} name */
export const featureUuid = name =>
  uuidOf('dnd5e.classes24', `fakeFeat${name.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`);

/**
 * What the advancement data says a hero must have, the way the real describeClass returns it.
 * @param {FakeClass} k
 * @param {FakeSubclass | null} s
 * @param {number} level
 * @param {Set<string>} [unresolved] feature names whose uuid does not resolve (a fault for tests)
 */
export function describe(k, s, level, unresolved = new Set()) {
  const grants = [];
  for (const [l, name] of [...k.grants, ...(s && level >= k.subclassAt ? s.grants : [])]) {
    if (l <= level) {
      grants.push({
        level: l,
        uuid: featureUuid(name),
        name,
        resolved: !unresolved.has(name),
        optional: false,
      });
    }
  }
  const choices = [];
  for (const c of k.itemChoices)
    if (c.level <= level)
      choices.push({ level: c.level, advancement: 'ItemChoice', count: c.count });
  choices.push({ level: 1, advancement: 'Trait', count: k.skillsChosen });
  for (const l of k.asi)
    if (l <= level) choices.push({ level: l, advancement: 'AbilityScoreImprovement', count: 1 });
  const caster = k.spell ?? (s && level >= k.subclassAt ? s.spell : null);
  let hpFixed = k.hitDie;
  for (let l = 2; l <= level; l += 1) hpFixed += k.hitDie / 2 + 1;
  return {
    grants,
    choices,
    scale: k.scale.map(x => ({
      identifier: x.identifier,
      value: x.base + Math.floor(level / x.step),
    })),
    saves: k.saves,
    hitDie: `d${k.hitDie}`,
    hpFixed,
    spellcasting: caster,
    spellSlots: caster ? slotsFor(caster.progression, level) : null,
    skillsChosen: k.skillsChosen,
    subclassAt: k.subclassAt,
  };
}
