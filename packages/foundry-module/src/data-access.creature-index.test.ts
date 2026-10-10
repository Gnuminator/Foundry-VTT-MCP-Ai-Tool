/**
 * Characterization tests for `PersistentCreatureIndex` (the creature-index
 * domain), driven through the Phase 9 Foundry-mock harness.
 *
 * Unlike the other data-access domains, this is a standalone class — the
 * `compendium` domain injects an instance of it for its enhanced fast path.
 * It is instantiated directly here (`new PersistentCreatureIndex()`; the ctor
 * takes no args and only registers Foundry hooks).
 *
 * These pin the *current* observable behaviour so the Phase 9 from-scratch
 * rewrite can be verified to parity. The assertions are the spec.
 *
 * Storage model the class uses (NOT settings/flags — it is file-based):
 *   - `(game as any).system.id`, `game.world.id`, `game.packs`, `ui.notifications`,
 *     `Hooks`, `game.settings.get(module,'autoRebuildIndex')` — all supplied by
 *     the harness.
 *   - `foundry.applications.apps.FilePicker.implementation.browse/upload` — NOT in
 *     the harness (its `foundry` only carries `.utils`), so we attach a stub
 *     `foundry.applications` locally AFTER install (the whole `foundry` global is
 *     saved/restored by the harness, so this never leaks).
 *   - `globalThis.fetch` — used to read the index file (GET); stubbed locally
 *     with `vi.fn` and restored. (Foundry's server ignores DELETE, so the module
 *     marks the index stale with the `creatureIndexDirtyAt` world setting.)
 *   - `File` / `btoa` — real Node globals; used as-is.
 *
 * A tiny in-memory "disk" wires `upload` (writes) to `fetch`/`browse` (reads) so
 * the persistence round-trip can be characterized end to end.
 *
 * HARNESS GAP worked around locally (never editing the shared harness): the
 * harness's `ui.notifications.info` returns the array length (a number), but the
 * build path captures its return value as a progress notification and calls
 * `.remove()` on it. We replace `ui.notifications` after install with stubs that
 * return a removable `{ remove() }` object (the whole `ui` global is restored on
 * teardown). This is purely to let the build path run; the notification *text* is
 * not part of what we pin.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeActor,
  makeItem,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import {
  BUILD_RETRY_COOLDOWN_MS,
  DIRTY_STAMP_DEBOUNCE_MS,
  nextChunkSize,
  PACK_LOAD_CHUNK_SIZE,
  PACK_LOAD_CHUNK_TARGET_MS,
  PACK_LOAD_MAX_CHUNK,
  PACK_LOAD_MIN_CHUNK,
  PersistentCreatureIndex,
} from './data-access/creature-index.js';

let world: TestWorld;
let restore: () => void;
let savedFetch: typeof globalThis.fetch | undefined;

/**
 * In-memory stand-in for the world data directory. `upload` writes the most
 * recent index file content; `browse`/`fetch` read it back. A test can pre-seed
 * `disk.content` to simulate an already-persisted index.
 */
interface FakeDisk {
  /** Raw JSON text of the persisted index file, or null when no file exists. */
  content: string | null;
  /** Make `browse` throw (directory missing / error path). */
  browseThrows: boolean;
  /** Make the next `fetch` GET return a non-ok response. */
  fetchNotOk: boolean;
  /** Record of fetch calls: [url, init?]. */
  fetchCalls: Array<{ url: string; init?: any }>;
  /** Record of upload calls: the uploaded File objects. */
  uploads: File[];
}

let disk: FakeDisk;

const MODULE = 'foundry-mcp-bridge';

/** Spy on `game.settings.set` (it still stores the value); see {@link stampWrites}. */
let settingsSet: any;

const INDEX_FILENAME = 'enhanced-creature-index.json';

