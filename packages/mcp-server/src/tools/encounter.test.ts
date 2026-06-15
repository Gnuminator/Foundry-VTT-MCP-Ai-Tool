import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EncounterTools } from './encounter.js';

/**
 * Tests for EncounterTools — a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures → shape the result.
 *
 * Validation-error behaviour differs per handler (matches source exactly):
 *   - handleSuggestBalancedEncounter  → THROWS  (no string return path)
 *   - handlePlaceMeasuredTemplate     → RETURNS string on ZodError
 *   - handleDeleteMeasuredTemplate    → THROWS  (no string return path)
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
  it('exposes the three encounter tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'suggest-balanced-encounter',
      'place-measured-template',
      'delete-measured-template',
    ]);
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

  it('place-measured-template requires shape and distance', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const place = defs.find(d => d.name === 'place-measured-template')!;
    expect((place.inputSchema as any).required).toEqual(['shape', 'distance']);
  });

  it('delete-measured-template has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const del = defs.find(d => d.name === 'delete-measured-template')!;
    expect((del.inputSchema as any).required).toBeUndefined();
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

// ---------------------------------------------------------------------------
// handlePlaceMeasuredTemplate
// ---------------------------------------------------------------------------

describe('EncounterTools.handlePlaceMeasuredTemplate', () => {
  it('dispatches with required shape and distance', async () => {
    const payload = { success: true, templateId: 'tpl-1', coveredTokens: [] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handlePlaceMeasuredTemplate({ shape: 'circle', distance: 20 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.placeMeasuredTemplate', {
      shape: 'circle',
      distance: 20,
    });
    expect(result).toBe(payload);
  });

  it('dispatches with all optional fields when provided', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handlePlaceMeasuredTemplate({
      shape: 'cone',
      distance: 30,
      x: 100,
      y: 200,
      direction: 45,
      angle: 53,
      width: 5,
      fillColor: '#ff0000',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.placeMeasuredTemplate', {
      shape: 'cone',
      distance: 30,
      x: 100,
      y: 200,
      direction: 45,
      angle: 53,
      width: 5,
      fillColor: '#ff0000',
    });
  });

  it('dispatches with originTokenName instead of x/y', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handlePlaceMeasuredTemplate({
      shape: 'ray',
      distance: 60,
      originTokenName: 'Gandalf',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.placeMeasuredTemplate', {
      shape: 'ray',
      distance: 60,
      originTokenName: 'Gandalf',
    });
  });

  it('returns a parameter-error string (not a throw) when shape is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handlePlaceMeasuredTemplate({ distance: 20 });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string (not a throw) when distance is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handlePlaceMeasuredTemplate({ shape: 'circle' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string (not a throw) when shape is an invalid enum', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handlePlaceMeasuredTemplate({ shape: 'sphere', distance: 20 });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'no active scene' }));
    await expect(
      tools.handlePlaceMeasuredTemplate({ shape: 'circle', distance: 20 })
    ).rejects.toThrow('no active scene');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(
      tools.handlePlaceMeasuredTemplate({ shape: 'circle', distance: 20 })
    ).rejects.toThrow('Failed to place template');
  });
});

// ---------------------------------------------------------------------------
// handleDeleteMeasuredTemplate
// ---------------------------------------------------------------------------

describe('EncounterTools.handleDeleteMeasuredTemplate', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('dispatches with a templateId', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleDeleteMeasuredTemplate({ templateId: 'tpl-abc' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteMeasuredTemplate', {
      templateId: 'tpl-abc',
    });
    expect(result).toBe(payload);
    consoleErr.mockRestore();
  });

  it('dispatches with all=true to clear all templates', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleDeleteMeasuredTemplate({ all: true });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteMeasuredTemplate', {
      all: true,
    });
    consoleErr.mockRestore();
  });

  it('defaults to empty params when args are omitted (undefined)', async () => {
    const { tools, query } = makeTools();
    await tools.handleDeleteMeasuredTemplate(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteMeasuredTemplate', {});
    consoleErr.mockRestore();
  });

  it('defaults to empty params when args are null', async () => {
    const { tools, query } = makeTools();
    await tools.handleDeleteMeasuredTemplate(null);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteMeasuredTemplate', {});
    consoleErr.mockRestore();
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'template not found' }));
    await expect(tools.handleDeleteMeasuredTemplate({ templateId: 'tpl-xyz' })).rejects.toThrow(
      'template not found'
    );
    consoleErr.mockRestore();
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleDeleteMeasuredTemplate({})).rejects.toThrow(
      'Failed to delete template'
    );
    consoleErr.mockRestore();
  });
});
