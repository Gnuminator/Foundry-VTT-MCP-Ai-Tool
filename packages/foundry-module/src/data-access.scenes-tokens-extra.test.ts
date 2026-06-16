/**
 * Characterization tests for the remaining `scenes-tokens` methods that the
 * existing nets (`data-access.scenes.test.ts` = listScenes/getTokenDetails,
 * `data-access.token-manipulation.test.ts` = moveToken/updateToken/deleteTokens/
 * toggleTokenCondition) do NOT cover:
 *   - switchScene
 *   - getTokenPositions
 *   - measureDistance
 *   - getTargets
 *   - setTokenVisionLight
 *
 * These pin the *current* (upstream-derived / fork-original) behaviour so the
 * Phase 9 from-scratch rewrite of `scenes-tokens.ts` can be verified to parity
 * across the whole domain surface (the wave-1 lesson: a parity net is required
 * per method, not per domain).
 *
 * Driven through the Phase 9 Foundry-mock harness (in-memory, no browser).
 *
 * Harness gaps worked around locally (never editing shared harness files):
 *   - `makeScene` does not attach `activate()` — switchScene needs it, so it is
 *     patched inline with a `vi.fn()` (mirrors the `withUpdate` pattern in the
 *     token-manipulation net).
 *   - `makeScene` does not set `scene.grid` — supplied via rest-spread where a
 *     test needs a non-default grid; omitted, the methods use their own
 *     fallbacks (gridSize 100; getTokenPositions gridDistance null / measure-
 *     Distance gridDistance 5; gridUnits 'ft').
 *   - `makeToken` does not include `actor`, `elevation`, or `actorId` — supplied
 *     via rest-spread.
 *   - `game.user` has no `targets`; getTargets reads it, so the target Set is set
 *     on `game.user` after `world.install()` (mirrors how the token-manipulation
 *     net sets `CONFIG.statusEffects` post-install).
 *   - The browser `canvas` global is absent in the harness, so the canvas-gated
 *     branches (switchScene's `optimize_view` pan, measureDistance's
 *     `grid.measurePath` fast path) are not exercised here — these tests pin the
 *     non-canvas paths, and the rewrite preserves the canvas branches verbatim
 *     (covered live, not in the mock).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from './constants.js';
import {
  createTestWorld,
  makeActor,
  makeEffect,
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

// ---------------------------------------------------------------------------
// switchScene
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — switchScene', () => {
  it('throws a wrapped error when the scene is not found', async () => {
    world.addScene({ id: 's1', name: 'Throne Room', active: false });

    await expect(da.switchScene({ scene_identifier: 'ghost' })).rejects.toThrow(
      'Failed to switch scene: Scene not found: "ghost"'
    );
  });

  it('activates a scene found by id and returns the result shape', async () => {
    const scene = world.addScene({
      id: 's1',
      name: 'Dungeon',
      active: false,
      width: 2000,
      height: 1500,
    });
    const activate = vi.fn(() => Promise.resolve());
    (scene as any).activate = activate;

    const result = await da.switchScene({ scene_identifier: 's1' });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      sceneId: 's1',
      sceneName: 'Dungeon',
      // no scene.dimensions in harness → falls back to top-level width/height
      dimensions: { width: 2000, height: 1500 },
    });
  });

  it('finds a scene by name case-insensitively', async () => {
    const scene = world.addScene({
      id: 's7',
      name: 'Crystal Cavern',
      active: false,
      width: 1000,
      height: 800,
    });
    const activate = vi.fn(() => Promise.resolve());
    (scene as any).activate = activate;

    const result = await da.switchScene({ scene_identifier: 'CRYSTAL CAVERN' });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(result.sceneId).toBe('s7');
    expect(result.sceneName).toBe('Crystal Cavern');
  });
});

// ---------------------------------------------------------------------------
// getTokenPositions
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getTokenPositions', () => {
  it('throws SCENE_NOT_FOUND (unwrapped) when there is no active scene', async () => {
    await expect(da.getTokenPositions({})).rejects.toThrow(ERROR_MESSAGES.SCENE_NOT_FOUND);
  });

  it('resolves a scene explicitly by sceneId', async () => {
    world.addScene({ id: 'active1', name: 'Active', active: true });
    world.setActiveScene('active1');
    world.addScene({ id: 'other1', name: 'Other', active: false });

    const result = await da.getTokenPositions({ sceneId: 'other1' });

    expect(result.sceneId).toBe('other1');
    expect(result.sceneName).toBe('Other');
  });

  it('maps tokens with category/hp/conditions and grid fallbacks (no scene.grid)', async () => {
    const pcActor = makeActor({
      id: 'a-pc',
      type: 'character',
      hasPlayerOwner: true,
      system: { attributes: { hp: { value: 25, max: 30 } } },
      effects: [makeEffect({ id: 'e1', name: 'Prone', statuses: ['prone'] })],
    });
    const enemyActor = makeActor({
      id: 'a-goblin',
      type: 'npc',
      hasPlayerOwner: false,
      system: { attributes: { hp: { value: 7, max: 7 } } },
    });

    const scene = world.addScene({
      id: 'scene1',
      name: 'Battlefield',
      active: true,
      tokens: [
        makeToken({
          id: 'tA',
          name: 'Hero',
          x: 150,
          y: 250,
          disposition: 1,
          elevation: 5,
          actor: pcActor,
        }),
        makeToken({
          id: 'tB',
          name: 'Goblin',
          x: 300,
          y: 100,
          disposition: -1,
          actor: enemyActor,
        }),
        makeToken({ id: 'tC', name: 'Statue', x: 0, y: 0, disposition: 0 }),
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.getTokenPositions({});

    expect(result).toEqual({
      success: true,
      sceneId: 'scene1',
      sceneName: 'Battlefield',
      gridSize: 100, // grid.size absent → fallback 100
      gridDistance: null, // grid.distance absent → null
      gridUnits: 'ft', // grid.units absent → 'ft'
      tokenCount: 3,
      tokens: [
        {
          tokenId: 'tA',
          name: 'Hero',
          actorId: 'a-pc', // t.actorId absent → actor.id
          x: 150,
          y: 250,
          gridX: 1, // floor(150 / 100)
          gridY: 2, // floor(250 / 100)
          elevation: 5,
          category: 'pc', // hasPlayerOwner && type === 'character'
          hidden: false,
          hp: { value: 25, max: 30 },
          conditions: ['Prone'],
        },
        {
          tokenId: 'tB',
          name: 'Goblin',
          actorId: 'a-goblin',
          x: 300,
          y: 100,
          gridX: 3,
          gridY: 1,
          elevation: 0, // token elevation absent → 0
          category: 'enemy', // disposition === -1
          hidden: false,
          hp: { value: 7, max: 7 },
          conditions: [],
        },
        {
          tokenId: 'tC',
          name: 'Statue',
          actorId: null, // no actor → null
          x: 0,
          y: 0,
          gridX: 0,
          gridY: 0,
          elevation: 0,
          category: 'npc', // not PC, disposition !== -1
          hidden: false,
          hp: null, // no actor → null
          conditions: [],
        },
      ],
    });
  });

  it('uses scene.grid when present (size/distance/units + grid coordinates)', async () => {
    const scene = world.addScene({
      id: 'scene2',
      name: 'Cavern',
      active: true,
      grid: { size: 50, distance: 10, units: 'm', type: 1 },
      tokens: [makeToken({ id: 't1', name: 'Dwarf', x: 100, y: 75, disposition: 1 })],
    });
    world.setActiveScene(scene.id);

    const result = await da.getTokenPositions({});

    expect(result.gridSize).toBe(50);
    expect(result.gridDistance).toBe(10);
    expect(result.gridUnits).toBe('m');
    expect(result.tokens[0].gridX).toBe(2); // floor(100 / 50)
    expect(result.tokens[0].gridY).toBe(1); // floor(75 / 50)
  });
});

// ---------------------------------------------------------------------------
// measureDistance
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — measureDistance', () => {
  it('throws SCENE_NOT_FOUND when there is no active scene', async () => {
    await expect(da.measureDistance({ fromTokenName: 'A', toTokenName: 'B' })).rejects.toThrow(
      ERROR_MESSAGES.SCENE_NOT_FOUND
    );
  });

  it('throws when the "from" token cannot be found', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Arena',
      active: true,
      tokens: [makeToken({ id: 't1', name: 'Knight' })],
    });
    world.setActiveScene(scene.id);

    await expect(
      da.measureDistance({ fromTokenName: 'Ghost', toTokenName: 'Knight' })
    ).rejects.toThrow('Token not found: Ghost');
  });

  it('throws when the "to" token cannot be found (from exists)', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Arena',
      active: true,
      tokens: [makeToken({ id: 't1', name: 'Knight' })],
    });
    world.setActiveScene(scene.id);

    await expect(
      da.measureDistance({ fromTokenName: 'Knight', toTokenName: 'Ghost' })
    ).rejects.toThrow('Token not found: Ghost');
  });

  it('computes Chebyshev distance on a square/no-grid scene (no approximate key)', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Hall',
      active: true,
      tokens: [
        makeToken({ id: 't1', name: 'Knight', x: 0, y: 0, width: 1, height: 1 }),
        makeToken({ id: 't2', name: 'Dragon', x: 300, y: 0, width: 1, height: 1 }),
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.measureDistance({ fromTokenName: 'Knight', toTokenName: 'Dragon' });

    // centers: (50,50) and (350,50); dx=300 dy=0; unitsPerPixel = 5/100; max*0.05 = 15
    expect(result).toEqual({
      success: true,
      from: 'Knight',
      to: 'Dragon',
      distance: 15,
      units: 'ft',
    });
    expect(result).not.toHaveProperty('approximate');
  });

  it('prefers an exact name match over an includes/substring match', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Camp',
      active: true,
      tokens: [
        makeToken({ id: 't1', name: 'Orc Warlord', x: 0, y: 0 }),
        makeToken({ id: 't2', name: 'Orc', x: 200, y: 0 }),
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.measureDistance({ fromTokenName: 'Orc', toTokenName: 'Orc Warlord' });

    // exact 'Orc' wins even though 'Orc Warlord' (inserted first) also includes 'orc'
    expect(result.from).toBe('Orc');
    expect(result.to).toBe('Orc Warlord');
  });

  it('falls back to an includes/substring match when there is no exact match', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Range',
      active: true,
      tokens: [
        makeToken({ id: 't1', name: 'Goblin Archer', x: 0, y: 0 }),
        makeToken({ id: 't2', name: 'Wizard', x: 100, y: 0 }),
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.measureDistance({ fromTokenName: 'archer', toTokenName: 'Wizard' });

    expect(result.from).toBe('Goblin Archer');
  });

  it('uses a Euclidean approximation flagged approximate:true on a hex grid', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Hex Field',
      active: true,
      grid: { type: 2, size: 100, distance: 5, units: 'ft' },
      tokens: [
        makeToken({ id: 't1', name: 'Scout', x: 0, y: 0, width: 1, height: 1 }),
        makeToken({ id: 't2', name: 'Beast', x: 300, y: 400, width: 1, height: 1 }),
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.measureDistance({ fromTokenName: 'Scout', toTokenName: 'Beast' });

    // centers (50,50) and (350,450); hypot(300,400)=500; *0.05 = 25
    expect(result.distance).toBe(25);
    expect(result.approximate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getTargets
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getTargets', () => {
  it('returns count 0 and an empty array when the user has no targets', async () => {
    const result = await da.getTargets();

    expect(result).toEqual({ success: true, count: 0, targets: [] });
  });

  it('maps the user targets to token id / actor / ac / hp', async () => {
    (globalThis as any).game.user.targets = new Set([
      {
        id: 'tk1',
        name: 'Goblin',
        actor: {
          id: 'ac1',
          system: { attributes: { ac: { value: 15 }, hp: { value: 7, max: 7 } } },
        },
      },
      // no actor → actorId/ac/hp all null
      { id: 'tk2', name: 'Shade', actor: null },
    ]);

    const result = await da.getTargets();

    expect(result).toEqual({
      success: true,
      count: 2,
      targets: [
        { tokenId: 'tk1', name: 'Goblin', actorId: 'ac1', ac: 15, hp: { value: 7, max: 7 } },
        { tokenId: 'tk2', name: 'Shade', actorId: null, ac: null, hp: null },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// setTokenVisionLight
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — setTokenVisionLight', () => {
  it('throws SCENE_NOT_FOUND when there is no active scene', async () => {
    await expect(da.setTokenVisionLight({ tokenName: 'Torch', sightRange: 30 })).rejects.toThrow(
      ERROR_MESSAGES.SCENE_NOT_FOUND
    );
  });

  it('throws when the token cannot be found', async () => {
    const scene = world.addScene({ id: 'scene1', name: 'Cave', active: true });
    world.setActiveScene(scene.id);

    await expect(da.setTokenVisionLight({ tokenName: 'Nobody', sightRange: 30 })).rejects.toThrow(
      'Token not found: Nobody'
    );
  });

  it('throws when no vision/light fields are provided', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Cave',
      active: true,
      tokens: [makeToken({ id: 't1', name: 'Torchbearer' })],
    });
    world.setActiveScene(scene.id);

    await expect(da.setTokenVisionLight({ tokenName: 'Torchbearer' })).rejects.toThrow(
      'No vision/light fields provided.'
    );
  });

  it('builds the flat update, applies it to the token, and lists the updated keys', async () => {
    const token = makeToken({ id: 't1', name: 'Torchbearer' });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Cave',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const result = await da.setTokenVisionLight({
      tokenName: 'torchbearer', // matched case-insensitively by name
      sightEnabled: true,
      sightRange: 30,
      visionMode: 'darkvision',
      lightDim: 20,
      lightBright: 10,
      lightColor: '#ff9900',
      lightAnimation: 'torch',
    });

    expect(result).toEqual({
      success: true,
      tokenId: 't1',
      tokenName: 'Torchbearer',
      updated: [
        'sight.enabled',
        'sight.range',
        'sight.visionMode',
        'light.dim',
        'light.bright',
        'light.color',
        'light.animation.type',
      ],
    });
    // the dotted update was applied in-place via the token's update()
    expect(token.sight).toEqual({ enabled: true, range: 30, visionMode: 'darkvision' });
    expect(token.light).toEqual({
      dim: 20,
      bright: 10,
      color: '#ff9900',
      animation: { type: 'torch' },
    });
  });

  it('includes falsy numeric/boolean fields (!= null) but skips empty-string string fields', async () => {
    const token = makeToken({ id: 't1', name: 'Sentry' });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Wall',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const result = await da.setTokenVisionLight({
      tokenName: 'Sentry',
      sightEnabled: false, // false != null → included
      lightDim: 0, // 0 != null → included
      visionMode: '', // falsy string → skipped
      lightColor: '', // falsy string → skipped
    });

    expect(result.updated).toEqual(['sight.enabled', 'light.dim']);
  });

  it('finds the token by id as well as by name', async () => {
    const token = makeToken({ id: 'tok-xyz', name: 'Lantern' });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Tunnel',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const result = await da.setTokenVisionLight({ tokenName: 'tok-xyz', sightRange: 60 });

    expect(result.tokenId).toBe('tok-xyz');
    expect(result.updated).toEqual(['sight.range']);
  });
});
