import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { CompendiumTools } from './compendium.js';
import {
  creatureSizeWord,
  flatHasSpells,
  hasLegendaryActions,
  isArmorEquipment,
  movementSummary,
  sizeWord,
  spellSchoolName,
  weaponDamageSummary,
} from './creature-format.js';
import { clearSystemCache } from '../utils/system-detection.js';

/**
 * M3 (lane F): the module's creature index returns FLAT records with dnd5e's
 * size KEY; older data is raw actor data under `system`. These tests pin that
 * the formatters read the new shape first and the old shape second.
 */

describe('sizeWord', () => {
  it('maps every dnd5e 6.0.5 actorSizes key to its word', () => {
    expect(['tiny', 'sm', 'med', 'lg', 'huge', 'grg'].map(sizeWord)).toEqual([
      'tiny',
      'small',
      'medium',
      'large',
      'huge',
      'gargantuan',
    ]);
  });

  it('keeps words, ignores case and whitespace, and passes unknown sizes through', () => {
    expect(sizeWord('Medium')).toBe('medium');
    expect(sizeWord(' GRG ')).toBe('gargantuan');
    expect(sizeWord('colossal')).toBe('colossal');
  });

  it('gives undefined for non-strings and blanks', () => {
    expect(sizeWord(undefined)).toBeUndefined();
    expect(sizeWord(null)).toBeUndefined();
    expect(sizeWord(3)).toBeUndefined();
    expect(sizeWord('  ')).toBeUndefined();
  });
});

describe('creatureSizeWord', () => {
  it('prefers the flat size the module sends', () => {
    expect(creatureSizeWord({ size: 'med', system: { traits: { size: 'lg' } } })).toBe('medium');
  });

  it('falls back to system.traits.size (string, {value}) and system.size', () => {
    expect(creatureSizeWord({ system: { traits: { size: 'sm' } } })).toBe('small');
    expect(creatureSizeWord({ system: { traits: { size: { value: 'lg' } } } })).toBe('large');
    expect(creatureSizeWord({ system: { size: 'huge' } })).toBe('huge');
  });

  it('gives undefined when nothing names a size', () => {
    expect(creatureSizeWord({})).toBeUndefined();
    expect(creatureSizeWord(null)).toBeUndefined();
  });
});

describe('hasLegendaryActions', () => {
  it('uses the module flag when it is a boolean', () => {
    expect(hasLegendaryActions({ hasLegendaryActions: true })).toBe(true);
    expect(
      hasLegendaryActions({
        hasLegendaryActions: false,
        system: { resources: { legact: { max: 3 } } },
      })
    ).toBe(false);
  });

  it('does not count the always-present legact container (default max 0)', () => {
    expect(hasLegendaryActions({ system: { resources: { legact: { max: 0, spent: 0 } } } })).toBe(
      false
    );
  });

  it('counts a positive legact max or value, and a legacy numeric system.legendary', () => {
    expect(hasLegendaryActions({ system: { resources: { legact: { max: 3 } } } })).toBe(true);
    expect(hasLegendaryActions({ system: { resources: { legact: { value: 2 } } } })).toBe(true);
    expect(hasLegendaryActions({ system: { legendary: 3 } })).toBe(true);
  });

  it('does not read legendary resistance (legres) as legendary actions', () => {
    expect(hasLegendaryActions({ system: { resources: { legres: { max: 3, value: 3 } } } })).toBe(
      false
    );
  });
});

describe('flatHasSpells', () => {
  it('returns the module flag or undefined', () => {
    expect(flatHasSpells({ hasSpells: true })).toBe(true);
    expect(flatHasSpells({ hasSpells: false })).toBe(false);
    expect(flatHasSpells({})).toBeUndefined();
  });
});

describe('spellSchoolName', () => {
  it('spells out the eight dnd5e school keys', () => {
    expect(['abj', 'con', 'div', 'enc', 'evo', 'ill', 'nec', 'trs'].map(spellSchoolName)).toEqual([
      'Abjuration',
      'Conjuration',
      'Divination',
      'Enchantment',
      'Evocation',
      'Illusion',
      'Necromancy',
      'Transmutation',
    ]);
  });

  it('passes unknown schools through and rejects blanks', () => {
    expect(spellSchoolName('Chronomancy')).toBe('Chronomancy');
    expect(spellSchoolName('')).toBeUndefined();
    expect(spellSchoolName(undefined)).toBeUndefined();
  });
});

describe('movementSummary', () => {
  it('reads dnd5e 6 movement.speeds first', () => {
    expect(
      movementSummary({ speeds: { walk: 40, fly: 80, swim: 0 }, units: 'ft', hover: true })
    ).toBe('40 ft, fly 80 ft');
  });

  it('falls back to the old top-level movement.<type>', () => {
    expect(movementSummary({ walk: 30, fly: 60, swim: 30, climb: 20, burrow: 10 })).toBe(
      '30 ft, fly 60 ft, swim 30 ft, climb 20 ft, burrow 10 ft'
    );
  });

  it('prefers speeds over the old key when both exist and honors units', () => {
    expect(movementSummary({ speeds: { walk: 9 }, walk: 30, units: 'm' })).toBe('9 m');
  });

  it('gives undefined when there is no speed', () => {
    expect(movementSummary({ speeds: { walk: 0 } })).toBeUndefined();
    expect(movementSummary(undefined)).toBeUndefined();
  });
});

