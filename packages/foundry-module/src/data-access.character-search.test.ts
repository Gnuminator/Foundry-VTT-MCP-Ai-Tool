/**
 * Characterization tests for `FoundryDataAccess.searchCharacterItems`.
 *
 * Pins the current (upstream-derived) behavior so the Phase 9 from-scratch
 * reimplementation can be verified to parity. The harness is the Phase 9
 * Foundry-mock driven via createTestWorld / makeActor / makeItem / makeEffect.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeActor,
  makeEffect,
  makeItem,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHero() {
  return makeActor({
    id: 'actor1xxxxxxxxxxx', // 16 chars → id-lookup branch
    name: 'Aldric',
    type: 'character',
    items: [
      makeItem({
        id: 'item01xxxxxxxxxx',
        name: 'Longsword',
        type: 'weapon',
        system: { quantity: 1, equipped: true },
      }),
      makeItem({
        id: 'item02xxxxxxxxxx',
        name: 'Leather Armor',
        type: 'armor',
        system: { quantity: 1, equipped: true },
      }),
      makeItem({
        id: 'item03xxxxxxxxxx',
        name: 'Fireball',
        type: 'spell',
        system: {
          level: 3,
          activation: { type: 'action' },
          description: { value: 'A bright streak flashes from your finger to a point.' },
          range: { value: 150, units: 'ft' },
          target: {
            type: 'enemy',
            value: null,
            template: { type: 'sphere', size: 20, units: 'ft' },
          },
        },
      }),
      makeItem({
        id: 'item04xxxxxxxxxx',
        name: 'Mage Armor',
        type: 'spell',
        system: {
          level: 1,
          activation: { type: 'action' },
          description: { value: 'You touch a willing creature who is not wearing armor.' },
          range: { value: null, units: 'touch' },
          target: { type: 'creature', value: 1 },
        },
      }),
      makeItem({
        id: 'item05xxxxxxxxxx',
        name: 'Light',
        type: 'spell',
        system: {
          level: 0,
          activation: { type: 'action' },
          description: { value: 'You touch one object that is no larger than 10 feet.' },
        },
      }),
      makeItem({
        id: 'item06xxxxxxxxxx',
        name: 'Action Surge',
        type: 'feat',
        system: {
          description: {
            value:
              'Starting at 2nd level, you can push yourself beyond your normal limits for a moment.',
          },
        },
      }),
    ],
    effects: [
      makeEffect({ id: 'eff01xxxxxxxxxx', name: 'Bless', disabled: false }),
      makeEffect({ id: 'eff02xxxxxxxxxx', name: 'Haste', disabled: false }),
    ],
  });
}

// ---------------------------------------------------------------------------
// 1. Character-not-found error
// ---------------------------------------------------------------------------

describe('searchCharacterItems — character resolution', () => {
  it('throws "Character not found: <id>" when identifier matches no actor', async () => {
    await expect(da.searchCharacterItems({ characterIdentifier: 'Nobody' })).rejects.toThrow(
      'Character not found: Nobody'
    );
  });

  it('finds actor by exact 16-char id', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({ characterIdentifier: 'actor1xxxxxxxxxxx' });
    expect(result.characterId).toBe('actor1xxxxxxxxxxx');
    expect(result.characterName).toBe('Aldric');
  });

  it('finds actor by case-insensitive name partial match', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({ characterIdentifier: 'aldric' });
    expect(result.characterId).toBe('actor1xxxxxxxxxxx');
  });
});

// ---------------------------------------------------------------------------
// 2. Result envelope shape
// ---------------------------------------------------------------------------

describe('searchCharacterItems — result envelope', () => {
  it('returns characterId/characterName/matches/totalMatches; omits query/type/category when not supplied', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({ characterIdentifier: 'Aldric', limit: 1 });

    expect(result).toMatchObject({
      characterId: 'actor1xxxxxxxxxxx',
      characterName: 'Aldric',
      totalMatches: 1,
    });
    expect('query' in result).toBe(false);
    expect('type' in result).toBe(false);
    expect('category' in result).toBe(false);
  });

  it('echoes query/type/category into the envelope when supplied', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Aldric',
      query: 'sword',
      type: 'weapon',
      category: 'equipped',
    });

    expect(result.query).toBe('sword');
    expect(result.type).toBe('weapon');
    expect(result.category).toBe('equipped');
  });

  it('totalMatches equals matches.length', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({ characterIdentifier: 'Aldric' });
    expect(result.totalMatches).toBe(result.matches.length);
  });
});

// ---------------------------------------------------------------------------
// 3. Type filter
// ---------------------------------------------------------------------------

describe('searchCharacterItems — type filter', () => {
  it('returns only spells when type="spell"', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({ characterIdentifier: 'Aldric', type: 'spell' });

    const types = result.matches.map(m => m.type);
    expect(types.every(t => t === 'spell')).toBe(true);
    expect(result.matches.map(m => m.name).sort()).toEqual(['Fireball', 'Light', 'Mage Armor']);
  });

  it('returns only weapons when type="weapon"', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({ characterIdentifier: 'Aldric', type: 'weapon' });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.name).toBe('Longsword');
    expect(result.matches[0]!.type).toBe('weapon');
  });

  it('includes effects when type filter is absent', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({ characterIdentifier: 'Aldric' });
    const effectMatches = result.matches.filter(m => m.type === 'effect');
    expect(effectMatches.map(e => e.name).sort()).toEqual(['Bless', 'Haste']);
  });

  it('returns only effects when type="effect"', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({ characterIdentifier: 'Aldric', type: 'effect' });

    expect(result.matches.every(m => m.type === 'effect')).toBe(true);
    expect(result.matches.map(m => m.name).sort()).toEqual(['Bless', 'Haste']);
  });
});

// ---------------------------------------------------------------------------
// 4. Query filter (name OR description, case-insensitive)
// ---------------------------------------------------------------------------

describe('searchCharacterItems — query filter', () => {
  it('matches items by name substring (case-insensitive)', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({ characterIdentifier: 'Aldric', query: 'SWORD' });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.name).toBe('Longsword');
  });

  it('matches spells by description substring', async () => {
    world.actors.add(makeHero());
    // "bright streak" appears only in Fireball description
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Aldric',
      query: 'bright streak',
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.name).toBe('Fireball');
  });

  it('returns empty matches when query matches nothing', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Aldric',
      query: 'zyxwvutsrq',
    });
    expect(result.matches).toHaveLength(0);
    expect(result.totalMatches).toBe(0);
  });

  it('combined type + query filter returns only matching items', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Aldric',
      type: 'spell',
      query: 'fire',
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.name).toBe('Fireball');
  });
});

// ---------------------------------------------------------------------------
// 5. Spell-specific fields
// ---------------------------------------------------------------------------

describe('searchCharacterItems — spell fields (dnd5e)', () => {
  it('populates level, actionCost, range, area, and description for a dnd5e spell', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Aldric',
      type: 'spell',
      query: 'Fireball',
    });

    expect(result.matches).toHaveLength(1);
    const fb = result.matches[0]!;
    expect(fb.type).toBe('spell');
    expect(fb.level).toBe(3);
    expect(fb.actionCost).toBe('action');
    expect(fb.range).toBe('150 ft');
    // area: template.size + units + type → "20-ft sphere"
    // target stays "enemy" because it was already set before the area check
    // (area only overrides target when it's unset or "point")
    expect(fb.area).toBe('20-ft sphere');
    expect(fb.target).toBe('enemy');
    expect(fb.description).toContain('bright streak');
  });

  it('sets range="Touch" for spells with units="touch"', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Aldric',
      type: 'spell',
      query: 'Mage Armor',
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.range).toBe('Touch');
  });

  it('level=0 for cantrips', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Aldric',
      type: 'spell',
      query: 'Light',
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.level).toBe(0);
  });

  it('category="cantrip" returns only level-0 spells', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Aldric',
      type: 'spell',
      category: 'cantrip',
    });

    expect(result.matches.every(m => m.level === 0)).toBe(true);
    expect(result.matches.map(m => m.name)).toEqual(['Light']);
  });
});

// ---------------------------------------------------------------------------
// 6. Equipment-specific fields
// ---------------------------------------------------------------------------

describe('searchCharacterItems — equipment fields', () => {
  it('includes quantity and equipped for a weapon item', async () => {
    world.actors.add(makeHero());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Aldric',
      type: 'weapon',
    });

    expect(result.matches).toHaveLength(1);
    const sword = result.matches[0]!;
    expect(sword.quantity).toBe(1);
    expect(sword.equipped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. limit parameter
// ---------------------------------------------------------------------------

describe('searchCharacterItems — limit', () => {
  it('respects the limit parameter (default 20)', async () => {
    // Actor with many items — 5 identical feats
    const actor = makeActor({
      id: 'limitActorxxxxxxx',
      name: 'Limiter',
      items: Array.from({ length: 5 }, (_, i) => makeItem({ name: `Feat ${i}`, type: 'feat' })),
    });
    world.actors.add(actor);

    const result = await da.searchCharacterItems({
      characterIdentifier: 'Limiter',
      limit: 3,
    });

    expect(result.matches.length).toBeLessThanOrEqual(3);
    expect(result.totalMatches).toBeLessThanOrEqual(3);
  });
});
