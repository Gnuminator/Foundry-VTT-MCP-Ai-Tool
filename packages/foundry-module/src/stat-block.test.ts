/**
 * Unit tests for the NPC stat block (`stat-block.ts`): the layout dnd5e uses for its stat block
 * embed, built from plain-object mock actors. The dnd5e globals (`CONFIG.DND5E`, `dnd5e.utils`)
 * are absent unless a test stubs them, so the fallbacks are exercised by default.
 *
 * All creature names and texts are made up for these tests.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildStatBlock } from './stat-block.js';

type Rec = Record<string, unknown>;

const BIG_BUDGET = 256 * 1024;

// ---------------------------------------------------------------------------
// Global stubs (restored after each test)
// ---------------------------------------------------------------------------

const saved = new Map<string, { had: boolean; value: unknown }>();

function setGlobal(key: string, value: unknown): void {
  const g = globalThis as unknown as Rec;
  if (!saved.has(key)) saved.set(key, { had: key in g, value: g[key] });
  g[key] = value;
}

afterEach(() => {
  const g = globalThis as unknown as Rec;
  for (const [key, prior] of saved) {
    if (prior.had) g[key] = prior.value;
    else delete g[key];
  }
  saved.clear();
});

/** A small `CONFIG.DND5E` with the tables the stat block reads. */
function stubConfig(): void {
  setGlobal('CONFIG', {
    DND5E: {
      actorSizes: { sm: { label: 'Small' }, med: { label: 'Medium' } },
      creatureTypes: { undead: { label: 'Undead' }, beast: { label: 'Beast' } },
      damageTypes: {
        poison: { label: 'Poison' },
        cold: { label: 'Cold' },
        fire: { label: 'Fire' },
      },
      conditionTypes: { charmed: { label: 'Charmed' }, frightened: { label: 'Frightened' } },
      skills: { prc: { label: 'Perception' }, ste: { label: 'Stealth' } },
      senses: { darkvision: 'Darkvision', blindsight: { label: 'Blindsight' } },
      movementTypes: {
        walk: { label: 'Walk' },
        fly: { label: 'Fly' },
        swim: { label: 'Swim' },
        burrow: { label: 'Burrow' },
        climb: { label: 'Climb' },
      },
      abilities: {
        str: { abbreviation: 'str' },
        dex: { abbreviation: 'dex' },
        con: { abbreviation: 'con' },
        int: { abbreviation: 'int' },
        wis: { abbreviation: 'wis' },
        cha: { abbreviation: 'cha' },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function ability(
  value: number,
  mod: number,
  save: number,
  multiplier: number
): { value: number; mod: number; save: { value: number; prof: { multiplier: number } } } {
  return { value, mod, save: { value: save, prof: { multiplier } } };
}

interface ItemOptions {
  type?: string;
  name: string;
  sort?: number;
  html?: string;
  activation?: string | null;
  legacyActivation?: string;
  properties?: string[];
  uses?: string;
  activityUses?: string;
  identifier?: string;
  level?: number;
  compendiumSource?: string;
  sourceId?: string;
}

function feature(options: ItemOptions): Rec {
  const system: Rec = {
    description: { value: options.html ?? '' },
    activities: {
      contents: options.activation
        ? [
            {
              activation: { type: options.activation },
              ...(options.activityUses ? { uses: { label: options.activityUses } } : {}),
            },
          ]
        : [],
    },
    properties: new Set(options.properties ?? []),
  };
  if (options.uses) system.uses = { label: options.uses };
  if (options.identifier) system.identifier = options.identifier;
  if (options.legacyActivation) system.activation = { type: options.legacyActivation };
  return {
    type: options.type ?? 'feat',
    name: options.name,
    _source: { name: options.name },
    sort: options.sort ?? 0,
    system,
  };
}

function spell(options: ItemOptions): Rec {
  const flags: Rec = options.sourceId ? { core: { sourceId: options.sourceId } } : {};
  const item: Rec = {
    type: 'spell',
    name: options.name,
    _source: { name: options.name },
    sort: options.sort ?? 0,
    system: { level: options.level ?? 0 },
    flags,
  };
  if (options.compendiumSource) item._stats = { compendiumSource: options.compendiumSource };
  return item;
}

/** A made-up undead NPC with every part the stat block reads. */
function weasel(overrides: { system?: Rec; items?: Rec[]; actor?: Rec } = {}): Rec {
  return {
    system: {
      abilities: {
        str: ability(8, -1, -1, 0),
        dex: ability(16, 3, 5, 1),
        con: ability(12, 1, 1, 0),
        int: ability(6, -2, -2, 0),
        wis: ability(10, 0, 0, 0),
        cha: ability(4, -3, -3, 0),
      },
      attributes: {
        ac: { value: 13, label: 'Natural Armor' },
        hp: { max: 22, formula: '4d8 + 4' },
        movement: { units: 'ft', speeds: { walk: 30, fly: 40 }, hover: false },
        senses: { ranges: { darkvision: 60 }, units: 'ft' },
        prof: 2,
        init: { total: 3, score: 13 },
      },
      skills: {
        prc: { value: 1, total: 5, passive: 15 },
        ste: { value: 1, total: 5, passive: 15 },
        ath: { value: 0, total: -1, passive: 9 },
      },
      traits: {
        size: 'sm',
        di: { value: new Set(['poison', 'fire']), custom: 'bludgeoning from nonmagical attacks' },
        dr: { value: new Set(['cold']), custom: '' },
        dv: { value: new Set<string>(), custom: '' },
        ci: { value: new Set(['charmed', 'frightened']), custom: '' },
        languages: {
          labels: {
            languages: new Set(['Common', 'Weaselspeak']),
            ranged: new Set(['telepathy 60 ft']),
          },
        },
      },
      details: {
        cr: 0.25,
        xp: { value: 50 },
        type: { value: 'undead', subtype: '' },
        alignment: 'Neutral Evil',
        biography: { value: '<p>Hunts the snow drifts.</p>' },
      },
      source: { rules: '2014' },
      ...overrides.system,
    },
    items: { contents: overrides.items ?? [] },
    ...overrides.actor,
  };
}

function lowerOf(block: ReturnType<typeof buildStatBlock>, label: string): string | undefined {
  return block.lower.find(line => line.label === label)?.value;
}

function upperOf(block: ReturnType<typeof buildStatBlock>, label: string): string | undefined {
  return block.upper.find(line => line.label === label)?.value;
}

// ---------------------------------------------------------------------------
// Tag, rules and the upper lines
// ---------------------------------------------------------------------------

describe('buildStatBlock: tag and rules', () => {
  it('writes the 2014 tag in sentence case from size, type and alignment', () => {
    stubConfig();
    const block = buildStatBlock(weasel(), null, BIG_BUDGET);
    expect(block.rules).toBe('2014');
    expect(block.tag).toBe('Small undead, neutral evil');
  });

  it('keeps the case of the labels in a 2024 tag and writes the subtype in brackets', () => {
    stubConfig();
    const actor = weasel({
      system: {
        source: { rules: '2024' },
        details: {
          cr: 1,
          type: { value: 'undead', subtype: 'shapechanger' },
          alignment: 'Neutral Evil',
        },
      },
    });
    const block = buildStatBlock(actor, null, BIG_BUDGET);
    expect(block.rules).toBe('2024');
    expect(block.tag).toBe('Small Undead (shapechanger), Neutral Evil');
  });

  it('uses a custom creature type when the type value is custom', () => {
    stubConfig();
    const actor = weasel({
      system: {
        details: {
          cr: 1,
          type: { value: 'custom', custom: 'frost spirit' },
          alignment: 'unaligned',
        },
      },
    });
    expect(buildStatBlock(actor, null, BIG_BUDGET).tag).toBe('Small frost spirit, unaligned');
  });

  it('falls back to raw keys when no dnd5e config exists', () => {
    const block = buildStatBlock(weasel(), null, BIG_BUDGET);
    expect(block.tag).toBe('Undead, neutral evil');
  });

  it('takes the rules from the actor, then the fallback, then 2014', () => {
    const noRules = weasel({ system: { source: {} } });
    expect(buildStatBlock(noRules, '2024', BIG_BUDGET).rules).toBe('2024');
    expect(buildStatBlock(noRules, null, BIG_BUDGET).rules).toBe('2014');
    const odd = weasel({ system: { source: { rules: '2099' } } });
    expect(buildStatBlock(odd, '2024', BIG_BUDGET).rules).toBe('2024');
    const own = weasel({ system: { source: { rules: '2014' } } });
    expect(buildStatBlock(own, '2024', BIG_BUDGET).rules).toBe('2014');
  });
});

describe('buildStatBlock: upper lines', () => {
  it('2014 uses Armor Class (with the lower-cased label), Hit Points and Speed', () => {
    stubConfig();
    const block = buildStatBlock(weasel(), null, BIG_BUDGET);
    expect(block.upper).toEqual([
      { label: 'Armor Class', value: '13 (natural armor)' },
      { label: 'Hit Points', value: '22 (4d8 + 4)' },
      { label: 'Speed', value: '30 ft, fly 40 ft' },
    ]);
  });

  it('2024 uses AC, Initiative with the score, HP and Speed', () => {
    stubConfig();
    const block = buildStatBlock(
      weasel({ system: { source: { rules: '2024' } } }),
      null,
      BIG_BUDGET
    );
    expect(block.upper).toEqual([
      { label: 'AC', value: '13' },
      { label: 'Initiative', value: '+3 (13)' },
      { label: 'HP', value: '22 (4d8 + 4)' },
      { label: 'Speed', value: '30 ft, Fly 40 ft' },
    ]);
  });

  it('writes a plain hit point maximum when there is no formula', () => {
    const actor = weasel({
      system: {
        attributes: {
          ac: { value: 11 },
          hp: { max: 9, formula: '' },
          movement: { speeds: { walk: 20 } },
        },
      },
    });
    const block = buildStatBlock(actor, null, BIG_BUDGET);
    expect(block.upper).toEqual([
      { label: 'Armor Class', value: '11' },
      { label: 'Hit Points', value: '9' },
      { label: 'Speed', value: '20 ft' },
    ]);
  });

  it('adds hover to a flying speed and special movement in brackets', () => {
    const actor = weasel({
      system: {
        attributes: {
          ac: { value: 10 },
          hp: { max: 5 },
          movement: {
            units: 'ft',
            speeds: { walk: 0, fly: 30, swim: 20 },
            hover: true,
            special: 'climbs ice; slides',
          },
        },
      },
    });
    const block = buildStatBlock(actor, null, BIG_BUDGET);
    // Without a movement config the extra speeds go in the fixed order burrow, climb, fly, swim.
    expect(upperOf(block, 'Speed')).toBe(
      '0 ft, fly 30 ft (hover), swim 20 ft (climbs ice, slides)'
    );
  });

  it('leaves out a line whose data is missing', () => {
    const block = buildStatBlock({ system: {}, items: { contents: [] } }, null, BIG_BUDGET);
    expect(block.upper).toEqual([]);
    expect(block.abilities).toEqual([]);
    expect(block.sections).toEqual([]);
    expect(block.spells).toEqual([]);
    expect(block.description).toBeNull();
    expect(block.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Abilities and the lower lines
// ---------------------------------------------------------------------------

describe('buildStatBlock: abilities', () => {
  it('lists the six abilities in order with score, modifier and save', () => {
    stubConfig();
    const block = buildStatBlock(weasel(), null, BIG_BUDGET);
    expect(block.abilities).toEqual([
      { key: 'str', label: 'STR', score: 8, mod: -1, save: -1 },
      { key: 'dex', label: 'DEX', score: 16, mod: 3, save: 5 },
      { key: 'con', label: 'CON', score: 12, mod: 1, save: 1 },
      { key: 'int', label: 'INT', score: 6, mod: -2, save: -2 },
      { key: 'wis', label: 'WIS', score: 10, mod: 0, save: 0 },
      { key: 'cha', label: 'CHA', score: 4, mod: -3, save: -3 },
    ]);
  });

  it('derives a missing modifier from the score and a missing save from the modifier', () => {
    const actor = weasel({ system: { abilities: { str: { value: 15 }, dex: {} } } });
    const block = buildStatBlock(actor, null, BIG_BUDGET);
    expect(block.abilities).toEqual([
      { key: 'str', label: 'STR', score: 15, mod: 2, save: 2 },
      { key: 'dex', label: 'DEX', score: 10, mod: 0, save: 0 },
    ]);
  });

  it('skips an ability that is not an object', () => {
    const actor = weasel({ system: { abilities: { str: 12, dex: { value: 14, mod: 2 } } } });
    expect(buildStatBlock(actor, null, BIG_BUDGET).abilities.map(a => a.key)).toEqual(['dex']);
  });
});

describe('buildStatBlock: lower lines, 2014', () => {
  it('writes every line in the dnd5e order with damage and condition words in lower case', () => {
    stubConfig();
    const block = buildStatBlock(weasel(), null, BIG_BUDGET);
    expect(block.lower).toEqual([
      { label: 'Saving Throws', value: 'Dex +5' },
      { label: 'Skills', value: 'Perception +5, Stealth +5' },
      { label: 'Damage Resistances', value: 'cold' },
      { label: 'Damage Immunities', value: 'bludgeoning from nonmagical attacks, fire, poison' },
      { label: 'Condition Immunities', value: 'charmed, frightened' },
      { label: 'Senses', value: 'darkvision 60 ft; Passive Perception 15' },
      { label: 'Languages', value: 'Common, Weaselspeak; telepathy 60 ft' },
      { label: 'Challenge', value: '1/4 (50 XP)' },
      { label: 'Proficiency Bonus', value: '+2' },
    ]);
  });

  it('lists a saving throw only for a proficient ability', () => {
    const actor = weasel({
      system: {
        abilities: {
          str: ability(8, -1, -1, 0),
          dex: ability(16, 3, 5, 1),
          con: ability(12, 1, 3, 1),
          wis: ability(10, 0, 0, 0),
        },
      },
    });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'Saving Throws')).toBe(
      'Dex +5, Con +3'
    );
  });

  it('writes a negative saving throw bonus with a minus sign', () => {
    const actor = weasel({ system: { abilities: { str: ability(4, -3, -2, 1) } } });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'Saving Throws')).toBe('Str -2');
  });

  it('lists only proficient skills, sorted by label', () => {
    stubConfig();
    const actor = weasel({
      system: {
        skills: {
          ste: { value: 1, total: 6, passive: 16 },
          prc: { value: 2, total: 8, passive: 18 },
          ath: { value: 0, total: 4, passive: 14 },
        },
      },
    });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'Skills')).toBe(
      'Perception +8, Stealth +6'
    );
  });

  it('puts vulnerabilities before resistances and immunities', () => {
    stubConfig();
    const actor = weasel({
      system: {
        traits: {
          size: 'sm',
          dv: { value: new Set(['fire']), custom: '' },
          dr: { value: new Set(['cold']), custom: '' },
          di: { value: new Set(['poison']), custom: '' },
        },
      },
    });
    const labels = buildStatBlock(actor, null, BIG_BUDGET)
      .lower.map(line => line.label)
      .filter(label => label.startsWith('Damage'));
    expect(labels).toEqual(['Damage Vulnerabilities', 'Damage Resistances', 'Damage Immunities']);
  });

  it('writes a dash placeholder when there are no languages, and no condition line', () => {
    const actor = weasel({
      system: {
        traits: { size: 'sm', languages: { labels: {} }, ci: { value: new Set<string>() } },
      },
    });
    const block = buildStatBlock(actor, null, BIG_BUDGET);
    expect(lowerOf(block, 'Languages')).toBe(String.fromCharCode(0x2014));
    expect(lowerOf(block, 'Condition Immunities')).toBeUndefined();
  });

  it('reads languages from the plain value set and custom text when there are no labels', () => {
    const actor = weasel({
      system: {
        traits: {
          size: 'sm',
          languages: { value: new Set(['elvish', 'common']), custom: 'Snowspeak' },
        },
      },
    });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'Languages')).toBe(
      'common, elvish, Snowspeak'
    );
  });

  it('adds the special senses and a Passive Perception from the skill', () => {
    stubConfig();
    const actor = weasel({
      system: {
        attributes: {
          senses: { ranges: { blindsight: 10, darkvision: 60 }, units: 'ft', special: 'sees heat' },
        },
        skills: { prc: { value: 0, total: 1, passive: 11 } },
      },
    });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'Senses')).toBe(
      'blindsight 10 ft, darkvision 60 ft, sees heat; Passive Perception 11'
    );
  });

  it('writes only the Passive Perception when there are no other senses', () => {
    const actor = weasel({ system: { attributes: { senses: { ranges: {} } } } });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'Senses')).toBe(
      'Passive Perception 15'
    );
  });

  it('formats the fractional challenge ratings and the experience points', () => {
    const cr = (value: number, xp: number): string | undefined =>
      lowerOf(
        buildStatBlock(
          weasel({ system: { details: { cr: value, xp: { value: xp } } } }),
          null,
          BIG_BUDGET
        ),
        'Challenge'
      );
    expect(cr(0.125, 25)).toBe('1/8 (25 XP)');
    expect(cr(0.5, 100)).toBe('1/2 (100 XP)');
    expect(cr(5, 1800)).toBe('5 (1800 XP)');
  });

  it('asks the actor for the experience points of the rating when it can', () => {
    const actor = weasel({
      actor: { getCRExp: (cr: number) => cr * 1000 },
      system: { details: { cr: 2, xp: { value: 1 } } },
    });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'Challenge')).toBe('2 (2000 XP)');
  });

  it('writes the bare rating when there is no experience value', () => {
    const actor = weasel({ system: { details: { cr: 3 } } });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'Challenge')).toBe('3');
  });
});

