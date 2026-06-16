/**
 * Characterization tests for the read-only world/scene/character surface of
 * `FoundryDataAccess`, driven through the Phase 9 Foundry-mock harness.
 *
 * These pin the *current* (upstream-derived) behavior so the from-scratch
 * reimplementation planned for Phase 9 can be verified to parity. They also
 * serve as the worked example that proves the harness drives real data-access
 * methods end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from './constants.js';
import {
  createTestWorld,
  makeActor,
  makeEffect,
  makeItem,
  makeToken,
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

describe('FoundryDataAccess — listActors', () => {
  it('maps actors to id/name/type and omits img when absent', async () => {
    world.addActor({ id: 'a1', name: 'Silvera', type: 'character' });
    world.addActor({ id: 'a2', name: 'Goblin', type: 'npc', img: 'goblin.webp' });

    const actors = await da.listActors();

    expect(actors).toEqual([
      { id: 'a1', name: 'Silvera', type: 'character' },
      { id: 'a2', name: 'Goblin', type: 'npc', img: 'goblin.webp' },
    ]);
  });

  it('returns an empty array for an empty world', async () => {
    expect(await da.listActors()).toEqual([]);
  });
});

describe('FoundryDataAccess — getWorldInfo', () => {
  it('reports world/system/foundry metadata and user roster', async () => {
    world.addUser({ id: 'gm', name: 'Gamemaster', active: true, isGM: true });
    world.addUser({ id: 'p1', name: 'Alice', active: false, isGM: false });

    const info = await da.getWorldInfo();

    expect(info).toMatchObject({
      id: 'test-world',
      title: 'Test World',
      system: 'dnd5e',
      systemVersion: '4.0.0',
      foundryVersion: '13.331',
    });
    expect(info.users).toEqual([
      { id: 'gm', name: 'Gamemaster', active: true, isGM: true },
      { id: 'p1', name: 'Alice', active: false, isGM: false },
    ]);
  });
});

describe('FoundryDataAccess — getActiveScene', () => {
  it('throws SCENE_NOT_FOUND when there is no current scene', async () => {
    await expect(da.getActiveScene()).rejects.toThrow(ERROR_MESSAGES.SCENE_NOT_FOUND);
  });

  it('returns scene data with mapped tokens, notes and embedded counts', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Throne Room',
      img: 'throne.webp',
      active: true,
      width: 4000,
      height: 3000,
      tokens: [
        makeToken({
          id: 't1',
          name: 'Hero',
          x: 100,
          y: 200,
          actorId: 'a1',
          texture: { src: 'hero.webp' },
          disposition: 1,
        }),
        makeToken({ id: 't2', name: 'Foe', x: 300, y: 400, disposition: -1 }),
      ],
      walls: [{ id: 'w1' }, { id: 'w2' }],
      lights: [{ id: 'l1' }],
      sounds: [],
      notes: [{ id: 'n1', text: 'Trap here', x: 50, y: 60 }],
    });
    world.setActiveScene(scene.id);

    const result = await da.getActiveScene();

    expect(result).toMatchObject({
      id: 'scene1',
      name: 'Throne Room',
      width: 4000,
      height: 3000,
      active: true,
      walls: 2,
      lights: 1,
      sounds: 0,
    });
    expect(result.tokens).toEqual([
      {
        id: 't1',
        name: 'Hero',
        x: 100,
        y: 200,
        width: 1,
        height: 1,
        actorId: 'a1',
        img: 'hero.webp',
        hidden: false,
        disposition: 1,
      },
      {
        id: 't2',
        name: 'Foe',
        x: 300,
        y: 400,
        width: 1,
        height: 1,
        img: '',
        hidden: false,
        disposition: -1,
      },
    ]);
    expect(result.notes).toEqual([{ id: 'n1', text: 'Trap here', x: 50, y: 60 }]);
  });
});

describe('FoundryDataAccess — getAvailablePacks', () => {
  it('maps pack metadata', async () => {
    world.addPack({
      id: 'dnd5e.monsters',
      label: 'Monsters (SRD)',
      type: 'Actor',
      system: 'dnd5e',
      private: false,
    });

    const packs = await da.getAvailablePacks();

    expect(packs).toEqual([
      {
        id: 'dnd5e.monsters',
        label: 'Monsters (SRD)',
        type: 'Actor',
        system: 'dnd5e',
        private: false,
      },
    ]);
  });
});

describe('FoundryDataAccess — getCharacterInfo', () => {
  function silvera(): ReturnType<typeof makeActor> {
    return makeActor({
      id: 'aaaaaaaaaaaaaaaa', // 16 chars → exercises the ID lookup branch
      name: 'Silvera',
      type: 'character',
      img: 'silvera.webp',
      system: {
        attributes: { hp: { value: 24, max: 24 } },
        spells: { spell3: { value: 2, max: 3 } },
      },
      items: [
        makeItem({ id: 'sword', name: 'Longsword', type: 'weapon', system: { equipped: true } }),
        makeItem({
          id: 'wizard',
          name: 'Wizard',
          type: 'class',
          system: { spellcasting: { progression: 'full', ability: 'int', type: 'prepared' } },
        }),
        makeItem({
          id: 'fireball',
          name: 'Fireball',
          type: 'spell',
          system: { level: 3, sourceClass: 'wizard', activation: { type: 'action' } },
        }),
      ],
      effects: [makeEffect({ id: 'bless', name: 'Bless', disabled: false })],
    });
  }

  it('finds an actor by 16-character id', async () => {
    world.actors.add(silvera());
    const info = await da.getCharacterInfo('aaaaaaaaaaaaaaaa');
    expect(info.id).toBe('aaaaaaaaaaaaaaaa');
    expect(info.name).toBe('Silvera');
    expect(info.type).toBe('character');
    expect(info.img).toBe('silvera.webp');
  });

  it('finds an actor by case-insensitive name', async () => {
    world.actors.add(silvera());
    const info = await da.getCharacterInfo('silvera');
    expect(info.id).toBe('aaaaaaaaaaaaaaaa');
  });

  it('throws CHARACTER_NOT_FOUND for an unknown identifier', async () => {
    await expect(da.getCharacterInfo('Nobody')).rejects.toThrow(ERROR_MESSAGES.CHARACTER_NOT_FOUND);
  });

  it('includes sanitized system data, items and effects', async () => {
    world.actors.add(silvera());
    const info = await da.getCharacterInfo('Silvera');

    expect(info.system).toMatchObject({ attributes: { hp: { value: 24, max: 24 } } });
    expect(info.items.map(i => i.name)).toEqual(['Longsword', 'Wizard', 'Fireball']);
    expect(info.effects).toEqual([{ id: 'bless', name: 'Bless', disabled: false }]);
  });

  it('reports an equipped item as a toggle', async () => {
    world.actors.add(silvera());
    const info = await da.getCharacterInfo('Silvera');
    expect(info.itemToggles).toContainEqual({
      itemId: 'sword',
      itemName: 'Longsword',
      type: 'equipped',
      enabled: true,
    });
  });

  it('extracts dnd5e class-based spellcasting', async () => {
    world.actors.add(silvera());
    const info = await da.getCharacterInfo('Silvera');

    expect(info.spellcasting).toHaveLength(1);
    const entry = info.spellcasting![0];
    expect(entry.name).toBe('Wizard Spellcasting');
    expect(entry.ability).toBe('int');
    expect(entry.spells.map(s => s.name)).toEqual(['Fireball']);
  });
});
