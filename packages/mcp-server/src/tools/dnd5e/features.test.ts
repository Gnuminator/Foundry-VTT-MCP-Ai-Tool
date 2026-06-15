import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DnD5eFeaturesFromCompendiumTools } from './features.js';

/**
 * Tests for DnD5eFeaturesFromCompendiumTools — a thin, deterministic layer over
 * FoundryClient.query. Pattern: validate args (ZodError throws on bad input) →
 * detect game system via detectGameSystem (mocked) → dispatch the correct
 * `foundry-mcp-bridge.*` method → propagate foundry-side failures via
 * ErrorHandler.handleToolError (which always throws) → shape the result via
 * formatResponse for the happy path.
 *
 * detectGameSystem is vi.mock'd so tests run without a real Foundry connection and
 * so we can exercise both the dnd5e and non-dnd5e branches.
 */

// ---------------------------------------------------------------------------
// Mock system-detection so detectGameSystem is fully controllable
// ---------------------------------------------------------------------------

vi.mock('../../utils/system-detection.js', () => ({
  detectGameSystem: vi.fn(async () => 'dnd5e'),
  getCachedSystemId: vi.fn(() => 'dnd5e'),
  clearSystemCache: vi.fn(),
}));

// Import the mock so tests can reconfigure it
import { detectGameSystem } from '../../utils/system-detection.js';
const mockDetectGameSystem = detectGameSystem as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

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
  return { tools: new DnD5eFeaturesFromCompendiumTools({ foundryClient, logger }), query };
}

// Minimal valid bridge response for the happy-path tests
function makeResult(
  overrides: Partial<{
    actor: { id: string; name: string };
    added: Array<{ name: string; packId: string; packLabel: string; itemId: string }>;
    skipped: Array<{ name: string; reason: string }>;
    notFound: string[];
    failed: Array<{ name: string; error: string }>;
    warnings: string[];
  }> = {}
) {
  return {
    actor: { id: 'actor-1', name: 'Goblin Boss' },
    added: [],
    skipped: [],
    notFound: [],
    failed: [],
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('DnD5eFeaturesFromCompendiumTools.getToolDefinitions', () => {
  it('exposes exactly one tool with an object input schema', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('dnd5e-add-features-from-compendium');
    expect((defs[0].inputSchema as any).type).toBe('object');
  });

  it('requires actorIdentifier and featureNames', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions()[0];
    expect((def.inputSchema as any).required).toEqual(['actorIdentifier', 'featureNames']);
  });

  it('featureNames has minItems 1 and maxItems 50', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions()[0];
    const featureNames = (def.inputSchema as any).properties.featureNames;
    expect(featureNames.minItems).toBe(1);
    expect(featureNames.maxItems).toBe(50);
  });

  it('compendiumPacks is not required and has a default', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions()[0];
    expect((def.inputSchema as any).required).not.toContain('compendiumPacks');
    expect((def.inputSchema as any).properties.compendiumPacks.default).toEqual([
      'dnd5e.monsterfeatures',
      'dnd5e.classfeatures',
    ]);
  });
});

// ---------------------------------------------------------------------------
// handleAddFeaturesFromCompendium — query dispatch
// ---------------------------------------------------------------------------

