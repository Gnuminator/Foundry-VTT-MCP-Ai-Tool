import { describe, expect, it } from 'vitest';

import { makeTools } from '../test-support/make-tool-harness.js';

import { EffectsTools } from './effects.js';

/**
 * Test suite for EffectsTools: condition / status-effect management.
 * Follows the chunk-4 template established by movement.test.ts:
 *   makeTools(EffectsTools) builds the class with a mocked FoundryClient and Logger stub,
 *   then each describe block exercises one handler.
 */

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('EffectsTools.getToolDefinitions', () => {
  it('exposes the effects tool with object input schemas', () => {
    const { tools } = makeTools(EffectsTools);
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['get-active-effects']);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
    }
  });

  it('get-active-effects requires actor', () => {
    const { tools } = makeTools(EffectsTools);
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-active-effects')!;
    expect((def.inputSchema as any).required).toEqual(['actor']);
  });
});

// ---------------------------------------------------------------------------
// handleGetActiveEffects
// ---------------------------------------------------------------------------

describe('EffectsTools.handleGetActiveEffects', () => {
  it('dispatches the correct query method with parsed params and returns the response', async () => {
    const payload = { success: true, effects: [{ name: 'Poisoned' }] };
    const { tools, query } = makeTools(EffectsTools, () => payload);
    const result = await tools.handleGetActiveEffects({ actor: 'Gandalf' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getActiveEffects', {
      identifier: 'Gandalf',
    });
    expect(result).toBe(payload);
  });

  it('throws when Foundry reports a failure', async () => {
    const { tools } = makeTools(EffectsTools, () => ({ success: false, error: 'actor not found' }));
    await expect(tools.handleGetActiveEffects({ actor: 'Unknown' })).rejects.toThrow(
      'actor not found'
    );
  });

  it('throws the default message when Foundry failure has no error string', async () => {
    const { tools } = makeTools(EffectsTools, () => ({ success: false }));
    await expect(tools.handleGetActiveEffects({ actor: 'X' })).rejects.toThrow(
      'Failed to get active effects'
    );
  });

  it('throws a zod validation error when actor is missing', async () => {
    const { tools, query } = makeTools(EffectsTools);
    await expect(tools.handleGetActiveEffects({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a zod validation error when actor is not a string', async () => {
    const { tools, query } = makeTools(EffectsTools);
    await expect(tools.handleGetActiveEffects({ actor: 42 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
