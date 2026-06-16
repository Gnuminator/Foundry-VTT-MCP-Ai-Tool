import { describe, expect, it, vi } from 'vitest';

import { ActorCreationTools } from './actor-creation.js';

/**
 * Tests for ActorCreationTools — a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args (via zod.parse — throws on failure) → dispatch correct
 * `foundry-mcp-bridge.*` method → shape result → propagate Foundry-side failures
 * (query throws → errorHandler.handleToolError → rethrows formatted Error).
 *
 * Neither handler returns a "Parameter error" string — both throw on validation failure
 * (schema.parse) and on Foundry failure (errorHandler.handleToolError), matching source.
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? (() => ({ success: true })));
  const foundryClient = { query } as any;
  // Minimal Logger stub: `.child()` returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  return { tools: new ActorCreationTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('ActorCreationTools.getToolDefinitions', () => {
  it('exposes the two actor-creation tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'create-actor-from-compendium',
      'get-compendium-entry-full',
    ]);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('create-actor-from-compendium requires packId, itemId, and names', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const create = defs.find(d => d.name === 'create-actor-from-compendium')!;
    expect((create.inputSchema as any).required).toEqual(['packId', 'itemId', 'names']);
  });

  it('get-compendium-entry-full requires packId and entryId', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const full = defs.find(d => d.name === 'get-compendium-entry-full')!;
    expect((full.inputSchema as any).required).toEqual(['packId', 'entryId']);
  });
});

// ---------------------------------------------------------------------------
// handleCreateActorFromCompendium
// ---------------------------------------------------------------------------

describe('ActorCreationTools.handleCreateActorFromCompendium', () => {
  it('dispatches the correct query method with required params', async () => {
    const mockResult = {
      success: true,
      totalCreated: 1,
      totalRequested: 1,
      actors: [{ name: 'Flameheart', id: 'abc' }],
      tokensPlaced: 0,
      errors: [],
    };
    const { tools, query } = makeTools(() => mockResult);
    await tools.handleCreateActorFromCompendium({
      packId: 'dnd5e.monsters',
      itemId: 'goblin-id',
      names: ['Flameheart'],
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.createActorFromCompendium', {
      packId: 'dnd5e.monsters',
      itemId: 'goblin-id',
      customNames: ['Flameheart'],
      quantity: 1,
      addToScene: false,
      placement: undefined,
    });
  });

  it('passes addToScene and placement when provided', async () => {
    const mockResult = {
      success: true,
      totalCreated: 1,
      totalRequested: 1,
      actors: [{ name: 'Sneak', id: 'def' }],
      tokensPlaced: 1,
      errors: [],
    };
    const { tools, query } = makeTools(() => mockResult);
    await tools.handleCreateActorFromCompendium({
      packId: 'dnd5e.monsters',
      itemId: 'rogue-id',
      names: ['Sneak'],
      addToScene: true,
      placement: { type: 'grid' },
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.createActorFromCompendium', {
      packId: 'dnd5e.monsters',
      itemId: 'rogue-id',
      customNames: ['Sneak'],
      quantity: 1,
      addToScene: true,
      placement: { type: 'grid', coordinates: undefined },
    });
  });

  it('auto-generates extra names when quantity exceeds names length', async () => {
    const mockResult = {
      success: true,
      totalCreated: 3,
      totalRequested: 3,
      actors: [
        { name: 'Goblin', id: 'g1' },
        { name: 'Goblin 2', id: 'g2' },
        { name: 'Goblin 3', id: 'g3' },
      ],
      tokensPlaced: 0,
      errors: [],
    };
    const { tools, query } = makeTools(() => mockResult);
    await tools.handleCreateActorFromCompendium({
      packId: 'dnd5e.monsters',
      itemId: 'goblin-id',
      names: ['Goblin'],
      quantity: 3,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.createActorFromCompendium', {
      packId: 'dnd5e.monsters',
      itemId: 'goblin-id',
      customNames: ['Goblin', 'Goblin 2', 'Goblin 3'],
      quantity: 3,
      addToScene: false,
      placement: undefined,
    });
  });

  it('shapes the result via formatSimpleActorCreationResponse', async () => {
    const mockResult = {
      success: true,
      totalCreated: 1,
      totalRequested: 1,
      actors: [{ name: 'Flameheart', id: 'abc' }],
      tokensPlaced: 0,
      errors: [],
    };
    const { tools } = makeTools(() => mockResult);
    const result = await tools.handleCreateActorFromCompendium({
      packId: 'dnd5e.monsters',
      itemId: 'goblin-id',
      names: ['Flameheart'],
    });
    // Result is shaped — not the raw query response
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('details');
    expect(result.details).toHaveProperty('sourceEntry', {
      packId: 'dnd5e.monsters',
      itemId: 'goblin-id',
    });
    expect(result.details).toHaveProperty('actors', mockResult.actors);
    expect(result.details).toHaveProperty('tokensPlaced', 0);
    expect(result).toHaveProperty('message');
    expect(typeof result.message).toBe('string');
  });

  it('throws (not returns string) when packId is missing', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateActorFromCompendium({ itemId: 'goblin-id', names: ['Goblin'] })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (not returns string) when itemId is missing', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateActorFromCompendium({ packId: 'dnd5e.monsters', names: ['Goblin'] })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (not returns string) when names array is missing', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateActorFromCompendium({ packId: 'dnd5e.monsters', itemId: 'goblin-id' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (not returns string) when names array is empty', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateActorFromCompendium({
        packId: 'dnd5e.monsters',
        itemId: 'goblin-id',
        names: [],
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (not returns string) when args are null/undefined', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleCreateActorFromCompendium(undefined)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry query throws an error', async () => {
    const { tools } = makeTools(() => {
      throw new Error('bridge timeout');
    });
    await expect(
      tools.handleCreateActorFromCompendium({
        packId: 'dnd5e.monsters',
        itemId: 'goblin-id',
        names: ['Goblin'],
      })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleGetCompendiumEntryFull
// ---------------------------------------------------------------------------

describe('ActorCreationTools.handleGetCompendiumEntryFull', () => {
  it('dispatches the correct query method with packId and documentId', async () => {
    const mockEntry = {
      name: 'Goblin',
      type: 'npc',
      packLabel: 'Monsters',
      system: {},
      fullData: {},
      items: [],
      effects: [],
    };
    const { tools, query } = makeTools(() => mockEntry);
    await tools.handleGetCompendiumEntryFull({
      packId: 'dnd5e.monsters',
      entryId: 'goblin-entry-id',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCompendiumDocumentFull', {
      packId: 'dnd5e.monsters',
      documentId: 'goblin-entry-id',
    });
  });

  it('shapes the result via formatCompendiumEntryResponse', async () => {
    const mockEntry = {
      name: 'Goblin',
      type: 'npc',
      packLabel: 'Monsters',
      system: { hp: { value: 7 } },
      fullData: { _id: 'goblin-entry-id' },
      items: [{ name: 'Scimitar' }, { name: 'Shortbow' }],
      effects: [],
    };
    const { tools } = makeTools(() => mockEntry);
    const result = await tools.handleGetCompendiumEntryFull({
      packId: 'dnd5e.monsters',
      entryId: 'goblin-entry-id',
    });
    expect(result).toHaveProperty('name', 'Goblin');
    expect(result).toHaveProperty('type', 'npc');
    expect(result).toHaveProperty('pack', 'Monsters');
    expect(result).toHaveProperty('system', mockEntry.system);
    expect(result).toHaveProperty('fullData', mockEntry.fullData);
    expect(result).toHaveProperty('items', mockEntry.items);
    expect(result).toHaveProperty('effects', []);
    expect(result).toHaveProperty('summary');
    expect(typeof result.summary).toBe('string');
    expect(result.summary).toContain('Goblin');
  });

  it('returns empty arrays for items and effects when entry has none', async () => {
    const mockEntry = {
      name: 'Shadow',
      type: 'npc',
      packLabel: 'Monsters',
      system: {},
      fullData: {},
    };
    const { tools } = makeTools(() => mockEntry);
    const result = await tools.handleGetCompendiumEntryFull({
      packId: 'dnd5e.monsters',
      entryId: 'shadow-id',
    });
    expect(result.items).toEqual([]);
    expect(result.effects).toEqual([]);
  });

  it('throws (not returns string) when packId is missing', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleGetCompendiumEntryFull({ entryId: 'goblin-entry-id' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (not returns string) when entryId is missing', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleGetCompendiumEntryFull({ packId: 'dnd5e.monsters' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (not returns string) when args are null/undefined', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetCompendiumEntryFull(undefined)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry query throws an error', async () => {
    const { tools } = makeTools(() => {
      throw new Error('pack not found');
    });
    await expect(
      tools.handleGetCompendiumEntryFull({ packId: 'dnd5e.monsters', entryId: 'goblin-entry-id' })
    ).rejects.toThrow();
  });
});
