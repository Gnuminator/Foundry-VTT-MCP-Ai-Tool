import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SceneRestoreTools } from '../tools/scene-restore.js';
import { findScenesDir, readBackupScene, type LevelOpener } from './backup-reader.js';
import { buildRestoreDiff, describePart, flatten } from './diff.js';

/**
 * Scene restore (I-128): the pure diff, the backup reader (with a fake LevelDB, the real one is
 * Foundry's classic-level and is checked live) and the `plan-scene-restore` tool with a fake
 * Foundry link and guarded-write service.
 */

const none = { walls: [], lights: [], tiles: [], tokens: [] };

describe('diff', () => {
  it('adds back, removes and updates by id, counting moves apart from other changes', () => {
    const live = {
      ...none,
      walls: [
        { _id: 'w1', c: [0, 0, 100, 0], door: 0 },
        { _id: 'w2', c: [0, 0, 0, 100], door: 0 },
        { _id: 'wx', c: [5, 5, 6, 6] },
      ],
      lights: [{ _id: 'l1', x: 10, y: 10, config: { dim: 5, color: '#fff' } }],
      tokens: [{ _id: 't1', name: 'Wolf', x: 500, y: 500, delta: { hp: 1 } }],
    };
    const backup = {
      ...none,
      walls: [
        { _id: 'w1', c: [0, 0, 100, 0], door: 0 },
        { _id: 'w2', c: [0, 0, 0, 200], door: 0 },
        { _id: 'w3', c: [9, 9, 9, 99], door: 1 },
      ],
      lights: [{ _id: 'l1', x: 10, y: 10, config: { dim: 8, color: '#fff' } }],
      tokens: [{ _id: 't1', name: 'Wolf', x: 100, y: 100, delta: { hp: 9 } }],
    };
    const diff = buildRestoreDiff('s1', ['walls', 'lights', 'tiles', 'tokens'], live, backup);
    expect(diff.counts.walls).toEqual({ added: 1, removed: 1, moved: 1, changed: 0, unchanged: 1 });
    expect(diff.counts.lights).toMatchObject({ changed: 1, moved: 0 });
    expect(diff.counts.tokens).toMatchObject({ moved: 1 });
    expect(diff.ops).toContainEqual({
      kind: 'create',
      documentName: 'Wall',
      parentUuid: 'Scene.s1',
      data: { _id: 'w3', c: [9, 9, 9, 99], door: 1 },
      keepId: true,
    });
    expect(diff.ops).toContainEqual({ kind: 'delete', uuid: 'Scene.s1.Wall.wx' });
    expect(diff.ops).toContainEqual({
      kind: 'update',
      uuid: 'Scene.s1.Wall.w2',
      changes: { c: [0, 0, 0, 200] },
    });
    expect(diff.ops).toContainEqual({
      kind: 'update',
      uuid: 'Scene.s1.AmbientLight.l1',
      changes: { 'config.dim': 8 },
    });
    // The token's own hit points (delta) are never restored.
    expect(diff.ops).toContainEqual({
      kind: 'update',
      uuid: 'Scene.s1.Token.t1',
      changes: { x: 100, y: 100 },
    });
  });

  it('leaves parts that were not asked for alone and plans nothing for equal scenes', () => {
    const doc = { _id: 'w1', c: [0, 0, 1, 1] };
    const same = buildRestoreDiff(
      's1',
      ['walls'],
      { ...none, walls: [doc] },
      {
        ...none,
        walls: [{ ...doc }],
      }
    );
    expect(same.ops).toEqual([]);
    const onlyTiles = buildRestoreDiff('s1', ['tiles'], { ...none, walls: [doc] }, none);
    expect(onlyTiles.ops).toEqual([]);
  });

  it('never unsets a field the backup does not hold', () => {
    const diff = buildRestoreDiff(
      's1',
      ['lights'],
      { ...none, lights: [{ _id: 'l1', x: 1, extra: 'live only' }] },
      { ...none, lights: [{ _id: 'l1', x: 2 }] }
    );
    expect(diff.ops).toEqual([
      { kind: 'update', uuid: 'Scene.s1.AmbientLight.l1', changes: { x: 2 } },
    ]);
  });

  it('flattens objects to dot paths and keeps arrays whole', () => {
    expect([...flatten({ a: { b: 1, c: [1, 2] }, d: {} })]).toEqual([
      ['a.b', 1],
      ['a.c', [1, 2]],
      ['d', {}],
    ]);
  });

  it('describes counts in words', () => {
    expect(
      describePart('walls', { added: 1, removed: 2, moved: 0, changed: 3, unchanged: 9 })
    ).toBe('1 wall added back, 2 walls removed, 3 walls changed');
    expect(
      describePart('tiles', { added: 0, removed: 0, moved: 0, changed: 0, unchanged: 2 })
    ).toBe('');
  });
});

/** A fake LevelDB over a key/value map. */
function fakeOpener(data: Record<string, unknown>): LevelOpener {
  return async () => ({
    async *entries(prefix: string): AsyncGenerator<[string, string]> {
      for (const key of Object.keys(data).sort()) {
        if (key.startsWith(prefix)) yield [key, JSON.stringify(data[key])] as [string, string];
      }
    },
    close: async (): Promise<void> => {},
  });
}

