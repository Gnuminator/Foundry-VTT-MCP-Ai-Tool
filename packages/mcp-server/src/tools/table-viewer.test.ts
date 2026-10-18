import { describe, expect, it, vi } from 'vitest';

import { TableViewerTools } from './table-viewer.js';

/**
 * `plan-table-viewer` (tv-login, G1) looks for an existing user through the read query
 * `findPlayers` and hands one `create` op on a User to the guarded-write service (a fake here), so
 * these tests need no bridge. Apply and undo are the generic guarded-write flow.
 */

function makeTools(existing: Array<{ id: string; name: string }> = []): {
  tools: TableViewerTools;
  query: ReturnType<typeof vi.fn>;
  createPlan: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(() => Promise.resolve(existing));
  const createPlan = vi.fn((input: any) =>
    Promise.resolve({ planId: 'plan-1', ...input, diff: [] })
  );
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const tools = new TableViewerTools({
    foundryClient: { query } as any,
    guardedWrites: { createPlan },
    logger,
  });
  return { tools, query, createPlan };
}

describe('TableViewerTools', () => {
  it('lists one tool, plan-table-viewer', () => {
    const { tools } = makeTools();
    expect(tools.getToolDefinitions().map(t => t.name)).toEqual(['plan-table-viewer']);
  });

  it('plans one create op: a Player-role user named Table, no password, no ownership', async () => {
    const { tools, createPlan } = makeTools();
    const plan: any = await tools.handleToolCall('plan-table-viewer', {});
    expect(plan.autoApply).toBe(false);
    const input = createPlan.mock.calls[0]?.[0];
    expect(input.feature).toBe('table-viewer');
    expect(input.ops).toEqual([
      { kind: 'create', documentName: 'User', data: { name: 'Table', role: 1 } },
    ]);
    expect(input.ops[0].data).not.toHaveProperty('password');
  });

  it('looks for an exact name match only, without the character-owner fallback', async () => {
    const { tools, query } = makeTools();
    await tools.handleToolCall('plan-table-viewer', { name: ' TV ' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.findPlayers', {
      identifier: 'TV',
      allowPartialMatch: false,
      includeCharacterOwners: false,
    });
  });

  it('refuses when a user of that name exists and plans nothing', async () => {
    const { tools, createPlan } = makeTools([{ id: 'u1', name: 'Table' }]);
    await expect(tools.handleToolCall('plan-table-viewer', {})).rejects.toThrow(/already exists/);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('rejects an empty or too long name', async () => {
    const { tools } = makeTools();
    await expect(tools.handleToolCall('plan-table-viewer', { name: '   ' })).rejects.toThrow();
    await expect(
      tools.handleToolCall('plan-table-viewer', { name: 'x'.repeat(41) })
    ).rejects.toThrow();
  });

  it('rejects an unknown tool name', async () => {
    const { tools } = makeTools();
    await expect(tools.handleToolCall('nope', {})).rejects.toThrow(/Unknown/);
  });
});
