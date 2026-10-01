import { describe, expect, it, vi } from 'vitest';

import { EffectsTools } from './effects.js';

/**
 * Test suite for EffectsTools — condition / status-effect management.
 * Follows the chunk-4 template established by movement.test.ts:
 *   makeTools() builds the class with a mocked FoundryClient and Logger stub,
 *   then each describe block exercises one handler.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? (() => ({ success: true })));
  const foundryClient = { query } as any;
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  return { tools: new EffectsTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('EffectsTools.getToolDefinitions', () => {
  it('exposes the effects tool with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['get-active-effects']);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
    }
  });

  it('get-active-effects requires identifier', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-active-effects')!;
    expect((def.inputSchema as any).required).toEqual(['identifier']);
  });
});

// ---------------------------------------------------------------------------
// handleGetActiveEffects
// ---------------------------------------------------------------------------

describe('EffectsTools.handleGetActiveEffects', () => {
  it('dispatches the correct query method with parsed params and returns the response', async () => {
    const payload = { success: true, effects: [{ name: 'Poisoned' }] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetActiveEffects({ identifier: 'Gandalf' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getActiveEffects', {
      identifier: 'Gandalf',
    });
    expect(result).toBe(payload);
  });

  it('throws when Foundry reports a failure', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'actor not found' }));
    await expect(tools.handleGetActiveEffects({ identifier: 'Unknown' })).rejects.toThrow(
      'actor not found'
    );
  });

  it('throws the default message when Foundry failure has no error string', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleGetActiveEffects({ identifier: 'X' })).rejects.toThrow(
      'Failed to get active effects'
    );
  });

  it('throws a zod validation error when identifier is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetActiveEffects({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a zod validation error when identifier is not a string', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetActiveEffects({ identifier: 42 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