const BACKUP_DATA = {
  '!scenes!s1': { name: 'Arena' },
  '!scenes!s2': { name: 'Other' },
  '!scenes.walls!s1.w1': { c: [0, 0, 1, 1] },
  '!scenes.walls!s2.w9': { c: [9, 9, 9, 9] },
  '!scenes.tokens!s1.t1': { _id: 't1', name: 'Wolf', x: 1, y: 1 },
};

let dir: string;
let scenes: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scene-restore-test-'));
  scenes = join(dir, 'worlds', 'w', 'data', 'scenes');
  await mkdir(scenes, { recursive: true });
  await writeFile(join(scenes, 'CURRENT'), 'MANIFEST-000001\n');
  await writeFile(join(scenes, 'LOCK'), '');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('backup reader', () => {
  it('finds the scenes folder from a world folder, a data root or the folder itself', async () => {
    expect(await findScenesDir(scenes)).toBe(scenes);
    expect(await findScenesDir(join(dir, 'worlds', 'w'))).toBe(scenes);
    expect(await findScenesDir(dir, 'w')).toBe(scenes);
    await expect(findScenesDir(join(dir, 'nothing'))).rejects.toThrow(/No scenes database/);
  });

  it('reads one scene, takes ids from the keys and skips other scenes', async () => {
    const scene = await readBackupScene({
      backupPath: join(dir, 'worlds', 'w'),
      sceneId: 's1',
      open: fakeOpener(BACKUP_DATA),
    });
    expect(scene.name).toBe('Arena');
    expect(scene.walls).toEqual([{ _id: 'w1', c: [0, 0, 1, 1] }]);
    expect(scene.tokens).toHaveLength(1);
    expect(scene.lights).toEqual([]);
  });

  it('names the scenes the backup holds when the scene is missing', async () => {
    await expect(
      readBackupScene({ backupPath: scenes, sceneId: 'zzz', open: fakeOpener(BACKUP_DATA) })
    ).rejects.toThrow(/not in that backup.*Arena, Other/);
  });
});

describe('plan-scene-restore', () => {
  function makeTools(opts: { enabled?: boolean; live?: unknown } = {}): {
    tools: SceneRestoreTools;
    query: ReturnType<typeof vi.fn>;
    createPlan: ReturnType<typeof vi.fn>;
  } {
    const query = vi.fn((method: string) => {
      if (method === 'foundry-mcp-bridge.listGuardedFeatures') {
        return [{ id: 'scene-restore', enabled: opts.enabled ?? true }];
      }
      return (
        opts.live ?? {
          sceneId: 's1',
          name: 'Arena',
          viewed: true,
          walls: [
            { _id: 'w1', c: [0, 0, 1, 1] },
            { _id: 'wx', c: [4, 4, 5, 5] },
          ],
          lights: [],
          tiles: [],
          tokens: [],
        }
      );
    });
    const createPlan = vi.fn((input: any) => Promise.resolve({ planId: 'p1', ...input, diff: [] }));
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = (): unknown => logger;
    const tools = new SceneRestoreTools({
      foundryClient: { query } as any,
      guardedWrites: { createPlan },
      worldIds: { current: (): Promise<string> => Promise.resolve('w') },
      logger,
      openLevel: fakeOpener(BACKUP_DATA),
      env: {},
    });
    return { tools, query, createPlan };
  }

  it('plans the difference as one guarded change under the scene-restore feature', async () => {
    const { tools, createPlan } = makeTools();
    const result: any = await tools.handleToolCall('plan-scene-restore', {
      backupPath: join(dir, 'worlds', 'w'),
    });
    const input = createPlan.mock.calls[0]?.[0];
    expect(input.feature).toBe('scene-restore');
    expect(input.ops).toEqual([
      { kind: 'delete', uuid: 'Scene.s1.Wall.wx' },
      expect.objectContaining({ kind: 'create', documentName: 'Token' }),
    ]);
    expect(input.summary).toMatch(
      /Restore Arena from the backup of .*1 wall removed.*1 token added back/
    );
    expect(result.counts.walls.removed).toBe(1);
    expect(result.tokens.added).toEqual(['Wolf']);
    expect(result.autoApply).toBe(false);
  });

  it('refuses while the feature switch is off and plans nothing', async () => {
    const { tools, createPlan } = makeTools({ enabled: false });
    await expect(
      tools.handleToolCall('plan-scene-restore', { backupPath: scenes })
    ).rejects.toThrow(/switched off/);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('says so when the scene already matches the backup', async () => {
    const { tools } = makeTools({
      live: {
        sceneId: 's1',
        name: 'Arena',
        viewed: true,
        walls: [{ _id: 'w1', c: [0, 0, 1, 1] }],
        lights: [],
        tiles: [],
        tokens: [{ _id: 't1', name: 'Wolf', x: 1, y: 1 }],
      },
    });
    await expect(
      tools.handleToolCall('plan-scene-restore', { backupPath: scenes })
    ).rejects.toThrow(/Nothing to restore/);
  });

  it('reports a missing backup folder with the way to get one', async () => {
    const { tools } = makeTools();
    await expect(
      tools.handleToolCall('plan-scene-restore', { backupPath: join(dir, 'gone') })
    ).rejects.toThrow(/No backup copy.*restore\.ps1/);
  });
});