describe('DnD5eFeaturesFromCompendiumTools.handleAddFeaturesFromCompendium — dispatch', () => {
  beforeEach(() => {
    mockDetectGameSystem.mockResolvedValue('dnd5e');
  });

  it('dispatches to foundry-mcp-bridge.addFeaturesFromCompendium with correct params', async () => {
    const bridgeResult = makeResult({
      added: [
        {
          name: 'Pack Tactics',
          packId: 'dnd5e.monsterfeatures',
          packLabel: 'Monster Features',
          itemId: 'item-1',
        },
      ],
    });
    const { tools, query } = makeTools(() => bridgeResult);

    await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Pack Tactics'],
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.addFeaturesFromCompendium', {
      actorIdentifier: 'goblin-boss',
      featureNames: ['Pack Tactics'],
      compendiumPacks: ['dnd5e.monsterfeatures', 'dnd5e.classfeatures'],
    });
  });

  it('passes custom compendiumPacks to the query when provided', async () => {
    const { tools, query } = makeTools(() => makeResult());

    await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'actor-x',
      featureNames: ['Multiattack'],
      compendiumPacks: ['dnd5e.monsterfeatures24'],
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.addFeaturesFromCompendium', {
      actorIdentifier: 'actor-x',
      featureNames: ['Multiattack'],
      compendiumPacks: ['dnd5e.monsterfeatures24'],
    });
  });

  it('uses default compendiumPacks when not provided', async () => {
    const { tools, query } = makeTools(() => makeResult());

    await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'actor-y',
      featureNames: ['Nimble Escape'],
    });

    const callArgs = query.mock.calls[0][1] as any;
    expect(callArgs.compendiumPacks).toEqual(['dnd5e.monsterfeatures', 'dnd5e.classfeatures']);
  });
});

// ---------------------------------------------------------------------------
// handleAddFeaturesFromCompendium — Zod validation (throws, not string)
// ---------------------------------------------------------------------------

