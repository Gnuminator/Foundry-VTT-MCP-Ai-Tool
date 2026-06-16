import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompendiumTools } from './compendium.js';
import { clearSystemCache } from '../utils/system-detection.js';

/**
 * Characterization tests for CompendiumTools — a thin, deterministic layer over
 * FoundryClient.query.  Pattern: validate args → dispatch the correct
 * `foundry-mcp-bridge.*` method → propagate foundry-side failures (always throw)
 * → shape / transform the result via private helpers.
 *
 * NOTE on system-detection:  detectGameSystem() caches the result in a module-level
 * variable.  We import clearSystemCache() and call it in afterEach so each test
 * starts clean.  handleSearchCompendium and handleListCreaturesByCriteria call
 * getGameSystem() which triggers getWorldInfo; we satisfy that by making the first
 * call (or a dedicated dispatch) return { system: 'dnd5e' }.
 */

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a CompendiumTools instance with a mocked FoundryClient.
 *
 * `queryImpl` receives every call — use a Jest-style conditional if you need
 * different responses per method (e.g., first call returns world info, second
 * returns the payload).
 */
function makeTools(queryImpl?: (method: string, data?: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? (() => ({ success: true })));
  const foundryClient = { query } as any;

  // Minimal Logger stub: .child() returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;

  // systemRegistry is optional; we pass undefined here (handlers don't use it
  // for their core dispatch logic — they rely on detectGameSystem instead).
  return { tools: new CompendiumTools({ foundryClient, logger }), query };
}

/**
 * Build a query mock that:
 *  - Returns worldInfo on getWorldInfo (for detectGameSystem)
 *  - Returns `payload` on all other calls
 */
function makeQueryWithSystem(
  system: string,
  payload: unknown
): (method: string, data?: unknown) => unknown {
  let firstCall = true;
  return (method: string) => {
    if (method === 'foundry-mcp-bridge.getWorldInfo' && firstCall) {
      firstCall = false;
      return { system };
    }
    return payload;
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  // Clear module-level game-system cache so each test starts fresh.
  clearSystemCache();
});

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('CompendiumTools.getToolDefinitions', () => {
  it('exposes exactly four compendium tools in the correct order', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'search-compendium',
      'get-compendium-item',
      'list-creatures-by-criteria',
      'list-compendium-packs',
    ]);
  });

  it('all tool definitions have object input schemas', () => {
    const { tools } = makeTools();
    for (const d of tools.getToolDefinitions()) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('search-compendium requires only "query"', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === 'search-compendium')!;
    expect((def.inputSchema as any).required).toEqual(['query']);
  });

  it('get-compendium-item requires packId and itemId', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === 'get-compendium-item')!;
    expect((def.inputSchema as any).required).toEqual(['packId', 'itemId']);
  });

  it('list-creatures-by-criteria has an empty required array (all fields optional)', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === 'list-creatures-by-criteria')!;
    // The source schema declares required: [] (empty array — no required fields).
    expect((def.inputSchema as any).required).toEqual([]);
  });

  it('list-compendium-packs has no required fields', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === 'list-compendium-packs')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });

  it('search-compendium declares packType, filters, and limit properties', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === 'search-compendium')!;
    const props = (def.inputSchema as any).properties;
    expect(props).toHaveProperty('query');
    expect(props).toHaveProperty('packType');
    expect(props).toHaveProperty('filters');
    expect(props).toHaveProperty('limit');
  });

  it('get-compendium-item declares compact property', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === 'get-compendium-item')!;
    const props = (def.inputSchema as any).properties;
    expect(props).toHaveProperty('compact');
  });

  it('list-creatures-by-criteria declares challengeRating, creatureType, hasSpells', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === 'list-creatures-by-criteria')!;
    const props = (def.inputSchema as any).properties;
    expect(props).toHaveProperty('challengeRating');
    expect(props).toHaveProperty('creatureType');
    expect(props).toHaveProperty('hasSpells');
  });

  it('list-compendium-packs declares type property', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === 'list-compendium-packs')!;
    const props = (def.inputSchema as any).properties;
    expect(props).toHaveProperty('type');
  });
});

// ---------------------------------------------------------------------------
// handleSearchCompendium
// ---------------------------------------------------------------------------

