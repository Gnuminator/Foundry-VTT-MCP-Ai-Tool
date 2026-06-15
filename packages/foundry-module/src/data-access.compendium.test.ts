/**
 * Characterization tests for the basic (non-enhanced) compendium-search paths
 * of `FoundryDataAccess`, driven through the Phase 9 Foundry-mock harness.
 *
 * Enhanced creature index is kept OFF (the default — `game.settings.get` returns
 * `undefined` for `enableEnhancedCreatureIndex`). See inline comments where the
 * harness pack/document shape needed local workarounds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeActor,
  makePack,
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
// searchCompendium — input validation
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — searchCompendium — input validation', () => {
  it('throws when query is an empty string', async () => {
    await expect(da.searchCompendium('')).rejects.toThrow(
      'Search query must be a string with at least 2 characters'
    );
  });

  it('throws when query is a single character', async () => {
    await expect(da.searchCompendium('a')).rejects.toThrow(
      'Search query must be a string with at least 2 characters'
    );
  });

  it('throws when query is whitespace only (trims to < 2 chars)', async () => {
    await expect(da.searchCompendium('  ')).rejects.toThrow(
      'Search query must be a string with at least 2 characters'
    );
  });

  it('throws when query is a number coerced (non-string)', async () => {
    // Cast to any so TypeScript doesn't complain about passing a wrong type
    await expect(da.searchCompendium(42 as any)).rejects.toThrow(
      'Search query must be a string with at least 2 characters'
    );
  });

  it('throws when query is null', async () => {
    await expect(da.searchCompendium(null as any)).rejects.toThrow(
      'Search query must be a string with at least 2 characters'
    );
  });
});

// ---------------------------------------------------------------------------
// searchCompendium — name matching and packType filtering
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — searchCompendium — name matching', () => {
  it('returns an entry whose name contains the query term', async () => {
    const goblin = makeActor({ id: 'g1', name: 'Goblin Warrior', type: 'npc' });
    world.addPack({
      id: 'world.monsters',
      label: 'Monsters',
      type: 'Actor',
      documents: [goblin],
    });

    const results = await da.searchCompendium('goblin');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'g1',
      name: 'Goblin Warrior',
      type: 'npc',
      pack: 'world.monsters',
      packLabel: 'Monsters',
      description: '',
      hasImage: false,
      summary: 'npc from Monsters',
    });
    // img should be absent (no image on the actor)
    expect(results[0]!.img).toBeUndefined();
  });

  it('returns multiple entries that all match the query', async () => {
    world.addPack({
      id: 'world.monsters',
      label: 'Monsters',
      type: 'Actor',
      documents: [
        makeActor({ id: 'g1', name: 'Goblin Scout', type: 'npc' }),
        makeActor({ id: 'g2', name: 'Goblin Boss', type: 'npc' }),
        makeActor({ id: 'o1', name: 'Orc Warrior', type: 'npc' }),
      ],
    });

    const results = await da.searchCompendium('goblin');

    const names = results.map(r => r.name).sort();
    expect(names).toEqual(['Goblin Boss', 'Goblin Scout']);
  });

  it('is case-insensitive for name matching', async () => {
    world.addPack({
      id: 'world.monsters',
      label: 'Monsters',
      type: 'Actor',
      documents: [makeActor({ id: 'troll1', name: 'Cave Troll', type: 'npc' })],
    });

    const results = await da.searchCompendium('CAVE TROLL');

    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('Cave Troll');
  });

  it('requires ALL query terms to appear in the name (AND semantics)', async () => {
    world.addPack({
      id: 'world.monsters',
      label: 'Monsters',
      type: 'Actor',
      documents: [
        makeActor({ id: 'a1', name: 'Ancient Red Dragon', type: 'npc' }),
        makeActor({ id: 'a2', name: 'Ancient Blue Dragon', type: 'npc' }),
        makeActor({ id: 'a3', name: 'Red Dragon Wyrmling', type: 'npc' }),
      ],
    });

    const results = await da.searchCompendium('ancient red');

    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('Ancient Red Dragon');
  });

  it('returns empty array when no packs are loaded', async () => {
    const results = await da.searchCompendium('goblin');
    expect(results).toEqual([]);
  });

  it('returns empty array when no entries match the query', async () => {
    world.addPack({
      id: 'world.monsters',
      label: 'Monsters',
      type: 'Actor',
      documents: [makeActor({ id: 'o1', name: 'Orc Warrior', type: 'npc' })],
    });

    const results = await da.searchCompendium('dragon');
    expect(results).toEqual([]);
  });

  it('populates img and hasImage when the document has an img field', async () => {
    world.addPack({
      id: 'world.items',
      label: 'Items',
      type: 'Item',
      documents: [
        makeActor({ id: 'sword1', name: 'Magic Sword', type: 'weapon', img: 'sword.webp' }),
        makeActor({ id: 'shield1', name: 'Iron Shield', type: 'armor' }),
      ],
    });

    const results = await da.searchCompendium('magic sword', 'Item');

    // Document with img: index carries it → hasImage true, img populated
    expect(results).toHaveLength(1);
    expect(results[0]!.hasImage).toBe(true);
    expect(results[0]!.img).toBe('sword.webp');
  });

  it('yields hasImage:false and no img when the document has no img field', async () => {
    world.addPack({
      id: 'world.items',
      label: 'Items',
      type: 'Item',
      documents: [makeActor({ id: 'shield1', name: 'Iron Shield', type: 'armor' })],
    });

    const results = await da.searchCompendium('iron shield', 'Item');

    expect(results).toHaveLength(1);
    expect(results[0]!.hasImage).toBe(false);
    expect(results[0]!.img).toBeUndefined();
  });

  it('filters by packType — Actor packs only', async () => {
    world.addPack({
      id: 'world.actors',
      label: 'Actors Pack',
      type: 'Actor',
      documents: [makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })],
    });
    world.addPack({
      id: 'world.items',
      label: 'Items Pack',
      type: 'Item',
      documents: [makeActor({ id: 'g2', name: 'Goblin Dagger', type: 'weapon' })],
    });

    const results = await da.searchCompendium('goblin', 'Actor');

    expect(results).toHaveLength(1);
    expect(results[0]!.pack).toBe('world.actors');
  });

  it('excludes Scene packs even when no packType filter is specified', async () => {
    world.addPack({
      id: 'world.scenes',
      label: 'Scenes Pack',
      type: 'Scene',
      documents: [makeActor({ id: 's1', name: 'Goblin Cave', type: 'Scene' })],
    });
    world.addPack({
      id: 'world.actors',
      label: 'Actors Pack',
      type: 'Actor',
      documents: [makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })],
    });

    const results = await da.searchCompendium('goblin');

    // Only the Actor pack result (Scene pack excluded)
    expect(results).toHaveLength(1);
    expect(results[0]!.pack).toBe('world.actors');
  });

  it('sorts exact name matches before partial matches', async () => {
    world.addPack({
      id: 'world.monsters',
      label: 'Monsters',
      type: 'Actor',
      documents: [
        makeActor({ id: 'g1', name: 'Goblin Scout', type: 'npc' }),
        makeActor({ id: 'g2', name: 'Goblin', type: 'npc' }),
      ],
    });

    const results = await da.searchCompendium('goblin');

    // Exact match 'Goblin' should come first
    expect(results[0]!.name).toBe('Goblin');
  });
});

// ---------------------------------------------------------------------------
// listCreaturesByCriteria — enhanced index OFF → fallbackBasicCreatureSearch
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — listCreaturesByCriteria (enhanced OFF → fallback)', () => {
  it('returns {creatures, searchSummary} with fallback metadata when no criteria given', async () => {
    // fallbackBasicCreatureSearch searches for 'monster' when no criteria terms
    world.addPack({
      id: 'world.actors',
      label: 'Monsters',
      type: 'Actor',
      documents: [
        makeActor({ id: 'm1', name: 'Monster Alpha', type: 'npc' }),
        makeActor({ id: 'm2', name: 'Cave Bear', type: 'npc' }),
      ],
    });

    const result = await da.listCreaturesByCriteria({});

    // 'monster' search matches 'Monster Alpha', not 'Cave Bear'
    expect(result.creatures).toHaveLength(1);
    expect(result.creatures[0]!.name).toBe('Monster Alpha');

    // Summary shape
    expect(result.searchSummary).toMatchObject({
      packsSearched: 0,
      topPacks: [],
      totalCreaturesFound: 1,
      resultsByPack: {},
      fallback: true,
      searchMethod: 'basic_fallback',
    });
    expect(result.searchSummary.criteria).toEqual({});
  });

  it('uses creatureType as the search term in fallback', async () => {
    world.addPack({
      id: 'world.actors',
      label: 'Monsters',
      type: 'Actor',
      documents: [
        makeActor({ id: 'd1', name: 'Dragon Red', type: 'npc' }),
        makeActor({ id: 'h1', name: 'Humanoid Guard', type: 'npc' }),
      ],
    });

    const result = await da.listCreaturesByCriteria({ creatureType: 'dragon' });

    const names = result.creatures.map((c: any) => c.name);
    expect(names).toContain('Dragon Red');
    expect(names).not.toContain('Humanoid Guard');
  });

  it('uses CR-based name keywords for challengeRating >= 15', async () => {
    // CR >= 15 → fallbackBasicCreatureSearch pushes ['ancient', 'legendary'],
    // joins them as 'ancient legendary', so searchCompendium requires BOTH terms
    // in the name (AND semantics). 'Ancient Legendary Dragon' matches both words.
    world.addPack({
      id: 'world.actors',
      label: 'Monsters',
      type: 'Actor',
      documents: [
        makeActor({ id: 'a1', name: 'Ancient Legendary Dragon', type: 'npc' }),
        makeActor({ id: 'g1', name: 'Goblin', type: 'npc' }),
      ],
    });

    const result = await da.listCreaturesByCriteria({ challengeRating: 15 });

    const names = result.creatures.map((c: any) => c.name);
    expect(names).toContain('Ancient Legendary Dragon');
    expect(names).not.toContain('Goblin');
  });

  it('respects the limit parameter', async () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      makeActor({ id: `m${i}`, name: `Monster ${i}`, type: 'npc' })
    );
    world.addPack({ id: 'world.actors', label: 'Monsters', type: 'Actor', documents: docs });

    const result = await da.listCreaturesByCriteria({ limit: 3 });

    expect(result.creatures.length).toBeLessThanOrEqual(3);
  });

  it('totalCreaturesFound reflects results before the limit slice', async () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      makeActor({ id: `m${i}`, name: `Monster ${i}`, type: 'npc' })
    );
    world.addPack({ id: 'world.actors', label: 'Monsters', type: 'Actor', documents: docs });

    const result = await da.listCreaturesByCriteria({ limit: 2 });

    // totalCreaturesFound is basicResults.length (before slice), creatures is sliced
    expect(result.searchSummary.totalCreaturesFound).toBe(5);
    expect(result.creatures).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getCompendiumDocumentFull
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCompendiumDocumentFull', () => {
  it('throws when the pack is not found', async () => {
    await expect(da.getCompendiumDocumentFull('nonexistent.pack', 'doc1')).rejects.toThrow(
      'Compendium pack nonexistent.pack not found'
    );
  });

  it('throws when the document is not found in the pack', async () => {
    world.addPack({ id: 'world.monsters', label: 'Monsters', type: 'Actor', documents: [] });

    await expect(da.getCompendiumDocumentFull('world.monsters', 'missing-doc')).rejects.toThrow(
      'Document missing-doc not found in pack world.monsters'
    );
  });

  it('returns full document data for an existing actor', async () => {
    const actor = makeActor({
      id: 'goblin1',
      name: 'Goblin',
      type: 'npc',
      system: {
        details: { cr: 0.25, type: { value: 'humanoid' } },
        attributes: { hp: { value: 7 }, ac: { value: 15 } },
      },
    });
    world.addPack({
      id: 'world.monsters',
      label: 'Test Monsters',
      type: 'Actor',
      documents: [actor],
    });

    const result = await da.getCompendiumDocumentFull('world.monsters', 'goblin1');

    expect(result.id).toBe('goblin1');
    expect(result.name).toBe('Goblin');
    expect(result.type).toBe('npc');
    expect(result.pack).toBe('world.monsters');
    expect(result.packLabel).toBe('Test Monsters');
    expect(result.img).toBeUndefined();

    // system data should be present and sanitized
    expect(result.system).toMatchObject({
      details: { cr: 0.25, type: { value: 'humanoid' } },
      attributes: { hp: { value: 7 }, ac: { value: 15 } },
    });

    // fullData comes from toObject() + sanitize; _source is stripped by sanitizeData
    // (starts with '_' and isn't '_id')
    expect(result.fullData).toMatchObject({
      id: 'goblin1',
      name: 'Goblin',
      type: 'npc',
    });
    expect((result.fullData as any)['_source']).toBeUndefined();

    // items array should be present (empty since no items on this actor)
    expect(result.items).toEqual([]);

    // effects array should be present (empty since no effects on this actor)
    expect(result.effects).toEqual([]);
  });

  it('sanitizes sensitive fields out of system data', async () => {
    const actor = makeActor({
      id: 'spy1',
      name: 'Spy',
      type: 'npc',
      system: {
        details: { cr: 1 },
        // 'token' and 'secret' are sensitive and should be stripped
        token: 'super-secret-value',
        secret: 'my-secret',
        hp: 40,
      },
    });
    world.addPack({
      id: 'world.monsters',
      label: 'Monsters',
      type: 'Actor',
      documents: [actor],
    });

    const result = await da.getCompendiumDocumentFull('world.monsters', 'spy1');

    expect((result.system as any)['token']).toBeUndefined();
    expect((result.system as any)['secret']).toBeUndefined();
    // Non-sensitive field survives
    expect((result.system as any)['hp']).toBe(40);
  });

  it('includes img when the document has one', async () => {
    const actor = makeActor({
      id: 'dragon1',
      name: 'Red Dragon',
      type: 'npc',
      img: 'dragon.webp',
      system: {},
    });
    world.addPack({
      id: 'world.monsters',
      label: 'Monsters',
      type: 'Actor',
      documents: [actor],
    });

    const result = await da.getCompendiumDocumentFull('world.monsters', 'dragon1');

    expect(result.img).toBe('dragon.webp');
  });
});