/** Install the FilePicker + fetch + notification stubs against the shared `disk`. */
function installStorageStubs(): void {
  const g = globalThis as any;

  // Replace ui.notifications with stubs returning a removable notification object
  // (the build path holds onto the return value and calls `.remove()` on it).
  const makeNote = (): { remove: () => undefined } => ({ remove: () => undefined });
  g.ui = {
    notifications: {
      info: (m: string): ReturnType<typeof makeNote> => {
        world.notifications.push({ level: 'info', message: m });
        return makeNote();
      },
      warn: (m: string): ReturnType<typeof makeNote> => {
        world.notifications.push({ level: 'warn', message: m });
        return makeNote();
      },
      error: (m: string): ReturnType<typeof makeNote> => {
        world.notifications.push({ level: 'error', message: m });
        return makeNote();
      },
    },
  };

  // FilePicker lives under foundry.applications.apps — attach it onto the
  // harness-provided `foundry` global (restored wholesale on teardown).
  g.foundry.applications = {
    apps: {
      FilePicker: {
        implementation: {
          browse: vi.fn(async (_source: string, _target: string) => {
            if (disk.browseThrows) throw new Error('browse failed: no such directory');
            return {
              files: disk.content !== null ? [`worlds/${g.game.world.id}/${INDEX_FILENAME}`] : [],
            };
          }),
          upload: vi.fn(async (_source: string, _target: string, file: File) => {
            disk.uploads.push(file);
            disk.content = await file.text();
            return { path: `worlds/${g.game.world.id}/${INDEX_FILENAME}`, status: 'success' };
          }),
        },
      },
    },
  };

  savedFetch = g.fetch;
  g.fetch = vi.fn(async (url: string, init?: any) => {
    disk.fetchCalls.push({ url, init });
    // GET (load path)
    if (disk.fetchNotOk || disk.content === null) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const text = disk.content;
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  disk = {
    content: null,
    browseThrows: false,
    fetchNotOk: false,
    fetchCalls: [],
    uploads: [],
  };
  installStorageStubs();
  // The dirty stamp starts at 0 (never dirty); every settings write is recorded.
  world.setSetting(MODULE, 'creatureIndexDirtyAt', 0);
  settingsSet = vi.spyOn((globalThis as any).game.settings, 'set');
});

afterEach(() => {
  // Restore the real fetch (foundry/game/etc. are restored by the harness).
  if (savedFetch === undefined) delete (globalThis as any).fetch;
  else (globalThis as any).fetch = savedFetch;
  savedFetch = undefined;
  restore();
  vi.restoreAllMocks();
});

/** The `creatureIndexDirtyAt` values written through `game.settings.set`, in order. */
function stampWrites(): unknown[] {
  return settingsSet.mock.calls
    .filter((c: unknown[]) => c[0] === MODULE && c[1] === 'creatureIndexDirtyAt')
    .map((c: unknown[]) => c[2]);
}

/** Add an Actor pack of monsters and return it. */
function addMonsterPack(documents: any[], id = 'world.monsters', label = 'Monsters'): any {
  return world.addPack({ id, label, type: 'Actor', documents });
}

// ===========================================================================
// constructor — hook registration
// ===========================================================================

describe('PersistentCreatureIndex — constructor', () => {
  it('constructs without throwing and registers Foundry hooks', () => {
    const onSpy = vi.spyOn((globalThis as any).Hooks, 'on');
    const index = new PersistentCreatureIndex();
    expect(index).toBeInstanceOf(PersistentCreatureIndex);
    // Registers Foundry 14's pack-change hook.
    const hookNames = onSpy.mock.calls.map(c => c[0]);
    expect(hookNames).toContain('updateCompendium');
  });
});

// ===========================================================================
// buildEnhancedIndex (via rebuildIndex) — system routing + extraction
// ===========================================================================

describe('PersistentCreatureIndex — rebuildIndex / build (dnd5e)', () => {
  it('builds an index from Actor packs and returns one record per npc/character', async () => {
    addMonsterPack([
      makeActor({ id: 'g1', name: 'Goblin', type: 'npc' }),
      makeActor({ id: 'h1', name: 'Hero', type: 'character' }),
      // dnd5e 6 actor types that are not creatures are skipped by extractDnD5eDataFromPack
      makeActor({ id: 'v1', name: 'Vehicle', type: 'vehicle' }),
      makeActor({ id: 'p1', name: 'Party', type: 'group' }),
    ]);

    const index = new PersistentCreatureIndex();
    const creatures = await index.rebuildIndex();

    const names = creatures.map(c => c.name).sort();
    expect(names).toEqual(['Goblin', 'Hero']);
  });

  it('ignores non-Actor packs entirely', async () => {
    world.addPack({
      id: 'world.items',
      label: 'Items',
      type: 'Item',
      documents: [makeActor({ id: 'i1', name: 'Sword', type: 'weapon' })],
    });

    const index = new PersistentCreatureIndex();
    const creatures = await index.rebuildIndex();

    expect(creatures).toEqual([]);
  });

  it('returns an empty array (and still persists) when there are no Actor packs', async () => {
    const index = new PersistentCreatureIndex();
    const creatures = await index.rebuildIndex();

    expect(creatures).toEqual([]);
    // The build always persists, even an empty index.
    expect(disk.uploads).toHaveLength(1);
    expect(disk.content).not.toBeNull();
  });

  it('throws for a non-dnd5e system (only dnd5e is supported)', async () => {
    restore();
    world = createTestWorld({ systemId: 'pf2e' });
    restore = world.install();
    installStorageStubs();
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await expect(index.rebuildIndex()).rejects.toThrow(
      'Enhanced creature index is only supported for D&D 5e'
    );
  });

  it('extracts the full dnd5e creature shape with rich CR/type/size/hp/ac/alignment', async () => {
    // NOTE: the extractor reads `doc._id` (the canonical Foundry id field), NOT
    // `doc.id`. `makeActor` only sets `id`, so `_id` is passed through explicitly
    // here to characterize a populated `id` in the output record.
    addMonsterPack([
      makeActor({
        id: 'drag1',
        _id: 'drag1',
        name: 'Ancient Red Dragon',
        type: 'npc',
        img: 'dragon.webp',
        system: {
          details: {
            cr: 24,
            type: { value: 'Dragon' },
            alignment: 'Chaotic Evil',
            biography: { value: '<p>A terrifying wyrm.</p>', public: '' }, // dnd5e 6 shape
          },
          traits: { size: 'GARGANTUAN' },
          attributes: { hp: { max: 546 }, ac: { value: 22 }, spellcasting: 'cha' },
          resources: { legact: { max: 3, value: 3, spent: 0 } },
        },
        items: [makeItem({ id: 'fb', name: 'Fireball', type: 'spell' })],
      }),
    ]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    expect(c).toMatchObject({
      id: 'drag1',
      name: 'Ancient Red Dragon',
      type: 'npc',
      pack: 'world.monsters',
      packLabel: 'Monsters',
      challengeRating: 24,
      creatureType: 'dragon', // lower-cased
      size: 'gargantuan', // lower-cased (raw value was the display word, not the dnd5e key)
      hitPoints: 546,
      armorClass: 22,
      hasSpells: true, // it has a spell item (the casting ability alone does not count)
      hasLegendaryActions: true, // resources.legact.max > 0
      alignment: 'chaotic evil', // lower-cased
      description: 'A terrifying wyrm.', // the biography's value as plain text, not the object
      img: 'dragon.webp',
    });
  });

  it('reads fractional CRs as dnd5e 6 stores them (NumberField: 0.125, 0.25, 0.5)', async () => {
    addMonsterPack([
      makeActor({ id: 'a', name: 'Eighth', type: 'npc', system: { details: { cr: 0.125 } } }),
      makeActor({ id: 'b', name: 'Quarter', type: 'npc', system: { details: { cr: 0.25 } } }),
      makeActor({ id: 'c', name: 'Half', type: 'npc', system: { details: { cr: 0.5 } } }),
      makeActor({ id: 'd', name: 'Unset', type: 'npc', system: { details: { cr: null } } }),
    ]);

    const index = new PersistentCreatureIndex();
    const byName = Object.fromEntries((await index.rebuildIndex()).map(c => [c.name, c]));

    expect(byName['Eighth'].challengeRating).toBe(0.125);
    expect(byName['Quarter'].challengeRating).toBe(0.25);
    expect(byName['Half'].challengeRating).toBe(0.5);
    expect(byName['Unset'].challengeRating).toBe(0);
  });

  it('applies defaults for a bare creature (no system fields)', async () => {
    addMonsterPack([makeActor({ id: 'blob', name: 'Blob', type: 'npc', system: {} })]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    expect(c).toMatchObject({
      challengeRating: 0,
      creatureType: 'unknown',
      size: 'med', // dnd5e's own storage key, not the display word 'medium'
      hitPoints: 0,
      armorClass: 10,
      hasSpells: false,
      hasLegendaryActions: false,
      alignment: 'unaligned',
      description: '',
    });
  });

  it('detects spells via a nonzero system.spells slot (prepared max) and legendary via resources.legact.max', async () => {
    addMonsterPack([
      makeActor({
        id: 'caster',
        name: 'Caster',
        type: 'npc',
        system: {
          spells: { spell1: { value: 0, override: null, max: 4 } },
          resources: { legact: { max: 3, spent: 0 } },
        },
      }),
    ]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    expect(c.hasSpells).toBe(true);
    expect(c.hasLegendaryActions).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Regression coverage for the pre-existing hasSpells/hasLegendaryActions
  // "always true" bug (plan `creature-index.ts:520-535`): both dnd5e 5.3 and
  // 6.0 always populate `system.spells` (fixed level map) and
  // `system.resources.legact` (fixed {max, spent} container) on every NPC, so
  // testing mere presence of those containers used to report every creature
  // as a caster with legendary actions.
  // -------------------------------------------------------------------------

  it('hasSpells is false for a non-caster NPC with dnd5e 6.0-shaped zeroed spell slots and a blank spellcasting ability', async () => {
    addMonsterPack([
      makeActor({
        id: 'goblin',
        name: 'Goblin',
        type: 'npc',
        system: {
          attributes: { spellcasting: '' }, // blank StringField — the dnd5e default for non-casters
          spells: {
            spell1: { value: 0, override: null },
            spell2: { value: 0, override: null },
            pact: { value: 0, override: null },
          },
        },
      }),
    ]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    expect(c.hasSpells).toBe(false);
  });

  it('hasSpells follows spell items, not the casting ability (dnd5e 6 2024 monsters, seen live)', async () => {
    // In `dnd5e.actors24` every NPC has a casting ability (a Wolf has "str"),
    // and casters like the Mage cast from spell items with no slots.
    addMonsterPack([
      makeActor({
        id: 'mage',
        name: 'Mage',
        type: 'npc',
        system: {
          attributes: { spellcasting: 'int' },
          spells: { spell1: { value: 0, override: null } },
        },
        items: [makeItem({ id: 'mm', name: 'Magic Missile', type: 'spell' })],
      }),
      makeActor({
        id: 'wolf24',
        name: 'Wolf',
        type: 'npc',
        system: {
          attributes: { spellcasting: 'str' },
          spells: { spell1: { value: 0, override: null } },
        },
        items: [makeItem({ id: 'bite', name: 'Bite', type: 'weapon' })],
      }),
    ]);

    const index = new PersistentCreatureIndex();
    const byName = Object.fromEntries((await index.rebuildIndex()).map(c => [c.name, c]));

    expect(byName['Mage'].hasSpells).toBe(true);
    expect(byName['Wolf'].hasSpells).toBe(false);
  });

  it('hasLegendaryActions is false for a non-legendary NPC with dnd5e 6.0-shaped resources.legact.max: 0', async () => {
    addMonsterPack([
      makeActor({
        id: 'wolf',
        name: 'Wolf',
        type: 'npc',
        system: {
          resources: { legact: { max: 0, spent: 0 }, legres: { max: 0, spent: 0 } },
        },
      }),
    ]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    expect(c.hasLegendaryActions).toBe(false);
  });

  it('hasLegendaryActions is false when only legendary RESISTANCE (legres) is set, not legendary actions', async () => {
    addMonsterPack([
      makeActor({
        id: 'devil',
        name: 'Pit Fiend',
        type: 'npc',
        system: {
          resources: { legact: { max: 0, spent: 0 }, legres: { max: 3, spent: 0 } },
        },
      }),
    ]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    expect(c.hasLegendaryActions).toBe(false);
  });

  it('hasLegendaryActions is true for dnd5e 6.0-shaped resources.legact.max > 0', async () => {
    addMonsterPack([
      makeActor({
        id: 'lich',
        name: 'Lich',
        type: 'npc',
        system: {
          resources: { legact: { max: 3, spent: 1 } },
        },
      }),
    ]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    expect(c.hasLegendaryActions).toBe(true);
  });

  it('reads the canonical _id field — id is undefined when only `id` (not `_id`) is set', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    // The extractor reads `doc._id`; makeActor sets only `id`, so id comes out undefined.
    expect(c.id).toBeUndefined();
    expect(c.name).toBe('Goblin');
  });

  it('falls back to a basic record (description "Data extraction failed") when extraction throws', async () => {
    // Force the extractor's try/catch: a getter on `system.details` that throws.
    // (`makePack`'s index builder only touches `system.description`, so this does
    // not blow up at pack-build time — only when the extractor reads `details`.)
    const broken = makeActor({ id: 'bad', _id: 'bad', name: 'Broken', type: 'npc', img: 'b.webp' });
    Object.defineProperty(broken.system, 'details', {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    addMonsterPack([broken]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    // Fallback record keeps the creature (does not drop it) with safe defaults.
    expect(c).toMatchObject({
      id: 'bad',
      name: 'Broken',
      type: 'npc',
      challengeRating: 0,
      creatureType: 'unknown',
      size: 'med',
      hitPoints: 1, // fallback HP is 1, not 0
      armorClass: 10,
      description: 'Data extraction failed',
      img: 'b.webp',
    });
  });

  it('continues past a pack whose getDocuments throws, indexing the others', async () => {
    const goodPack = addMonsterPack(
      [makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })],
      'world.good',
      'Good'
    );
    const badPack = addMonsterPack([], 'world.bad', 'Bad');
    // Force the bad pack's document load to throw (caught per-pack).
    badPack.getDocuments = async () => {
      throw new Error('pack load failed');
    };
    void goodPack;

    const index = new PersistentCreatureIndex();
    const creatures = await index.rebuildIndex();

    expect(creatures.map(c => c.name)).toEqual(['Goblin']);
  });

  it('loads a pack in chunks of creature ids, never the whole pack in one call', async () => {
    const monsters = Array.from({ length: 120 }, (_, i) =>
      makeActor({ id: `m${i}`, name: `Monster ${i}`, type: 'npc' })
    );
    const cart = makeActor({ id: 'v1', name: 'Cart', type: 'vehicle' });
    const pack = addMonsterPack([...monsters, cart]);
    // Each creature takes 10 ms to load: the chunk grows to the 25 that fit 250 ms.
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const load = pack.getDocuments;
    const getDocuments = vi.fn(async (query: { _id__in: string[] }): Promise<unknown> => {
      clock += 10 * query._id__in.length;
      return load(query);
    });
    pack.getDocuments = getDocuments;

    const creatures = await new PersistentCreatureIndex().rebuildIndex();

    expect(creatures).toHaveLength(120);
    const queries = getDocuments.mock.calls.map(c => c[0]._id__in);
    expect(PACK_LOAD_CHUNK_SIZE).toBe(5);
    expect(PACK_LOAD_CHUNK_TARGET_MS).toBe(250);
    expect(queries.map(ids => ids.length)).toEqual([5, 10, 20, 25, 25, 25, 10]);
    expect(new Set(queries.flat()).size).toBe(120);
    // The pack index says the cart is no creature: it is never loaded.
    expect(queries.flat()).not.toContain('v1');
  });

  it('chunks grow on a fast PC and shrink on a slow one', async () => {
    const pack = addMonsterPack(
      Array.from({ length: 300 }, (_, i) =>
        makeActor({ id: `m${i}`, name: `Monster ${i}`, type: 'npc' })
      )
    );
    let clock = 0;
    let msPerCreature = 1;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const load = pack.getDocuments;
    const sizes: number[] = [];
    pack.getDocuments = async (query: { _id__in: string[] }): Promise<unknown> => {
      sizes.push(query._id__in.length);
      // The PC gets busy from the fourth chunk on.
      if (sizes.length === 4) msPerCreature = 50;
      clock += msPerCreature * query._id__in.length;
      return load(query);
    };

    await new PersistentCreatureIndex().rebuildIndex();

    // 5, doubling at 1 ms each; 40 at 50 ms each took 2 s, so the rest goes in
    // the smallest chunks (5 at 50 ms is the 250 ms target).
    expect(sizes).toEqual([5, 10, 20, 40, ...Array(45).fill(PACK_LOAD_MIN_CHUNK)]);
  });

  it('each pack starts at the first chunk size again, not at the last pack size', async () => {
    const light = addMonsterPack(
      Array.from({ length: 100 }, (_, i) =>
        makeActor({ id: `l${i}`, name: `Light ${i}`, type: 'npc' })
      ),
      'world.light',
      'Light'
    );
    const heavy = addMonsterPack(
      Array.from({ length: 10 }, (_, i) =>
        makeActor({ id: `h${i}`, name: `Heavy ${i}`, type: 'npc' })
      ),
      'world.heavy',
      'Heavy'
    );
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const sizes: Record<string, number[]> = { light: [], heavy: [] };
    for (const [name, pack] of [
      ['light', light],
      ['heavy', heavy],
    ] as const) {
      const load = pack.getDocuments;
      pack.getDocuments = async (query: { _id__in: string[] }): Promise<unknown> => {
        sizes[name].push(query._id__in.length);
        return load(query);
      };
    }

    await new PersistentCreatureIndex().rebuildIndex();

    // The light pack grew to 40 per chunk; the heavy one still starts at 5.
    expect(sizes.light).toEqual([5, 10, 20, 40, 25]);
    expect(sizes.heavy).toEqual([PACK_LOAD_CHUNK_SIZE, 5]);
  });

  it('yields to the browser after every chunk', async () => {
    const pack = addMonsterPack(
      Array.from({ length: 60 }, (_, i) =>
        makeActor({ id: `m${i}`, name: `Monster ${i}`, type: 'npc' })
      )
    );
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const order: string[] = [];
    const load = pack.getDocuments;
    pack.getDocuments = async (query: unknown): Promise<unknown> => {
      order.push('load');
      return load(query);
    };
    const g = globalThis as { scheduler?: unknown };
    g.scheduler = { yield: async (): Promise<void> => void order.push('yield') };
    try {
      await new PersistentCreatureIndex().rebuildIndex();
    } finally {
      delete g.scheduler;
    }

    // 5, 10, 20, then the 25 left (no time passes, so the chunk size doubles).
    expect(order).toEqual(['load', 'yield', 'load', 'yield', 'load', 'yield', 'load', 'yield']);
  });

  it('in a hidden page, loads the biggest chunks and does not yield', async () => {
    const pack = addMonsterPack(
      Array.from({ length: 120 }, (_, i) =>
        makeActor({ id: `m${i}`, name: `Monster ${i}`, type: 'npc' })
      )
    );
    const getDocuments = vi.spyOn(pack, 'getDocuments');
    const yields = vi.fn(async (): Promise<void> => undefined);
    const g = globalThis as { scheduler?: unknown; document?: unknown };
    g.scheduler = { yield: yields };
    g.document = { hidden: true };
    try {
      expect(await new PersistentCreatureIndex().rebuildIndex()).toHaveLength(120);
    } finally {
      delete g.scheduler;
      delete g.document;
    }

    const sizes = getDocuments.mock.calls.map(c => (c[0] as { _id__in: string[] })._id__in.length);
    expect(sizes).toEqual([PACK_LOAD_MAX_CHUNK, 20]);
    expect(yields).not.toHaveBeenCalled();
  });

  it('shows progress within a big pack, at most once a second', async () => {
    const pack = addMonsterPack(
      Array.from({ length: 120 }, (_, i) =>
        makeActor({ id: `m${i}`, name: `Monster ${i}`, type: 'npc' })
      )
    );
    vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const load = pack.getDocuments;
      pack.getDocuments = async (query: unknown): Promise<unknown> => {
        // Every chunk takes 0.6 s.
        vi.setSystemTime(Date.now() + 600);
        return load(query);
      };

      await new PersistentCreatureIndex().rebuildIndex();
    } finally {
      vi.useRealTimers();
    }

    const progress = world.notifications
      .map(n => n.message)
      .filter(m => m.includes('creatures loaded'));
    // Chunks of 5, 10, 20, 40 and 45: 15 loaded after 1.2 s, 35 too soon after
    // that, 75 at 2.4 s, and the last chunk ends the pack (the per-pack note follows).
    expect(progress).toEqual([
      'Building creature index... pack 1/1 (Monsters): 15/120 creatures loaded',
      'Building creature index... pack 1/1 (Monsters): 75/120 creatures loaded',
    ]);
  });

  it('a chunk that fails to load drops only its own creatures', async () => {
    const pack = addMonsterPack(
      Array.from({ length: 120 }, (_, i) =>
        makeActor({ id: `m${i}`, name: `Monster ${i}`, type: 'npc' })
      )
    );
    // No time passes: chunks of 5, 10, 20, 40 and 45.
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const load = pack.getDocuments;
    let calls = 0;
    pack.getDocuments = async (query: unknown): Promise<unknown> => {
      calls++;
      if (calls === 2) throw new Error('chunk lost');
      return load(query);
    };

    const creatures = await new PersistentCreatureIndex().rebuildIndex();

    expect(calls).toBe(5);
    expect(creatures).toHaveLength(110);
    expect(creatures.map(c => c.name)).not.toContain('Monster 5');
  });

  it('nextChunkSize fits the target time, grows at most twofold, within the bounds', () => {
    expect(nextChunkSize(25, 250)).toBe(25);
    expect(nextChunkSize(25, 500)).toBe(12);
    expect(nextChunkSize(25, 100)).toBe(50);
    expect(nextChunkSize(25, 0)).toBe(50);
    expect(nextChunkSize(80, 10)).toBe(PACK_LOAD_MAX_CHUNK);
    expect(nextChunkSize(25, 60_000)).toBe(PACK_LOAD_MIN_CHUNK);
  });

  it('calls getIndex when a pack is not yet indexed', async () => {
    const pack = addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    pack.indexed = false;
    const getIndexSpy = vi.spyOn(pack, 'getIndex');

    const index = new PersistentCreatureIndex();
    await index.rebuildIndex();

    expect(getIndexSpy).toHaveBeenCalled();
  });
});

// ===========================================================================
// persistence round-trip + savePersistedIndex shape
// ===========================================================================

describe('PersistentCreatureIndex — persistence', () => {
  it('uploads the index as a JSON File named enhanced-creature-index.json', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await index.rebuildIndex();

    expect(disk.uploads).toHaveLength(1);
    const file = disk.uploads[0];
    expect(file.name).toBe(INDEX_FILENAME);
    expect(file.type).toBe('application/json');
  });

  it('serializes packFingerprints as an array of [id, fingerprint] entries (Map → array)', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await index.rebuildIndex();

    const saved = JSON.parse(disk.content!);
    expect(saved.metadata.version).toBe('1.2.0');
    expect(saved.metadata.gameSystem).toBe('dnd5e');
    expect(saved.metadata.totalCreatures).toBe(1);
    // Map serialized to entries array.
    expect(Array.isArray(saved.metadata.packFingerprints)).toBe(true);
    expect(saved.metadata.packFingerprints[0][0]).toBe('world.monsters');
    expect(saved.metadata.packFingerprints[0][1]).toMatchObject({
      packId: 'world.monsters',
      packLabel: 'Monsters',
      documentCount: 1,
    });
    expect(saved.creatures).toHaveLength(1);
    expect(saved.creatures[0].name).toBe('Goblin');
  });

  it('getEnhancedIndex returns the persisted creatures without rebuilding when the index is valid', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    // First call builds + persists.
    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex();
    const uploadsAfterBuild = disk.uploads.length;
    expect(uploadsAfterBuild).toBe(1);

    // Second call should load from disk (no new upload).
    const second = await index.getEnhancedIndex();
    expect(second.map(c => c.name)).toEqual(['Goblin']);
    expect(disk.uploads.length).toBe(uploadsAfterBuild); // no rebuild
  });

  it('round-trips the packFingerprints Map back to a Map on load', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex(); // build + persist

    // Loading again (in a fresh instance: the builder serves its copy in memory) exercises the
    // array → Map conversion + isIndexValid (which calls .get on the Map). A successful valid
    // load proves the Map was rebuilt.
    const second = await new PersistentCreatureIndex().getEnhancedIndex();
    expect(second).toHaveLength(1);
    // browse + a GET fetch happened on the load path.
    expect(disk.fetchCalls.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// loadPersistedIndex — null/empty paths
// ===========================================================================

describe('PersistentCreatureIndex — load failure paths force a rebuild', () => {
  it('rebuilds when browse throws (directory missing) — load returns null', async () => {
    disk.browseThrows = true;
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    const creatures = await index.getEnhancedIndex();

    // No cached file readable → build path runs and persists.
    expect(creatures.map(c => c.name)).toEqual(['Goblin']);
    expect(disk.uploads.length).toBeGreaterThanOrEqual(1);
  });

  it('rebuilds when no index file exists in the world directory', async () => {
    // disk.content stays null → browse reports no files.
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    const creatures = await index.getEnhancedIndex();

    expect(creatures.map(c => c.name)).toEqual(['Goblin']);
    expect(disk.uploads.length).toBe(1);
  });

  it('rebuilds when the index file fetch returns a non-ok response', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    // Pretend a file exists (so browse reports it) but fetch fails.
    disk.content = 'PLACEHOLDER';
    disk.fetchNotOk = true;

    const index = new PersistentCreatureIndex();
    const creatures = await index.getEnhancedIndex();

    expect(creatures.map(c => c.name)).toEqual(['Goblin']);
    // A rebuild persisted a fresh file.
    expect(disk.uploads.length).toBe(1);
  });
});

// ===========================================================================
// isIndexValid — staleness invalidation (forces rebuild on next getEnhancedIndex)
// ===========================================================================

describe('PersistentCreatureIndex — index validity / staleness', () => {
  /** Seed a persisted index whose JSON we control, then read it back. */
  async function seedAndCount(): Promise<PersistentCreatureIndex> {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex(); // build + persist a valid index
    disk.uploads.length = 0; // reset upload counter for the next assertion
    // A fresh instance (another GM browser, or after a reload) reads the file the test edits;
    // the builder's own instance serves its current copy in memory.
    return new PersistentCreatureIndex();
  }

  it('treats a same-state index as valid (no rebuild on the second read)', async () => {
    const index = await seedAndCount();
    await index.getEnhancedIndex();
    expect(disk.uploads.length).toBe(0); // valid → no rebuild
  });

  it('invalidates (rebuilds) when the persisted version differs', async () => {
    const index = await seedAndCount();
    const saved = JSON.parse(disk.content!);
    saved.metadata.version = '0.0.1-old';
    disk.content = JSON.stringify(saved);

    await index.getEnhancedIndex();
    expect(disk.uploads.length).toBe(1); // stale version → rebuild
  });

  it('invalidates (rebuilds) when the persisted gameSystem differs from the current system', async () => {
    const index = await seedAndCount();
    const saved = JSON.parse(disk.content!);
    saved.metadata.gameSystem = 'pf2e';
    disk.content = JSON.stringify(saved);

    await index.getEnhancedIndex();
    expect(disk.uploads.length).toBe(1);
  });

  it('invalidates (rebuilds) when a currently-loaded Actor pack has no saved fingerprint', async () => {
    const index = await seedAndCount();
    // Add a brand-new pack the persisted index never fingerprinted.
    addMonsterPack(
      [makeActor({ id: 'o1', name: 'Orc', type: 'npc' })],
      'world.new-monsters',
      'New Monsters'
    );

    await expect(index.ensureIndexCurrent()).resolves.toEqual({
      rebuilt: true,
      totalCreatures: 2,
    });
    expect(disk.uploads.length).toBe(1);
  });

  it('invalidates (rebuilds) when the saved fingerprint mismatches the live pack', async () => {
    const index = await seedAndCount();
    // Corrupt the persisted fingerprint so it no longer matches the live pack
    // (fingerprintsMatch compares documentCount + checksum).
    const saved = JSON.parse(disk.content!);
    saved.metadata.packFingerprints[0][1].documentCount = 999;
    saved.metadata.packFingerprints[0][1].checksum = 'STALECHECKSUM!!!';
    disk.content = JSON.stringify(saved);

    await expect(index.ensureIndexCurrent()).resolves.toMatchObject({ rebuilt: true });
    expect(disk.uploads.length).toBe(1); // mismatch → rebuild
  });

  it('invalidates (rebuilds) when a saved pack no longer exists', async () => {
    const index = await seedAndCount();
    // Remove the pack the persisted index fingerprinted.
    world.packs.delete('world.monsters');

    // With no Actor packs left, the rebuild produces an empty index but still
    // persists — the point is that the stale index was rejected (rebuild ran).
    await expect(index.ensureIndexCurrent()).resolves.toEqual({ rebuilt: true, totalCreatures: 0 });
    expect(disk.uploads.length).toBe(1);
  });

  it('is not valid when a creature changed after the build started (creatureIndexDirtyAt)', async () => {
    const index = await seedAndCount();
    const saved = JSON.parse(disk.content!);
    saved.metadata.dirtyStamp = 1_000;
    disk.content = JSON.stringify(saved);
    world.setSetting(MODULE, 'creatureIndexDirtyAt', 2_000);

    await expect(index.ensureIndexCurrent()).resolves.toMatchObject({ rebuilt: true });
    expect(disk.uploads.length).toBe(1);
  });

  it('is valid when the build saw the last creature change (no rebuild)', async () => {
    const index = await seedAndCount();
    const saved = JSON.parse(disk.content!);
    saved.metadata.dirtyStamp = 2_000;
    disk.content = JSON.stringify(saved);
    world.setSetting(MODULE, 'creatureIndexDirtyAt', 2_000);

    await expect(index.ensureIndexCurrent()).resolves.toMatchObject({ rebuilt: false });
    expect(disk.uploads.length).toBe(0);
  });

  it('is not valid for a saved index without dirtyStamp (an older file) once any change is stamped', async () => {
    const index = await seedAndCount();
    const saved = JSON.parse(disk.content!);
    delete saved.metadata.dirtyStamp;
    disk.content = JSON.stringify(saved);
    world.setSetting(MODULE, 'creatureIndexDirtyAt', 1);

    await expect(index.ensureIndexCurrent()).resolves.toMatchObject({ rebuilt: true });
  });

  it('getEnhancedIndex serves a stale-but-usable saved index at once and starts one background build', async () => {
    const index = await seedAndCount();
    const saved = JSON.parse(disk.content!);
    saved.creatures[0].name = 'Stale Goblin';
    saved.metadata.packFingerprints[0][1].documentCount = 999; // pack changed
    disk.content = JSON.stringify(saved);

    const first = await index.getEnhancedIndex();
    expect(first.map(c => c.name)).toEqual(['Stale Goblin']); // the stale copy, not waiting
    // A second read while the build runs still serves the saved copy and starts no second build.
    const second = await index.getEnhancedIndex();
    expect(second.map(c => c.name)).toEqual(['Stale Goblin']);

    await vi.waitFor(() => expect((index as any).buildPromise).toBeNull());
    expect(disk.uploads.length).toBe(1);
    expect(JSON.parse(disk.content).creatures[0].name).toBe('Goblin');
    // The next read is current and builds nothing more.
    expect((await index.getEnhancedIndex()).map(c => c.name)).toEqual(['Goblin']);
    expect(disk.uploads.length).toBe(1);
  });

  it('a failed background build only warns; the stale index was already served', async () => {
    const index = await seedAndCount();
    const saved = JSON.parse(disk.content!);
    saved.creatures[0].name = 'Stale Goblin';
    saved.metadata.packFingerprints[0][1].documentCount = 999;
    disk.content = JSON.stringify(saved);
    const upload = (globalThis as any).foundry.applications.apps.FilePicker.implementation.upload;
    upload.mockImplementationOnce(async () => false);

    const creatures = await index.getEnhancedIndex();
    expect(creatures.map(c => c.name)).toEqual(['Stale Goblin']);
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to rebuild the creature index'),
        expect.any(Error)
      )
    );
  });

  it('getEnhancedIndex does not serve a saved index of another INDEX_VERSION: it waits for the build', async () => {
    const index = await seedAndCount();
    const saved = JSON.parse(disk.content!);
    saved.metadata.version = '1.1.0';
    saved.creatures[0].name = 'Stale Goblin';
    disk.content = JSON.stringify(saved);

    const creatures = await index.getEnhancedIndex();
    expect(creatures.map(c => c.name)).toEqual(['Goblin']); // the fresh build
    expect(disk.uploads.length).toBe(1);
  });

  it('the build saves the stamp it saw before reading the packs, not a clock', async () => {
    const pack = addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    // Foundry 14's game.time.serverTime counts from the server start: never used.
    (globalThis as any).game.time = { serverTime: 123_456 };
    world.setSetting(MODULE, 'creatureIndexDirtyAt', 5_000);
    // A creature change while the build reads the packs raises the stamp.
    const read = pack.getDocuments;
    pack.getDocuments = async (): Promise<unknown> => {
      world.setSetting(MODULE, 'creatureIndexDirtyAt', 6_000);
      return read();
    };
    const index = new PersistentCreatureIndex();
    await index.rebuildIndex();

    expect(JSON.parse(disk.content!).metadata.dirtyStamp).toBe(5_000);
    // So the build counts as stale and the warm-up builds again.
    pack.getDocuments = read;
    await expect(index.ensureIndexCurrent()).resolves.toMatchObject({ rebuilt: true });
    expect(JSON.parse(disk.content!).metadata.dirtyStamp).toBe(6_000);
  });

  it('clock skew between GM PCs does not matter: only stamps are compared', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    world.setSetting(MODULE, 'creatureIndexDirtyAt', 2_000_000);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000); // the builder's clock far behind
    const index = new PersistentCreatureIndex();
    await index.rebuildIndex();
    clock.mockReturnValue(9_000_000_000_000); // and far ahead

    await expect(index.ensureIndexCurrent()).resolves.toMatchObject({ rebuilt: false });
    world.setSetting(MODULE, 'creatureIndexDirtyAt', 2_000_001); // the next change
    await expect(index.ensureIndexCurrent()).resolves.toMatchObject({ rebuilt: true });
    clock.mockRestore();
  });

  it('after a failed background build, stale reads start no new build for the cooldown', async () => {
    const index = await seedAndCount();
    const saved = JSON.parse(disk.content!);
    saved.creatures[0].name = 'Stale Goblin';
    saved.metadata.packFingerprints[0][1].documentCount = 999;
    disk.content = JSON.stringify(saved);
    const upload = (globalThis as any).foundry.applications.apps.FilePicker.implementation.upload;
    upload.mockImplementationOnce(async () => false);
    const errors = (): number => world.notifications.filter(n => n.level === 'error').length;

    await index.getEnhancedIndex();
    await vi.waitFor(() => expect(errors()).toBe(1));
    const uploadsAfterFailure = upload.mock.calls.length;

    // Inside the cooldown: the stale copy, no build, no second error.
    expect((await index.getEnhancedIndex()).map(c => c.name)).toEqual(['Stale Goblin']);
    expect((await index.getEnhancedIndex()).map(c => c.name)).toEqual(['Stale Goblin']);
    expect(upload.mock.calls.length).toBe(uploadsAfterFailure);
    expect(errors()).toBe(1);

    // After it, a read builds again.
    const later = Date.now() + BUILD_RETRY_COOLDOWN_MS;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    await index.getEnhancedIndex();
    await vi.waitFor(() => expect((index as any).buildPromise).toBeNull());
    expect(disk.uploads.length).toBe(1);
    expect(JSON.parse(disk.content).creatures[0].name).toBe('Goblin');
    clock.mockRestore();
  });
});

// ===========================================================================
// ensureIndexCurrent (the GM's ready-time warm) + one build at a time
// ===========================================================================

describe('PersistentCreatureIndex: ensureIndexCurrent and the shared build', () => {
  /**
   * Hold every upload until `release()` so a build stays in flight while the
   * test makes more calls. `uploading` resolves once the build reaches its save.
   */
  function gateUploads(): { uploading: Promise<void>; release: () => void } {
    const g = globalThis as any;
    const upload = g.foundry.applications.apps.FilePicker.implementation.upload;
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    let reached!: () => void;
    const uploading = new Promise<void>(resolve => (reached = resolve));
    upload.mockImplementation(async (_source: string, _target: string, file: File) => {
      reached();
      await gate;
      disk.uploads.push(file);
      disk.content = await file.text();
      return { path: `worlds/${g.game.world.id}/${INDEX_FILENAME}`, status: 'success' };
    });
    return { uploading, release };
  }

  it('builds and persists the index when it is missing', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();

    await expect(index.ensureIndexCurrent()).resolves.toEqual({
      rebuilt: true,
      totalCreatures: 1,
    });
    expect(disk.uploads.length).toBe(1);
  });

  it('rebuilds a stale index persisted by an older module (1.1.0) at the current version', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    await new PersistentCreatureIndex().rebuildIndex();
    // The module update reloads the page: a fresh instance reads the old file.
    const index = new PersistentCreatureIndex();
    const currentVersion = JSON.parse(disk.content!).metadata.version;
    const saved = JSON.parse(disk.content!);
    saved.metadata.version = '1.1.0';
    disk.content = JSON.stringify(saved);
    disk.uploads.length = 0;

    await expect(index.ensureIndexCurrent()).resolves.toEqual({
      rebuilt: true,
      totalCreatures: 1,
    });
    expect(disk.uploads.length).toBe(1);
    expect(currentVersion).not.toBe('1.1.0');
    expect(JSON.parse(disk.content).metadata.version).toBe(currentVersion);
  });

  it('leaves a current index alone (no rebuild, no upload)', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    await index.rebuildIndex();
    disk.uploads.length = 0;

    await expect(index.ensureIndexCurrent()).resolves.toEqual({
      rebuilt: false,
      totalCreatures: 1,
    });
    expect(disk.uploads.length).toBe(0);
  });

  it('a query during the warm build waits on the same build instead of starting a second', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    const { uploading, release } = gateUploads();

    const warm = index.ensureIndexCurrent();
    await uploading; // the build is in flight, held at its save
    const query = index.getEnhancedIndex();
    const forced = index.rebuildIndex();
    release();

    await expect(warm).resolves.toEqual({ rebuilt: true, totalCreatures: 1 });
    expect((await query).map(c => c.name)).toEqual(['Goblin']);
    expect((await forced).map(c => c.name)).toEqual(['Goblin']);
    expect(disk.uploads.length).toBe(1);
  });

  it('two callers that both find the index stale share one build', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    const { uploading, release } = gateUploads();

    // Both start before either has a build in flight (both load the missing file).
    const first = index.ensureIndexCurrent();
    const second = index.getEnhancedIndex();
    await uploading;
    release();

    await expect(first).resolves.toEqual({ rebuilt: true, totalCreatures: 1 });
    expect(await second).toHaveLength(1);
    expect(disk.uploads.length).toBe(1);
  });

  /**
   * Seed a saved index that is usable but stale (a pack changed), named 'Stale
   * Goblin', and return a new instance (it has no build of its own in memory).
   */
  async function seedStale(): Promise<PersistentCreatureIndex> {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    await new PersistentCreatureIndex().rebuildIndex();
    const saved = JSON.parse(disk.content!);
    saved.creatures[0].name = 'Stale Goblin';
    saved.metadata.packFingerprints[0][1].documentCount = 999;
    disk.content = JSON.stringify(saved);
    disk.uploads.length = 0;
    return new PersistentCreatureIndex();
  }

  /** Let pending promise callbacks and zero-delay timers run. */
  const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

  it('with a build in flight, getEnhancedIndex returns the usable saved index without waiting', async () => {
    const index = await seedStale();
    const { uploading, release } = gateUploads();

    const build = index.rebuildIndex();
    await uploading; // the build is held at its save

    // Resolves while the build is still held: no release() yet.
    const creatures = await index.getEnhancedIndex();
    expect(creatures.map(c => c.name)).toEqual(['Stale Goblin']);
    expect(disk.uploads.length).toBe(0);

    release();
    await build;
    expect(disk.uploads.length).toBe(1);
  });

  it('with a build in flight, stale reads serve the copy in memory without reading the file again', async () => {
    const index = await seedStale();
    const { uploading, release } = gateUploads();

    expect((await index.getEnhancedIndex()).map(c => c.name)).toEqual(['Stale Goblin']);
    await uploading; // its background build is held at the save
    const fetches = disk.fetchCalls.length;
    for (let i = 0; i < 3; i++) {
      expect((await index.getEnhancedIndex()).map(c => c.name)).toEqual(['Stale Goblin']);
    }
    expect(disk.fetchCalls.length).toBe(fetches);

    release();
    await vi.waitFor(() => expect(disk.uploads.length).toBe(1));
    // The new build is the copy in memory now, and current.
    expect((await index.getEnhancedIndex()).map(c => c.name)).toEqual(['Goblin']);
  });

  it('ensureIndexCurrent builds again when the build it joined went stale during the wait', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    const { uploading, release } = gateUploads();

    const build = index.rebuildIndex();
    await uploading;
    world.setSetting(MODULE, 'creatureIndexDirtyAt', 7); // a creature changed meanwhile
    const ensured = index.ensureIndexCurrent();
    release();
    await build;

    await expect(ensured).resolves.toEqual({ rebuilt: true, totalCreatures: 1 });
    expect(disk.uploads.length).toBe(2);
    expect(JSON.parse(disk.content!).metadata.dirtyStamp).toBe(7);
  });

  it('with a build in flight, ensureIndexCurrent still waits for the build', async () => {
    const index = await seedStale();
    const { uploading, release } = gateUploads();

    const build = index.rebuildIndex();
    await uploading;
    let settled = false;
    const ensured = index.ensureIndexCurrent().then(r => {
      settled = true;
      return r;
    });
    await flush();
    expect(settled).toBe(false);

    release();
    await build;
    await expect(ensured).resolves.toEqual({ rebuilt: true, totalCreatures: 1 });
  });

  it('with no saved index, getEnhancedIndex waits for the build (cold start)', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    const { uploading, release } = gateUploads();

    const build = index.rebuildIndex();
    await uploading;
    let settled = false;
    const query = index.getEnhancedIndex().then(r => {
      settled = true;
      return r;
    });
    await flush();
    expect(settled).toBe(false); // nothing saved to serve, so it waits

    release();
    await build;
    expect((await query).map(c => c.name)).toEqual(['Goblin']);
  });

  it('with a saved index of another INDEX_VERSION and a build in flight, getEnhancedIndex waits', async () => {
    const index = await seedStale();
    const saved = JSON.parse(disk.content!);
    saved.metadata.version = '1.1.0';
    disk.content = JSON.stringify(saved);
    const { uploading, release } = gateUploads();

    const build = index.rebuildIndex();
    await uploading;
    let settled = false;
    const query = index.getEnhancedIndex().then(r => {
      settled = true;
      return r;
    });
    await flush();
    expect(settled).toBe(false);

    release();
    await build;
    expect((await query).map(c => c.name)).toEqual(['Goblin']);
  });

  it('a cold-start query whose file read outlasts the build gets the build result', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    const { uploading, release } = gateUploads();
    const build = index.rebuildIndex();
    await uploading;
    // The query lists the folder while no file exists yet, and gets the answer after the build.
    const browse = (globalThis as any).foundry.applications.apps.FilePicker.implementation.browse;
    let listed!: () => void;
    const listing = new Promise<void>(resolve => (listed = resolve));
    browse.mockImplementationOnce(async () => {
      await listing;
      return { files: [] };
    });

    const query = index.getEnhancedIndex();
    await vi.waitFor(() => expect(browse).toHaveBeenCalled());
    release();
    await build;
    expect((index as any).buildPromise).toBeNull();
    listed();
    expect((await query).map(c => c.name)).toEqual(['Goblin']);
  });

  it('a cold-start query whose file read outlasts a failed build gets the failure, not null', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    const upload = (globalThis as any).foundry.applications.apps.FilePicker.implementation.upload;
    let failed!: () => void;
    const failing = new Promise<void>(resolve => (failed = resolve));
    upload.mockImplementationOnce(async () => {
      await failing;
      return false;
    });
    const build = index.rebuildIndex();
    await vi.waitFor(() => expect(upload).toHaveBeenCalled());
    const browse = (globalThis as any).foundry.applications.apps.FilePicker.implementation.browse;
    let listed!: () => void;
    const listing = new Promise<void>(resolve => (listed = resolve));
    browse.mockImplementationOnce(async () => {
      await listing;
      return { files: [] };
    });

    const query = index.getEnhancedIndex();
    await vi.waitFor(() => expect(browse).toHaveBeenCalled());
    failed();
    await expect(build).rejects.toThrow('File upload failed');
    listed();
    await expect(query).rejects.toThrow('File upload failed');
  });

  it('a file read begun before a build ended does not replace the newer index in memory', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    await index.rebuildIndex();
    world.setSetting(MODULE, 'creatureIndexDirtyAt', 5); // a change: the copy in memory is stale
    // The query reads the file as it was before the change's build saved a new one.
    const fetchMock = (globalThis as any).fetch;
    const before = disk.content!;
    let read!: () => void;
    const reading = new Promise<void>(resolve => (read = resolve));
    fetchMock.mockImplementationOnce(async () => {
      await reading;
      return { ok: true, status: 200, json: async (): Promise<unknown> => JSON.parse(before) };
    });
    const fetches = fetchMock.mock.calls.length;

    const query = index.getEnhancedIndex();
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBe(fetches + 1));
    await index.rebuildIndex(); // the change's build ends first
    const uploads = disk.uploads.length;
    read();

    expect((await query).map(c => c.name)).toEqual(['Goblin']);
    expect((index as any).loadedIndex.metadata.dirtyStamp).toBe(5);
    // The old file was not taken for a stale index: no further build.
    expect((index as any).buildPromise).toBeNull();
    expect(disk.uploads.length).toBe(uploads);
  });

  it('a current index in memory is served without reading the file again', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    await index.ensureIndexCurrent();
    const fetches = disk.fetchCalls.length;

    expect((await index.getEnhancedIndex()).map(c => c.name)).toEqual(['Goblin']);
    expect((await index.getEnhancedIndex()).map(c => c.name)).toEqual(['Goblin']);
    expect(disk.fetchCalls.length).toBe(fetches);
  });

  it('after a failed cold-start build, queries start no build for the cooldown', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    const upload = (globalThis as any).foundry.applications.apps.FilePicker.implementation.upload;
    upload.mockImplementationOnce(async () => false);
    await expect(index.getEnhancedIndex()).rejects.toThrow('File upload failed');
    const attempts = upload.mock.calls.length;

    // Inside the cooldown the query fails at once (the compendium search falls back).
    await expect(index.getEnhancedIndex()).rejects.toThrow('not retried yet');
    expect(upload.mock.calls.length).toBe(attempts);

    // After it, a query builds again.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + BUILD_RETRY_COOLDOWN_MS);
    expect((await index.getEnhancedIndex()).map(c => c.name)).toEqual(['Goblin']);
    clock.mockRestore();
    expect(disk.uploads.length).toBe(1);
  });

  it('the GM warm-up builds even inside the cooldown after a failed cold start', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    const upload = (globalThis as any).foundry.applications.apps.FilePicker.implementation.upload;
    upload.mockImplementationOnce(async () => false);
    await expect(index.getEnhancedIndex()).rejects.toThrow('File upload failed');

    await expect(index.ensureIndexCurrent()).resolves.toEqual({ rebuilt: true, totalCreatures: 1 });
  });

  it('a failed build is not cached: the next call builds again', async () => {
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    const upload = (globalThis as any).foundry.applications.apps.FilePicker.implementation.upload;
    upload.mockImplementationOnce(async () => false); // "File upload failed"

    await expect(index.ensureIndexCurrent()).rejects.toThrow('File upload failed');
    await expect(index.ensureIndexCurrent()).resolves.toEqual({
      rebuilt: true,
      totalCreatures: 1,
    });
    expect(disk.uploads.length).toBe(1);
  });
});

