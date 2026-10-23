/**
 * Scene reads and token writes on a client with core `noCanvas` (the Pi's Assistant GM): there
 * `game.scenes.current` is empty while `game.scenes.active` is set, so they fall back to `active`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, makeToken, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';
import { viewedScene } from './viewed-scene.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  world.noCanvas = true;
  restore = world.install();
  da = new FoundryDataAccess();
  world.addScene({
    id: 'scene1',
    name: 'Throne Room',
    active: true,
    tokens: [
      makeToken({ id: 't1', name: 'Hero', x: 100, y: 200 }),
      makeToken({ id: 't2', name: 'Foe', x: 300, y: 200 }),
    ],
  });
  world.setActiveScene('scene1');
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe('no canvas', () => {
  it('has no current scene but an active one', () => {
    expect(game.scenes.current).toBeUndefined();
    expect(game.scenes.active?.id).toBe('scene1');
  });

  it('viewedScene prefers current, falls back to active, and tolerates nothing', () => {
    expect(viewedScene({ current: { id: 'a' }, active: { id: 'b' } })?.id).toBe('a');
    expect(viewedScene({ current: null, active: { id: 'b' } })?.id).toBe('b');
    expect(viewedScene({ current: null, active: null })).toBeUndefined();
    expect(viewedScene(undefined)).toBeUndefined();
  });

  it('getActiveScene reads the active scene', async () => {
    const scene = await da.getActiveScene();
    expect(scene.id).toBe('scene1');
    expect(scene.name).toBe('Throne Room');
  });

  it('getTokenPositions reads the active scene tokens', async () => {
    const result = await da.getTokenPositions({});
    expect(result.sceneId).toBe('scene1');
    expect(result.tokens.map(t => t.name).sort()).toEqual(['Foe', 'Hero']);
  });

  it('still reports SCENE_NOT_FOUND when no scene is active either', async () => {
    world.setActiveScene(null as unknown as string);
    await expect(da.getTokenPositions({})).rejects.toThrow();
  });
});