describe('buildStatBlock: lower lines, 2024', () => {
  const rules2024 = { source: { rules: '2024' } };

  it('has no saving throw line and merges the immunities with a semicolon', () => {
    stubConfig();
    const block = buildStatBlock(weasel({ system: rules2024 }), null, BIG_BUDGET);
    expect(lowerOf(block, 'Saving Throws')).toBeUndefined();
    expect(lowerOf(block, 'Resistances')).toBe('Cold');
    expect(lowerOf(block, 'Immunities')).toBe(
      'bludgeoning from nonmagical attacks, Fire, Poison; Charmed, Frightened'
    );
    expect(block.lower.map(line => line.label)).toEqual([
      'Skills',
      'Resistances',
      'Immunities',
      'Senses',
      'Languages',
      'CR',
    ]);
  });

  it('writes CR with XP and the proficiency bonus, and None for no languages', () => {
    const actor = weasel({
      system: { ...rules2024, traits: { size: 'sm', languages: { labels: {} } } },
    });
    const block = buildStatBlock(actor, null, BIG_BUDGET);
    expect(lowerOf(block, 'CR')).toBe('1/4 (XP 50; PB +2)');
    expect(lowerOf(block, 'Languages')).toBe('None');
    expect(lowerOf(block, 'Proficiency Bonus')).toBeUndefined();
  });

  it('calls vulnerabilities by their short label', () => {
    const actor = weasel({
      system: { ...rules2024, traits: { size: 'sm', dv: { value: new Set(['fire']) } } },
    });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'Vulnerabilities')).toBe('fire');
  });
});

