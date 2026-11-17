import { describe, expect, it } from 'vitest';

import { makeTools } from '../test-support/make-tool-harness.js';

import { ResourceTools } from './resources.js';

/**
 * Tests for ResourceTools: the thin deterministic layer over FoundryClient.query
 * for limited-use resource tracking (spell slots, class resources, item charges, etc.).
 *
 * Pattern: mock FoundryClient + Logger stub, test each handler in isolation.
 */

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('ResourceTools.getToolDefinitions', () => {
  it('exposes get-character-resources with an object schema', () => {
    const { tools } = makeTools(ResourceTools);
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['get-character-resources']);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
    }
  });

  it('get-character-resources requires actor', () => {
    const { tools } = makeTools(ResourceTools);
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-character-resources')!;
    expect((def.inputSchema as any).required).toEqual(['actor']);
  });
});

// ---------------------------------------------------------------------------
// handleGetCharacterResources
// ---------------------------------------------------------------------------

describe('ResourceTools.handleGetCharacterResources', () => {
  it('dispatches the correct query method with identifier and returns the response', async () => {
    const payload = { success: true, spellSlots: { 1: { max: 4, current: 3 } } };
    const { tools, query } = makeTools(ResourceTools, () => payload);
    const result = await tools.handleGetCharacterResources({ actor: 'Aria' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCharacterResources', {
      identifier: 'Aria',
    });
    expect(result).toBe(payload);
  });

  it('throws when Foundry reports a failure', async () => {
    const { tools } = makeTools(ResourceTools, () => ({
      success: false,
      error: 'actor not found',
    }));
    await expect(tools.handleGetCharacterResources({ actor: 'Ghost' })).rejects.toThrow(
      'actor not found'
    );
  });

  it('throws a ZodError (not a string) when actor is missing', async () => {
    const { tools, query } = makeTools(ResourceTools);
    await expect(tools.handleGetCharacterResources({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a ZodError when args are null/undefined', async () => {
    const { tools, query } = makeTools(ResourceTools);
    await expect(tools.handleGetCharacterResources(undefined)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('uses a default error message when Foundry returns success:false with no error field', async () => {
    const { tools } = makeTools(ResourceTools, () => ({ success: false }));
    await expect(tools.handleGetCharacterResources({ actor: 'X' })).rejects.toThrow(
      'Failed to get character resources'
    );
  });
});
