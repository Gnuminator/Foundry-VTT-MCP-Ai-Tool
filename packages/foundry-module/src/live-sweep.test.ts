import { afterEach, describe, expect, it } from 'vitest';

import { createTestWorld, makeToken, type TestWorld } from './test-support/foundry-mock/index.js';
import { registerGuardedFeature, resetGuardedFeaturesForTests } from './guarded-features.js';
import { liveSweep, SWEEP_PREFIX, SWEEP_WORLD_ID, SWEEP_WORLD_IDS } from './live-sweep.js';

let restore: (() => void) | undefined;

function install(worldId: string): TestWorld {
  const world = createTestWorld({ worldId });
  restore = world.install();
  return world;
}

afterEach(() => {
  resetGuardedFeaturesForTests();
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
    const requests: object[] = [
      { mode: 'snapshot' },
      { mode: 'combat', tokenIds: ['t1'] },
      { mode: 'concentration', actorIds: ['a', 'b'] },
      { mode: 'switches', switches: { party: true } },
      { mode: 'fixture', kind: 'playlist' },
      { mode: 'fixture', kind: 'party', actorIds: [] },
      { mode: 'fixture', kind: 'handout' },
      { mode: 'playlist-state', id: 'p1' },
      { mode: 'cleanup', since: 1 },
      {},
      { mode: 'unknown-mode' },
    ];
    for (const request of requests) {
      await expect(liveSweep(request), JSON.stringify(request)).rejects.toThrow(
        /only in the test world/
      );
    }
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

  it('switches turns guarded features on or off and gives back what they were', async () => {
    const world = install(SWEEP_WORLD_ID);
    const g = globalThis as unknown as { game: { settings: { register: () => void } } };
    g.game.settings.register = (): void => undefined;
    registerGuardedFeature({ id: 'party', name: 'Party', hint: 'Test.' });
    registerGuardedFeature({ id: 'obsidian-mirror', name: 'Mirror', hint: 'Test.' });
    world.setSetting('foundry-mcp-bridge', 'feature.party.enabled', true);
    world.setSetting('foundry-mcp-bridge', 'feature.obsidian-mirror.enabled', false);

    const result = await liveSweep({
      mode: 'switches',
      switches: { party: false, 'obsidian-mirror': true },
    });

    expect(result).toEqual({
      mode: 'switches',
      before: { party: true, 'obsidian-mirror': false },
    });
    expect(world.settings.get('foundry-mcp-bridge.feature.party.enabled')).toBe(false);
    expect(world.settings.get('foundry-mcp-bridge.feature.obsidian-mirror.enabled')).toBe(true);
    await expect(liveSweep({ mode: 'switches', switches: {} })).rejects.toThrow(/switches needs/);
    await expect(liveSweep({ mode: 'switches', switches: { 'x/y': true } })).rejects.toThrow(
      /must be a feature id/
    );
    await expect(liveSweep({ mode: 'switches', switches: { party: 'yes' } })).rejects.toThrow(
      /true or false/
    );
  });

  it('switches reaches only feature.<id>.enabled and sets nothing when one id is bad', async () => {
    const world = install(SWEEP_WORLD_ID);
    const g = globalThis as unknown as { game: { settings: { register: () => void } } };
    g.game.settings.register = (): void => undefined;
    registerGuardedFeature({ id: 'party', name: 'Party', hint: 'Test.' });
    world.setSetting('foundry-mcp-bridge', 'feature.party.enabled', false);

    // A dotted id would reach feature.<id>.autoApply or another key.
    for (const id of ['party.enabled', 'x.autoApply', 'party.autoApply']) {
      await expect(liveSweep({ mode: 'switches', switches: { [id]: true } })).rejects.toThrow(
        /must be a feature id/
      );
    }
    // A known id first and an unregistered one after it: neither is set.
    await expect(
      liveSweep({ mode: 'switches', switches: { party: true, 'not-a-feature': true } })
    ).rejects.toThrow(/not a guarded feature/);
    expect(world.settings.get('foundry-mcp-bridge.feature.party.enabled')).toBe(false);
    expect(world.settings.has('foundry-mcp-bridge.feature.not-a-feature.enabled')).toBe(false);
  });

  it('switches refuses outside the test world', async () => {
    install('curse-of-strahd');
    await expect(liveSweep({ mode: 'switches', switches: { party: true } })).rejects.toThrow(
      /only in the test world/
    );
  });

  it('fixture refuses an unknown kind and playlist-state an unknown playlist', async () => {
    install(SWEEP_WORLD_ID);
    await expect(liveSweep({ mode: 'fixture', kind: 'castle' })).rejects.toThrow(/Unknown fixture/);
    await expect(liveSweep({ mode: 'playlist-state', id: 'nope' })).rejects.toThrow(
      /no playlist nope/
    );
  });

  it('cleanup closes the dialogs use-item left open on a sweep actor, and only those', async () => {
    install(SWEEP_WORLD_ID);
    const g = globalThis as unknown as { foundry?: unknown };
    const hadFoundry = g.foundry;
    const closed: string[] = [];
    const app = (id: string, actorName: string | null): object => ({
      item: actorName === null ? undefined : { actor: { name: actorName } },
      close: (): Promise<void> => {
        closed.push(id);
        return Promise.resolve();
      },
    });
    g.foundry = {
      applications: {
        instances: new Map([
          ['a', app('a', `${SWEEP_PREFIX} Wolf`)],
          ['b', app('b', 'Test Hero')],
          ['c', app('c', null)],
        ]),
      },
    };
    try {
      const result = await liveSweep({});
      expect(closed).toEqual(['a']);
      expect(result.deleted).toMatchObject({ dialogs: 1 });
    } finally {
      g.foundry = hadFoundry;
    }
  });

  it('cleanup goes on when an open application throws on its item getter', async () => {
    install(SWEEP_WORLD_ID);
    const g = globalThis as unknown as { foundry?: unknown };
    const hadFoundry = g.foundry;
    const closed: string[] = [];
    const broken = {
      get item(): never {
        throw new Error('half-rendered');
      },
      close: (): Promise<void> => Promise.resolve(),
    };
    const ours = {
      item: { actor: { name: `${SWEEP_PREFIX} Wolf` } },
      close: (): Promise<void> => {
        closed.push('ours');
        return Promise.resolve();
      },
    };
    g.foundry = {
      applications: {
        instances: new Map([
          ['x', broken],
          ['y', ours],
        ]),
      },
    };
    try {
      const result = await liveSweep({});
      expect(closed).toEqual(['ours']);
      expect(result.deleted).toMatchObject({ dialogs: 1 });
    } finally {
      g.foundry = hadFoundry;
    }
  });

  it('deletes sweep playlists with the other named documents', async () => {
    const world = install(SWEEP_WORLD_ID);
    const playlist = (id: string, name: string): never =>
      ({
        id,
        name,
        delete: () => {
          world.playlists.delete(id);
          return Promise.resolve();
        },
      }) as never;
    world.playlists.add(playlist('p1', `${SWEEP_PREFIX} Playlist`));
    world.playlists.add(playlist('p2', 'Tavern'));

    const result = await liveSweep({});

    expect(world.playlists.has('p1')).toBe(false);
    expect(world.playlists.has('p2')).toBe(true);
    expect(result.deleted).toMatchObject({ playlists: 1 });
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

  it('combat starts the way Combat#startCombat does, without calling it', async () => {
    const world = install(SWEEP_WORLD_ID);
    world.addScene({
      id: 's1',
      name: 'Test Arena',
      tokens: [makeToken({ id: 't1', name: `${SWEEP_PREFIX} Wolf` })],
    });
    world.setActiveScene('s1');
    const calls: string[] = [];
    const combat = {
      id: 'c1',
      createEmbeddedDocuments: (type: string, data: Record<string, unknown>[]): Promise<[]> => {
        calls.push(`${type} ${data.map(d => d.tokenId).join(',')}`);
        return Promise.resolve([]);
      },
      update: (data: Record<string, unknown>): Promise<unknown> => {
        calls.push(`update ${JSON.stringify(data)}`);
        return Promise.resolve(combat);
      },
      // Modules wrap this with a confirm dialog (Monk's Combat Details); the helper must not call it.
      startCombat: (): Promise<never> => Promise.reject(new Error('startCombat called')),
    };
    const g = globalThis as any;
    g.CONFIG.Combat = {
      documentClass: { create: (): Promise<typeof combat> => Promise.resolve(combat) },
    };
    g.Hooks.on('combatStart', (c: unknown, data: unknown): void => {
      calls.push(`hook ${c === combat} ${JSON.stringify(data)}`);
    });

    const result = await liveSweep({ mode: 'combat', tokenIds: ['t1'] });

    expect(result).toEqual({
      mode: 'combat',
      combatId: 'c1',
      combatants: [`${SWEEP_PREFIX} Wolf`],
    });
    expect(calls).toEqual([
      'Combatant t1',
      'hook true {"round":1,"turn":0}',
      'update {"round":1,"turn":0}',
    ]);
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
    folder.delete = (options: unknown): Promise<unknown> => {
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
