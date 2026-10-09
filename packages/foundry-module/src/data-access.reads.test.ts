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

  it('background: v13 scene reads _source.background.src', async () => {
    // makeScene wraps `img` into `_source.background.src` — see data-access.scenes.test.ts.
    const scene = world.addScene({ id: 'scene2', name: 'Crypt', img: 'crypt.webp', active: true });
    world.setActiveScene(scene.id);

    const result = await da.getActiveScene();
    expect(result.background).toBe('crypt.webp');
  });

  it('background: v14 scene reads the current Scene Level (no _source.background)', async () => {
    // Verified `sceneBackgroundSrc` (systems/core.ts): v14 Scene has no top-level
    // `background` — it lives on each Level (`Scene#levels`, `Scene#initialLevel`).
    const levels = {
      get: (id: string): { id: string; background: { src: string } } | undefined =>
        id === 'lvl0' ? { id: 'lvl0', background: { src: 'ground.webp' } } : undefined,
      contents: [{ id: 'lvl0', background: { src: 'ground.webp' } }],
    };
    const scene = world.addScene({
      id: 'scene3',
      name: 'Upper Chamber',
      active: true,
      levels,
      initialLevel: 'lvl0',
    });
    world.setActiveScene(scene.id);

    const result = await da.getActiveScene();
    expect(result.background).toBe('ground.webp');
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
        // dnd5e 6 shapes: the class id is random, spells point at it by `sourceItem`.
        makeItem({
          id: 'Xq3cls0000000001',
          name: 'Wizard',
          type: 'class',
          system: {
            identifier: 'wizard',
            spellcasting: {
              progression: 'full',
              ability: 'int',
              type: 'spell',
              save: 14,
              attack: 6,
            },
          },
        }),
        makeItem({
          id: 'fireball',
          name: 'Fireball',
          type: 'spell',
          system: {
            level: 3,
            sourceItem: 'class:wizard',
            method: 'spell',
            prepared: 1,
            activation: { type: 'action' },
          },
        }),
        makeItem({
          id: 'shield',
          name: 'Shield',
          type: 'spell',
          system: { level: 1, sourceItem: 'class:wizard', method: 'spell', prepared: 0 },
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
    expect(info.items.map(i => i.name)).toEqual(['Longsword', 'Wizard', 'Fireball', 'Shield']);
    expect(info.effects).toEqual([{ id: 'bless', name: 'Bless', disabled: false }]);
  });

  it('effect summary: icon prefers img over the removed v14 icon field', async () => {
    world.actors.add(
      makeActor({
        id: 'aaaaaaaaaaaaaaaa',
        name: 'Icons',
        type: 'character',
        effects: [makeEffect({ id: 'e1', name: 'Legacy', icon: 'old.svg', img: 'new.webp' })],
      })
    );

    const info = await da.getCharacterInfo('Icons');
    expect(info.effects[0].icon).toBe('new.webp');
  });

  it('effect summary: v13 (rounds) duration normalizes to {type, duration, remaining}', async () => {
    world.actors.add(
      makeActor({
        id: 'aaaaaaaaaaaaaaaa',
        name: 'Durations',
        type: 'character',
        effects: [
          makeEffect({
            id: 'e1',
            name: 'Haste',
            duration: { rounds: 3, remaining: 2 },
          }),
        ],
      })
    );

    const info = await da.getCharacterInfo('Durations');
    expect(info.effects[0].duration).toEqual({ type: 'rounds', duration: 3, remaining: 2 });
  });

  it('effect summary: v14-shaped duration ({value, units}) normalizes the same way', async () => {
    world.actors.add(
      makeActor({
        id: 'aaaaaaaaaaaaaaaa',
        name: 'Durations14',
        type: 'character',
        effects: [
          makeEffect({
            id: 'e1',
            name: 'Haste',
            duration: { value: 3, units: 'rounds', remaining: 3 },
          }),
        ],
      })
    );

    const info = await da.getCharacterInfo('Durations14');
    expect(info.effects[0].duration).toEqual({ type: 'rounds', duration: 3, remaining: 3 });
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
    expect(entry.type).toBe('prepared');
    expect(entry.ability).toBe('int');
    expect(entry.dc).toBe(14);
    expect(entry.attack).toBe(6);
    expect(entry.spells.map(s => [s.name, s.prepared])).toEqual([
      ['Shield', false],
      ['Fireball', true],
    ]);
  });

  it('groups subclass, pact and innate spells (dnd5e 6 sourceItem and method)', async () => {
    world.actors.add(
      makeActor({
        name: 'Multi',
        type: 'character',
        items: [
          makeItem({
            id: 'Xq3cls0000000002',
            name: 'Cleric',
            type: 'class',
            system: {
              identifier: 'cleric',
              spellcasting: { progression: 'full', ability: 'wis', type: 'spell' },
            },
          }),
          makeItem({
            id: 'Xq3sub0000000002',
            name: 'Life Domain',
            type: 'subclass',
            system: { identifier: 'life-domain', classIdentifier: 'cleric' },
          }),
          makeItem({
            id: 'Xq3cls0000000003',
            name: 'Warlock',
            type: 'class',
            system: {
              identifier: 'warlock',
              spellcasting: { progression: 'pact', ability: 'cha', type: 'pact' },
            },
          }),
          makeItem({
            name: 'Bless',
            type: 'spell',
            system: { level: 1, sourceItem: 'subclass:life-domain', method: 'spell', prepared: 2 },
          }),
          makeItem({
            name: 'Hex',
            type: 'spell',
            system: { level: 1, sourceItem: 'class:warlock', method: 'pact', prepared: 0 },
          }),
          makeItem({
            name: 'Misty Step',
            type: 'spell',
            system: { level: 2, sourceItem: 'race:eladrin', method: 'innate', prepared: 0 },
          }),
        ],
      })
    );
    const info = await da.getCharacterInfo('Multi');
    const byName = Object.fromEntries(info.spellcasting!.map(e => [e.name, e]));
    expect(Object.keys(byName)).toEqual([
      'Cleric Spellcasting',
      'Warlock Spellcasting',
      'Other Spells',
    ]);
    expect(byName['Cleric Spellcasting'].spells.map(s => [s.name, s.prepared])).toEqual([
      ['Bless', true],
    ]);
    expect(byName['Warlock Spellcasting'].type).toBe('pact');
    expect(byName['Warlock Spellcasting'].spells.map(s => [s.name, s.prepared])).toEqual([
      ['Hex', false],
    ]);
    // Innate spells are ready without preparing.
    expect(byName['Other Spells'].spells.map(s => [s.name, s.prepared])).toEqual([
      ['Misty Step', true],
    ]);
  });

  it('lists NPC spells as ready (feat-granted, method "spell", prepared 0)', async () => {
    world.actors.add(
      makeActor({
        name: 'Vampire',
        type: 'npc',
        items: [
          makeItem({
            name: 'Charm Person',
            type: 'spell',
            system: { level: 1, sourceItem: 'feat:charm', method: 'spell', prepared: 0 },
          }),
        ],
      })
    );
    const info = await da.getCharacterInfo('Vampire');
    expect(info.spellcasting).toHaveLength(1);
    expect(info.spellcasting![0].spells.map(s => [s.name, s.prepared])).toEqual([
      ['Charm Person', true],
    ]);
  });

  it('reads a subclass caster (Eldritch Knight) from the subclass spellcasting', async () => {
    world.actors.add(
      makeActor({
        name: 'Knight',
        type: 'character',
        items: [
          makeItem({
            id: 'Xq3cls0000000004',
            name: 'Fighter',
            type: 'class',
            system: { identifier: 'fighter', spellcasting: { progression: 'none', ability: '' } },
          }),
          makeItem({
            id: 'Xq3sub0000000004',
            name: 'Eldritch Knight',
            type: 'subclass',
            system: {
              identifier: 'eldritch-knight',
              classIdentifier: 'fighter',
              spellcasting: {
                progression: 'third',
                ability: 'int',
                type: 'spell',
                save: 12,
                attack: 4,
              },
            },
          }),
          makeItem({
            name: 'Shield',
            type: 'spell',
            system: {
              level: 1,
              sourceItem: 'subclass:eldritch-knight',
              method: 'spell',
              prepared: 1,
            },
          }),
        ],
      })
    );
    const info = await da.getCharacterInfo('Knight');
    expect(info.spellcasting).toHaveLength(1);
    const entry = info.spellcasting![0];
    expect(entry.name).toBe('Fighter Spellcasting');
    expect(entry.type).toBe('prepared');
    expect(entry.ability).toBe('int');
    expect(entry.dc).toBe(12);
    expect(entry.attack).toBe(4);
    expect(entry.spells.map(s => [s.name, s.prepared])).toEqual([['Shield', true]]);
  });
});
