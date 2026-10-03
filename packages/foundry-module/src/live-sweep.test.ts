import { afterEach, describe, expect, it } from 'vitest';

import { createTestWorld, makeToken, type TestWorld } from './test-support/foundry-mock/index.js';
import { liveSweep, SWEEP_PREFIX, SWEEP_WORLD_ID, SWEEP_WORLD_IDS } from './live-sweep.js';

let restore: (() => void) | undefined;

function install(worldId: string): TestWorld {
  const world = createTestWorld({ worldId });
  restore = world.install();
  return world;
}

afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('liveSweep (I-016)', () => {
  it('refuses outside the test world and deletes nothing', async () => {
    const world = install('curse-of-strahd');
    world.addActor({ id: 'a1', name: `${SWEEP_PREFIX} NPC` });

    await expect(liveSweep({ since: 1 })).rejects.toThrow(/only in the test world/);
    expect(world.actors.has('a1')).toBe(true);
  });

  it('refuses every mode outside the test world', async () => {
    install('curse-of-strahd');
    await expect(liveSweep({ mode: 'snapshot' })).rejects.toThrow(/only in the test world/);
    await expect(liveSweep({ mode: 'combat', tokenIds: ['t1'] })).rejects.toThrow(
      /only in the test world/
    );
  });

  it('runs in each listed test world and refuses any third world, ai-tool-kit included', async () => {
    expect(SWEEP_WORLD_IDS).toEqual(['ai-tool-test', 'ai-tool-walkthrough']);
    for (const id of SWEEP_WORLD_IDS) {
      install(id);
      await expect(liveSweep({ mode: 'snapshot' })).resolves.toMatchObject({ mode: 'snapshot' });
      restore?.();
      restore = undefined;
    }
    for (const id of ['ai-tool-kit', 'ai-tool-test-copy', '']) {
      install(id);
      await expect(liveSweep({ mode: 'snapshot' })).rejects.toThrow(/only in the test world/);
      restore?.();
      restore = undefined;
    }
  });

  it('keeps the same world list as the live scripts (scripts/test-worlds.mjs)', async () => {
    // @ts-expect-error plain JavaScript module outside the package, no type declarations
    const scripts = (await import('../../../scripts/test-worlds.mjs')) as {
      TEST_WORLDS: readonly string[];
      parseWorldArg: (argv: string[]) => string;
    };
    expect([...scripts.TEST_WORLDS]).toEqual([...SWEEP_WORLD_IDS]);
    expect(scripts.parseWorldArg([])).toBe(SWEEP_WORLD_ID);
    expect(scripts.parseWorldArg(['--world', 'ai-tool-walkthrough'])).toBe('ai-tool-walkthrough');
    expect(scripts.parseWorldArg(['--world=ai-tool-test'])).toBe('ai-tool-test');
    expect(() => scripts.parseWorldArg(['--world', 'ai-tool-kit'])).toThrow(
      /--world must be one of/
    );
    expect(() => scripts.parseWorldArg(['--world', 'curse-of-strahd'])).toThrow(/--world must/);
    expect(() => scripts.parseWorldArg(['--world'])).toThrow(/--world must/);
  });

  it('rejects an unknown mode', async () => {
    install(SWEEP_WORLD_ID);
    await expect(liveSweep({ mode: 'wipe' })).rejects.toThrow(/Unknown live sweep mode/);
  });

  it('snapshot reads the active scene lighting', async () => {
    const world = install(SWEEP_WORLD_ID);
    const scene = world.addScene({ id: 's1', name: 'Test Arena' });
    (scene as any).environment = { darknessLevel: 0.4, globalLight: { enabled: true } };
    world.setActiveScene('s1');

    expect(await liveSweep({ mode: 'snapshot' })).toEqual({
      mode: 'snapshot',
      sceneId: 's1',
      sceneName: 'Test Arena',
      darkness: 0.4,
      globalLight: true,
    });
  });

  it('deletes only documents named with the sweep prefix', async () => {
    const world = install(SWEEP_WORLD_ID);
    world.addActor({ id: 'a1', name: `${SWEEP_PREFIX} NPC` });
    world.addActor({ id: 'a2', name: 'Test Hero' });
    world.addItem({ id: 'i1', name: `${SWEEP_PREFIX} Item` });
    world.addItem({ id: 'i2', name: 'Longsword' });
    world.addJournal({ id: 'j1', name: `${SWEEP_PREFIX} Quest` });
    world.addJournal({ id: 'j2', name: 'Handouts' });

    const result = await liveSweep({});

    expect(world.actors.has('a1')).toBe(false);
    expect(world.actors.has('a2')).toBe(true);
    expect(world.items.has('i1')).toBe(false);
    expect(world.items.has('i2')).toBe(true);
    expect(world.journal.has('j1')).toBe(false);
    expect(world.journal.has('j2')).toBe(true);
    expect(result.deleted).toMatchObject({ actors: 1, items: 1, journal: 1 });
    expect(result.names).toContain(`Actor: ${SWEEP_PREFIX} NPC`);
  });

  it('deletes sweep tokens on every scene, not only the viewed one', async () => {
    const world = install(SWEEP_WORLD_ID);
    const arena = world.addScene({
      id: 's1',
      name: 'Test Arena',
      tokens: [
        makeToken({ id: 't1', name: `${SWEEP_PREFIX} Wolf` }),
        makeToken({ id: 't2', name: 'Wolf 1' }),
      ],
    });
    world.addScene({ id: 's2', name: 'Other' });
    world.setActiveScene('s2');

    const result = await liveSweep({});

    expect(arena.tokens.has('t1')).toBe(false);
    expect(arena.tokens.has('t2')).toBe(true);
    expect(result).toMatchObject({ deleted: { tokens: 1 } });
  });

  it('deletes chat messages created since the run started, only when asked', async () => {
    const world = install(SWEEP_WORLD_ID);
    world.addMessage({ id: 'm-old', _stats: { createdTime: 1_000 } });
    world.addMessage({ id: 'm-new', _stats: { createdTime: 5_000 } });

    await liveSweep({});
    expect(world.messages.has('m-new')).toBe(true);

    const result = await liveSweep({ since: 4_000 });
    expect(world.messages.has('m-old')).toBe(true);
    expect(world.messages.has('m-new')).toBe(false);
    expect(result.deleted.messages).toBe(1);
  });

  it('deletes sweep folders with their contents, last', async () => {
    const world = install(SWEEP_WORLD_ID);
    const calls: unknown[] = [];
    const folder = world.addFolder({ id: 'f1', name: `${SWEEP_PREFIX} (safe to delete)` });
    const plainDelete = folder.delete as () => Promise<unknown>;
    folder.delete = (options: unknown) => {
      calls.push(options);
      return plainDelete();
    };
    world.addFolder({ id: 'f2', name: 'Monsters' });

    const result = await liveSweep({});

    expect(calls).toEqual([{ deleteSubfolders: true, deleteContents: true }]);
    expect(world.folders.has('f1')).toBe(false);
    expect(world.folders.has('f2')).toBe(true);
    expect(result.deleted.folders).toBe(1);
  });
});