describe('buildStatBlock: dnd5e parity details', () => {
  const rules2024 = { source: { rules: '2024' } };

  /** A config with physical damage types and the weapon properties that bypass them. */
  function stubPhysicalConfig(): void {
    stubConfig();
    const config = (globalThis as unknown as { CONFIG: { DND5E: Rec } }).CONFIG.DND5E;
    config.damageTypes = {
      bludgeoning: { label: 'Bludgeoning', isPhysical: true },
      piercing: { label: 'Piercing', isPhysical: true },
      slashing: { label: 'Slashing', isPhysical: true },
      fire: { label: 'Fire' },
    };
    config.itemProperties = { mgc: { label: 'Magical' }, sil: { label: 'Silvered' } };
  }

  it('keeps the case of sense and movement labels in 2024 and lowers them in 2014', () => {
    stubConfig();
    const system = {
      attributes: {
        senses: { ranges: { blindsight: 10, darkvision: 60 }, units: 'ft' },
        movement: { units: 'ft', speeds: { walk: 30, swim: 20 }, hover: false },
      },
    };
    const old = buildStatBlock(weasel({ system }), null, BIG_BUDGET);
    expect(lowerOf(old, 'Senses')).toBe(
      'blindsight 10 ft, darkvision 60 ft; Passive Perception 15'
    );
    expect(upperOf(old, 'Speed')).toBe('30 ft, swim 20 ft');
    const current = buildStatBlock(
      weasel({ system: { ...system, ...rules2024 } }),
      null,
      BIG_BUDGET
    );
    expect(lowerOf(current, 'Senses')).toBe(
      'Blindsight 10 ft, Darkvision 60 ft; Passive Perception 15'
    );
    expect(upperOf(current, 'Speed')).toBe('30 ft, Swim 20 ft');
  });

  it('writes physical damage with bypasses as "from attacks that are not magical"', () => {
    stubPhysicalConfig();
    const traits = {
      size: 'sm',
      dr: {
        value: new Set(['bludgeoning', 'piercing', 'slashing', 'fire']),
        bypasses: new Set(['mgc']),
        custom: '',
      },
      di: { value: new Set(['slashing']), bypasses: new Set(['mgc', 'sil']), custom: '' },
    };
    const old = buildStatBlock(weasel({ system: { traits } }), null, BIG_BUDGET);
    expect(lowerOf(old, 'Damage Resistances')).toBe(
      'fire; bludgeoning, piercing, and slashing from attacks that are not magical'
    );
    expect(lowerOf(old, 'Damage Immunities')).toBe(
      'slashing from attacks that are not magical or silvered'
    );
    const current = buildStatBlock(weasel({ system: { ...rules2024, traits } }), null, BIG_BUDGET);
    expect(lowerOf(current, 'Resistances')).toBe(
      'Fire; Bludgeoning, Piercing, and Slashing from attacks that are not Magical'
    );
  });

  it('leaves physical damage in the plain list when there are no bypasses', () => {
    stubPhysicalConfig();
    const actor = weasel({
      system: {
        traits: { size: 'sm', dr: { value: new Set(['slashing', 'fire']), custom: '' } },
      },
    });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'Damage Resistances')).toBe(
      'fire, slashing'
    );
  });

  it('writes the lair experience points in 2024 when the actor has a lair', () => {
    const actor = weasel({
      actor: { getCRExp: (cr: number) => cr * 1000 },
      system: {
        ...rules2024,
        details: { cr: 5, xp: { value: 1 } },
        resources: { lair: { value: true } },
      },
    });
    expect(lowerOf(buildStatBlock(actor, null, BIG_BUDGET), 'CR')).toBe(
      '5 (XP 5000, or 6000 in lair; PB +2)'
    );
  });

  it('keeps the standard experience points in 2024 without a lair or without the helper', () => {
    const noLair = weasel({
      actor: { getCRExp: (cr: number) => cr * 1000 },
      system: { ...rules2024, details: { cr: 5 }, resources: { lair: { value: false } } },
    });
    expect(lowerOf(buildStatBlock(noLair, null, BIG_BUDGET), 'CR')).toBe('5 (XP 5000; PB +2)');
    const noHelper = weasel({
      system: {
        ...rules2024,
        details: { cr: 5, xp: { value: 1800 } },
        resources: { lair: { value: true } },
      },
    });
    expect(lowerOf(buildStatBlock(noHelper, null, BIG_BUDGET), 'CR')).toBe('5 (XP 1800; PB +2)');
  });

  it('honours the stat block overrides the dnd5e embed reads', () => {
    stubConfig();
    const actor = weasel({
      actor: {
        flags: {
          dnd5e: {
            statBlockOverride: {
              tag: 'Odd Frost Thing',
              ac: '15 (hide)',
              hp: '30 (varies)',
              speed: '35 ft',
              skills: 'Stealth +9',
              senses: 'Darkvision 90 ft',
              languages: 'Frost Tongue',
              vulnerabilities: 'Fire',
              resistances: '',
              cr: '1 or 2',
              xp: '999 XP',
              pb: '+3',
            },
          },
        },
      },
    });
    const block = buildStatBlock(actor, null, BIG_BUDGET);
    expect(block.tag).toBe('Odd frost thing');
    expect(upperOf(block, 'Armor Class')).toBe('15 (hide)');
    expect(upperOf(block, 'Hit Points')).toBe('30 (varies)');
    expect(upperOf(block, 'Speed')).toBe('35 ft');
    expect(lowerOf(block, 'Skills')).toBe('Stealth +9');
    expect(lowerOf(block, 'Senses')).toBe('Darkvision 90 ft');
    expect(lowerOf(block, 'Languages')).toBe('Frost Tongue');
    expect(lowerOf(block, 'Damage Vulnerabilities')).toBe('fire');
    // An override with an empty value hides the line, as it does in dnd5e.
    expect(lowerOf(block, 'Damage Resistances')).toBeUndefined();
    expect(lowerOf(block, 'Challenge')).toBe('1 or 2 (999 XP)');
    expect(lowerOf(block, 'Proficiency Bonus')).toBe('+3');
  });

  it('honours the 2024 overrides for size, type, alignment, initiative, xp and pb', () => {
    stubConfig();
    const actor = weasel({
      system: rules2024,
      actor: {
        flags: {
          dnd5e: {
            statBlockOverride: {
              size: 'Tiny',
              type: 'Frost Spirit',
              alignment: 'Chaotic',
              initiative: '+9 (19)',
              xp: 'XP 10',
              pb: 'PB +4',
            },
          },
        },
      },
    });
    const block = buildStatBlock(actor, null, BIG_BUDGET);
    expect(block.tag).toBe('Tiny Frost Spirit, Chaotic');
    expect(upperOf(block, 'Initiative')).toBe('+9 (19)');
    expect(lowerOf(block, 'CR')).toBe('1/4 (XP 10; PB +4)');
  });

  it('ignores overrides that are not text or numbers', () => {
    const actor = weasel({
      actor: { flags: { dnd5e: { statBlockOverride: { ac: { nested: true }, hp: 12 } } } },
    });
    const block = buildStatBlock(actor, null, BIG_BUDGET);
    expect(upperOf(block, 'Armor Class')).toBe('13 (natural armor)');
    expect(upperOf(block, 'Hit Points')).toBe('12');
  });
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

