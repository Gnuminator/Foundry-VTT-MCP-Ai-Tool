import { describe, expect, it, vi } from 'vitest';

import { OwnershipTools } from './ownership.js';

/**
 * Tests for OwnershipTools: `plan-ownership-change` (F5 L3, D-082) resolves actors and players
 * through read queries on a mocked FoundryClient and hands one `update` op per actor to the
 * guarded-write service (a fake here), so these tests run with no bridge connection. The
 * ownership write itself is applied and undone by apply-planned-change / undo-change.
 */

type Before = Record<string, { present: boolean; value?: unknown }>;

/** A fake `createPlan` that builds the diff the real service would: one line per changed path. */
function fakeCreatePlan(befores: Record<string, Before> = {}) {
  return vi.fn((input: any) =>
    Promise.resolve({
      planId: 'plan-1',
      feature: input.feature,
      summary: input.summary,
      target: 'foundry',
      risk: 'normal',
      worldId: 'w1',
      createdAt: '2026-10-01T10:00:00.000Z',
      expiresAt: '2026-10-01T10:15:00.000Z',
      requires: { confirm: true, confirmDestructive: false },
      diff: input.ops.flatMap((op: any, i: number) =>
        Object.entries(op.changes).map(([path, after]) => ({
          op: i,
          kind: 'update',
          target: op.uuid,
          label: `Actor "${op.uuid.slice('Actor.'.length)}"`,
          path,
          before: befores[op.uuid]?.[path] ?? { present: false },
          after: { present: true, value: after },
          text: `${op.uuid}: ${path}`,
        }))
      ),
    })
  );
}

function makeTools(
  queryImpl?: (method: string, data: unknown) => unknown,
  createPlan: ReturnType<typeof fakeCreatePlan> = fakeCreatePlan()
) {
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
  const guardedWrites = { createPlan } as any;
  return {
    tools: new OwnershipTools({ foundryClient, guardedWrites, logger }),
    query,
    createPlan,
  };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('OwnershipTools.getToolDefinitions', () => {
  it('exposes plan-ownership-change and list-actor-ownership with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['plan-ownership-change', 'list-actor-ownership']);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('plan-ownership-change requires action, actorIdentifier and playerIdentifier', () => {
    const { tools } = makeTools();
    const plan = tools.getToolDefinitions().find(d => d.name === 'plan-ownership-change')!;
    expect((plan.inputSchema as any).required).toEqual([
      'action',
      'actorIdentifier',
      'playerIdentifier',
    ]);
    expect((plan.inputSchema as any).properties.action.enum).toEqual(['assign', 'remove']);
  });

  it('plan-ownership-change permissionLevel enum includes the four levels', () => {
    const { tools } = makeTools();
    const plan = tools.getToolDefinitions().find(d => d.name === 'plan-ownership-change')!;
    const permProp = (plan.inputSchema as any).properties.permissionLevel;
    expect(permProp.enum).toEqual(['NONE', 'LIMITED', 'OBSERVER', 'OWNER']);
  });

  it('list-actor-ownership has no required fields', () => {
    const { tools } = makeTools();
    const list = tools.getToolDefinitions().find(d => d.name === 'list-actor-ownership')!;
    expect((list.inputSchema as any).required).toBeUndefined();
  });

  it('no longer exposes the direct assign and remove tools', () => {
    const { tools } = makeTools();
    const names = tools.getToolDefinitions().map(d => d.name);
    expect(names).not.toContain('assign-actor-ownership');
    expect(names).not.toContain('remove-actor-ownership');
  });
});

// ---------------------------------------------------------------------------
// handleToolCall: unknown tool name
// ---------------------------------------------------------------------------

describe('OwnershipTools.handleToolCall: unknown tool name', () => {
  it('throws when given an unrecognised tool name', async () => {
    const { tools } = makeTools();
    await expect(tools.handleToolCall('does-not-exist', {})).rejects.toThrow(
      'Unknown ownership tool: does-not-exist'
    );
  });

  it('rejects the removed direct tools', async () => {
    const { tools } = makeTools();
    await expect(tools.handleToolCall('assign-actor-ownership', {})).rejects.toThrow(
      'Unknown ownership tool: assign-actor-ownership'
    );
    await expect(tools.handleToolCall('remove-actor-ownership', {})).rejects.toThrow(
      'Unknown ownership tool: remove-actor-ownership'
    );
  });
});

// ---------------------------------------------------------------------------
// plan-ownership-change (via handleToolCall)
// ---------------------------------------------------------------------------

