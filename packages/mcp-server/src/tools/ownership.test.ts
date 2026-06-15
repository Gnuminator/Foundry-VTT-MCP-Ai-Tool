import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OwnershipTools } from './ownership.js';

/**
 * Tests for OwnershipTools — a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures → return validation errors (zod throws on bad
 * permissionLevel; confirmRemoval=false returns {success:false} without throwing).
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 *
 * Dispatch entry-point: handleToolCall(name, args) — routes to the three private
 * methods by tool name; throws Error('Unknown ownership tool: <name>') for anything
 * else.
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
  return { tools: new OwnershipTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('OwnershipTools.getToolDefinitions', () => {
  it('exposes the three ownership tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'assign-actor-ownership',
      'remove-actor-ownership',
      'list-actor-ownership',
    ]);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('assign-actor-ownership requires actorIdentifier, playerIdentifier, and permissionLevel', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const assign = defs.find(d => d.name === 'assign-actor-ownership')!;
    expect((assign.inputSchema as any).required).toEqual([
      'actorIdentifier',
      'playerIdentifier',
      'permissionLevel',
    ]);
  });

  it('remove-actor-ownership requires actorIdentifier and playerIdentifier', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const remove = defs.find(d => d.name === 'remove-actor-ownership')!;
    expect((remove.inputSchema as any).required).toEqual(['actorIdentifier', 'playerIdentifier']);
  });

  it('list-actor-ownership has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const list = defs.find(d => d.name === 'list-actor-ownership')!;
    expect((list.inputSchema as any).required).toBeUndefined();
  });

  it('assign-actor-ownership permissionLevel enum includes the four levels', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const assign = defs.find(d => d.name === 'assign-actor-ownership')!;
    const permProp = (assign.inputSchema as any).properties.permissionLevel;
    expect(permProp.enum).toEqual(['NONE', 'LIMITED', 'OBSERVER', 'OWNER']);
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — unknown tool name
// ---------------------------------------------------------------------------

describe('OwnershipTools.handleToolCall — unknown tool name', () => {
  it('throws when given an unrecognised tool name', async () => {
    const { tools } = makeTools();
    await expect(tools.handleToolCall('does-not-exist', {})).rejects.toThrow(
      'Unknown ownership tool: does-not-exist'
    );
  });
});

// ---------------------------------------------------------------------------
// assign-actor-ownership (via handleToolCall)
// ---------------------------------------------------------------------------

describe("OwnershipTools.handleToolCall('assign-actor-ownership')", () => {
  /**
   * For a single actor + single player the query sequence is:
   *   1. foundry-mcp-bridge.findActor      { identifier }
   *   2. foundry-mcp-bridge.findPlayers    { identifier, allowPartialMatch, includeCharacterOwners }
   *   3. foundry-mcp-bridge.setActorOwnership { actorId, userId, permission }
   */
  function makeAssignTools(
    queryImpl: (method: string, data: unknown) => unknown = (method: string) => {
      if (method === 'foundry-mcp-bridge.findActor') return { id: 'a1', name: 'Aragorn' };
      if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
      if (method === 'foundry-mcp-bridge.setActorOwnership')
        return { success: true, message: 'done' };
      return { success: true };
    }
  ) {
    return makeTools(queryImpl);
  }

  it('resolves a single actor and single player then calls setActorOwnership with numeric level', async () => {
    const { tools, query } = makeAssignTools();
    const result = await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel: 'OWNER',
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.findActor', { identifier: 'Aragorn' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.findPlayers', {
      identifier: 'John',
      allowPartialMatch: true,
      includeCharacterOwners: true,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setActorOwnership', {
      actorId: 'a1',
      userId: 'p1',
      permission: 3, // OWNER = 3
    });

    expect((result as any).success).toBe(true);
    expect((result as any).results).toHaveLength(1);
    expect((result as any).results[0]).toMatchObject({
      actor: 'Aragorn',
      player: 'John',
      permission: 'OWNER',
      success: true,
    });
  });

  it('maps OBSERVER to numeric level 2', async () => {
    const { tools, query } = makeAssignTools();
    await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel: 'OBSERVER',
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorOwnership',
      expect.objectContaining({ permission: 2 })
    );
  });

  it('maps LIMITED to numeric level 1', async () => {
    const { tools, query } = makeAssignTools();
    await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel: 'LIMITED',
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorOwnership',
      expect.objectContaining({ permission: 1 })
    );
  });

  it('maps NONE to numeric level 0', async () => {
    const { tools, query } = makeAssignTools();
    await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel: 'NONE',
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorOwnership',
      expect.objectContaining({ permission: 0 })
    );
  });

  it('throws (zod parse error) when permissionLevel is not a valid enum value', async () => {
    const { tools } = makeAssignTools();
    await expect(
      tools.handleToolCall('assign-actor-ownership', {
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'John',
        permissionLevel: 'SUPERUSER',
      })
    ).rejects.toThrow();
  });

  it('returns bulk-confirmation-required response without dispatching setActorOwnership when multiple actors found and confirmBulkOperation is false', async () => {
    // Return two actors to trigger bulk check
    const { tools, query } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.findActor') return { id: 'a1', name: 'Aragorn' };
      if (method === 'foundry-mcp-bridge.getFriendlyNPCs')
        return [
          { id: 'a1', name: 'Goblin A' },
          { id: 'a2', name: 'Goblin B' },
        ];
      if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
      return { success: true };
    });

    const result = (await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'all friendly NPCs',
      playerIdentifier: 'John',
      permissionLevel: 'OBSERVER',
      confirmBulkOperation: false,
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/bulk operation/i);
    expect(query).not.toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorOwnership',
      expect.anything()
    );
  });

  it('proceeds when confirmBulkOperation is true for bulk operations', async () => {
    const { tools, query } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.getFriendlyNPCs')
        return [
          { id: 'a1', name: 'Goblin A' },
          { id: 'a2', name: 'Goblin B' },
        ];
      if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
      if (method === 'foundry-mcp-bridge.setActorOwnership')
        return { success: true, message: 'done' };
      return { success: true };
    });

    const result = (await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'all friendly NPCs',
      playerIdentifier: 'John',
      permissionLevel: 'OBSERVER',
      confirmBulkOperation: true,
    })) as any;

    expect(result.success).toBe(true);
    // Two actors × one player = two calls
    const setOwnershipCalls = query.mock.calls.filter(
      c => c[0] === 'foundry-mcp-bridge.setActorOwnership'
    );
    expect(setOwnershipCalls).toHaveLength(2);
  });

  it('records failure in results array when setActorOwnership returns success:false', async () => {
    const { tools } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.findActor') return { id: 'a1', name: 'Aragorn' };
      if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
      if (method === 'foundry-mcp-bridge.setActorOwnership')
        return { success: false, error: 'permission denied' };
      return { success: true };
    });

    const result = (await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel: 'OWNER',
    })) as any;

    // Top-level success is false because no results succeeded
    expect(result.success).toBe(false);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toBe('permission denied');
  });

  it('uses foundry-mcp-bridge.getPartyCharacters for "party characters" identifier', async () => {
    const { tools, query } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.getPartyCharacters') return [{ id: 'a1', name: 'Hero' }];
      if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
      if (method === 'foundry-mcp-bridge.setActorOwnership')
        return { success: true, message: 'done' };
      return { success: true };
    });

    await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'party characters',
      playerIdentifier: 'John',
      permissionLevel: 'OWNER',
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getPartyCharacters', {});
  });

  it('uses foundry-mcp-bridge.getConnectedPlayers for "party" player identifier', async () => {
    const { tools, query } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.findActor') return { id: 'a1', name: 'Aragorn' };
      if (method === 'foundry-mcp-bridge.getConnectedPlayers')
        return [
          { id: 'p1', name: 'Alice' },
          { id: 'p2', name: 'Bob' },
        ];
      if (method === 'foundry-mcp-bridge.setActorOwnership')
        return { success: true, message: 'done' };
      return { success: true };
    });

    await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'party',
      permissionLevel: 'OBSERVER',
      confirmBulkOperation: true,
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getConnectedPlayers', {});
  });
});