describe('buildStatBlock: sections', () => {
  it('groups features by the first activity and orders the sections', () => {
    const items = [
      feature({ name: 'Frost Bite', sort: 30, activation: 'action', html: '<p>Bites.</p>' }),
      feature({ name: 'Pack Tactics', sort: 10, html: '<p>Advantage.</p>' }),
      feature({ name: 'Snow Cloak', sort: 20, activation: 'action', properties: ['trait'] }),
      feature({ name: 'Slip Away', sort: 40, activation: 'bonus' }),
      feature({ name: 'Flurry Shield', sort: 50, activation: 'reaction' }),
      feature({ name: 'Snowdrift', sort: 60, activation: 'legendary' }),
      feature({ type: 'weapon', name: 'Icy Claw', sort: 35, activation: 'action' }),
      feature({ type: 'loot', name: 'Frozen Coin', sort: 5, activation: 'action' }),
    ];
    const block = buildStatBlock(weasel({ items }), null, BIG_BUDGET);
    expect(block.sections.map(s => [s.key, s.label, s.entries.map(e => e.name)])).toEqual([
      ['trait', 'Traits', ['Pack Tactics', 'Snow Cloak']],
      ['action', 'Actions', ['Frost Bite', 'Icy Claw']],
      ['bonus', 'Bonus Actions', ['Slip Away']],
      ['reaction', 'Reactions', ['Flurry Shield']],
      ['legendary', 'Legendary Actions', ['Snowdrift']],
    ]);
    expect(block.sections[0]?.entries[0]).toEqual({
      name: 'Pack Tactics',
      html: '<p>Advantage.</p>',
    });
  });

  it('omits empty sections and puts mythic actions last', () => {
    const items = [
      feature({ name: 'Rebirth', activation: 'mythic' }),
      feature({ name: 'Chill', activation: 'action' }),
    ];
    const block = buildStatBlock(weasel({ items }), null, BIG_BUDGET);
    expect(block.sections.map(s => s.key)).toEqual(['action', 'mythic']);
    expect(block.sections[1]?.label).toBe('Mythic Actions');
  });

  it('puts a feature with an unknown activation type under traits', () => {
    const items = [feature({ name: 'Slow Burn', activation: 'minute' })];
    const block = buildStatBlock(weasel({ items }), null, BIG_BUDGET);
    expect(block.sections.map(s => [s.key, s.entries.map(e => e.name)])).toEqual([
      ['trait', ['Slow Burn']],
    ]);
  });

  it('ignores an item-level system.activation (dnd5e 6 feats have none): a trait', () => {
    const items = [feature({ name: 'Old Reflex', legacyActivation: 'reaction' })];
    const block = buildStatBlock(weasel({ items }), null, BIG_BUDGET);
    expect(block.sections.map(s => s.key)).toEqual(['trait']);
  });

  it('appends the uses label to the name', () => {
    const items = [
      feature({ name: 'Frost Breath', activation: 'action', uses: 'Recharge 5-6' }),
      feature({ name: 'Slip Away', activation: 'bonus', uses: '2/Day' }),
    ];
    const block = buildStatBlock(weasel({ items }), null, BIG_BUDGET);
    expect(block.sections[0]?.entries[0]?.name).toBe('Frost Breath (Recharge 5-6)');
    expect(block.sections[1]?.entries[0]?.name).toBe('Slip Away (2/Day)');
  });

  it('sorts by the sort value, then by name', () => {
    const items = [
      feature({ name: 'Zeta', sort: 1, activation: 'action' }),
      feature({ name: 'Beta', sort: 2, activation: 'action' }),
      feature({ name: 'Alpha', sort: 2, activation: 'action' }),
      feature({ name: 'First', sort: 0, activation: 'action' }),
    ];
    const names = buildStatBlock(weasel({ items }), null, BIG_BUDGET).sections[0]?.entries.map(
      e => e.name
    );
    expect(names).toEqual(['First', 'Zeta', 'Alpha', 'Beta']);
  });

  it('names an entry by its stored name, not an unidentified display name', () => {
    const item = feature({ name: 'Moon Spear', activation: 'action' });
    item.name = 'Strange Stick';
    const block = buildStatBlock(weasel({ items: [item] }), null, BIG_BUDGET);
    expect(block.sections[0]?.entries[0]?.name).toBe('Moon Spear');
  });

  it('turns the legendary actions feature into the intro, not an entry', () => {
    const items = [
      feature({
        name: 'Legendary Actions',
        identifier: 'legendary-actions',
        activation: 'legendary',
        html: '<p>The weasel can take 2 legendary actions.</p>',
      }),
      feature({ name: 'Snowdrift', activation: 'legendary', html: '<p>Moves.</p>' }),
    ];
    const block = buildStatBlock(weasel({ items }), null, BIG_BUDGET);
    const legendary = block.sections.find(s => s.key === 'legendary');
    expect(legendary?.intro).toBe('<p>The weasel can take 2 legendary actions.</p>');
    expect(legendary?.entries.map(e => e.name)).toEqual(['Snowdrift']);
  });

  it('turns the mythic actions feature into the mythic intro', () => {
    const items = [
      feature({
        name: 'Mythic Actions',
        identifier: 'mythic-actions',
        activation: 'mythic',
        html: '<p>Mythic text.</p>',
      }),
      feature({ name: 'Second Wind', activation: 'mythic' }),
    ];
    const mythic = buildStatBlock(weasel({ items }), null, BIG_BUDGET).sections.find(
      s => s.key === 'mythic'
    );
    expect(mythic?.intro).toBe('<p>Mythic text.</p>');
    expect(mythic?.entries.map(e => e.name)).toEqual(['Second Wind']);
  });

  it('takes the legendary actions identifier as the intro in any category, as dnd5e does', () => {
    const items = [
      feature({
        name: 'Odd One',
        identifier: 'legendary-actions',
        activation: 'action',
        html: '<p>Intro text.</p>',
      }),
      feature({ name: 'Snowdrift', activation: 'legendary', html: '<p>Moves.</p>' }),
    ];
    const block = buildStatBlock(weasel({ items }), null, BIG_BUDGET);
    expect(block.sections.map(s => [s.key, s.entries.map(e => e.name)])).toEqual([
      ['legendary', ['Snowdrift']],
    ]);
    expect(block.sections[0]?.intro).toBe('<p>Intro text.</p>');
  });

  it('finds the intro by the slugged name when the feature has no stored identifier', () => {
    const items = [
      feature({ name: 'Legendary Actions', html: '<p>Slug intro.</p>' }),
      feature({ name: 'Mythic Actions', html: '<p>Mythic slug.</p>' }),
      feature({ name: 'Snowdrift', activation: 'legendary' }),
      feature({ name: 'Rebirth', activation: 'mythic' }),
    ];
    const block = buildStatBlock(weasel({ items }), null, BIG_BUDGET);
    expect(block.sections.map(s => [s.key, s.intro, s.entries.map(e => e.name)])).toEqual([
      ['legendary', '<p>Slug intro.</p>', ['Snowdrift']],
      ['mythic', '<p>Mythic slug.</p>', ['Rebirth']],
    ]);
  });

  it('uses the uses label of a single activity when the item has none', () => {
    const items = [
      feature({ name: 'Frost Breath', activation: 'action', activityUses: 'Recharge 5-6' }),
      feature({ name: 'Slip Away', activation: 'bonus', uses: '2/Day', activityUses: '9/Day' }),
    ];
    const block = buildStatBlock(weasel({ items }), null, BIG_BUDGET);
    expect(block.sections.flatMap(s => s.entries.map(e => e.name))).toEqual([
      'Frost Breath (Recharge 5-6)',
      'Slip Away (2/Day)',
    ]);
  });

  it('ignores the activity uses label when the item has several activities', () => {
    const item = feature({
      name: 'Frost Breath',
      activation: 'action',
      activityUses: 'Recharge 5-6',
    });
    const activities = (item.system as Rec).activities as { contents: Rec[] };
    activities.contents.push({ activation: { type: 'action' } });
    const block = buildStatBlock(weasel({ items: [item] }), null, BIG_BUDGET);
    expect(block.sections[0]?.entries[0]?.name).toBe('Frost Breath');
  });

  it('writes the dnd5e legendary intro when the actor has legendary entries but no intro item', () => {
    const items = [feature({ name: 'Snowdrift', activation: 'legendary' })];
    const actor = weasel({
      items,
      system: { getLegendaryActionsDescription: () => 'The weasel can take 3 legendary actions.' },
    });
    const legendary = buildStatBlock(actor, null, BIG_BUDGET).sections.find(
      s => s.key === 'legendary'
    );
    expect(legendary?.intro).toBe('<p>The weasel can take 3 legendary actions.</p>');
  });

  it('has no intro when there is neither an intro item nor a dnd5e helper', () => {
    const items = [feature({ name: 'Snowdrift', activation: 'legendary' })];
    const legendary = buildStatBlock(weasel({ items }), null, BIG_BUDGET).sections.find(
      s => s.key === 'legendary'
    );
    expect(legendary?.intro).toBeNull();
  });

  it('survives a legendary intro helper that throws', () => {
    const items = [feature({ name: 'Snowdrift', activation: 'legendary' })];
    const actor = weasel({
      items,
      system: {
        getLegendaryActionsDescription: () => {
          throw new Error('boom');
        },
      },
    });
    const legendary = buildStatBlock(actor, null, BIG_BUDGET).sections.find(
      s => s.key === 'legendary'
    );
    expect(legendary?.intro).toBeNull();
  });

  it('accepts the trait property as an array', () => {
    const item = feature({ name: 'Frost Aura', activation: 'action' });
    (item.system as Rec).properties = ['trait'];
    const block = buildStatBlock(weasel({ items: [item] }), null, BIG_BUDGET);
    expect(block.sections.map(s => s.key)).toEqual(['trait']);
  });
});

