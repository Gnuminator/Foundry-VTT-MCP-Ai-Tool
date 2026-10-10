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
  makeEffect,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';
import {
  INDEX_CONCURRENCY,
  ITEM_SUMMARY_FIELDS,
  SUMMARY_FIELDS_BUDGET_MS,
} from './data-access/compendium.js';

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
    expect(results[0].img).toBeUndefined();
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
    expect(results[0].name).toBe('Cave Troll');
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
    expect(results[0].name).toBe('Ancient Red Dragon');
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
    expect(results[0].hasImage).toBe(true);
    expect(results[0].img).toBe('sword.webp');
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
    expect(results[0].hasImage).toBe(false);
    expect(results[0].img).toBeUndefined();
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
    expect(results[0].pack).toBe('world.actors');
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
    expect(results[0].pack).toBe('world.actors');
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
    expect(results[0].name).toBe('Goblin');
  });
});

describe('FoundryDataAccess: searchCompendium, Item summary fields (dnd5e 6)', () => {
  const chainMail = {
    _id: 'chain',
    name: 'Chain Mail',
    type: 'equipment',
    system: {
      identifier: 'chain-mail',
      source: { book: 'SRD' },
      type: { value: 'heavy' },
      armor: { value: 16 },
      price: { value: 75, denomination: 'gp' },
    },
  };

  /**
   * An Item pack that indexes like Foundry 14's CompendiumCollection: the plain index holds
   * names only, `getIndex` asks the server again only for fields it has not indexed yet, and
   * each server request replaces the indexed fields with the ones it asked for. `wait` runs
   * before every server request (to hold it open).
   */
  function itemPack(
    id: string,
    entries: Array<Record<string, any>>,
    fail?: 'fields' | 'all',
    wait?: (fields: string[]) => Promise<void>
  ): { pack: ReturnType<TestWorld['addPack']>; server: ReturnType<typeof vi.fn> } {
    const pack = world.addPack({ id, label: id, type: 'Item' });
    let indexedFields = new Set<string>();
    pack.indexed = false;
    pack.index = new Map();
    const server = vi.fn(async (fields: string[]) => {
      if (wait) await wait(fields);
      if (fail === 'all' || (fail === 'fields' && fields.length > 0)) throw new Error('timeout');
      pack.index = new Map(
        entries.map(e => [
          e._id,
          fields.length > 0 ? { ...e } : { _id: e._id, name: e.name, type: e.type },
        ])
      );
    });
    pack.getIndex = vi.fn(async ({ fields = [] }: { fields?: string[] } = {}) => {
      if (pack.indexed && fields.every(f => indexedFields.has(f))) return pack.index;
      await server(fields);
      indexedFields = new Set(fields);
      pack.indexed = true;
      return pack.index;
    });
    return { pack, server };
  }

  it('asks for the summary fields once a name matches, and returns their system', async () => {
    const { pack, server } = itemPack('dnd5e.items', [chainMail]);

    const first = await da.searchCompendium('chain mail');
    await da.searchCompendium('chain');

    expect(pack.getIndex).toHaveBeenCalledWith({ fields: ITEM_SUMMARY_FIELDS });
    expect(server).toHaveBeenCalledTimes(2); // the plain index, then the fields once
    expect(ITEM_SUMMARY_FIELDS).toEqual(
      expect.arrayContaining([
        'system.type.value',
        'system.armor.value',
        'system.damage.base',
        'system.rarity',
        'system.rarities',
      ])
    );
    expect(first[0].system).toEqual({
      type: { value: 'heavy' },
      armor: { value: 16 },
      price: { value: 75, denomination: 'gp' },
    });
  });

  it('leaves Item packs without a name match on their plain index', async () => {
    const items = itemPack('dnd5e.items', [chainMail]);
    const loot = itemPack('world.loot', [
      { _id: 'cloak', name: 'Cloak of Displacement', type: 'equipment', system: {} },
    ]);

    const results = await da.searchCompendium('chain');

    expect(results.map(r => r.name)).toEqual(['Chain Mail']);
    expect(items.pack.getIndex).toHaveBeenCalledWith({ fields: ITEM_SUMMARY_FIELDS });
    expect(loot.pack.getIndex).not.toHaveBeenCalledWith({ fields: ITEM_SUMMARY_FIELDS });
  });

  it('keeps the plain entries when the summary fields request fails', async () => {
    itemPack('dnd5e.items', [chainMail], 'fields');

    const results = await da.searchCompendium('chain');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Chain Mail', system: {} });
  });

  it('passes the dnd5e 6 rarities list through', async () => {
    itemPack('world.loot', [
      { _id: 'cloak', name: 'Cloak', type: 'equipment', system: { rarities: ['veryRare'] } },
    ]);
    const results = await da.searchCompendium('cloak');
    expect(results[0].system).toEqual({ rarities: ['veryRare'] });
  });

  it('searches the other packs when one fails to index', async () => {
    itemPack('broken.items', [chainMail], 'all');
    itemPack('dnd5e.items', [chainMail]);

    const results = await da.searchCompendium('chain');

    expect(results.map(r => r.pack)).toEqual(['dnd5e.items']);
  });

  it('asks again when another caller replaced the indexed fields', async () => {
    const { pack, server } = itemPack('dnd5e.items', [chainMail]);

    await da.searchCompendium('chain');
    await pack.getIndex({ fields: ['system.weight'] }); // say, another module
    const results = await da.searchCompendium('chain');

    expect(server).toHaveBeenCalledTimes(4); // plain, ours, theirs, ours again
    expect(server).toHaveBeenLastCalledWith(ITEM_SUMMARY_FIELDS);
    expect(results[0].system).toMatchObject({ armor: { value: 16 } });
  });

  it('shares one summary fields request between searches running at once', async () => {
    const { server } = itemPack('dnd5e.items', [chainMail]);

    const [a, b] = await Promise.all([
      da.searchCompendium('chain'),
      da.searchCompendium('chain mail'),
    ]);

    expect(server.mock.calls.filter(([fields]) => fields.length > 0)).toHaveLength(1);
    expect(a[0].system).toMatchObject({ armor: { value: 16 } });
    expect(b[0].system).toMatchObject({ armor: { value: 16 } });
  });

  it('returns the plain entries when the summary fields pass the time budget', async () => {
    vi.useFakeTimers();
    try {
      let finish = (): void => {};
      const { server } = itemPack('dnd5e.items', [chainMail], undefined, fields =>
        fields.length > 0 ? new Promise<void>(resolve => (finish = resolve)) : Promise.resolve()
      );

      const slow = da.searchCompendium('chain');
      await vi.advanceTimersByTimeAsync(SUMMARY_FIELDS_BUDGET_MS - 1);
      let settled = false;
      void slow.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const first = await slow;

      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ name: 'Chain Mail', system: {} });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Summary fields for 1'));

      // Foundry finishes the request after all, so the next search has the fields at once
      finish();
      await vi.advanceTimersByTimeAsync(0);
      const next = await da.searchCompendium('chain');
      expect(next[0].system).toMatchObject({ armor: { value: 16 } });
      expect(server.mock.calls.filter(([fields]) => fields.length > 0)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it(`indexes at most ${INDEX_CONCURRENCY} packs at once`, async () => {
    let running = 0;
    let most = 0;
    // Plain index requests only: the summary fields go out at once, under the time budget
    const wait = async (fields: string[]): Promise<void> => {
      if (fields.length > 0) return;
      running += 1;
      most = Math.max(most, running);
      await new Promise(resolve => setTimeout(resolve, 1));
      running -= 1;
    };
    for (let i = 0; i < INDEX_CONCURRENCY * 2 + 1; i += 1) {
      itemPack(`world.pack${i}`, [{ ...chainMail, _id: `chain${i}` }], undefined, wait);
    }

    const results = await da.searchCompendium('chain');

    expect(results).toHaveLength(INDEX_CONCURRENCY * 2 + 1);
    expect(most).toBe(INDEX_CONCURRENCY);
  });

  it('sends no system for Actor packs', async () => {
    world.addPack({
      id: 'world.monsters',
      label: 'Monsters',
      type: 'Actor',
      documents: [makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })],
    });
    const results = await da.searchCompendium('goblin');
    expect(results[0]).not.toHaveProperty('system');
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
// searchCompendium — enhanced fast path (index ON)
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — searchCompendium — enhanced fast path', () => {
  it('passes challengeRating 0 to the enhanced index instead of dropping it', async () => {
    world.setSetting('foundry-mcp-bridge', 'enableEnhancedCreatureIndex', true);
    const compendium = (da as any).compendium;
    const spy = vi
      .spyOn(compendium, 'listCreaturesByCriteria')
      .mockResolvedValue({ creatures: [{ id: 'rat', name: 'Rat', pack: 'p', packLabel: 'P' }] });

    const result = await da.searchCompendium('rat', 'Actor', { challengeRating: 0 });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ challengeRating: 0 }));
    expect(result.map(r => r.name)).toEqual(['Rat']);
  });
});

