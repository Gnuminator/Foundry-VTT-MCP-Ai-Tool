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

it('refuses a non-GM and an unknown action', async () => {
  world.setActiveScene(scene('a', 'Hall').id);
  await expect(planRoomSetup({ action: 'dance' })).rejects.toThrow(/Unknown action "dance"/);
  (globalThis as any).game.user.isGM = false;
  await expect(planRoomSetup({ action: 'dance' })).rejects.toThrow(/Only a GM/);
});
