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
 *   - `globalThis.fetch` — used to read the index file (GET) and delete it
 *     (DELETE on invalidate); stubbed locally with `vi.fn` and restored.
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
import { createTestWorld, makeActor, type TestWorld } from './test-support/foundry-mock/index.js';
import { PersistentCreatureIndex } from './data-access/creature-index.js';

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

const INDEX_FILENAME = 'enhanced-creature-index.json';

/** Install the FilePicker + fetch + notification stubs against the shared `disk`. */
function installStorageStubs(): void {
  const g = globalThis as any;

  // Replace ui.notifications with stubs returning a removable notification object
  // (the build path holds onto the return value and calls `.remove()` on it).
  const makeNote = () => ({ remove: () => undefined });
  g.ui = {
    notifications: {
      info: (m: string) => {
        world.notifications.push({ level: 'info', message: m });
        return makeNote();
      },
      warn: (m: string) => {
        world.notifications.push({ level: 'warn', message: m });
        return makeNote();
      },
      error: (m: string) => {
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
    // DELETE (invalidate path) just succeeds; it clears the file.
    if (init && init.method === 'DELETE') {
      disk.content = null;
      return { ok: true, status: 200 };
    }
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
});

afterEach(() => {
  // Restore the real fetch (foundry/game/etc. are restored by the harness).
  if (savedFetch === undefined) delete (globalThis as any).fetch;
  else (globalThis as any).fetch = savedFetch;
  savedFetch = undefined;
  restore();
  vi.restoreAllMocks();
});

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
    // Registers the five pack-change hooks.
    const hookNames = onSpy.mock.calls.map(c => c[0]);
    expect(hookNames).toEqual(
      expect.arrayContaining([
        'createDocument',
        'updateDocument',
        'deleteDocument',
        'createCompendium',
        'deleteCompendium',
      ])
    );
  });
});

// ===========================================================================
// buildEnhancedIndex (via rebuildIndex) — system routing + extraction
// ===========================================================================

describe('PersistentCreatureIndex — rebuildIndex / build (dnd5e)', () => {
  it('builds an index from Actor packs and returns one record per npc/character/creature', async () => {
    addMonsterPack([
      makeActor({ id: 'g1', name: 'Goblin', type: 'npc' }),
      makeActor({ id: 'h1', name: 'Hero', type: 'character' }),
      makeActor({ id: 'c1', name: 'Creature', type: 'creature' }),
      // non-creature type is skipped by extractDnD5eDataFromPack
      makeActor({ id: 'v1', name: 'Vehicle', type: 'vehicle' }),
    ]);

    const index = new PersistentCreatureIndex();
    const creatures = await index.rebuildIndex();

    const names = creatures.map(c => c.name).sort();
    expect(names).toEqual(['Creature', 'Goblin', 'Hero']);
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
            biography: 'A terrifying wyrm.',
          },
          traits: { size: 'GARGANTUAN' },
          attributes: { hp: { max: 546 }, ac: { value: 22 }, spellcasting: 'cha' },
          resources: { legact: { value: 3 } },
        },
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
      size: 'gargantuan', // lower-cased
      hitPoints: 546,
      armorClass: 22,
      hasSpells: true, // attributes.spellcasting truthy
      hasLegendaryActions: true, // resources.legact truthy
      alignment: 'chaotic evil', // lower-cased
      description: 'A terrifying wyrm.',
      img: 'dragon.webp',
    });
  });

  it('parses fractional CR strings (1/8, 1/4, 1/2) into numbers', async () => {
    addMonsterPack([
      makeActor({ id: 'a', name: 'Eighth', type: 'npc', system: { details: { cr: '1/8' } } }),
      makeActor({ id: 'b', name: 'Quarter', type: 'npc', system: { details: { cr: '1/4' } } }),
      makeActor({ id: 'c', name: 'Half', type: 'npc', system: { details: { cr: '1/2' } } }),
    ]);

    const index = new PersistentCreatureIndex();
    const byName = Object.fromEntries((await index.rebuildIndex()).map(c => [c.name, c]));

    expect(byName['Eighth'].challengeRating).toBe(0.125);
    expect(byName['Quarter'].challengeRating).toBe(0.25);
    expect(byName['Half'].challengeRating).toBe(0.5);
  });

  it('applies defaults for a bare creature (no system fields)', async () => {
    addMonsterPack([makeActor({ id: 'blob', name: 'Blob', type: 'npc', system: {} })]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    expect(c).toMatchObject({
      challengeRating: 0,
      creatureType: 'unknown',
      size: 'medium',
      hitPoints: 0,
      armorClass: 10,
      hasSpells: false,
      hasLegendaryActions: false,
      alignment: 'unaligned',
      description: '',
    });
  });

  it('detects spells via system.spells and legendary via system.legendary', async () => {
    addMonsterPack([
      makeActor({
        id: 'caster',
        name: 'Caster',
        type: 'npc',
        system: { spells: { spell1: { value: 4 } }, legendary: { actions: 3 } },
      }),
    ]);

    const index = new PersistentCreatureIndex();
    const [c] = await index.rebuildIndex();

    expect(c.hasSpells).toBe(true);
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
      size: 'medium',
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
    expect(saved.metadata.version).toBe('1.0.0');
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

    // Loading again exercises the array → Map conversion + isIndexValid (which
    // calls .get on the Map). A successful valid load proves the Map was rebuilt.
    const second = await index.getEnhancedIndex();
    expect(second).toHaveLength(1);
    // browse + a GET fetch happened on the load path.
    expect(disk.fetchCalls.some(c => !c.init || c.init.method !== 'DELETE')).toBe(true);
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
    return index;
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

    await index.getEnhancedIndex();
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

    await index.getEnhancedIndex();
    expect(disk.uploads.length).toBe(1); // mismatch → rebuild
  });

  it('invalidates (rebuilds) when a saved pack no longer exists', async () => {
    const index = await seedAndCount();
    // Remove the pack the persisted index fingerprinted.
    world.packs.delete('world.monsters');

    await index.getEnhancedIndex();
    // With no Actor packs left, the rebuild produces an empty index but still
    // persists — the point is that the stale index was rejected (rebuild ran).
    expect(disk.uploads.length).toBe(1);
  });
});

