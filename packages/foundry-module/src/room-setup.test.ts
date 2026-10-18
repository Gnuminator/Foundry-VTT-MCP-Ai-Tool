/**
 * `planRoomSetup` (I-133): grid squares to Region and Token create ops. Driven through the
 * Foundry-mock harness; nothing is written, these tests pin the ops, the ids a teleport names its
 * destination by, and the refusals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ROOM_SETUP_FEATURE_ID as SHARED_FEATURE,
  ROOM_SETUP_QUERY as SHARED_QUERY,
} from '../../../shared/src/room-setup.js';
import { planRoomSetup, ROOM_SETUP_FEATURE_ID, ROOM_SETUP_QUERY } from './room-setup.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { NON_WRITE_METHODS } from './write-gate.js';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

function scene(id: string, name: string, extra: Record<string, any> = {}): any {
  const s = world.addScene({
    id,
    name,
    uuid: `Scene.${id}`,
    tokens: [],
    grid: {
      size: 100,
      isGridless: false,
      getOffset: ({ x, y }: { x: number; y: number }) => ({
        i: Math.floor(y / 100),
        j: Math.floor(x / 100),
      }),
      getTopLeftPoint: ({ i, j }: { i: number; j: number }) => ({ x: j * 100, y: i * 100 }),
    },
    dimensions: { sceneRect: { x: 0, y: 0, width: 2000, height: 2000 } },
    ...extra,
  });
  return s;
}

describe('names', () => {
  it('mirror the shared contract and the query is a read', () => {
    expect(ROOM_SETUP_QUERY).toBe(SHARED_QUERY);
    expect(ROOM_SETUP_FEATURE_ID).toBe(SHARED_FEATURE);
    expect(NON_WRITE_METHODS).toContain('planRoomSetup');
  });
});

describe('teleport', () => {
  it('makes an entry and an arrival Region that name each other, in pixels from squares', async () => {
    const a = scene('a', 'Hall');
    world.setActiveScene(a.id);
    scene('b', 'Crypt');
    const plan = await planRoomSetup({
      action: 'teleport',
      name: 'Stairs',
      from: { x: 2, y: 3, width: 1, height: 2 },
      to: { x: 5, y: 5, width: 2, height: 2, scene: 'Crypt' },
    });
    expect(plan.ops).toHaveLength(2);
    const [entry, arrival] = plan.ops as any[];
    expect(entry).toMatchObject({
      kind: 'create',
      documentName: 'Region',
      parentUuid: 'Scene.a',
      keepId: true,
    });
    expect(entry.data.shapes[0]).toMatchObject({
      type: 'rectangle',
      x: 200,
      y: 300,
      width: 100,
      height: 200,
    });
    expect(arrival.parentUuid).toBe('Scene.b');
    expect(arrival.data.name).toBe('Stairs (arrival)');
    expect(arrival.data.behaviors).toEqual([]);
    const behavior = entry.data.behaviors[0];
    expect(behavior).toMatchObject({
      type: 'teleportToken',
      system: { placement: 'center', choice: false },
    });
    expect(behavior.system.destinations).toEqual([`Scene.b.Region.${arrival.data._id}`]);
    expect(plan.summary).toBe('Add a teleport "Stairs" from "Hall" to "Crypt"');
    expect(plan.regions.map(r => r.role)).toEqual(['entry', 'arrival']);
  });

  it('two-way adds the way back on the arrival', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    const plan = await planRoomSetup({
      action: 'teleport',
      from: { x: 0, y: 0, width: 1, height: 1 },
      to: { x: 5, y: 5, width: 1, height: 1 },
      twoWay: true,
      choice: true,
    });
    const [entry, arrival] = plan.ops as any[];
    expect(arrival.data.behaviors[0].system.destinations).toEqual([
      `Scene.a.Region.${entry.data._id}`,
    ]);
    expect(arrival.data.behaviors[0].system.choice).toBe(true);
    expect(plan.summary).toContain('two-way');
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('refuses overlapping rectangles, bad squares and an unknown scene', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    await expect(
      planRoomSetup({
        action: 'teleport',
        from: { x: 0, y: 0, width: 3, height: 3 },
        to: { x: 2, y: 2, width: 3, height: 3 },
      })
    ).rejects.toThrow(/overlap/);
    await expect(
      planRoomSetup({
        action: 'teleport',
        from: { x: 0.5, y: 0, width: 1, height: 1 },
        to: { x: 5, y: 5, width: 1, height: 1 },
      })
    ).rejects.toThrow(/whole number/);
    await expect(
      planRoomSetup({
        action: 'teleport',
        from: { x: 0, y: 0, width: 1, height: 1 },
        to: { x: 5, y: 5, width: 1, height: 1, scene: 'Nowhere' },
      })
    ).rejects.toThrow(/No scene "Nowhere"/);
  });

  it('warns when a rectangle runs off the map', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    const plan = await planRoomSetup({
      action: 'teleport',
      from: { x: 0, y: 0, width: 1, height: 1 },
      to: { x: 19, y: 19, width: 3, height: 3 },
    });
    expect(plan.warnings.join(' ')).toMatch(/past the edge/);
  });
});

describe('spawn', () => {
  function wolf(): any {
    const actor = world.addActor({ id: 'wolf', name: 'Wolf', type: 'npc' });
    (actor as any).prototypeToken = { width: 1, height: 1 };
    (actor as any).getTokenDocument = async (
      data: Record<string, unknown>
    ): Promise<{ toObject(): Record<string, unknown> }> => ({
      toObject: (): Record<string, unknown> => ({
        _id: 'tmp',
        name: 'Wolf',
        actorId: 'wolf',
        ...data,
      }),
    });
    return actor;
  }

  it('creates the room Region and a hidden token per creature on free squares inside it', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    wolf();
    const plan = await planRoomSetup({
      action: 'spawn',
      name: 'Kennel',
      area: { x: 4, y: 4, width: 3, height: 3 },
      creatures: [{ actor: 'Wolf', count: 3 }],
    });
    expect(plan.ops).toHaveLength(4);
    const [room, ...tokens] = plan.ops as any[];
    expect(room).toMatchObject({ documentName: 'Region', keepId: true });
    expect(room.data.behaviors).toEqual([]);
    const spots = tokens.map(t => `${t.data.x},${t.data.y}`);
    expect(new Set(spots).size).toBe(3);
    for (const t of tokens) {
      expect(t).toMatchObject({ kind: 'create', documentName: 'Token', parentUuid: 'Scene.a' });
      expect(t.data._id).toBeUndefined();
      expect(t.data.hidden).toBe(true);
      expect(t.data.x).toBeGreaterThanOrEqual(400);
      expect(t.data.x).toBeLessThan(700);
      expect(t.data.y).toBeGreaterThanOrEqual(400);
      expect(t.data.y).toBeLessThan(700);
    }
    expect(plan.summary).toBe('Set up the room "Kennel" on "Hall" with 3 hidden tokens');
  });

  it('can start visible, lists unknown actors and tokens that do not fit', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    wolf();
    const plan = await planRoomSetup({
      action: 'spawn',
      name: 'Closet',
      area: { x: 1, y: 1, width: 1, height: 1 },
      creatures: [{ actor: 'Wolf', count: 2 }, { actor: 'Ghost' }],
      hidden: false,
    });
    expect((plan.ops[1] as any).data.hidden).toBe(false);
    expect(plan.skipped).toEqual([
      { name: 'Ghost', reason: 'no actor with that id or name' },
      { name: 'Wolf', reason: 'no free square left in the room' },
    ]);
  });

  it('refuses when no creature exists', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    await expect(
      planRoomSetup({
        action: 'spawn',
        name: 'Void',
        area: { x: 1, y: 1, width: 2, height: 2 },
        creatures: [{ actor: 'Ghost' }],
      })
    ).rejects.toThrow(/None of the creatures exist/);
  });
});

describe('review fixes', () => {
  function actor(id: string, name: string): any {
    const a = world.addActor({ id, name, type: 'npc' });
    (a as any).prototypeToken = { width: 1, height: 1 };
    (a as any).getTokenDocument = async (
      data: Record<string, unknown>
    ): Promise<{ toObject(): Record<string, unknown> }> => ({
      toObject: (): Record<string, unknown> => ({ _id: 'tmp', name, actorId: id, ...data }),
    });
    return a;
  }

  it('makes every region GM-only, so players see no box round hidden monsters', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    actor('wolf', 'Wolf');
    const tp = await planRoomSetup({
      action: 'teleport',
      from: { x: 0, y: 0, width: 1, height: 1 },
      to: { x: 5, y: 5, width: 1, height: 1 },
    });
    const sp = await planRoomSetup({
      action: 'spawn',
      name: 'Den',
      area: { x: 4, y: 4, width: 3, height: 3 },
      creatures: [{ actor: 'Wolf' }],
    });
    for (const op of [...tp.ops, sp.ops[0]] as any[]) expect(op.data.visibility).toBe(1);
  });

  it('does not guess between actors whose names contain the text', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    actor('dw', 'Dire Wolf');
    actor('ww', 'Werewolf');
    actor('w', 'Wolf');
    const exact = await planRoomSetup({
      action: 'spawn',
      name: 'Den',
      area: { x: 4, y: 4, width: 3, height: 3 },
      creatures: [{ actor: 'wolf' }],
    });
    expect((exact.ops[1] as any).data.actorId).toBe('w');
    await expect(
      planRoomSetup({
        action: 'spawn',
        name: 'Den',
        area: { x: 4, y: 4, width: 3, height: 3 },
        creatures: [{ actor: 'were' }, { actor: 'dire' }],
      })
    ).resolves.toMatchObject({ tokens: [{ name: 'Werewolf' }, { name: 'Dire Wolf' }] });
  });

  it('lists several partial matches as skipped', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    actor('dw', 'Dire Wolf');
    actor('ww', 'Werewolf');
    actor('g', 'Goblin');
    const plan = await planRoomSetup({
      action: 'spawn',
      name: 'Den',
      area: { x: 4, y: 4, width: 3, height: 3 },
      creatures: [{ actor: 'wolf' }, { actor: 'Goblin' }],
    });
    expect(plan.skipped?.[0]).toMatchObject({ name: 'wolf' });
    expect(plan.skipped?.[0].reason).toMatch(/several actors match/);
    expect(plan.tokens).toHaveLength(1);
  });

  it('refuses two scenes with the same name and a hex grid', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    scene('b', 'Twin');
    scene('c', 'Twin');
    scene('h', 'Hexes', { grid: { size: 100, type: 2 } });
    const area = { x: 0, y: 0, width: 1, height: 1 };
    await expect(
      planRoomSetup({
        action: 'teleport',
        from: area,
        to: { x: 5, y: 5, width: 1, height: 1, scene: 'Twin' },
      })
    ).rejects.toThrow(/2 scenes are named "Twin"/);
    await expect(
      planRoomSetup({
        action: 'teleport',
        from: area,
        to: { x: 5, y: 5, width: 1, height: 1, scene: 'Hexes' },
      })
    ).rejects.toThrow(/hex grid/);
  });

  it('puts regions of the viewed scene on its current level, other scenes on every level', async () => {
    const a = scene('a', 'Hall', { levels: { contents: [{ id: 'lv1' }] }, initialLevel: 'lv1' });
    world.setActiveScene(a.id);
    scene('b', 'Crypt', { levels: { contents: [{ id: 'lv9' }] }, initialLevel: 'lv9' });
    const plan = await planRoomSetup({
      action: 'teleport',
      from: { x: 0, y: 0, width: 1, height: 1 },
      to: { x: 5, y: 5, width: 1, height: 1, scene: 'Crypt' },
    });
    const [entry, arrival] = plan.ops as any[];
    expect(entry.data.levels).toEqual(['lv1']);
    expect(arrival.data.levels).toBeUndefined();
  });
});

const lv = (id: string, name: string, bottom: number, top: number | null): any => ({
  id,
  name,
  elevation: { bottom, top },
});

describe('levels', () => {
  it('makes one Level create per entry and warns about existing ones', async () => {
    const a = scene('a', 'Tower', { levels: { contents: [lv('d', 'Ground', 0, 10)] } });
    world.setActiveScene(a.id);
    const plan = await planRoomSetup({
      action: 'levels',
      levels: [
        { name: 'Upstairs', bottom: 10, top: 20 },
        { name: 'Roof', bottom: 20, background: 'maps/roof.webp' },
      ],
    });
    expect(plan.ops).toHaveLength(2);
    expect(plan.ops[0]).toMatchObject({
      kind: 'create',
      documentName: 'Level',
      parentUuid: 'Scene.a',
      data: { name: 'Upstairs', elevation: { bottom: 10, top: 20 } },
    });
    expect((plan.ops[1] as any).data).toMatchObject({
      elevation: { bottom: 20, top: null },
      background: { src: 'maps/roof.webp' },
    });
    expect(plan.levels).toHaveLength(2);
    expect(plan.warnings.join(' ')).toMatch(/already has 1 level/);
  });

  it('refuses duplicates, bad ranges and scenes without levels', async () => {
    world.setActiveScene(
      scene('a', 'Tower', { levels: { contents: [lv('d', 'Ground', 0, 10)] } }).id
    );
    await expect(
      planRoomSetup({ action: 'levels', levels: [{ name: 'ground', bottom: 5 }] })
    ).rejects.toThrow(/already a level/);
    await expect(
      planRoomSetup({ action: 'levels', levels: [{ name: 'X', bottom: 5, top: 1 }] })
    ).rejects.toThrow(/not below bottom/);
    world.setActiveScene(scene('b', 'Flat').id);
    await expect(
      planRoomSetup({ action: 'levels', levels: [{ name: 'X', bottom: 0 }] })
    ).rejects.toThrow(/no Scene Levels/);
  });
});

describe('stairs', () => {
  const levels = { contents: [lv('d', 'Ground', 0, 10), lv('u', 'Upstairs', 10, 20)] };

  it('makes a changeLevel Region that lists the levels', async () => {
    world.setActiveScene(scene('a', 'Tower', { levels }).id);
    const plan = await planRoomSetup({
      action: 'stairs',
      name: 'Spiral',
      area: { x: 1, y: 1, width: 2, height: 2 },
      levels: ['Ground', 'upstairs'],
      movementActions: ['walk'],
    });
    const op = plan.ops[0] as any;
    expect(op.data.levels).toEqual(['d', 'u']);
    expect(op.data.behaviors[0]).toMatchObject({
      type: 'changeLevel',
      system: { movementActions: ['walk'] },
    });
    expect(plan.regions[0].role).toBe('stairs');
  });

  it('refuses a scene with one level and an unknown level', async () => {
    world.setActiveScene(
      scene('a', 'Tower', { levels: { contents: [lv('d', 'Ground', 0, 10)] } }).id
    );
    const base = { action: 'stairs', name: 'S', area: { x: 0, y: 0, width: 1, height: 1 } };
    await expect(planRoomSetup(base)).rejects.toThrow(/fewer than two levels/);
    world.setActiveScene(scene('b', 'Tower2', { levels }).id);
    await expect(planRoomSetup({ ...base, levels: ['Ground', 'Attic'] })).rejects.toThrow(
      /No level "Attic"/
    );
  });
});

describe('hazard', () => {
  const area = { x: 0, y: 0, width: 2, height: 2 };

  it('difficult terrain uses the dnd5e behavior and needs the system', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    const plan = await planRoomSetup({
      action: 'hazard',
      kind: 'difficult',
      name: 'Mud',
      area,
      magical: true,
    });
    const b = (plan.ops[0] as any).data.behaviors[0];
    expect(b).toMatchObject({ type: 'dnd5e.difficultTerrain', system: { magical: true } });
    expect(plan.regions[0].role).toBe('hazard');
    (globalThis as any).CONFIG.RegionBehavior = { dataModels: { teleportToken: {} } };
    await expect(
      planRoomSetup({ action: 'hazard', kind: 'difficult', name: 'Mud', area })
    ).rejects.toThrow(/needs the dnd5e system/);
    delete (globalThis as any).CONFIG.RegionBehavior;
  });

  it('darkness maps the mode to Foundry numbers', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    const plan = await planRoomSetup({
      action: 'hazard',
      kind: 'darkness',
      name: 'Gloom',
      area,
      darknessMode: 'brighten',
      modifier: 0.25,
    });
    expect((plan.ops[0] as any).data.behaviors[0]).toMatchObject({
      type: 'adjustDarknessLevel',
      system: { mode: 1, modifier: 0.25 },
    });
  });

  it('effect needs an existing ActiveEffect uuid', async () => {
    world.setActiveScene(scene('a', 'Hall').id);
    (globalThis as any).fromUuid = async (u: string): Promise<unknown> =>
      u === 'Actor.x.ActiveEffect.e' ? { documentName: 'ActiveEffect', name: 'Poisoned' } : null;
    const plan = await planRoomSetup({
      action: 'hazard',
      kind: 'effect',
      name: 'Gas',
      area,
      effectUuid: 'Actor.x.ActiveEffect.e',
    });
    expect((plan.ops[0] as any).data.behaviors[0].system.effects).toEqual([
      'Actor.x.ActiveEffect.e',
    ]);
    await expect(
      planRoomSetup({ action: 'hazard', kind: 'effect', name: 'Gas', area, effectUuid: 'nope' })
    ).rejects.toThrow(/No ActiveEffect/);
    delete (globalThis as any).fromUuid;
  });

  it('an area level confines the Region to that level', async () => {
    world.setActiveScene(
      scene('a', 'Tower', {
        levels: { contents: [lv('d', 'Ground', 0, 10), lv('u', 'Up', 10, 20)] },
      }).id
    );
    const plan = await planRoomSetup({
      action: 'hazard',
      kind: 'difficult',
      name: 'Rubble',
      area: { ...area, level: 'Up' },
    });
    expect((plan.ops[0] as any).data.levels).toEqual(['u']);
  });
});

describe('levels follow-ups', () => {
  const levels = { contents: [lv('d', 'Ground', 0, 10), lv('u', 'Upstairs', 10, 20)] };

  it('a teleport and a spawn area can name their level', async () => {
    world.setActiveScene(scene('a', 'Tower', { levels }).id);
    const plan = await planRoomSetup({
      action: 'teleport',
      from: { x: 0, y: 0, width: 1, height: 1, level: 'Ground' },
      to: { x: 5, y: 5, width: 1, height: 1, level: 'Upstairs' },
    });
    const [entry, arrival] = plan.ops as any[];
    expect(entry.data.levels).toEqual(['d']);
    expect(arrival.data.levels).toEqual(['u']);
  });

  it('refuses an unknown movement action on stairs and a bad background', async () => {
    world.setActiveScene(scene('a', 'Tower', { levels }).id);
    (globalThis as any).CONFIG.Token = { movement: { actions: { walk: {}, fly: {} } } };
    await expect(
      planRoomSetup({
        action: 'stairs',
        name: 'S',
        area: { x: 0, y: 0, width: 1, height: 1 },
        movementActions: ['teleport'],
      })
    ).rejects.toThrow(/Unknown movement action/);
    await expect(
      planRoomSetup({
        action: 'levels',
        levels: [{ name: 'Roof', bottom: 20, background: 'x.txt' }],
      })
    ).rejects.toThrow(/background must be/);
    const plan = await planRoomSetup({ action: 'levels', levels: [{ name: 'Roof', bottom: 20 }] });
    expect(plan.warnings.join(' ')).toMatch(/no background image/);
  });
});

it('refuses a non-GM and an unknown action', async () => {
  world.setActiveScene(scene('a', 'Hall').id);
  await expect(planRoomSetup({ action: 'dance' })).rejects.toThrow(/Unknown action "dance"/);
  (globalThis as any).game.user.isGM = false;
  await expect(planRoomSetup({ action: 'dance' })).rejects.toThrow(/Only a GM/);
});