describe("OwnershipTools.handleToolCall('plan-ownership-change')", () => {
  /**
   * For a single actor + single player the read queries are:
   *   1. foundry-mcp-bridge.findActor   { identifier }
   *   2. foundry-mcp-bridge.findPlayers { identifier, allowPartialMatch, includeCharacterOwners }
   * and nothing is written: the plan goes to the guarded-write service.
   */
  const singleQueries = (method: string): unknown => {
    if (method === 'foundry-mcp-bridge.findActor') return { id: 'a1', name: 'Aragorn' };
    if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
    return { success: true };
  };

  it('plans one update op for a single actor and player, with the numeric level', async () => {
    const { tools, query, createPlan } = makeTools(singleQueries);
    const result = (await tools.handleToolCall('plan-ownership-change', {
      action: 'assign',
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel: 'OWNER',
    })) as any;

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.findActor', { identifier: 'Aragorn' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.findPlayers', {
      identifier: 'John',
      allowPartialMatch: true,
      includeCharacterOwners: true,
    });
    // Reads only: no module write handler is involved any more.
    expect(query.mock.calls.map(c => c[0])).not.toContain('foundry-mcp-bridge.setActorOwnership');

    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(createPlan).toHaveBeenCalledWith({
      feature: 'ownership',
      summary: 'Give John OWNER on Aragorn',
      ops: [{ kind: 'update', uuid: 'Actor.a1', changes: { 'ownership.p1': 3 } }],
      pathLabels: { 'ownership.p1': 'ownership for John' },
    });
    expect(result.planId).toBe('plan-1');
    expect(result.autoApply).toBe(false);
  });

  it.each([
    ['NONE', 0],
    ['LIMITED', 1],
    ['OBSERVER', 2],
    ['OWNER', 3],
  ])('maps %s to numeric level %i', async (permissionLevel, level) => {
    const { tools, createPlan } = makeTools(singleQueries);
    await tools.handleToolCall('plan-ownership-change', {
      action: 'assign',
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel,
    });
    expect(createPlan.mock.calls[0][0].ops[0].changes).toEqual({ 'ownership.p1': level });
  });

  it('remove sets the level to NONE (0), ignoring any permissionLevel', async () => {
    const { tools, createPlan } = makeTools(singleQueries);
    await tools.handleToolCall('plan-ownership-change', {
      action: 'remove',
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel: 'OWNER',
    });
    const input = createPlan.mock.calls[0][0];
    expect(input.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'ownership.p1': 0 } },
    ]);
    expect(input.summary).toBe("Remove John's access to Aragorn (set to NONE)");
  });

  it('assign without permissionLevel throws and plans nothing', async () => {
    const { tools, createPlan } = makeTools(singleQueries);
    await expect(
      tools.handleToolCall('plan-ownership-change', {
        action: 'assign',
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'John',
      })
    ).rejects.toThrow(/needs permissionLevel/);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('throws (zod parse error) when permissionLevel is not a valid enum value', async () => {
    const { tools, createPlan } = makeTools(singleQueries);
    await expect(
      tools.handleToolCall('plan-ownership-change', {
        action: 'assign',
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'John',
        permissionLevel: 'SUPERUSER',
      })
    ).rejects.toThrow();
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('throws on an unknown action', async () => {
    const { tools } = makeTools(singleQueries);
    await expect(
      tools.handleToolCall('plan-ownership-change', {
        action: 'transfer',
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'John',
      })
    ).rejects.toThrow();
  });

  it('plans one op per actor for "all friendly NPCs"', async () => {
    const { tools, query, createPlan } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.getFriendlyNPCs')
        return [
          { id: 'a1', name: 'Goblin A' },
          { id: 'a2', name: 'Goblin B' },
        ];
      if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
      return { success: true };
    });

    await tools.handleToolCall('plan-ownership-change', {
      action: 'assign',
      actorIdentifier: 'all friendly NPCs',
      playerIdentifier: 'John',
      permissionLevel: 'OBSERVER',
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getFriendlyNPCs', {});
    expect(createPlan).toHaveBeenCalledTimes(1);
    const input = createPlan.mock.calls[0][0];
    expect(input.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'ownership.p1': 2 } },
      { kind: 'update', uuid: 'Actor.a2', changes: { 'ownership.p1': 2 } },
    ]);
    expect(input.summary).toBe('Give John OBSERVER on 2 actors');
  });

  it('uses foundry-mcp-bridge.getPartyCharacters for "party characters"', async () => {
    const { tools, query, createPlan } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.getPartyCharacters') return [{ id: 'a1', name: 'Hero' }];
      if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
      return { success: true };
    });

    await tools.handleToolCall('plan-ownership-change', {
      action: 'assign',
      actorIdentifier: 'party characters',
      playerIdentifier: 'John',
      permissionLevel: 'OWNER',
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getPartyCharacters', {});
    expect(createPlan.mock.calls[0][0].ops).toHaveLength(1);
  });

  it('uses foundry-mcp-bridge.getConnectedPlayers for "party" and puts every player on each op', async () => {
    const { tools, query, createPlan } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.findActor') return { id: 'a1', name: 'Aragorn' };
      if (method === 'foundry-mcp-bridge.getConnectedPlayers')
        return [
          { id: 'p1', name: 'Alice' },
          { id: 'p2', name: 'Bob' },
        ];
      return { success: true };
    });

    await tools.handleToolCall('plan-ownership-change', {
      action: 'assign',
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'party',
      permissionLevel: 'OBSERVER',
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getConnectedPlayers', {});
    const input = createPlan.mock.calls[0][0];
    expect(input.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Actor.a1',
        changes: { 'ownership.p1': 2, 'ownership.p2': 2 },
      },
    ]);
    expect(input.pathLabels).toEqual({
      'ownership.p1': 'ownership for Alice',
      'ownership.p2': 'ownership for Bob',
    });
    expect(input.summary).toBe('Give Alice, Bob OBSERVER on Aragorn');
  });

  it('throws when no actor matches', async () => {
    const { tools, createPlan } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.findActor') return null;
      if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
      return { success: true };
    });
    await expect(
      tools.handleToolCall('plan-ownership-change', {
        action: 'assign',
        actorIdentifier: 'Nobody',
        playerIdentifier: 'John',
        permissionLevel: 'OWNER',
      })
    ).rejects.toThrow('No actor matches "Nobody"');
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('throws when no player matches', async () => {
    const { tools, createPlan } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.findActor') return { id: 'a1', name: 'Aragorn' };
      if (method === 'foundry-mcp-bridge.findPlayers') return [];
      return { success: true };
    });
    await expect(
      tools.handleToolCall('plan-ownership-change', {
        action: 'assign',
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'Ghost',
        permissionLevel: 'OWNER',
      })
    ).rejects.toThrow('No player matches "Ghost"');
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('treats a failing lookup as no match and throws', async () => {
    const { tools, createPlan } = makeTools((method: string) => {
      if (method === 'foundry-mcp-bridge.findActor') throw new Error('bridge unavailable');
      return [{ id: 'p1', name: 'John' }];
    });
    await expect(
      tools.handleToolCall('plan-ownership-change', {
        action: 'remove',
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'John',
      })
    ).rejects.toThrow('No actor matches "Aragorn"');
    expect(createPlan).not.toHaveBeenCalled();
  });

  describe('targets preview from the plan diff', () => {
    it('says "was default" when the user had no ownership entry', async () => {
      const { tools } = makeTools(singleQueries);
      const result = (await tools.handleToolCall('plan-ownership-change', {
        action: 'assign',
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'John',
        permissionLevel: 'OBSERVER',
      })) as any;
      expect(result.targets).toEqual([
        {
          target: 'Aragorn',
          actorUuid: 'Actor.a1',
          line: 'Aragorn: John OBSERVER, was default',
        },
      ]);
    });

    it('names the old level when there was one, and skips unchanged actors in a bulk plan', async () => {
      const createPlan = fakeCreatePlan({
        'Actor.a1': { 'ownership.p1': { present: true, value: 3 } },
        'Actor.a2': { 'ownership.p1': { present: true, value: 2 } },
      });
      const { tools } = makeTools((method: string) => {
        if (method === 'foundry-mcp-bridge.getFriendlyNPCs')
          return [
            { id: 'a1', name: 'Goblin A' },
            { id: 'a2', name: 'Goblin B' },
          ];
        if (method === 'foundry-mcp-bridge.findPlayers') return [{ id: 'p1', name: 'John' }];
        return { success: true };
      }, createPlan);

      const result = (await tools.handleToolCall('plan-ownership-change', {
        action: 'assign',
        actorIdentifier: 'all friendly NPCs',
        playerIdentifier: 'John',
        permissionLevel: 'OBSERVER',
      })) as any;

      expect(result.targets).toEqual([
        { target: 'Goblin A', actorUuid: 'Actor.a1', line: 'Goblin A: John OBSERVER, was OWNER' },
        {
          target: 'Goblin B',
          actorUuid: 'Actor.a2',
          line: 'Goblin B: John OBSERVER already',
          skipped: true,
        },
      ]);
      expect(result.autoApply).toBe(false);
      // The plan itself is passed through untouched.
      expect(result.planId).toBe('plan-1');
      expect(result.diff).toHaveLength(2);
    });

    it('throws "Nothing to change" when every target already has that level', async () => {
      const createPlan = fakeCreatePlan({
        'Actor.a1': { 'ownership.p1': { present: true, value: 0 } },
      });
      const { tools } = makeTools(singleQueries, createPlan);
      await expect(
        tools.handleToolCall('plan-ownership-change', {
          action: 'remove',
          actorIdentifier: 'Aragorn',
          playerIdentifier: 'John',
        })
      ).rejects.toThrow(/Nothing to change: Aragorn: John NONE already/);
    });
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
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { tools } = makeTools(() => {
      throw new Error('bridge unavailable');
    });

    const result = (await tools.handleToolCall('list-actor-ownership', {})) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe('bridge unavailable');
    consoleErr.mockRestore();
  });

  it('returns success:false with generic error string when a non-Error is thrown', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { tools } = makeTools(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'oops';
    });

    const result = (await tools.handleToolCall('list-actor-ownership', {})) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
    consoleErr.mockRestore();
  });
});
