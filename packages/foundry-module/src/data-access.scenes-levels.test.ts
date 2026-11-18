/**
 * Floor-aware reads (I-178): `getTokenPositions` names the Scene Level of each token and
 * `measureDistance` counts height on a scene with Foundry 14 Scene Levels. A flat scene answers
 * exactly as before (pinned in data-access.scenes-tokens-extra.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, makeToken, type TestWorld } from './test-support/foundry-mock/index.js';
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

/** A scene's `levels` collection: `get` by id and `contents`, as Foundry's collections do. */
function levelsOf(list: Array<{ id: string; name: string; bottom: number; top: number }>): unknown {
  const docs = list.map(l => ({
    id: l.id,
    name: l.name,
    elevation: { bottom: l.bottom, top: l.top },
  }));
  return { contents: docs, get: (id: string) => docs.find(d => d.id === id) };
}

function castle(): void {
  const scene = world.addScene({
    id: 'castle',
    name: 'Castle',
    active: true,
    levels: levelsOf([
      { id: 'ground', name: 'Ground floor', bottom: 0, top: 10 },
      { id: 'upper', name: 'Tower', bottom: 20, top: 30 },
    ]),
    tokens: [
      makeToken({ id: 't1', name: 'Knight', x: 0, y: 0, level: 'ground', elevation: 0 }),
      makeToken({ id: 't2', name: 'Archer', x: 300, y: 0, level: 'upper', elevation: 20 }),
      makeToken({ id: 't3', name: 'Lookout', x: 300, y: 0, level: 'upper' }),
    ],
  });
  world.setActiveScene(scene.id);
}

describe('floor-aware tools', () => {
  it('getTokenPositions lists the level of each token', async () => {
    castle();
    const r = await da.getTokenPositions({});
    expect(r.tokens.find(t => t.name === 'Knight')?.level).toEqual({
      id: 'ground',
      name: 'Ground floor',
    });
    expect(r.tokens.find(t => t.name === 'Archer')?.level).toEqual({ id: 'upper', name: 'Tower' });
  });

  it('measureDistance counts height and names each level', async () => {
    castle();
    const r = await da.measureDistance({ fromTokenName: 'Knight', toTokenName: 'Archer' });
    // 15 ft across the map, 20 ft up: the larger step count wins (5e)
    expect(r).toMatchObject({
      distance: 20,
      horizontalDistance: 15,
      verticalDistance: 20,
      fromLevel: { id: 'ground', name: 'Ground floor' },
      toLevel: { id: 'upper', name: 'Tower' },
      threeD: true,
    });
  });

  it('lifts a token that is below its level floor to the floor', async () => {
    castle();
    const r = await da.measureDistance({ fromTokenName: 'Knight', toTokenName: 'Lookout' });
    expect(r.toElevation).toBe(20);
    expect(r.distance).toBe(20);
  });

  it('two tokens on one level keep the flat answer', async () => {
    castle();
    const r = await da.measureDistance({ fromTokenName: 'Archer', toTokenName: 'Lookout' });
    expect(r.distance).toBe(0);
    expect(r.verticalDistance).toBe(0);
  });

  it('a flat scene has no level fields', async () => {
    const scene = world.addScene({
      id: 'flat',
      name: 'Flat',
      active: true,
      tokens: [
        makeToken({ id: 'a', name: 'A', x: 0, y: 0, elevation: 0 }),
        makeToken({ id: 'b', name: 'B', x: 200, y: 0, elevation: 50 }),
      ],
    });
    world.setActiveScene(scene.id);
    const d = await da.measureDistance({ fromTokenName: 'A', toTokenName: 'B' });
    expect(d).toEqual({ success: true, from: 'A', to: 'B', distance: 10, units: 'ft' });
    const p = await da.getTokenPositions({});
    expect(p.tokens[0]).not.toHaveProperty('level');
  });
});
