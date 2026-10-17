/**
 * `getSceneState` (I-128): the read-only query the scene restore compares with a backup copy.
 * Driven through the Foundry-mock harness; also pins the names mirrored from the shared contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SCENE_RESTORE_FEATURE_ID as SHARED_FEATURE,
  SCENE_STATE_QUERY as SHARED_QUERY,
} from '../../../shared/src/scene-restore.js';
import { getSceneState, SCENE_RESTORE_FEATURE_ID, SCENE_STATE_QUERY } from './scene-state.js';
import { NON_WRITE_METHODS } from './write-gate.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

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

describe('getSceneState', () => {
  it('mirrors the shared names and is classified as a read', () => {
    expect(SCENE_STATE_QUERY).toBe(SHARED_QUERY);
    expect(SCENE_RESTORE_FEATURE_ID).toBe(SHARED_FEATURE);
    expect(NON_WRITE_METHODS).toContain('getSceneState');
  });

  it('returns the viewed scene with its embedded documents, without stats', () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Field',
      uuid: 'Scene.scene1',
      active: true,
      tokens: [],
    });
    world.setActiveScene(scene.id);
    (scene as any).walls = [
      {
        id: 'w1',
        toObject: (): Record<string, unknown> => ({ _id: 'w1', c: [0, 0, 1, 1], _stats: { x: 1 } }),
      },
    ];
    const state = getSceneState({});
    expect(state).toMatchObject({ sceneId: 'scene1', name: 'Field', viewed: true });
    expect(state.walls).toEqual([{ _id: 'w1', c: [0, 0, 1, 1] }]);
    expect(state.lights).toEqual([]);
  });

  it('refuses an unknown scene id', () => {
    expect(() => getSceneState({ sceneId: 'nope' })).toThrow(/No scene with id "nope"/);
  });
});