describe('CompendiumTools.handleSearchCompendium', () => {
  /** Minimal compendium search response from the bridge. */
  const searchResults = [
    {
      id: 'item-1',
      name: 'Ancient Red Dragon',
      type: 'npc',
      pack: 'dnd5e.monsters',
      packLabel: 'D&D Monsters',
      img: 'dragon.png',
      system: {
        details: { cr: 24, type: { value: 'dragon' }, alignment: 'chaotic evil' },
        attributes: { hp: { value: 546, max: 546 }, ac: { value: 22 } },
        traits: { size: 'gargantuan' },
      },
    },
    {
      id: 'item-2',
      name: 'Young Red Dragon',
      type: 'npc',
      pack: 'dnd5e.monsters',
      packLabel: 'D&D Monsters',
      img: '',
      system: {
        details: { cr: 10, type: { value: 'dragon' } },
        attributes: { hp: { value: 178, max: 178 }, ac: { value: 18 } },
        traits: { size: 'large' },
      },
    },
  ];

  it('dispatches foundry-mcp-bridge.searchCompendium with query and packType', async () => {
    const { tools, query } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    await tools.handleSearchCompendium({ query: 'dragon', packType: 'Actor' });

    const compendiumCall = query.mock.calls.find(
      ([m]) => m === 'foundry-mcp-bridge.searchCompendium'
    );
    expect(compendiumCall).toBeDefined();
    expect(compendiumCall![1]).toMatchObject({ query: 'dragon', packType: 'Actor' });
  });

  it('dispatches foundry-mcp-bridge.searchCompendium without packType when omitted', async () => {
    const { tools, query } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    await tools.handleSearchCompendium({ query: 'goblin' });

    const compendiumCall = query.mock.calls.find(
      ([m]) => m === 'foundry-mcp-bridge.searchCompendium'
    );
    expect(compendiumCall).toBeDefined();
    expect(compendiumCall![1]).toMatchObject({ query: 'goblin' });
  });

  it('returns top-level envelope fields: query, gameSystem, filterDescription, results, totalFound, showing, hasMore', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    const result = await tools.handleSearchCompendium({ query: 'dragon' });

    expect(result).toHaveProperty('query', 'dragon');
    expect(result).toHaveProperty('gameSystem', 'dnd5e');
    expect(result).toHaveProperty('filterDescription');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('totalFound');
    expect(result).toHaveProperty('showing');
    expect(result).toHaveProperty('hasMore');
  });

  it('filterDescription is "no filters" when no filters provided', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    const result = await tools.handleSearchCompendium({ query: 'dragon' });
    expect(result.filterDescription).toBe('no filters');
  });

  it('filterDescription reflects CR filter when filters.challengeRating is provided', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    const result = await tools.handleSearchCompendium({
      query: 'dragon',
      filters: { challengeRating: 10 },
    });
    expect(result.filterDescription).toMatch(/CR 10/);
  });

  it('shapes each result item: id, name, type, pack object, description, hasImage, summary', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    const result = await tools.handleSearchCompendium({ query: 'dragon' });

    const first = result.results[0];
    expect(first).toHaveProperty('id', 'item-1');
    expect(first).toHaveProperty('name', 'Ancient Red Dragon');
    expect(first).toHaveProperty('type', 'npc');
    expect(first.pack).toEqual({ id: 'dnd5e.monsters', label: 'D&D Monsters' });
    expect(first).toHaveProperty('description');
    expect(first).toHaveProperty('hasImage', true); // img: 'dragon.png'
    expect(first).toHaveProperty('summary');
  });

  it('shapes hasImage=false for item with empty img string', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    const result = await tools.handleSearchCompendium({ query: 'dragon' });
    const second = result.results[1];
    expect(second.hasImage).toBe(false);
  });

  it('shapes NPC stats block: challengeRating and creatureType for dnd5e', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    const result = await tools.handleSearchCompendium({ query: 'dragon' });

    const first = result.results[0];
    // formatCompendiumItem adds .stats for npc/character types under dnd5e
    expect(first.stats).toBeDefined();
    expect(first.stats.challengeRating).toBe(24);
    expect(first.stats.creatureType).toBe('dragon');
  });

  it('respects limit: slices results and sets hasMore=true when there are more', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    // limit=1 → only first result returned; totalFound=2 → hasMore=true
    const result = await tools.handleSearchCompendium({ query: 'dragon', limit: 1 });
    expect(result.results).toHaveLength(1);
    expect(result.totalFound).toBe(2);
    expect(result.showing).toBe(1);
    expect(result.hasMore).toBe(true);
  });

  it('hasMore=false when results fit within limit', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    const result = await tools.handleSearchCompendium({ query: 'dragon', limit: 50 });
    expect(result.hasMore).toBe(false);
  });

  it('throws when the Foundry client throws during search', async () => {
    let callCount = 0;
    const { tools } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.getWorldInfo') {
        callCount++;
        if (callCount === 1) return { system: 'dnd5e' };
      }
      throw new Error('bridge error');
    });
    await expect(tools.handleSearchCompendium({ query: 'dragon' })).rejects.toThrow(
      'Failed to search compendium: bridge error'
    );
  });

  it('throws (ZodError) when query is shorter than 2 characters', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', []));
    await expect(tools.handleSearchCompendium({ query: 'x' })).rejects.toThrow();
  });

  it('throws (ZodError) when query is missing', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', []));
    await expect(tools.handleSearchCompendium({})).rejects.toThrow();
  });

  it('accepts string args (MCP fallback) — wraps string as { query }', async () => {
    const { tools, query } = makeTools(makeQueryWithSystem('dnd5e', searchResults));
    // handleSearchCompendium catches ZodError and retries when args is a plain string
    const result = await tools.handleSearchCompendium('goblin' as any);
    expect(result.query).toBe('goblin');
    const compendiumCall = query.mock.calls.find(
      ([m]) => m === 'foundry-mcp-bridge.searchCompendium'
    );
    expect(compendiumCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// handleGetCompendiumItem
// ---------------------------------------------------------------------------

describe('CompendiumTools.handleGetCompendiumItem', () => {
  /** Full item payload returned by foundry-mcp-bridge.getCompendiumDocumentFull */
  const fullItem = {
    id: 'abc123',
    name: 'Adult Blue Dragon',
    type: 'npc',
    pack: 'dnd5e.monsters',
    packLabel: 'D&D SRD Monsters',
    img: 'dragon-blue.png',
    items: [
      { name: 'Bite', type: 'weapon' },
      { name: 'Claw', type: 'weapon' },
    ],
    effects: [{ label: 'Lightning Damage', icon: '' }],
    fullData: { raw: true },
    system: {
      description: { value: '<p>A powerful blue dragon with lightning breath.</p>' },
      details: {
        cr: 16,
        type: { value: 'dragon' },
        alignment: 'lawful evil',
        spellLevel: 0,
      },
      attributes: {
        hp: { value: 225, max: 225 },
        ac: { value: 19 },
        movement: { walk: 40, fly: 80 },
      },
      traits: { size: 'huge' },
      abilities: {
        str: { value: 25 },
        dex: { value: 10 },
        con: { value: 23 },
        int: { value: 16 },
        wis: { value: 13 },
        cha: { value: 20 },
      },
    },
  };

  it('dispatches foundry-mcp-bridge.getCompendiumDocumentFull with packId and documentId', async () => {
    const { tools, query } = makeTools(() => fullItem);
    await tools.handleGetCompendiumItem({ packId: 'dnd5e.monsters', itemId: 'abc123' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCompendiumDocumentFull', {
      packId: 'dnd5e.monsters',
      documentId: 'abc123',
    });
  });

  it('returns base fields: id, name, type, pack, description, hasImage, imageUrl in full mode', async () => {
    const { tools } = makeTools(() => fullItem);
    const result = await tools.handleGetCompendiumItem({
      packId: 'dnd5e.monsters',
      itemId: 'abc123',
    });
    expect(result.id).toBe('abc123');
    expect(result.name).toBe('Adult Blue Dragon');
    expect(result.type).toBe('npc');
    expect(result.pack).toEqual({ id: 'dnd5e.monsters', label: 'D&D SRD Monsters' });
    expect(result.hasImage).toBe(true);
    expect(result.imageUrl).toBe('dragon-blue.png');
    expect(result.mode).toBe('full');
  });

  it('full mode includes system, properties, items, effects, fullData', async () => {
    const { tools } = makeTools(() => fullItem);
    const result = await tools.handleGetCompendiumItem({
      packId: 'dnd5e.monsters',
      itemId: 'abc123',
    });
    expect(result.items).toHaveLength(2);
    expect(result.effects).toHaveLength(1);
    expect(result.fullData).toEqual({ raw: true });
    expect(result.system).toBeDefined();
    // sanitizeSystemData removes description and details from system
    expect(result.system).not.toHaveProperty('description');
    expect(result.system).not.toHaveProperty('details');
    // Other system fields remain
    expect(result.system).toHaveProperty('attributes');
    expect(result.system).toHaveProperty('abilities');
  });

  it('full mode description strips HTML tags from system.description.value', async () => {
    const { tools } = makeTools(() => fullItem);
    const result = await tools.handleGetCompendiumItem({
      packId: 'dnd5e.monsters',
      itemId: 'abc123',
    });
    // extractDescription strips <p> tags and truncates to 200 chars
    expect(result.description).not.toMatch(/<p>/);
    expect(result.description).toContain('powerful blue dragon');
  });

  it('compact mode returns stats block and properties; sets mode="compact"', async () => {
    const { tools } = makeTools(() => fullItem);
    const result = await tools.handleGetCompendiumItem({
      packId: 'dnd5e.monsters',
      itemId: 'abc123',
      compact: true,
    });
    expect(result.mode).toBe('compact');
    expect(result.stats).toBeDefined();
    // extractCompactStats picks up ac, hp, cr
    expect(result.stats.armorClass).toBe(19);
    expect(result.stats.hitPoints).toBe(225);
    expect(result.stats.challengeRating).toBe(16);
  });

  it('compact mode limits items to 5', async () => {
    const manyItems = [1, 2, 3, 4, 5, 6, 7].map(i => ({ name: `Item ${i}`, type: 'weapon' }));
    const { tools } = makeTools(() => ({ ...fullItem, items: manyItems }));
    const result = await tools.handleGetCompendiumItem({
      packId: 'dnd5e.monsters',
      itemId: 'abc123',
      compact: true,
    });
    expect(result.items).toHaveLength(5);
  });

  it('compact mode extractCompactStats includes speed when movement defined', async () => {
    const { tools } = makeTools(() => fullItem);
    const result = await tools.handleGetCompendiumItem({
      packId: 'dnd5e.monsters',
      itemId: 'abc123',
      compact: true,
    });
    // system.attributes.movement: { walk: 40, fly: 80 }
    expect(result.stats.speed).toBe('40 ft, fly 80 ft');
  });

  it('compact mode extractCompactStats includes abilities with significant modifiers (|mod|>=2)', async () => {
    const { tools } = makeTools(() => fullItem);
    const result = await tools.handleGetCompendiumItem({
      packId: 'dnd5e.monsters',
      itemId: 'abc123',
      compact: true,
    });
    // STR=25 mod=+7, CON=23 mod=+6, CHA=20 mod=+5, INT=16 mod=+3 (all ≥2)
    // DEX=10 mod=0, WIS=13 mod=+1 (|mod|<2, excluded)
    expect(result.stats.abilities).toBeDefined();
    expect(result.stats.abilities['STR']).toEqual({ value: 25, modifier: 7 });
    expect(result.stats.abilities['DEX']).toBeUndefined(); // mod=0, filtered
    expect(result.stats.abilities['WIS']).toBeUndefined(); // mod=1, filtered
  });

  it('throws when item is not found (null returned by bridge)', async () => {
    const { tools } = makeTools(() => null);
    await expect(
      tools.handleGetCompendiumItem({ packId: 'dnd5e.monsters', itemId: 'missing-id' })
    ).rejects.toThrow('Item missing-id not found in pack dnd5e.monsters');
  });

  it('throws (wraps message) when the Foundry client throws', async () => {
    const { tools } = makeTools(() => {
      throw new Error('pack not found');
    });
    await expect(
      tools.handleGetCompendiumItem({ packId: 'bad.pack', itemId: 'abc' })
    ).rejects.toThrow('Failed to retrieve item: pack not found');
  });

  it('throws (ZodError) when packId is missing', async () => {
    const { tools } = makeTools(() => fullItem);
    await expect(tools.handleGetCompendiumItem({ itemId: 'abc123' })).rejects.toThrow();
  });

  it('throws (ZodError) when itemId is missing', async () => {
    const { tools } = makeTools(() => fullItem);
    await expect(tools.handleGetCompendiumItem({ packId: 'dnd5e.monsters' })).rejects.toThrow();
  });

  it('throws (ZodError) when packId is an empty string', async () => {
    const { tools } = makeTools(() => fullItem);
    await expect(tools.handleGetCompendiumItem({ packId: '', itemId: 'abc123' })).rejects.toThrow();
  });

  it('defaults compact to false when not specified', async () => {
    const { tools } = makeTools(() => fullItem);
    const result = await tools.handleGetCompendiumItem({
      packId: 'dnd5e.monsters',
      itemId: 'abc123',
    });
    expect(result.mode).toBe('full');
    // full mode has fullDescription; compact mode does not
    expect(result).toHaveProperty('fullDescription');
  });
});

// ---------------------------------------------------------------------------
// handleListCreaturesByCriteria
// ---------------------------------------------------------------------------

describe('CompendiumTools.handleListCreaturesByCriteria', () => {
  /**
   * Bridge response in the nested { response: { creatures, searchSummary } } shape
   * which the handler handles via results.response?.creatures || results.
   */
  const bridgeResponse = {
    response: {
      creatures: [
        {
          id: 'goblin-1',
          name: 'Goblin',
          pack: 'dnd5e.monsters',
          packLabel: 'SRD Monsters',
          system: {
            details: { cr: 0.25, type: { value: 'humanoid' } },
            attributes: { hp: { value: 7, max: 7 }, ac: { value: 15 } },
            traits: { size: 'small' },
          },
        },
        {
          id: 'hobgoblin-1',
          name: 'Hobgoblin',
          pack: 'dnd5e.monsters',
          packLabel: 'SRD Monsters',
          system: {
            details: { cr: 0.5, type: { value: 'humanoid' } },
            attributes: { hp: { value: 11, max: 11 }, ac: { value: 18 } },
            traits: { size: 'medium' },
          },
        },
      ],
      searchSummary: {
        packsSearched: 3,
        topPacks: ['dnd5e.monsters'],
        totalCreaturesFound: 2,
      },
    },
  };

  it('dispatches foundry-mcp-bridge.listCreaturesByCriteria with parsed params', async () => {
    const { tools, query } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    await tools.handleListCreaturesByCriteria({ challengeRating: 1, creatureType: 'humanoid' });

    const listCall = query.mock.calls.find(
      ([m]) => m === 'foundry-mcp-bridge.listCreaturesByCriteria'
    );
    expect(listCall).toBeDefined();
    expect(listCall![1]).toMatchObject({ challengeRating: 1, creatureType: 'humanoid' });
  });

  it('dispatches with empty params when called with no args', async () => {
    const { tools, query } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    await tools.handleListCreaturesByCriteria({});

    const listCall = query.mock.calls.find(
      ([m]) => m === 'foundry-mcp-bridge.listCreaturesByCriteria'
    );
    expect(listCall).toBeDefined();
  });

  it('returns top-level envelope: gameSystem, criteriaDescription, creatures, totalFound, criteria, searchSummary, optimizationNote', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    const result = await tools.handleListCreaturesByCriteria({ challengeRating: 1 });

    expect(result).toHaveProperty('gameSystem', 'dnd5e');
    expect(result).toHaveProperty('criteriaDescription');
    expect(result).toHaveProperty('creatures');
    expect(result).toHaveProperty('totalFound');
    expect(result).toHaveProperty('criteria');
    expect(result).toHaveProperty('searchSummary');
    expect(result).toHaveProperty('optimizationNote');
  });

  it('criteriaDescription includes CR when challengeRating number provided', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    const result = await tools.handleListCreaturesByCriteria({ challengeRating: 5 });
    expect(result.criteriaDescription).toMatch(/CR 5/);
  });

  it('criteriaDescription is "no criteria" when no filters passed', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    const result = await tools.handleListCreaturesByCriteria({});
    expect(result.criteriaDescription).toBe('no criteria');
  });

  it('shapes creature list items: name, id, pack with D&D 5e fields (challengeRating, creatureType, size, flags)', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    const result = await tools.handleListCreaturesByCriteria({});

    const goblin = result.creatures[0];
    expect(goblin.name).toBe('Goblin');
    expect(goblin.id).toBe('goblin-1');
    expect(goblin.pack).toEqual({ id: 'dnd5e.monsters', label: 'SRD Monsters' });
    // formatCreatureListItem under dnd5e uses getCreatureLevel → system.details.cr
    expect(goblin.challengeRating).toBe(0.25);
    // getCreatureType → system.details.type.value
    expect(goblin.creatureType).toBe('humanoid');
    expect(goblin.flags).toBeDefined();
    expect(goblin.flags.spellcaster).toBe(false);
    expect(goblin.flags.legendary).toBe(false);
    expect(goblin.flags.undead).toBe(false);
    expect(goblin.flags.dragon).toBe(false);
    expect(goblin.flags.fiend).toBe(false);
  });

  it('totalFound reflects response.creatures.length from bridge response', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    const result = await tools.handleListCreaturesByCriteria({});
    expect(result.totalFound).toBe(2);
  });

  it('searchSummary merges bridge searchSummary with D&D 5e searchStrategy text', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    const result = await tools.handleListCreaturesByCriteria({});
    expect(result.searchSummary.packsSearched).toBe(3);
    expect(result.searchSummary.searchStrategy).toMatch(/D&D 5e/);
    expect(result.searchSummary.note).toBe(
      'Packs searched in priority order to find most relevant creatures first'
    );
  });

  it('handles flat creatures array response (no nested response wrapper)', async () => {
    // Some bridge versions return a flat array; handler falls back via `results.response?.creatures || results`
    const flatArray = [
      {
        id: 'orc-1',
        name: 'Orc',
        pack: 'dnd5e.monsters',
        packLabel: 'SRD Monsters',
        challengeRating: 0.5,
        creatureType: 'humanoid',
        size: 'medium',
        hasSpells: false,
        hasLegendaryActions: false,
        system: {},
      },
    ];
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', flatArray));
    const result = await tools.handleListCreaturesByCriteria({});
    // Falls back to legacy shaping (gameSystem passed but creature has no system.details.cr)
    expect(result.creatures).toHaveLength(1);
    expect(result.creatures[0].name).toBe('Orc');
  });

  it('parses challengeRating as string number ("5") via union transform', async () => {
    const { tools, query } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    await tools.handleListCreaturesByCriteria({ challengeRating: '5' as any });
    const listCall = query.mock.calls.find(
      ([m]) => m === 'foundry-mcp-bridge.listCreaturesByCriteria'
    );
    // schema transforms "5" → 5
    expect(listCall![1]).toMatchObject({ challengeRating: 5 });
  });

  it('throws with Parameter validation failed when challengeRating is invalid', async () => {
    const { tools } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    await expect(
      tools.handleListCreaturesByCriteria({ challengeRating: 'not-a-number' })
    ).rejects.toThrow(/Parameter validation failed/);
  });

  it('does not dispatch bridge call when validation fails', async () => {
    const { tools, query } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    try {
      await tools.handleListCreaturesByCriteria({ challengeRating: 'bad' });
    } catch {
      // expected
    }
    const listCall = query.mock.calls.find(
      ([m]) => m === 'foundry-mcp-bridge.listCreaturesByCriteria'
    );
    expect(listCall).toBeUndefined();
  });

  it('throws (wraps message) when the Foundry client throws during listing', async () => {
    let firstCall = true;
    const { tools } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.getWorldInfo' && firstCall) {
        firstCall = false;
        return { system: 'dnd5e' };
      }
      throw new Error('database timeout');
    });
    await expect(tools.handleListCreaturesByCriteria({})).rejects.toThrow(
      'Failed to list creatures: database timeout'
    );
  });

  it('accepts challengeRating as object { min, max }', async () => {
    const { tools, query } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    await tools.handleListCreaturesByCriteria({ challengeRating: { min: 5, max: 10 } });
    const listCall = query.mock.calls.find(
      ([m]) => m === 'foundry-mcp-bridge.listCreaturesByCriteria'
    );
    expect(listCall![1]).toMatchObject({ challengeRating: { min: 5, max: 10 } });
  });

  it('default limit is 100 when not specified', async () => {
    const { tools, query } = makeTools(makeQueryWithSystem('dnd5e', bridgeResponse));
    await tools.handleListCreaturesByCriteria({});
    const listCall = query.mock.calls.find(
      ([m]) => m === 'foundry-mcp-bridge.listCreaturesByCriteria'
    );
    expect((listCall![1] as any).limit).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// handleListCompendiumPacks
// ---------------------------------------------------------------------------

describe('CompendiumTools.handleListCompendiumPacks', () => {
  /** Representative packs response from foundry-mcp-bridge.getAvailablePacks */
  const allPacks = [
    {
      id: 'dnd5e.monsters',
      label: 'SRD Monsters',
      type: 'Actor',
      system: 'dnd5e',
      private: false,
    },
    {
      id: 'dnd5e.spells',
      label: 'SRD Spells',
      type: 'Item',
      system: 'dnd5e',
      private: false,
    },
    {
      id: 'world.custom',
      label: 'Custom World Pack',
      type: 'JournalEntry',
      system: null,
      private: true,
    },
  ];

  it('dispatches foundry-mcp-bridge.getAvailablePacks with no params', async () => {
    const { tools, query } = makeTools(() => allPacks);
    await tools.handleListCompendiumPacks({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getAvailablePacks');
  });

  it('returns all packs when no type filter given', async () => {
    const { tools } = makeTools(() => allPacks);
    const result = await tools.handleListCompendiumPacks({});
    expect(result.total).toBe(3);
    expect(result.packs).toHaveLength(3);
  });

  it('filters by type when type argument is provided', async () => {
    const { tools } = makeTools(() => allPacks);
    const result = await tools.handleListCompendiumPacks({ type: 'Actor' });
    expect(result.total).toBe(1);
    expect(result.packs[0].id).toBe('dnd5e.monsters');
    expect(result.packs[0].type).toBe('Actor');
  });

  it('shapes each pack with id, label, type, system, private fields', async () => {
    const { tools } = makeTools(() => allPacks);
    const result = await tools.handleListCompendiumPacks({});
    const first = result.packs[0];
    expect(first).toEqual({
      id: 'dnd5e.monsters',
      label: 'SRD Monsters',
      type: 'Actor',
      system: 'dnd5e',
      private: false,
    });
  });

  it('availableTypes lists all unique types across all packs (before filter)', async () => {
    const { tools } = makeTools(() => allPacks);
    const result = await tools.handleListCompendiumPacks({});
    // Set deduplication: Actor, Item, JournalEntry
    expect(result.availableTypes).toHaveLength(3);
    expect(result.availableTypes).toContain('Actor');
    expect(result.availableTypes).toContain('Item');
    expect(result.availableTypes).toContain('JournalEntry');
  });

  it('availableTypes still lists all types even when filter is applied', async () => {
    const { tools } = makeTools(() => allPacks);
    // Type filter → only Actor pack in result, but availableTypes reflects the full pack list
    const result = await tools.handleListCompendiumPacks({ type: 'Item' });
    expect(result.total).toBe(1);
    expect(result.availableTypes).toHaveLength(3);
  });

  it('returns empty packs and total=0 when no packs match the type filter', async () => {
    const { tools } = makeTools(() => allPacks);
    const result = await tools.handleListCompendiumPacks({ type: 'RollTable' });
    expect(result.total).toBe(0);
    expect(result.packs).toHaveLength(0);
  });

  it('handles empty packs list from bridge gracefully', async () => {
    const { tools } = makeTools(() => []);
    const result = await tools.handleListCompendiumPacks({});
    expect(result.total).toBe(0);
    expect(result.packs).toEqual([]);
    expect(result.availableTypes).toEqual([]);
  });

  it('throws (wraps message) when the Foundry client throws', async () => {
    const { tools } = makeTools(() => {
      throw new Error('Foundry unavailable');
    });
    await expect(tools.handleListCompendiumPacks({})).rejects.toThrow(
      'Failed to list compendium packs: Foundry unavailable'
    );
  });

  it('throws with Unknown error message when client throws a non-Error', async () => {
    const { tools } = makeTools(() => {
      throw 'something bad';
    });
    await expect(tools.handleListCompendiumPacks({})).rejects.toThrow(
      'Failed to list compendium packs: Unknown error'
    );
  });

  it('throws (ZodError) when called with undefined args (schema.parse does not default to {})', async () => {
    const { tools } = makeTools(() => allPacks);
    // handleListCompendiumPacks calls schema.parse(args) directly; passing undefined
    // causes Zod to throw because it expects an object.
    await expect(tools.handleListCompendiumPacks(undefined)).rejects.toThrow();
  });
});