describe('weaponDamageSummary', () => {
  it('reads dnd5e 4+ damage.base (number, denomination, bonus, types)', () => {
    expect(
      weaponDamageSummary({
        damage: { base: { number: 1, denomination: 8, bonus: '', types: ['slashing'] } },
      })
    ).toBe('1d8 slashing damage');
    expect(
      weaponDamageSummary({
        damage: { base: { number: 2, denomination: 6, bonus: '@mod', types: ['fire', 'cold'] } },
      })
    ).toBe('2d6+@mod fire/cold damage');
  });

  it('uses a custom formula when enabled', () => {
    expect(
      weaponDamageSummary({
        damage: { base: { custom: { enabled: true, formula: '1d10 + 3' }, types: ['piercing'] } },
      })
    ).toBe('1d10 + 3 piercing damage');
  });

  it('falls back to the dnd5e 3.x damage.parts pair', () => {
    expect(weaponDamageSummary({ damage: { parts: [['1d8', 'slashing']] } })).toBe(
      '1d8 slashing damage'
    );
  });

  it('gives undefined when there is no damage', () => {
    expect(weaponDamageSummary({ damage: { base: { number: null, denomination: null } } })).toBe(
      undefined
    );
    expect(weaponDamageSummary({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CompendiumTools handlers
// ---------------------------------------------------------------------------

type QueryImpl = (method: string, data?: unknown) => unknown;

function makeTools(queryImpl: QueryImpl): { tools: CompendiumTools; query: Mock<QueryImpl> } {
  const query = vi.fn(queryImpl);
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  return { tools: new CompendiumTools({ foundryClient: { query } as any, logger }), query };
}

function withDnd5e(payload: unknown): QueryImpl {
  let first = true;
  return (method: string): unknown => {
    if (method === 'foundry-mcp-bridge.getWorldInfo' && first) {
      first = false;
      return { system: 'dnd5e' };
    }
    return payload;
  };
}

afterEach(() => clearSystemCache());

describe('CompendiumTools.handleListCreaturesByCriteria reads the module flat records (M3)', () => {
  const flat = {
    response: {
      creatures: [
        {
          id: 'lich',
          name: 'Lich',
          pack: 'dnd5e.monsters',
          packLabel: 'SRD Monsters',
          creatureType: 'undead',
          size: 'med',
          challengeRating: 21,
          hasSpells: true,
          hasLegendaryActions: true,
        },
        {
          id: 'wolf',
          name: 'Wolf',
          pack: 'dnd5e.monsters',
          packLabel: 'SRD Monsters',
          creatureType: 'beast',
          size: 'med',
          challengeRating: 0.25,
          hasSpells: false,
          hasLegendaryActions: false,
        },
        {
          id: 'tarrasque',
          name: 'Tarrasque',
          pack: 'dnd5e.monsters',
          packLabel: 'SRD Monsters',
          creatureType: 'monstrosity',
          size: 'grg',
          challengeRating: 30,
          hasSpells: false,
          hasLegendaryActions: true,
        },
      ],
      searchSummary: { packsSearched: 1, topPacks: [], totalCreaturesFound: 3 },
    },
  };

  it('reports CR, type, size word and flags from the flat fields', async () => {
    const { tools } = makeTools(withDnd5e(flat));
    const result = await tools.handleListCreaturesByCriteria({});
    const [lich, wolf, tarrasque] = result.creatures;

    expect(lich).toMatchObject({
      name: 'Lich',
      challengeRating: 21,
      creatureType: 'undead',
      size: 'medium',
      flags: { spellcaster: true, legendary: true, undead: true, dragon: false, fiend: false },
    });
    expect(wolf).toMatchObject({
      challengeRating: 0.25,
      creatureType: 'beast',
      size: 'medium',
      flags: { spellcaster: false, legendary: false },
    });
    expect(tarrasque).toMatchObject({ size: 'gargantuan', flags: { legendary: true } });
  });

  it('still reads old raw-system records, and the legact container alone is not legendary', async () => {
    const legacy = {
      response: {
        creatures: [
          {
            id: 'goblin',
            name: 'Goblin',
            pack: 'dnd5e.monsters',
            packLabel: 'SRD Monsters',
            system: {
              details: { cr: 0.25, type: { value: 'humanoid' } },
              traits: { size: 'sm' },
              resources: { legact: { max: 0, spent: 0 }, legres: { max: 0, value: 0 } },
            },
          },
        ],
        searchSummary: { packsSearched: 1, topPacks: [], totalCreaturesFound: 1 },
      },
    };
    const { tools } = makeTools(withDnd5e(legacy));
    const result = await tools.handleListCreaturesByCriteria({});
    expect(result.creatures[0]).toMatchObject({
      challengeRating: 0.25,
      creatureType: 'humanoid',
      size: 'small',
      flags: { legendary: false, spellcaster: false },
    });
  });
});

describe('CompendiumTools.handleGetCompendiumItem formatting (M3)', () => {
  const npc = {
    id: 'wolf',
    name: 'Wolf',
    type: 'npc',
    pack: 'dnd5e.monsters',
    packLabel: 'SRD Monsters',
    system: {
      details: { cr: 0.25, type: { value: 'beast' } },
      traits: { size: 'med' },
      attributes: {
        hp: { value: 11, max: 11 },
        ac: { value: 13 },
        movement: { speeds: { walk: 40 }, units: 'ft' },
      },
    },
  };

  it('compact mode reports the size word and dnd5e 6 movement.speeds', async () => {
    const { tools } = makeTools(withDnd5e(npc));
    const result = await tools.handleGetCompendiumItem({
      packId: 'dnd5e.monsters',
      itemId: 'wolf',
      compact: true,
    });
    expect(result.stats.size).toBe('medium');
    expect(result.stats.speed).toBe('40 ft');
  });

  it('search results summarise a dnd5e 6 weapon (damage.base) and a spell school word', async () => {
    const hits = [
      {
        id: 'sword',
        name: 'Longsword',
        type: 'weapon',
        pack: 'dnd5e.items',
        packLabel: 'SRD Items',
        system: {
          damage: { base: { number: 1, denomination: 8, bonus: '', types: ['slashing'] } },
        },
      },
      {
        id: 'fb',
        name: 'Fire Bolt',
        type: 'spell',
        pack: 'dnd5e.spells',
        packLabel: 'SRD Spells',
        system: { level: 1, school: 'evo' },
      },
      {
        id: 'ray',
        name: 'Ray of Frost',
        type: 'spell',
        pack: 'dnd5e.spells',
        packLabel: 'SRD Spells',
        system: { level: 0, school: 'evo' },
      },
    ];
    const { tools } = makeTools(withDnd5e(hits));
    const result = await tools.handleSearchCompendium({ query: 'fire' });
    expect(result.results[0].summary).toContain('1d8 slashing damage');
    expect(result.results[1].summary).toContain('Evocation');
    expect(result.results[1].summary).not.toContain('evo');
    expect(result.results[2].summary).toBe('spell from SRD Spells • Cantrip • Evocation');
  });

  // dnd5e 6 stores armor as `equipment` with an armor `type.value` (dnd5e 6.0.5 Chain Mail).
  const chainMail = {
    id: 'chain',
    name: 'Chain Mail',
    type: 'equipment',
    pack: 'dnd5e.equipment24',
    packLabel: 'Equipment',
    system: {
      type: { value: 'heavy' },
      armor: { value: 16, dex: 0 },
      strength: 13,
      properties: ['stealthDisadvantage'],
      price: { value: 75, denomination: 'gp' },
    },
  };

  it('search results summarise dnd5e 6 armor and shields (equipment) with their AC', async () => {
    const shield = {
      ...chainMail,
      id: 'shield',
      name: 'Shield',
      system: { type: { value: 'shield' }, armor: { value: 2 }, properties: [] },
    };
    const ring = { ...chainMail, id: 'ring', name: 'Ring', system: { type: { value: 'ring' } } };
    const { tools } = makeTools(withDnd5e([chainMail, shield, ring]));
    const result = await tools.handleSearchCompendium({ query: 'armor' });
    expect(result.results[0].summary).toBe('equipment from Equipment • AC 16 • 75 gp');
    expect(result.results[1].summary).toBe('equipment from Equipment • AC +2');
    expect(result.results[2].summary).toBe('equipment from Equipment');
  });

  it('full mode reports dnd5e 6 armor properties (type, AC, strength, stealth)', async () => {
    const { tools } = makeTools(withDnd5e(chainMail));
    const result = await tools.handleGetCompendiumItem({
      packId: 'dnd5e.equipment24',
      itemId: 'chain',
    });
    expect(result.properties).toMatchObject({
      armorType: 'heavy',
      armorClass: { value: 16, dex: 0 },
      strengthRequirement: 13,
      stealthDisadvantage: true,
    });
  });
});

describe('isArmorEquipment', () => {
  it.each([
    [{ type: { value: 'heavy' } }, true],
    [{ type: { value: 'shield' } }, true],
    [{ type: { value: 'natural' } }, true],
    [{ type: { value: 'ring' } }, false],
    [{ type: {} }, false],
    [undefined, false],
  ])('%j -> %s', (system, expected) => {
    expect(isArmorEquipment(system)).toBe(expected);
  });
});
