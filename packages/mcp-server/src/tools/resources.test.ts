import { describe, expect, it, vi } from 'vitest';

import { ResourceTools } from './resources.js';

/**
 * Tests for ResourceTools — the thin deterministic layer over FoundryClient.query
 * for limited-use resource tracking (spell slots, class resources, item charges, etc.).
 *
 * Pattern: mock FoundryClient + Logger stub, test each handler in isolation.
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
  return { tools: new ResourceTools({ foundryClient, logger }), query, logger };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('ResourceTools.getToolDefinitions', () => {
  it('exposes get-character-resources with an object schema', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['get-character-resources']);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
    }
  });

  it('get-character-resources requires identifier', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-character-resources')!;
    expect((def.inputSchema as any).required).toEqual(['identifier']);
  });
});

// ---------------------------------------------------------------------------
// handleGetCharacterResources
// ---------------------------------------------------------------------------

describe('ResourceTools.handleGetCharacterResources', () => {
  it('dispatches the correct query method with identifier and returns the response', async () => {
    const payload = { success: true, spellSlots: { 1: { max: 4, current: 3 } } };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetCharacterResources({ identifier: 'Aria' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCharacterResources', {
      identifier: 'Aria',
    });
    expect(result).toBe(payload);
  });

  it('throws when Foundry reports a failure', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'actor not found' }));
    await expect(tools.handleGetCharacterResources({ identifier: 'Ghost' })).rejects.toThrow(
      'actor not found'
    );
  });

  it('throws a ZodError (not a string) when identifier is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetCharacterResources({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a ZodError when args are null/undefined', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetCharacterResources(undefined)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('uses a default error message when Foundry returns success:false with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleGetCharacterResources({ identifier: 'X' })).rejects.toThrow(
      'Failed to get character resources'
    );
  });
});
