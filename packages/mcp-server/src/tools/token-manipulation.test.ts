import { describe, expect, it, vi } from 'vitest';

import { TokenManipulationTools } from './token-manipulation.js';

/**
 * Tests for TokenManipulationTools — a thin, deterministic layer over
 * FoundryClient.query. Pattern: validate args → dispatch correct
 * `foundry-mcp-bridge.*` method → propagate query-level failures → shape result.
 *
 * All handlers use `schema.parse(args)` (Zod) — validation failures throw a
 * ZodError (no {success:false} guard). Query-level errors are caught and
 * re-thrown as `new Error('Failed to ...: <message>')`.
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
  return { tools: new TokenManipulationTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('TokenManipulationTools.getToolDefinitions', () => {
  it('exposes the six token-manipulation tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'move-token',
      'update-token',
      'delete-tokens',
      'get-token-details',
      'toggle-token-condition',
      'get-available-conditions',
    ]);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('move-token requires tokenId, x, and y', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'move-token')!;
    expect((def.inputSchema as any).required).toEqual(['tokenId', 'x', 'y']);
  });

  it('update-token requires tokenId and updates', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'update-token')!;
    expect((def.inputSchema as any).required).toEqual(['tokenId', 'updates']);
  });

  it('delete-tokens requires tokenIds', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'delete-tokens')!;
    expect((def.inputSchema as any).required).toEqual(['tokenIds']);
  });

  it('get-token-details requires tokenId', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-token-details')!;
    expect((def.inputSchema as any).required).toEqual(['tokenId']);
  });

  it('toggle-token-condition requires tokenId and conditionId', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'toggle-token-condition')!;
    expect((def.inputSchema as any).required).toEqual(['tokenId', 'conditionId']);
  });

  it('get-available-conditions has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-available-conditions')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleMoveToken
// ---------------------------------------------------------------------------

describe('TokenManipulationTools.handleMoveToken', () => {
  it('dispatches the correct query method with required params', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    const result = await tools.handleMoveToken({ tokenId: 'tok1', x: 100, y: 200 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.move-token', {
      tokenId: 'tok1',
      x: 100,
      y: 200,
      animate: false,
    });
    expect(result).toEqual({
      success: true,
      tokenId: 'tok1',
      newPosition: { x: 100, y: 200 },
      animated: false,
    });
  });

  it('passes animate: true when specified', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleMoveToken({ tokenId: 'tok2', x: 50, y: 75, animate: true });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.move-token', {
      tokenId: 'tok2',
      x: 50,
      y: 75,
      animate: true,
    });
  });

  it('throws (ZodError) when tokenId is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleMoveToken({ x: 10, y: 20 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when x or y are missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleMoveToken({ tokenId: 'tok1', x: 10 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to move token: <message>"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('socket timeout');
    });
    await expect(tools.handleMoveToken({ tokenId: 'tok1', x: 0, y: 0 })).rejects.toThrow(
      'Failed to move token: socket timeout'
    );
  });
});

// ---------------------------------------------------------------------------
// handleUpdateToken
// ---------------------------------------------------------------------------

describe('TokenManipulationTools.handleUpdateToken', () => {
  it('dispatches update-token with tokenId and updates object', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    const result = await tools.handleUpdateToken({
      tokenId: 'tok1',
      updates: { hidden: true, name: 'Shadow' },
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.update-token', {
      tokenId: 'tok1',
      updates: { hidden: true, name: 'Shadow' },
    });
    expect(result).toEqual({
      success: true,
      tokenId: 'tok1',
      updated: true,
      appliedUpdates: { hidden: true, name: 'Shadow' },
    });
  });

  it('dispatches with disposition when provided', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleUpdateToken({ tokenId: 'tok2', updates: { disposition: -1 } });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.update-token', {
      tokenId: 'tok2',
      updates: { disposition: -1 },
    });
  });

  it('throws (ZodError) when tokenId is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleUpdateToken({ updates: { hidden: false } })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when updates is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleUpdateToken({ tokenId: 'tok1' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when disposition is an invalid enum value', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleUpdateToken({ tokenId: 'tok1', updates: { disposition: 2 } })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to update token: <message>"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('connection lost');
    });
    await expect(
      tools.handleUpdateToken({ tokenId: 'tok1', updates: { hidden: true } })
    ).rejects.toThrow('Failed to update token: connection lost');
  });
});

// ---------------------------------------------------------------------------
// handleDeleteTokens
// ---------------------------------------------------------------------------

describe('TokenManipulationTools.handleDeleteTokens', () => {
  it('dispatches delete-tokens with array of tokenIds', async () => {
    const payload = { success: true, deletedCount: 2, tokenIds: ['a', 'b'], errors: [] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleDeleteTokens({ tokenIds: ['a', 'b'] });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.delete-tokens', {
      tokenIds: ['a', 'b'],
    });
    expect(result).toEqual({
      success: true,
      deletedCount: 2,
      tokenIds: ['a', 'b'],
      errors: [],
    });
  });

  it('throws (ZodError) when tokenIds is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleDeleteTokens({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when tokenIds is an empty array (minItems: 1)', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleDeleteTokens({ tokenIds: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to delete tokens: <message>"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('scene locked');
    });
    await expect(tools.handleDeleteTokens({ tokenIds: ['tok1'] })).rejects.toThrow(
      'Failed to delete tokens: scene locked'
    );
  });
});

// ---------------------------------------------------------------------------
// handleGetTokenDetails
// ---------------------------------------------------------------------------

describe('TokenManipulationTools.handleGetTokenDetails', () => {
  it('dispatches get-token-details and returns formatted token details', async () => {
    const rawToken = {
      id: 'tok1',
      name: 'Goblin',
      x: 100,
      y: 200,
      width: 1,
      height: 1,
      rotation: 0,
      scale: 1,
      alpha: 1,
      hidden: false,
      img: 'img/goblin.png',
      disposition: -1,
      elevation: 0,
      lockRotation: false,
      actorId: 'actor1',
      actorLink: false,
      actorData: { name: 'Goblin Actor', type: 'npc', img: 'img/goblin.png' },
    };
    const { tools, query } = makeTools(() => rawToken);
    const result = await tools.handleGetTokenDetails({ tokenId: 'tok1' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.get-token-details', {
      tokenId: 'tok1',
    });
    // formatTokenDetails shapes the result
    expect(result).toEqual({
      id: 'tok1',
      name: 'Goblin',
      position: { x: 100, y: 200 },
      size: { width: 1, height: 1 },
      appearance: { rotation: 0, scale: 1, alpha: 1, hidden: false, img: 'img/goblin.png' },
      behavior: { disposition: 'hostile', elevation: 0, lockRotation: false },
      actor: {
        id: 'actor1',
        name: 'Goblin Actor',
        type: 'npc',
        img: 'img/goblin.png',
        isLinked: false,
      },
    });
  });

  it('returns null actor when actorData is absent', async () => {
    const rawToken = {
      id: 'tok2',
      name: 'Object',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      scale: 1,
      alpha: 1,
      hidden: false,
      img: '',
      disposition: 0,
      elevation: 0,
      lockRotation: false,
      actorId: null,
      actorLink: false,
      actorData: null,
    };
    const { tools } = makeTools(() => rawToken);
    const result = await tools.handleGetTokenDetails({ tokenId: 'tok2' });
    expect(result.actor).toBeNull();
    expect(result.behavior.disposition).toBe('neutral');
  });

  it('maps disposition 1 to "friendly"', async () => {
    const rawToken = {
      id: 'tok3',
      name: 'Guard',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      scale: 1,
      alpha: 1,
      hidden: false,
      img: '',
      disposition: 1,
      elevation: 0,
      lockRotation: false,
      actorId: null,
      actorLink: false,
      actorData: null,
    };
    const { tools } = makeTools(() => rawToken);
    const result = await tools.handleGetTokenDetails({ tokenId: 'tok3' });
    expect(result.behavior.disposition).toBe('friendly');
  });

  it('throws (ZodError) when tokenId is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetTokenDetails({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to get token details: <message>"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('token not found');
    });
    await expect(tools.handleGetTokenDetails({ tokenId: 'tok1' })).rejects.toThrow(
      'Failed to get token details: token not found'
    );
  });
});

// ---------------------------------------------------------------------------
// handleToggleTokenCondition
// ---------------------------------------------------------------------------

describe('TokenManipulationTools.handleToggleTokenCondition', () => {
  it('dispatches toggle-token-condition with tokenId and conditionId', async () => {
    const payload = { isActive: true, conditionName: 'Prone' };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleToggleTokenCondition({
      tokenId: 'tok1',
      conditionId: 'prone',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'prone',
      active: undefined,
    });
    expect(result).toEqual({
      success: true,
      tokenId: 'tok1',
      conditionId: 'prone',
      isActive: true,
      conditionName: 'Prone',
    });
  });

  it('dispatches with active: true when specified', async () => {
    const { tools, query } = makeTools(() => ({ isActive: true, conditionName: 'Blinded' }));
    await tools.handleToggleTokenCondition({
      tokenId: 'tok1',
      conditionId: 'blinded',
      active: true,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'blinded',
      active: true,
    });
  });

  it('dispatches with active: false when specified', async () => {
    const { tools, query } = makeTools(() => ({ isActive: false, conditionName: 'Poisoned' }));
    await tools.handleToggleTokenCondition({
      tokenId: 'tok1',
      conditionId: 'poisoned',
      active: false,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'poisoned',
      active: false,
    });
  });

  it('throws (ZodError) when tokenId is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleToggleTokenCondition({ conditionId: 'prone' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when conditionId is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleToggleTokenCondition({ tokenId: 'tok1' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to toggle token condition: <message>"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('condition not found');
    });
    await expect(
      tools.handleToggleTokenCondition({ tokenId: 'tok1', conditionId: 'prone' })
    ).rejects.toThrow('Failed to toggle token condition: condition not found');
  });
});

// ---------------------------------------------------------------------------
// handleGetAvailableConditions
// ---------------------------------------------------------------------------

describe('TokenManipulationTools.handleGetAvailableConditions', () => {
  it('dispatches get-available-conditions with empty params and returns shaped result', async () => {
    const payload = {
      conditions: [{ id: 'prone', name: 'Prone' }],
      gameSystem: 'dnd5e',
    };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetAvailableConditions({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.get-available-conditions', {});
    expect(result).toEqual({
      success: true,
      conditions: [{ id: 'prone', name: 'Prone' }],
      gameSystem: 'dnd5e',
    });
  });

  it('works when called with undefined args', async () => {
    const payload = { conditions: [], gameSystem: 'dnd5e' };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetAvailableConditions(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.get-available-conditions', {});
    expect(result.success).toBe(true);
  });

  it('wraps query errors as "Failed to get available conditions: <message>"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('system not loaded');
    });
    await expect(tools.handleGetAvailableConditions({})).rejects.toThrow(
      'Failed to get available conditions: system not loaded'
    );
  });
});