// ===========================================================================
// hooks → invalidateIndex (autoRebuildIndex gate)
// ===========================================================================

describe('PersistentCreatureIndex — hook-driven invalidation', () => {
  /** Fire a registered Foundry hook through the harness dispatcher. */
  function fireHook(name: string, payload: any): void {
    (globalThis as any).Hooks.callAll(name, payload);
  }

  it('deletes the persisted file on a compendium-document change when autoRebuildIndex is on', async () => {
    world.setSetting('foundry-mcp-bridge', 'autoRebuildIndex', true);
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex(); // persist a file (disk.content set)
    expect(disk.content).not.toBeNull();

    fireHook('updateDocument', { pack: 'world.monsters', type: 'npc' });
    // invalidateIndex is async; let the microtasks settle.
    await Promise.resolve();
    await Promise.resolve();

    // A DELETE fetch was issued against the index path; the file is cleared.
    expect(disk.fetchCalls.some(c => c.init && c.init.method === 'DELETE')).toBe(true);
    expect(disk.content).toBeNull();
  });

  it('does NOT delete the file when autoRebuildIndex is off (default/undefined)', async () => {
    // autoRebuildIndex unset → game.settings.get returns undefined (falsy).
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex();
    const deletesBefore = disk.fetchCalls.filter(c => c.init && c.init.method === 'DELETE').length;

    fireHook('createDocument', { pack: 'world.monsters', type: 'npc' });
    await Promise.resolve();
    await Promise.resolve();

    const deletesAfter = disk.fetchCalls.filter(c => c.init && c.init.method === 'DELETE').length;
    expect(deletesAfter).toBe(deletesBefore); // no DELETE issued
    expect(disk.content).not.toBeNull(); // file untouched
  });

  it('ignores document changes that are not in a pack or not a creature type', async () => {
    world.setSetting('foundry-mcp-bridge', 'autoRebuildIndex', true);
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex();

    // No `pack` → ignored; wrong type → ignored.
    fireHook('updateDocument', { type: 'npc' }); // no pack
    fireHook('updateDocument', { pack: 'world.monsters', type: 'weapon' }); // not a creature
    await Promise.resolve();
    await Promise.resolve();

    expect(disk.fetchCalls.some(c => c.init && c.init.method === 'DELETE')).toBe(false);
    expect(disk.content).not.toBeNull();
  });

  it('invalidates on a deleteCompendium hook for an Actor pack', async () => {
    world.setSetting('foundry-mcp-bridge', 'autoRebuildIndex', true);
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex();

    fireHook('deleteCompendium', { metadata: { type: 'Actor' } });
    await Promise.resolve();
    await Promise.resolve();

    expect(disk.fetchCalls.some(c => c.init && c.init.method === 'DELETE')).toBe(true);
  });

  it('ignores a createCompendium hook for a non-Actor pack', async () => {
    world.setSetting('foundry-mcp-bridge', 'autoRebuildIndex', true);
    addMonsterPack([makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })]);

    const index = new PersistentCreatureIndex();
    await index.getEnhancedIndex();

    fireHook('createCompendium', { metadata: { type: 'Item' } });
    await Promise.resolve();
    await Promise.resolve();

    expect(disk.fetchCalls.some(c => c.init && c.init.method === 'DELETE')).toBe(false);
  });
});