// ---------------------------------------------------------------------------
// listCreaturesByCriteria — enhanced index ON: criteria matching (M3)
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — listCreaturesByCriteria (enhanced index matching)', () => {
  const entry = (over: Record<string, unknown>): Record<string, unknown> => ({
    id: String(over.name),
    type: 'npc',
    pack: 'world.monsters',
    packLabel: 'Monsters',
    challengeRating: 1,
    creatureType: 'beast',
    size: 'med',
    hitPoints: 10,
    armorClass: 12,
    hasSpells: false,
    hasLegendaryActions: false,
    alignment: '',
    ...over,
  });

  beforeEach(() => {
    world.setSetting('foundry-mcp-bridge', 'enableEnhancedCreatureIndex', true);
    const index = (da as any).compendium.persistentIndex;
    vi.spyOn(index, 'getEnhancedIndex').mockResolvedValue([
      // The index stores dnd5e's own size keys (CONFIG.DND5E.actorSizes).
      entry({ name: 'Wolf', size: 'med' }),
      entry({ name: 'Brown Bear', size: 'lg' }),
      entry({ name: 'Mage', size: 'med', hasSpells: true }),
      entry({ name: 'Adult Dragon', size: 'huge', hasLegendaryActions: true }),
      entry({ name: 'Odd Thing', size: 'colossal' }),
    ]);
  });

  const names = async (criteria: Record<string, unknown>): Promise<string[]> =>
    (await da.listCreaturesByCriteria(criteria)).creatures.map(c => c.name).sort();

  it('matches a size given as the display word or as the dnd5e key (found in M3)', async () => {
    expect(await names({ size: 'medium' })).toEqual(['Mage', 'Wolf']);
    expect(await names({ size: 'med' })).toEqual(['Mage', 'Wolf']);
    expect(await names({ size: 'Large' })).toEqual(['Brown Bear']);
    expect(await names({ size: 'lg' })).toEqual(['Brown Bear']);
  });

  it('still matches an index persisted with display words by an older module', async () => {
    const index = (da as any).compendium.persistentIndex;
    vi.spyOn(index, 'getEnhancedIndex').mockResolvedValue([
      entry({ name: 'Old Wolf', size: 'medium' }),
    ]);
    expect(await names({ size: 'med' })).toEqual(['Old Wolf']);
    expect(await names({ size: 'medium' })).toEqual(['Old Wolf']);
  });

  it('compares a size no dnd5e key knows as plain text', async () => {
    expect(await names({ size: 'colossal' })).toEqual(['Odd Thing']);
    expect(await names({ size: 'medium' })).not.toContain('Odd Thing');
  });

  it('filters spellcasting and legendary actions both ways', async () => {
    expect(await names({ hasSpells: true })).toEqual(['Mage']);
    expect(await names({ hasSpells: false })).not.toContain('Mage');
    expect(await names({ hasLegendaryActions: true })).toEqual(['Adult Dragon']);
    expect(await names({ size: 'medium', hasSpells: false })).toEqual(['Wolf']);
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

  it('effects: icon prefers img (v14 has no icon field), falls back to the legacy icon (v13)', async () => {
    const actor = makeActor({
      id: 'lich1',
      name: 'Lich',
      type: 'npc',
      system: {},
      effects: [
        makeEffect({ id: 'e-v14', name: 'Frightful', img: 'new.webp' }),
        makeEffect({ id: 'e-v13', name: 'Legacy', icon: 'old.svg' }),
        makeEffect({ id: 'e-none', name: 'No Icon' }),
      ],
    });
    world.addPack({
      id: 'world.monsters',
      label: 'Monsters',
      type: 'Actor',
      documents: [actor],
    });

    const result = await da.getCompendiumDocumentFull('world.monsters', 'lich1');

    expect(result.effects).toEqual([
      { id: 'e-v14', name: 'Frightful', icon: 'new.webp', disabled: false, duration: {} },
      { id: 'e-v13', name: 'Legacy', icon: 'old.svg', disabled: false, duration: {} },
      { id: 'e-none', name: 'No Icon', icon: undefined, disabled: false, duration: {} },
    ]);
  });
});
