import { describe, expect, it } from 'vitest';

import { makeTools } from '../test-support/make-tool-harness.js';

import { EncounterTools } from './encounter.js';

/**
 * Tests for EncounterTools: a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures → shape the result.
 *
 * handleSuggestBalancedEncounter THROWS on a validation error (no string return path).
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 */

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('EncounterTools.getToolDefinitions', () => {
  it('exposes the encounter tool with an object input schema', () => {
    const { tools } = makeTools(EncounterTools);
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['suggest-balanced-encounter']);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('suggest-balanced-encounter has no required fields', () => {
    const { tools } = makeTools(EncounterTools);
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
    const { tools, query } = makeTools(EncounterTools, () => payload);
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

  it('forwards toughness, and says so when an older module does not apply it', async () => {
    const { tools, query } = makeTools(EncounterTools, () => ({ success: true, xpBudget: 500 }));
    const result = (await tools.handleSuggestBalancedEncounter({ toughness: 1.5 })) as any;
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.suggestBalancedEncounter', {
      toughness: 1.5,
    });
    expect(result.note).toMatch(/too old to apply toughness/);
    await expect(tools.handleSuggestBalancedEncounter({ toughness: 3 })).rejects.toThrow();
  });

  it('defaults to empty params when args are omitted (undefined)', async () => {
    const { tools, query } = makeTools(EncounterTools);
    await tools.handleSuggestBalancedEncounter(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.suggestBalancedEncounter', {});
  });

  it('defaults to empty params when args are null', async () => {
    const { tools, query } = makeTools(EncounterTools);
    await tools.handleSuggestBalancedEncounter(null);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.suggestBalancedEncounter', {});
  });

  it('dispatches with only partyLevels when difficulty is omitted', async () => {
    const { tools, query } = makeTools(EncounterTools);
    await tools.handleSuggestBalancedEncounter({ partyLevels: [5, 5] });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.suggestBalancedEncounter', {
      partyLevels: [5, 5],
    });
  });

  it('dispatches with only difficulty when partyLevels is omitted', async () => {
    const { tools, query } = makeTools(EncounterTools);
    await tools.handleSuggestBalancedEncounter({ difficulty: 'high' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.suggestBalancedEncounter', {
      difficulty: 'high',
    });
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(EncounterTools, () => ({
      success: false,
      error: 'system not supported',
    }));
    await expect(tools.handleSuggestBalancedEncounter({})).rejects.toThrow('system not supported');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(EncounterTools, () => ({ success: false }));
    await expect(tools.handleSuggestBalancedEncounter({})).rejects.toThrow(
      'Failed to suggest encounter'
    );
  });

  it('throws (not returns string) on invalid difficulty enum value', async () => {
    const { tools, query } = makeTools(EncounterTools);
    await expect(tools.handleSuggestBalancedEncounter({ difficulty: 'deadly' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