// ===========================================================================
// hooks → creatureIndexDirtyAt stamp (autoRebuildIndex gate, GM browsers only)
// ===========================================================================

describe('PersistentCreatureIndex — hook-driven invalidation', () => {
  /** Fire a registered Foundry hook through the harness dispatcher. */
  function fireHook(name: string, ...args: any[]): void {
    (globalThis as any).Hooks.callAll(name, ...args);
  }
  const actorPack = { metadata: { type: 'Actor' } };
  const itemPack = { metadata: { type: 'Item' } };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the creatureIndexDirtyAt stamp after the debounce when autoRebuildIndex is on', async () => {
    world.setSetting(MODULE, 'autoRebuildIndex', true);
    // Foundry 14's game.time.serverTime counts from the server start: never used.
    (globalThis as any).game.time = { serverTime: 5_000 };
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex(); // persist a file (disk.content set)
    const saved = disk.content;

    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    fireHook('updateCompendium', actorPack, [{ type: 'npc' }]);
    await vi.advanceTimersByTimeAsync(DIRTY_STAMP_DEBOUNCE_MS - 1);
    expect(stampWrites()).toEqual([]); // still inside the debounce

    await vi.advanceTimersByTimeAsync(1);
    expect(stampWrites()).toEqual([1_700_000_000_000]);
    expect(settingsSet).toHaveBeenCalledWith(MODULE, 'creatureIndexDirtyAt', 1_700_000_000_000);
    // The stamp is the whole invalidation: the saved file is left alone.
    expect(disk.content).toBe(saved);
    clock.mockRestore();
  });

  it('two GM browsers both stamp one change: the stamp only rises and the saved index goes stale', async () => {
    world.setSetting(MODULE, 'autoRebuildIndex', true);
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const first = new PersistentCreatureIndex();
    new PersistentCreatureIndex(); // another GM's browser: its own hook, the same world setting
    await first.getEnhancedIndex(); // a saved index that saw stamp 0

    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    fireHook('updateCompendium', actorPack, [{ type: 'npc' }]);
    await vi.advanceTimersByTimeAsync(DIRTY_STAMP_DEBOUNCE_MS);
    clock.mockRestore();

    // The second write is above the first, never equal or lower.
    expect(stampWrites()).toEqual([1_700_000_000_000, 1_700_000_000_001]);
    expect((first as any).isIndexValid((first as any).loadedIndex)).toBe(false);
  });

  it('writes no stamp when autoRebuildIndex is off (default/undefined)', async () => {
    // autoRebuildIndex unset → game.settings.get returns undefined (falsy).
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex();

    fireHook('updateCompendium', actorPack, [{ type: 'npc' }]);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stampWrites()).toEqual([]);
    expect(disk.content).not.toBeNull(); // file untouched
  });

  it("a player's browser writes no stamp and schedules no rebuild", async () => {
    world.setSetting(MODULE, 'autoRebuildIndex', true);
    world.setSetting(MODULE, 'enableEnhancedCreatureIndex', true);
    world.setSetting(MODULE, 'bridgeUserId', 'gm'); // a GM here would rebuild
    (globalThis as any).game.user.isGM = false;
    const index = new PersistentCreatureIndex();
    const rebuild = vi.spyOn(index, 'rebuildIndex').mockResolvedValue([]);

    fireHook('updateCompendium', actorPack, [{ type: 'npc' }]);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stampWrites()).toEqual([]);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('ignores changes in a non-Actor pack or to documents that are not creatures', async () => {
    world.setSetting(MODULE, 'autoRebuildIndex', true);
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex();

    fireHook('updateCompendium', itemPack, [{ type: 'npc' }]); // not an Actor pack
    fireHook('updateCompendium', actorPack, [{ type: 'weapon' }]); // not a creature
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stampWrites()).toEqual([]);
    expect(disk.content).not.toBeNull();
  });

  it('writes the stamp when the hook gives no document list', async () => {
    world.setSetting(MODULE, 'autoRebuildIndex', true);
    new PersistentCreatureIndex();

    fireHook('updateCompendium', actorPack, undefined);
    await vi.advanceTimersByTimeAsync(DIRTY_STAMP_DEBOUNCE_MS);

    expect(stampWrites()).toHaveLength(1);
  });

  it('ignores an empty change in an Actor pack', async () => {
    world.setSetting(MODULE, 'autoRebuildIndex', true);
    new PersistentCreatureIndex();

    fireHook('updateCompendium', actorPack, []);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stampWrites()).toEqual([]);
  });

  it("several changes inside the debounce write one stamp, with the last change's time", async () => {
    world.setSetting(MODULE, 'autoRebuildIndex', true);
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    new PersistentCreatureIndex();

    fireHook('updateCompendium', actorPack, [{ type: 'npc' }]);
    await vi.advanceTimersByTimeAsync(500);
    now = 1_000_500;
    fireHook('updateCompendium', actorPack, [{ type: 'npc' }]);
    await vi.advanceTimersByTimeAsync(500);
    now = 1_001_000;
    fireHook('updateCompendium', actorPack, [{ type: 'npc' }]);
    await vi.advanceTimersByTimeAsync(DIRTY_STAMP_DEBOUNCE_MS - 1);
    expect(stampWrites()).toEqual([]); // each change restarted the quiet time

    await vi.advanceTimersByTimeAsync(1);
    expect(stampWrites()).toEqual([1_001_000]);
    clock.mockRestore();
  });

  it('the stamp only rises: a browser whose clock is behind writes the current stamp plus one', async () => {
    world.setSetting(MODULE, 'autoRebuildIndex', true);
    world.setSetting(MODULE, 'creatureIndexDirtyAt', 5_000_000);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    new PersistentCreatureIndex();

    fireHook('updateCompendium', actorPack, [{ type: 'npc' }]);
    await vi.advanceTimersByTimeAsync(DIRTY_STAMP_DEBOUNCE_MS);
    expect(stampWrites()).toEqual([5_000_001]);
    clock.mockRestore();
  });

  it('a failed stamp write only logs a warning', async () => {
    world.setSetting(MODULE, 'autoRebuildIndex', true);
    new PersistentCreatureIndex();
    settingsSet.mockRejectedValueOnce(new Error('denied'));

    fireHook('updateCompendium', actorPack, [{ type: 'npc' }]);
    await vi.advanceTimersByTimeAsync(DIRTY_STAMP_DEBOUNCE_MS);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to mark the creature index stale'),
      expect.any(Error)
    );
  });
});

