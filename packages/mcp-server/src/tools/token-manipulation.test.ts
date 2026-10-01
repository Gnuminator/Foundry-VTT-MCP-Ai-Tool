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
  it('exposes the two token read tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['get-token-details', 'get-available-conditions']);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('get-token-details requires tokenId', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-token-details')!;
    expect((def.inputSchema as any).required).toEqual(['tokenId']);
  });

  it('get-available-conditions has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-available-conditions')!;
    expect((def.inputSchema as any).required).toBeUndefined();
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

// ---------------------------------------------------------------------------
// M3: secret disposition (-2); token writes moved to plan-token-change (live-play.test.ts)
// ---------------------------------------------------------------------------

describe('TokenManipulationTools secret disposition (M3)', () => {
  it('get-token-details maps disposition -2 to "secret"', async () => {
    const rawToken = {
      id: 'tok9',
      name: 'Stranger',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      scale: 1,
      alpha: 1,
      hidden: false,
      img: '',
      disposition: -2,
      elevation: 0,
      lockRotation: false,
      actorId: null,
      actorLink: false,
      actorData: null,
    };
    const { tools } = makeTools(() => rawToken);
    const result = await tools.handleGetTokenDetails({ tokenId: 'tok9' });
    expect(result.behavior.disposition).toBe('secret');
  });
});
