import { describe, expect, it, vi } from 'vitest';

import { LootTools } from './loot.js';

/**
 * Unit tests for LootTools — a thin validation + dispatch layer over
 * FoundryClient.query. We mock the client and Logger so the layer is tested
 * in isolation (no live bridge required).
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
  return { tools: new LootTools({ foundryClient, logger }), query, logger };
}

// ─── getToolDefinitions ───────────────────────────────────────────────────────

describe('LootTools.getToolDefinitions', () => {
  it('exposes exactly one tool named "drop-loot" with an object input schema', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['drop-loot']);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
    }
  });

  it('has no required fields (all args are optional)', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    // The schema does not declare a "required" array — all properties are optional.
    expect((def.inputSchema as any).required).toBeUndefined();
  });
});

// ─── handleDropLoot — happy path ─────────────────────────────────────────────

describe('LootTools.handleDropLoot', () => {
  it('dispatches foundry-mcp-bridge.dropLoot with the parsed params and returns the response', async () => {
    const payload = { success: true, itemsAdded: 2 };
    const { tools, query } = makeTools(() => payload);
    const args = {
      targetCharacter: 'Thalindra',
      currency: { gp: 50, sp: 25 },
      itemUuids: ['Compendium.dnd5e.items.Item.abc123'],
      announce: true,
    };
    const result = await tools.handleDropLoot(args);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.dropLoot', {
      targetCharacter: 'Thalindra',
      currency: { gp: 50, sp: 25 },
      itemUuids: ['Compendium.dnd5e.items.Item.abc123'],
      announce: true,
    });
    expect(result).toBe(payload);
  });

  it('works when called with no args (all fields optional)', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleDropLoot(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.dropLoot', {});
    expect(result).toBe(payload);
  });

  it('works when called with an empty object', async () => {
    const { tools, query } = makeTools();
    await tools.handleDropLoot({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.dropLoot', {});
  });

  it('works with only currency provided', async () => {
    const { tools, query } = makeTools();
    await tools.handleDropLoot({ currency: { gp: 100 } });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.dropLoot', {
      currency: { gp: 100 },
    });
  });

  it('works with only announce: false provided', async () => {
    const { tools, query } = makeTools();
    await tools.handleDropLoot({ announce: false });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.dropLoot', { announce: false });
  });

  // ─── foundry-side failure ─────────────────────────────────────────────────

  it('throws when Foundry reports { success: false }', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'Character not found' }));
    await expect(tools.handleDropLoot({ targetCharacter: 'Ghost' })).rejects.toThrow(
      'Character not found'
    );
  });

  it('uses a fallback message when Foundry failure has no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleDropLoot({})).rejects.toThrow('Failed to drop loot');
  });

  // ─── validation-error path ────────────────────────────────────────────────

  it('returns a Parameter error string (not a throw) when args fail zod validation', async () => {
    const { tools, query } = makeTools();
    // Pass a non-boolean for `announce` to trigger a ZodError.
    const result = await tools.handleDropLoot({ announce: 'yes' as any });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    // Query must NOT have been called.
    expect(query).not.toHaveBeenCalled();
  });

  it('does not call query when validation fails', async () => {
    const { tools, query } = makeTools();
    // itemUuids should be an array of strings; pass a non-array to trigger ZodError.
    await tools.handleDropLoot({ itemUuids: 'not-an-array' as any });
    expect(query).not.toHaveBeenCalled();
  });

  // ─── logger called on error ───────────────────────────────────────────────

  it('calls logger.error on any caught error', async () => {
    const { tools, logger } = makeTools(() => ({ success: false, error: 'boom' }));
    await expect(tools.handleDropLoot({})).rejects.toThrow('boom');
    expect(logger.error).toHaveBeenCalled();
  });
});
