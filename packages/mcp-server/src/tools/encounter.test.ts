import { describe, expect, it, vi } from 'vitest';

import { EncounterTools } from './encounter.js';

/**
 * Tests for EncounterTools — a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures → shape the result.
 *
 * handleSuggestBalancedEncounter THROWS on a validation error (no string return path).
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
  return { tools: new EncounterTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('EncounterTools.getToolDefinitions', () => {
  it('exposes the encounter tool with an object input schema', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['suggest-balanced-encounter']);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('suggest-balanced-encounter has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const suggest = defs.find(d => d.name === 'suggest-balanced-encounter')!;
    expect((suggest.inputSchema as any).required).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleSuggestBalancedEncounter
// ---------------------------------------------------------------------------

describe('EncounterTools.handleSuggestBalancedEncounter', () => {
  it('dispatches the correct query method and returns the response', async () => {
    const payload = { success: true, budget: 1200, suggestions: [] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleSuggestBalancedEncounter({
      partyLevels: [3, 3, 3, 3],
      difficulty: 'moderate',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.suggestBalancedEncounter', {
      partyLevels: [3, 3, 3, 3],
      difficulty: 'moderate',
    });
    expect(result).toBe(payload);
  });

  it('defaults to empty params when args are omitted (undefined)', async () => {
    const { tools, query } = makeTools();
    await tools.handleSuggestBalancedEncounter(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.suggestBalancedEncounter', {});
  });

  it('defaults to empty params when args are null', async () => {
    const { tools, query } = makeTools();
    await tools.handleSuggestBalancedEncounter(null);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.suggestBalancedEncounter', {});
  });

  it('dispatches with only partyLevels when difficulty is omitted', async () => {
    const { tools, query } = makeTools();
    await tools.handleSuggestBalancedEncounter({ partyLevels: [5, 5] });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.suggestBalancedEncounter', {
      partyLevels: [5, 5],
    });
  });

  it('dispatches with only difficulty when partyLevels is omitted', async () => {
    const { tools, query } = makeTools();
    await tools.handleSuggestBalancedEncounter({ difficulty: 'high' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.suggestBalancedEncounter', {
      difficulty: 'high',
    });
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'system not supported' }));
    await expect(tools.handleSuggestBalancedEncounter({})).rejects.toThrow('system not supported');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleSuggestBalancedEncounter({})).rejects.toThrow(
      'Failed to suggest encounter'
    );
  });

  it('throws (not returns string) on invalid difficulty enum value', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSuggestBalancedEncounter({ difficulty: 'deadly' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
