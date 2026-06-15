/**
 * Characterization tests for `listScenes` and `getTokenDetails` in
 * `FoundryDataAccess`, driven through the Phase 9 Foundry-mock harness.
 *
 * These pin the *current* (upstream-derived) behaviour so the from-scratch
 * reimplementation planned for Phase 9 can be verified to parity.
 *
 * Harness gaps worked around locally (never editing shared files):
 *   - `makeToken` does not include `rotation`, `alpha`, `elevation`,
 *     `lockRotation`, `actorLink`, or `actor` — supplied via rest-spread in
 *     each call that needs them.
 *   - `makeToken` `texture` only types `{ src? }`, but `getTokenDetails` reads
 *     `texture.scaleX` — supplied as extra props via rest-spread.
 *   - `makeScene` wraps `img` in `_source.background.src` (null when absent),
 *     so a scene without `img` produces `background: ''` (null short-circuits to
 *     the `|| scene.img || ''` fallback, which is also absent → `''`).
 *   - `scene.dimensions` is not set by the harness; the method falls back to the
 *     top-level `scene.width` / `scene.height` fields that `makeScene` does set.
 *   - `scene.grid` is not set by the harness; `gridSize` therefore defaults to
 *     the method's own fallback of `100`.
 *   - `scene.navigation` defaults to `true` in `makeScene`.
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

// ---------------------------------------------------------------------------
// listScenes
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — listScenes', () => {
  it('returns an empty array when there are no scenes', async () => {
    const result = await da.listScenes();
    expect(result).toEqual([]);
  });

  it('maps a scene to the expected flat result shape', async () => {
    world.addScene({
      id: 'scene1',
      name: 'Dungeon',
      img: 'dungeon.webp',
      active: false,
      width: 3000,
      height: 2000,
      walls: [{ id: 'w1' }, { id: 'w2' }],
      tokens: [makeToken({ id: 't1' })],
      lights: [{ id: 'l1' }],
      sounds: [{ id: 's1' }, { id: 's2' }],
      notes: [],
      navigation: true,
    });

    const result = await da.listScenes();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'scene1',
      name: 'Dungeon',
      active: false,
      // dimensions fall back to top-level width/height (no scene.dimensions in harness)
      dimensions: { width: 3000, height: 2000 },
      // grid.size not set by harness → falls back to 100
      gridSize: 100,
      // _source.background.src is set from img by makeScene
      background: 'dungeon.webp',
      walls: 2,
      tokens: 1,
      lighting: 1,
      sounds: 2,
      // makeScene defaults navigation to true
      navigation: true,
    });
  });

  it('produces background "" when no img is supplied (null _source.background.src + no scene.img)', async () => {
    world.addScene({ id: 'scene-no-img', name: 'Dark Room', active: false });

    const result = await da.listScenes();

    expect(result[0]!.background).toBe('');
  });

  it('returns all scenes when neither filter is applied', async () => {
    world.addScene({ id: 's1', name: 'Alpha', active: true });
    world.addScene({ id: 's2', name: 'Beta', active: false });
    world.addScene({ id: 's3', name: 'Gamma', active: false });

    const result = await da.listScenes();

    expect(result.map((s: any) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('include_active_only keeps only scenes with active === true', async () => {
    world.addScene({ id: 's1', name: 'Active Scene', active: true });
    world.addScene({ id: 's2', name: 'Inactive Scene', active: false });

    const result = await da.listScenes({ include_active_only: true });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('s1');
    expect(result[0]!.active).toBe(true);
  });

  it('include_active_only returns empty when no scene is active', async () => {
    world.addScene({ id: 's1', name: 'Inactive', active: false });

    const result = await da.listScenes({ include_active_only: true });

    expect(result).toEqual([]);
  });

  it('filter matches scene names case-insensitively using includes', async () => {
    world.addScene({ id: 's1', name: 'Throne Room', active: false });
    world.addScene({ id: 's2', name: 'Dungeon Level 1', active: false });
    world.addScene({ id: 's3', name: 'Throne Antechamber', active: false });

    const result = await da.listScenes({ filter: 'THRONE' });

    expect(result.map((s: any) => s.id)).toEqual(['s1', 's3']);
  });

  it('filter is a substring match, not an exact match', async () => {
    world.addScene({ id: 's1', name: 'The Great Hall of Kings', active: false });
    world.addScene({ id: 's2', name: 'Hall of Shadows', active: false });
    world.addScene({ id: 's3', name: 'Stable', active: false });

    const result = await da.listScenes({ filter: 'hall' });

    expect(result.map((s: any) => s.id)).toEqual(['s1', 's2']);
  });

  it('filter returning no matches yields an empty array', async () => {
    world.addScene({ id: 's1', name: 'Forest', active: false });

    const result = await da.listScenes({ filter: 'castle' });

    expect(result).toEqual([]);
  });

  it('combines include_active_only and filter (active first, then name filter)', async () => {
    world.addScene({ id: 's1', name: 'Active Throne Room', active: true });
    world.addScene({ id: 's2', name: 'Active Dungeon', active: true });
    world.addScene({ id: 's3', name: 'Inactive Throne Room', active: false });

    const result = await da.listScenes({ include_active_only: true, filter: 'throne' });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getTokenDetails
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getTokenDetails', () => {
  it('throws wrapped error when there is no active scene', async () => {
    // No scene installed → game.scenes.current is undefined
    await expect(da.getTokenDetails({ tokenId: 'tok1' })).rejects.toThrow(
      'Failed to get token details: No active scene found'
    );
  });

  it('throws wrapped error when the token id is not in the current scene', async () => {
    const scene = world.addScene({ id: 'scene1', name: 'Arena', active: true });
    world.setActiveScene(scene.id);

    await expect(da.getTokenDetails({ tokenId: 'missing-token' })).rejects.toThrow(
      'Failed to get token details: Token missing-token not found in current scene'
    );
  });

  it('returns the full flat result shape on success', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Arena',
      active: true,
      tokens: [
        makeToken({
          id: 'tok1',
          name: 'Silvera',
          x: 150,
          y: 250,
          width: 1,
          height: 1,
          hidden: false,
          disposition: 1,
          texture: { src: 'silvera.webp', scaleX: 0.8 },
          rotation: 45,
          alpha: 0.9,
          elevation: 10,
          lockRotation: true,
          actorLink: true,
          actor: {
            id: 'actor1',
            name: 'Silvera Moonwhisper',
            type: 'character',
            img: 'silvera-avatar.webp',
          },
        }),
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.getTokenDetails({ tokenId: 'tok1' });

    expect(result).toEqual({
      success: true,
      id: 'tok1',
      name: 'Silvera',
      x: 150,
      y: 250,
      width: 1,
      height: 1,
      rotation: 45,
      scale: 0.8,
      alpha: 0.9,
      hidden: false,
      disposition: 1,
      elevation: 10,
      lockRotation: true,
      img: 'silvera.webp',
      actorId: 'actor1',
      actorData: { name: 'Silvera Moonwhisper', type: 'character', img: 'silvera-avatar.webp' },
      actorLink: true,
    });
  });

  it('scale defaults to 1 when texture.scaleX is falsy (0 or absent)', async () => {
    const scene = world.addScene({
      id: 'scene2',
      name: 'Pit',
      active: true,
      tokens: [
        makeToken({
          id: 'tok2',
          name: 'Goblin',
          texture: { src: 'goblin.webp' }, // no scaleX
        }),
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.getTokenDetails({ tokenId: 'tok2' });

    expect(result.scale).toBe(1);
  });

  it('actorData is null when token has no actor', async () => {
    const scene = world.addScene({
      id: 'scene3',
      name: 'Void',
      active: true,
      tokens: [
        makeToken({
          id: 'tok3',
          name: 'Mysterious Figure',
          texture: { src: '' },
          actorLink: false,
          // no actor prop
        }),
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.getTokenDetails({ tokenId: 'tok3' });

    expect(result.actorData).toBeNull();
    expect(result.actorId).toBeUndefined();
  });

  it('img reads from texture.src (may be empty string)', async () => {
    const scene = world.addScene({
      id: 'scene4',
      name: 'Empty',
      active: true,
      tokens: [
        makeToken({
          id: 'tok4',
          name: 'Ghost',
          texture: { src: '' },
        }),
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.getTokenDetails({ tokenId: 'tok4' });

    expect(result.img).toBe('');
  });
});
