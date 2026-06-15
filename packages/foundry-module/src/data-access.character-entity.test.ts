/**
 * Characterization tests for `FoundryDataAccess.getCharacterEntity`.
 *
 * Pins the current (upstream-derived) behavior across every search branch:
 *   1. character look-up by id
 *   2. character look-up by name (case-insensitive)
 *   3. entity found in items — by id, by name (case-insensitive)
 *   4. entity found in system.actions — array form, by id, by name
 *   5. entity found in effects — by id, by name (case-insensitive)
 *   6. character-not-found error
 *   7. entity-not-found error
 *
 * Harness gaps noted inline.
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

/** A well-rounded character used across multiple tests. */
function makeHero() {
  return makeActor({
    id: 'hero000000000000', // 16 chars — exercises the id-lookup branch
    name: 'Aldric',
    type: 'character',
    items: [
      makeItem({
        id: 'sword00000000000',
        name: 'Longsword',
        type: 'weapon',
        img: 'longsword.webp',
        system: {
          description: { value: 'A trusty blade.' },
          equipped: true,
        },
      }),
      makeItem({
        id: 'shield0000000000',
        name: 'Shield',
        type: 'equipment',
        // no img — exercises the missing-img branch (img: undefined → harness omits it)
        system: {
          description: 'Plain text description',
        },
      }),
    ],
    effects: [
      makeEffect({
        id: 'bless00000000000',
        name: 'Bless',
        icon: 'icons/bless.webp',
        disabled: false,
        duration: { rounds: 10 },
        changes: [{ key: 'system.attributes.ac.value', mode: 2, value: '1' }],
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Character look-up
// ---------------------------------------------------------------------------

describe('getCharacterEntity — character look-up', () => {
  it('finds a character by exact id', async () => {
    world.actors.add(makeHero());
    const result = await da.getCharacterEntity({
      characterIdentifier: 'hero000000000000',
      entityIdentifier: 'Longsword',
    });
    expect(result.success).toBe(true);
    expect(result.entityType).toBe('item');
  });

  it('finds a character by exact name', async () => {
    world.actors.add(makeHero());
    const result = await da.getCharacterEntity({
      characterIdentifier: 'Aldric',
      entityIdentifier: 'Longsword',
    });
    expect(result.success).toBe(true);
  });

  it('finds a character by case-insensitive name', async () => {
    world.actors.add(makeHero());
    const result = await da.getCharacterEntity({
      characterIdentifier: 'aldric', // lowercase
      entityIdentifier: 'Longsword',
    });
    expect(result.success).toBe(true);
  });

  it('throws "Character not found" wrapped in the outer error when character is missing', async () => {
    await expect(
      da.getCharacterEntity({ characterIdentifier: 'Nobody', entityIdentifier: 'Sword' })
    ).rejects.toThrow('Failed to get character entity: Character not found: "Nobody"');
  });
});

// ---------------------------------------------------------------------------
// Item branch
// ---------------------------------------------------------------------------

describe('getCharacterEntity — item branch', () => {
  it('returns the item shape when found by id', async () => {
    world.actors.add(makeHero());
    const result = await da.getCharacterEntity({
      characterIdentifier: 'Aldric',
      entityIdentifier: 'sword00000000000',
    });
    expect(result).toEqual({
      success: true,
      entityType: 'item',
      entity: {
        id: 'sword00000000000',
        name: 'Longsword',
        type: 'weapon',
        img: 'longsword.webp',
        description: 'A trusty blade.',
        system: {
          description: { value: 'A trusty blade.' },
          equipped: true,
        },
      },
    });
  });

  it('returns the item shape when found by case-insensitive name', async () => {
    world.actors.add(makeHero());
    const result = await da.getCharacterEntity({
      characterIdentifier: 'Aldric',
      entityIdentifier: 'longsword', // lower-case
    });
    expect(result.success).toBe(true);
    expect(result.entityType).toBe('item');
    expect(result.entity.id).toBe('sword00000000000');
    expect(result.entity.name).toBe('Longsword');
  });

  it('uses plain-string description when system.description is a string (no .value)', async () => {
    world.actors.add(makeHero());
    const result = await da.getCharacterEntity({
      characterIdentifier: 'Aldric',
      entityIdentifier: 'Shield',
    });
    // system.description is 'Plain text description' (a string, no .value property)
    // The method does: entity.system?.description?.value || entity.system?.description || ''
    // 'Plain text description'.value is undefined → falls through to the string itself
    expect(result.entity.description).toBe('Plain text description');
  });
});

// ---------------------------------------------------------------------------
// Actions branch (system.actions — array form)
// ---------------------------------------------------------------------------

describe('getCharacterEntity — actions branch', () => {
  function makeHeroWithActions() {
    return makeActor({
      id: 'hero000000000001',
      name: 'Brynn',
      type: 'character',
      items: [], // no items → action search is reached
      system: {
        actions: [
          { id: 'action01', name: 'Multiattack', type: 'action' },
          { id: 'action02', name: 'Claw', type: 'action' },
        ],
      },
      effects: [],
    });
  }

  it('returns the action shape when found in system.actions array by id', async () => {
    world.actors.add(makeHeroWithActions());
    const result = await da.getCharacterEntity({
      characterIdentifier: 'Brynn',
      entityIdentifier: 'action01',
    });
    expect(result).toEqual({
      success: true,
      entityType: 'action',
      entity: { id: 'action01', name: 'Multiattack', type: 'action' },
    });
  });

  it('returns the action shape when found by case-insensitive name', async () => {
    world.actors.add(makeHeroWithActions());
    const result = await da.getCharacterEntity({
      characterIdentifier: 'Brynn',
      entityIdentifier: 'claw', // lower-case
    });
    expect(result.success).toBe(true);
    expect(result.entityType).toBe('action');
    expect(result.entity.name).toBe('Claw');
  });

  it('skips actions search when character has no system.actions and falls through to effects', async () => {
    // Hero has effects but no system.actions — the if-guard is skipped entirely
    world.actors.add(makeHero()); // system has no .actions property
    const result = await da.getCharacterEntity({
      characterIdentifier: 'Aldric',
      entityIdentifier: 'Bless',
    });
    // Should find the effect, not throw
    expect(result.entityType).toBe('effect');
  });
});

// ---------------------------------------------------------------------------
// Effects branch
// ---------------------------------------------------------------------------

describe('getCharacterEntity — effects branch', () => {
  it('returns the effect shape when found by id', async () => {
    world.actors.add(makeHero());
    const result = await da.getCharacterEntity({
      characterIdentifier: 'Aldric',
      entityIdentifier: 'bless00000000000',
    });
    expect(result).toEqual({
      success: true,
      entityType: 'effect',
      entity: {
        id: 'bless00000000000',
        name: 'Bless',
        icon: 'icons/bless.webp',
        disabled: false,
        duration: { rounds: 10 },
        changes: [{ key: 'system.attributes.ac.value', mode: 2, value: '1' }],
      },
    });
  });

  it('returns the effect shape when found by case-insensitive name', async () => {
    world.actors.add(makeHero());
    const result = await da.getCharacterEntity({
      characterIdentifier: 'Aldric',
      entityIdentifier: 'bless', // lower-case
    });
    expect(result.success).toBe(true);
    expect(result.entityType).toBe('effect');
    expect(result.entity.id).toBe('bless00000000000');
  });

  it('uses effect.label as name fallback when name is absent', async () => {
    // The method does: name: entity.name || entity.label
    // Harness gap: makeEffect always defaults `name` to 'Effect'; it cannot be set
    // to undefined through the builder. Bypass makeEffect and supply a raw plain
    // object directly — makeActor wraps the array in MockCollection which accepts
    // any object with .id. The id-lookup branch finds it; the name-lookup branch
    // skips it safely (undefined?.toLowerCase() === undefined).
    const rawEffect = {
      id: 'curse00000000000',
      // name intentionally absent — only label is set
      label: 'Curse of Weakness',
      icon: 'icons/curse.webp',
      disabled: true,
      duration: {},
      changes: [],
    };
    const actor = makeActor({
      id: 'hero000000000002',
      name: 'Cara',
      type: 'character',
      items: [],
      effects: [rawEffect as any],
    });
    world.actors.add(actor);

    const result = await da.getCharacterEntity({
      characterIdentifier: 'Cara',
      entityIdentifier: 'curse00000000000',
    });
    expect(result.entity.name).toBe('Curse of Weakness');
  });
});

// ---------------------------------------------------------------------------
// Entity not found
// ---------------------------------------------------------------------------

describe('getCharacterEntity — entity not-found error', () => {
  it('throws "Entity not found" wrapped in outer error when no branch matches', async () => {
    world.actors.add(makeHero());
    await expect(
      da.getCharacterEntity({
        characterIdentifier: 'Aldric',
        entityIdentifier: 'Phantom Dagger',
      })
    ).rejects.toThrow(
      'Failed to get character entity: Entity not found: "Phantom Dagger" in character "Aldric"'
    );
  });
});