// ===========================================================================
// pack change → background rebuild in the index builder's browser (#283 low 3)
// ===========================================================================

describe('PersistentCreatureIndex: background rebuild after a pack change', () => {
  /** Make this browser the index builder: the bridge user, both switches on. */
  function makeBuilder(): void {
    world.setSetting(MODULE, 'autoRebuildIndex', true);
    world.setSetting(MODULE, 'enableEnhancedCreatureIndex', true);
    world.setSetting(MODULE, 'bridgeUserId', 'gm');
  }

  function setActiveGm(id: string | null): void {
    Object.defineProperty((globalThis as any).game.users, 'activeGM', {
      value: id ? { id } : null,
      configurable: true,
    });
  }

  function newIndexWithSpies(): {
    index: PersistentCreatureIndex;
    ensure: ReturnType<typeof vi.spyOn>;
    rebuild: ReturnType<typeof vi.spyOn>;
  } {
    const index = new PersistentCreatureIndex();
    const ensure = vi
      .spyOn(index, 'ensureIndexCurrent')
      .mockResolvedValue({ rebuilt: true, totalCreatures: 1 });
    const rebuild = vi.spyOn(index, 'rebuildIndex').mockResolvedValue([]);
    return { index, ensure, rebuild };
  }

  const change = (): void =>
    (globalThis as any).Hooks.callAll('updateCompendium', { metadata: { type: 'Actor' } }, [
      { type: 'npc' },
    ]);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rebuilds once, 5 s after the last change of a burst', async () => {
    makeBuilder();
    const { ensure, rebuild } = newIndexWithSpies();

    change();
    await vi.advanceTimersByTimeAsync(3_000);
    change();
    change();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(rebuild).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(rebuild).toHaveBeenCalledTimes(1);
    // Forced: an edit keeps the fingerprints, so "is it current?" is not asked.
    expect(ensure).not.toHaveBeenCalled();
  });

  it('rebuilds after a build that finished inside the quiet time', async () => {
    makeBuilder();
    const { index, rebuild } = newIndexWithSpies();
    let finish!: () => void;
    (index as any).buildPromise = new Promise<unknown[]>(resolve => {
      finish = (): void => resolve([]);
    });

    change();
    finish();
    (index as any).buildPromise = null;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('does not rebuild on a system other than dnd5e', async () => {
    makeBuilder();
    (globalThis as any).game.system.id = 'pf2e';
    const { rebuild } = newIndexWithSpies();

    change();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('does not rebuild when another user is the bridge user', async () => {
    makeBuilder();
    world.setSetting(MODULE, 'bridgeUserId', 'someone-else');
    const { rebuild } = newIndexWithSpies();

    change();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('with "Any GM" rebuilds only in the active GM\'s browser', async () => {
    makeBuilder();
    world.setSetting(MODULE, 'bridgeUserId', '');
    const { rebuild } = newIndexWithSpies();

    setActiveGm('other-gm');
    change();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rebuild).not.toHaveBeenCalled();

    setActiveGm('gm');
    change();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild in a player's browser", async () => {
    makeBuilder();
    (globalThis as any).game.user.isGM = false;
    const { rebuild } = newIndexWithSpies();

    change();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('does not rebuild when the enhanced index is off', async () => {
    makeBuilder();
    world.setSetting(MODULE, 'enableEnhancedCreatureIndex', false);
    const { rebuild } = newIndexWithSpies();

    change();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('follows a build still running at the change with a fresh one', async () => {
    makeBuilder();
    const { index, ensure, rebuild } = newIndexWithSpies();
    let finish!: () => void;
    (index as any).buildPromise = new Promise<unknown[]>(resolve => {
      finish = (): void => resolve([]);
    });

    change();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rebuild).not.toHaveBeenCalled();

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('the whole loop: an edit, the stamp, the old index served, a real rebuild, then the new one', async () => {
    makeBuilder();
    const goblin = makeActor({ id: 'g1', name: 'Goblin', type: 'npc' });
    addMonsterPack([goblin]);
    const logs = vi.spyOn(console, 'log');
    const index = new PersistentCreatureIndex();
    await index.ensureIndexCurrent();
    const names = async (): Promise<string[]> => (await index.getEnhancedIndex()).map(c => c.name);

    const firstBuild = disk.uploads.length;
    // An edit keeps the creature count, so only the stamp shows the change.
    goblin.name = 'Goblin Boss';
    change();
    await vi.advanceTimersByTimeAsync(DIRTY_STAMP_DEBOUNCE_MS);
    expect(stampWrites()).toHaveLength(1);
    expect(await names()).toEqual(['Goblin']); // the old index, while it rebuilds

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() =>
      expect(JSON.parse(disk.content!).creatures.map((c: any) => c.name)).toEqual(['Goblin Boss'])
    );
    await vi.waitFor(() => expect((index as any).buildPromise).toBeNull());
    const uploads = disk.uploads.length;
    expect(await names()).toEqual(['Goblin Boss']);
    expect(disk.uploads.length).toBe(uploads); // current: no further build
    // One build for the change: the query's build saw the stamp, so the timer skipped its own.
    expect(uploads - firstBuild).toBe(1);
    expect(logs).toHaveBeenCalledWith(
      expect.stringContaining('already current after a pack change')
    );
  });

  it('the timer still builds when the build it waited for started before the change was stamped', async () => {
    makeBuilder();
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    await index.ensureIndexCurrent();
    const before = disk.uploads.length;

    // Hold this build at its save so it is still running when the timer fires.
    const upload = (globalThis as any).foundry.applications.apps.FilePicker.implementation.upload;
    const save = upload.getMockImplementation();
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    upload.mockImplementationOnce(async (...args: unknown[]) => {
      await gate;
      return save(...args);
    });
    const running = index.rebuildIndex(); // saw the old stamp
    change();
    await vi.advanceTimersByTimeAsync(5_000);
    expect((index as any).buildPromise).not.toBeNull();
    release();
    await running;
    await vi.waitFor(() => expect(disk.uploads.length).toBe(before + 2));
    await vi.waitFor(() => expect((index as any).buildPromise).toBeNull());
    expect(JSON.parse(disk.content!).metadata.dirtyStamp).toBe(
      (globalThis as any).game.settings.get(MODULE, 'creatureIndexDirtyAt')
    );
  });

  it('the timer rebuilds when the stamp write failed, though the index looks current', async () => {
    makeBuilder();
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    await index.ensureIndexCurrent();
    const before = disk.uploads.length;
    settingsSet.mockRejectedValueOnce(new Error('denied'));

    change();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(disk.uploads.length).toBe(before + 1));
  });

  it('the pack-change timer rebuilds even inside the cooldown after a failed build', async () => {
    makeBuilder();
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);
    const index = new PersistentCreatureIndex();
    await index.ensureIndexCurrent();
    const upload = (globalThis as any).foundry.applications.apps.FilePicker.implementation.upload;
    upload.mockImplementationOnce(async () => false);
    await expect(index.rebuildIndex()).rejects.toThrow('File upload failed');
    expect((index as any).inBuildCooldown()).toBe(true);
    const before = disk.uploads.length;

    change();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(disk.uploads.length).toBe(before + 1));
  });

  it('a failed rebuild only logs a warning', async () => {
    makeBuilder();
    const { rebuild } = newIndexWithSpies();
    rebuild.mockRejectedValue(new Error('upload failed'));

    change();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to rebuild the creature index'),
      expect.any(Error)
    );
  });
});