describe('DnD5eFeaturesFromCompendiumTools.handleAddFeaturesFromCompendium — validation', () => {
  beforeEach(() => {
    mockDetectGameSystem.mockResolvedValue('dnd5e');
  });

  it('throws a ZodError (not returns string) when actorIdentifier is missing', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleAddFeaturesFromCompendium({ featureNames: ['Pack Tactics'] })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when featureNames is missing', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleAddFeaturesFromCompendium({ actorIdentifier: 'goblin' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when featureNames is an empty array (min 1)', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleAddFeaturesFromCompendium({
        actorIdentifier: 'goblin',
        featureNames: [],
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when actorIdentifier is an empty string (min length 1)', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleAddFeaturesFromCompendium({
        actorIdentifier: '',
        featureNames: ['Pack Tactics'],
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when featureNames has more than 50 entries (max 50)', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleAddFeaturesFromCompendium({
        actorIdentifier: 'goblin',
        featureNames: Array.from({ length: 51 }, (_, i) => `Feature ${i}`),
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when args are null/undefined', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleAddFeaturesFromCompendium(undefined)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleAddFeaturesFromCompendium — non-dnd5e system guard
// ---------------------------------------------------------------------------

describe('DnD5eFeaturesFromCompendiumTools.handleAddFeaturesFromCompendium — system guard', () => {
  it('throws when system is not dnd5e', async () => {
    mockDetectGameSystem.mockResolvedValue('pf2e');
    const { tools, query } = makeTools();

    await expect(
      tools.handleAddFeaturesFromCompendium({
        actorIdentifier: 'fighter',
        featureNames: ['Pack Tactics'],
      })
    ).rejects.toThrow();
    // query must never be called when system check fails
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (via ErrorHandler) when system is "other"', async () => {
    mockDetectGameSystem.mockResolvedValue('other');
    const { tools } = makeTools();

    // ErrorHandler.handleToolError wraps the original error through mapFoundryError,
    // so the thrown message is the formatted MCP error, not the raw system-guard message.
    await expect(
      tools.handleAddFeaturesFromCompendium({
        actorIdentifier: 'fighter',
        featureNames: ['Pack Tactics'],
      })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleAddFeaturesFromCompendium — Foundry failure propagation
// ---------------------------------------------------------------------------

describe('DnD5eFeaturesFromCompendiumTools.handleAddFeaturesFromCompendium — Foundry failure', () => {
  beforeEach(() => {
    mockDetectGameSystem.mockResolvedValue('dnd5e');
  });

  it('throws when foundryClient.query rejects', async () => {
    const { tools } = makeTools(() => {
      throw new Error('bridge unreachable');
    });

    await expect(
      tools.handleAddFeaturesFromCompendium({
        actorIdentifier: 'goblin',
        featureNames: ['Pack Tactics'],
      })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleAddFeaturesFromCompendium — formatResponse shaping
// ---------------------------------------------------------------------------

describe('DnD5eFeaturesFromCompendiumTools.handleAddFeaturesFromCompendium — result shaping', () => {
  beforeEach(() => {
    mockDetectGameSystem.mockResolvedValue('dnd5e');
  });

  it('returns actor, added, skipped, notFound, failed, warnings, summary, and message', async () => {
    const added = [
      {
        name: 'Pack Tactics',
        packId: 'dnd5e.monsterfeatures',
        packLabel: 'Monster Features',
        itemId: 'item-1',
      },
    ];
    const { tools } = makeTools(() => makeResult({ added }));

    const result = await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Pack Tactics'],
    });

    expect(result).toMatchObject({
      actor: { id: 'actor-1', name: 'Goblin Boss' },
      added,
      skipped: [],
      notFound: [],
      failed: [],
      warnings: [],
    });
    expect(typeof result.summary).toBe('string');
    expect(typeof result.message).toBe('string');
  });

  it('success is true when at least one feature was added', async () => {
    const added = [
      {
        name: 'Pack Tactics',
        packId: 'dnd5e.monsterfeatures',
        packLabel: 'Monster Features',
        itemId: 'item-1',
      },
    ];
    const { tools } = makeTools(() => makeResult({ added }));

    const result = await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Pack Tactics'],
    });

    expect(result.success).toBe(true);
  });

  it('success is false when no features added and some were not found', async () => {
    const { tools } = makeTools(() => makeResult({ notFound: ['Nonexistent Feature'] }));

    const result = await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Nonexistent Feature'],
    });

    expect(result.success).toBe(false);
  });

  it('success is false when some features failed', async () => {
    const failed = [{ name: 'Pack Tactics', error: 'import error' }];
    const { tools } = makeTools(() => makeResult({ failed }));

    const result = await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Pack Tactics'],
    });

    expect(result.success).toBe(false);
  });

  it('success is true when all features were skipped (already present)', async () => {
    const skipped = [{ name: 'Pack Tactics', reason: 'already on actor' }];
    const { tools } = makeTools(() => makeResult({ skipped }));

    const result = await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Pack Tactics'],
    });

    // added.length === 0 BUT notFound.length === 0 && failed.length === 0 → true
    expect(result.success).toBe(true);
  });

  it('summary contains the actor name', async () => {
    const { tools } = makeTools(() => makeResult());

    const result = await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Pack Tactics'],
    });

    expect(result.summary).toContain('Goblin Boss');
  });

  it('summary includes added count when features were added', async () => {
    const added = [
      {
        name: 'Pack Tactics',
        packId: 'dnd5e.monsterfeatures',
        packLabel: 'Monster Features',
        itemId: 'item-1',
      },
    ];
    const { tools } = makeTools(() => makeResult({ added }));

    const result = await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Pack Tactics'],
    });

    expect(result.summary).toMatch(/1 added/);
  });

  it('message contains actor name and id', async () => {
    const { tools } = makeTools(() => makeResult());

    const result = await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Pack Tactics'],
    });

    expect(result.message).toContain('Goblin Boss');
    expect(result.message).toContain('actor-1');
  });

  it('message lists not-found feature names', async () => {
    const { tools } = makeTools(() => makeResult({ notFound: ['Mystery Ability'] }));

    const result = await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Mystery Ability'],
    });

    expect(result.message).toContain('Mystery Ability');
  });

  it('message includes warnings when present', async () => {
    const { tools } = makeTools(() => makeResult({ warnings: ['Some packs were unavailable'] }));

    const result = await tools.handleAddFeaturesFromCompendium({
      actorIdentifier: 'goblin-boss',
      featureNames: ['Pack Tactics'],
    });

    expect(result.message).toContain('Some packs were unavailable');
  });
});