// ---------------------------------------------------------------------------
// remove-actor-ownership (via handleToolCall)
// ---------------------------------------------------------------------------

describe("OwnershipTools.handleToolCall('remove-actor-ownership')", () => {
  it('returns success:false without querying when confirmRemoval is false (default)', async () => {
    const { tools, query } = makeTools();
    const result = (await tools.handleToolCall('remove-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/confirmRemoval/i);
    // No bridge calls should have been made
    expect(query).not.toHaveBeenCalled();
  });

  it('returns success:false when confirmRemoval is explicitly false', async () => {
    const { tools, query } = makeTools();
    const result = (await tools.handleToolCall('remove-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      confirmRemoval: false,
    })) as any;

    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('delegates to assignActorOwnership with permissionLevel NONE when confirmRemoval is true', async () => {
    const { tools, query } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.findActor') return { id: 'a1', name: 'Aragorn' };
      if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
      if (method === 'foundry-mcp-bridge.setActorOwnership')
        return { success: true, message: 'done' };
      return { success: true };
    });

    const result = (await tools.handleToolCall('remove-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      confirmRemoval: true,
    })) as any;

    // Should have set ownership to NONE (0)
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setActorOwnership', {
      actorId: 'a1',
      userId: 'p1',
      permission: 0,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// list-actor-ownership (via handleToolCall)
// ---------------------------------------------------------------------------

describe("OwnershipTools.handleToolCall('list-actor-ownership')", () => {
  it('dispatches foundry-mcp-bridge.getActorOwnership with the provided identifiers', async () => {
    const ownershipData = { actors: [{ name: 'Aragorn', owners: ['John'] }] };
    const { tools, query } = makeTools(() => ownershipData);

    const result = (await tools.handleToolCall('list-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
    })) as any;

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getActorOwnership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
    });
    expect(result.success).toBe(true);
    expect(result.ownership).toBe(ownershipData);
  });

  it('dispatches with undefined identifiers when no args provided', async () => {
    const { tools, query } = makeTools(() => ({}));
    await tools.handleToolCall('list-actor-ownership', {});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getActorOwnership', {
      actorIdentifier: undefined,
      playerIdentifier: undefined,
    });
  });

  it('returns success:false (not throws) when foundry query throws', async () => {
    let consoleErr: ReturnType<typeof vi.spyOn>;
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { tools } = makeTools(() => {
      throw new Error('bridge unavailable');
    });

    const result = (await tools.handleToolCall('list-actor-ownership', {})) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe('bridge unavailable');
    consoleErr.mockRestore();
  });

  it('returns success:false with generic error string when a non-Error is thrown', async () => {
    let consoleErr: ReturnType<typeof vi.spyOn>;
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { tools } = makeTools(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'oops';
    });

    const result = (await tools.handleToolCall('list-actor-ownership', {})) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
    consoleErr.mockRestore();
  });
});