// ---------------------------------------------------------------------------
// Spells and the description
// ---------------------------------------------------------------------------

describe('buildStatBlock: spells and description', () => {
  it('lists embedded spells by level then name with their source uuid', () => {
    const items = [
      spell({
        name: 'Snow Veil',
        level: 2,
        compendiumSource: 'Compendium.test.spells.Item.AAAAAAAAAAAAAAAA',
      }),
      spell({ name: 'Frost Nip', level: 0 }),
      spell({ name: 'Drift', level: 2, sourceId: 'Compendium.test.spells.Item.BBBBBBBBBBBBBBBB' }),
      spell({
        name: 'Chill Touch',
        level: 0,
        compendiumSource: 'Compendium.test.spells.Item.CCCCCCCCCCCCCCCC',
      }),
      feature({ name: 'Frost Bite', activation: 'action' }),
    ];
    const block = buildStatBlock(weasel({ items }), null, BIG_BUDGET);
    expect(block.spells).toEqual([
      { name: 'Chill Touch', level: 0, sourceUuid: 'Compendium.test.spells.Item.CCCCCCCCCCCCCCCC' },
      { name: 'Frost Nip', level: 0, sourceUuid: null },
      { name: 'Drift', level: 2, sourceUuid: 'Compendium.test.spells.Item.BBBBBBBBBBBBBBBB' },
      { name: 'Snow Veil', level: 2, sourceUuid: 'Compendium.test.spells.Item.AAAAAAAAAAAAAAAA' },
    ]);
    // A spell never becomes a feature entry.
    expect(block.sections.flatMap(s => s.entries.map(e => e.name))).toEqual(['Frost Bite']);
  });

  it('prefers the compendium source over the core source id', () => {
    const item = spell({
      name: 'Snow Veil',
      level: 1,
      compendiumSource: 'Compendium.test.spells.Item.AAAAAAAAAAAAAAAA',
      sourceId: 'Compendium.test.spells.Item.BBBBBBBBBBBBBBBB',
    });
    const block = buildStatBlock(weasel({ items: [item] }), null, BIG_BUDGET);
    expect(block.spells[0]?.sourceUuid).toBe('Compendium.test.spells.Item.AAAAAAAAAAAAAAAA');
  });

  it('takes the description from the actor biography', () => {
    const block = buildStatBlock(weasel(), null, BIG_BUDGET);
    expect(block.description).toBe('<p>Hunts the snow drifts.</p>');
  });

  it('has no description for an empty or blank biography', () => {
    for (const value of ['', '   \n  ']) {
      const actor = weasel({ system: { details: { cr: 1, biography: { value } } } });
      expect(buildStatBlock(actor, null, BIG_BUDGET).description).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The byte budget
// ---------------------------------------------------------------------------

describe('buildStatBlock: byte budget', () => {
  const texts = (block: ReturnType<typeof buildStatBlock>): string[] =>
    block.sections.flatMap(s => s.entries.map(e => e.html));

  it('does not truncate when everything fits', () => {
    const items = [feature({ name: 'A', sort: 1, html: 'a'.repeat(20) })];
    const block = buildStatBlock(weasel({ items }), null, 100);
    expect(block.truncated).toBe(false);
    expect(texts(block)).toEqual(['a'.repeat(20)]);
  });

  it('cuts the text that crosses the budget and drops every later text', () => {
    const items = [
      feature({ name: 'A', sort: 1, html: 'a'.repeat(20) }),
      feature({ name: 'B', sort: 2, html: 'b'.repeat(20) }),
      feature({ name: 'C', sort: 3, html: 'c'.repeat(20) }),
    ];
    const actor = weasel({
      items,
      system: { details: { cr: 1, biography: { value: '<p>Long biography.</p>' } } },
    });
    const block = buildStatBlock(actor, null, 30);
    expect(block.truncated).toBe(true);
    expect(texts(block)).toEqual(['a'.repeat(20), 'b'.repeat(10), '']);
    expect(block.description).toBeNull();
    // The entries themselves stay, only their texts are cut.
    expect(block.sections[0]?.entries.map(e => e.name)).toEqual(['A', 'B', 'C']);
  });

  it('drops the description first when it is the only text that does not fit', () => {
    const items = [feature({ name: 'A', html: 'a'.repeat(40) })];
    const actor = weasel({
      items,
      system: { details: { cr: 1, biography: { value: 'z'.repeat(40) } } },
    });
    const block = buildStatBlock(actor, null, 50);
    expect(texts(block)).toEqual(['a'.repeat(40)]);
    expect(block.description).toBe('z'.repeat(10));
    expect(block.truncated).toBe(true);
  });

  it('a zero budget empties every text and reports truncated', () => {
    const items = [feature({ name: 'A', html: '<p>Text</p>' })];
    const block = buildStatBlock(weasel({ items }), null, 0);
    expect(texts(block)).toEqual(['']);
    expect(block.description).toBeNull();
    expect(block.truncated).toBe(true);
  });

  it('a zero budget with no texts is not truncated', () => {
    const actor = weasel({
      items: [feature({ name: 'A', html: '' })],
      system: { details: { cr: 1, biography: { value: '' } } },
    });
    expect(buildStatBlock(actor, null, 0).truncated).toBe(false);
  });

  it('counts JSON escapes against the budget', () => {
    const items = [feature({ name: 'A', html: '"'.repeat(10) })];
    // Each quote takes two bytes in JSON, so a 10 byte budget keeps five of them.
    const block = buildStatBlock(weasel({ items }), null, 10);
    expect(texts(block)).toEqual(['"'.repeat(5)]);
    expect(block.truncated).toBe(true);
  });
});
