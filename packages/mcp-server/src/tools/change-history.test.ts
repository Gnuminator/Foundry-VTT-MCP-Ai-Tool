import { describe, expect, it, vi } from 'vitest';

import { ChangeHistoryTools } from './change-history.js';

const EM_DASH = String.fromCharCode(0x2014);

function makeTools(): {
  tools: ChangeHistoryTools;
  list: ReturnType<typeof vi.fn>;
  plan: ReturnType<typeof vi.fn>;
} {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const list = vi.fn(() => Promise.resolve({ changes: [] }));
  const plan = vi.fn(() => Promise.resolve({ planId: 'plan-1' }));
  return {
    tools: new ChangeHistoryTools({
      changeHistory: { list },
      undoPlanner: { plan } as any,
      logger,
    }),
    list,
    plan,
  };
}

describe('list-changes', () => {
  it('is read-only and points at plan-undo-changes for undoing a change', () => {
    const [tool] = makeTools().tools.getToolDefinitions();
    expect(tool?.name).toBe('list-changes');
    expect(tool?.description).toContain('plan-undo-changes');
    expect(tool?.description).not.toContain(EM_DASH);
  });

  it('defaults to 30 changes from everyone', async () => {
    const { tools, list } = makeTools();
    await tools.handleListChanges(undefined);
    expect(list).toHaveBeenCalledWith({ limit: 30, source: 'all' });
  });

  it('maps person to a user id or name and passes the other filters on', async () => {
    const { tools, list } = makeTools();
    await tools.handleListChanges({
      limit: 5,
      person: ' Ireena ',
      thing: 'Actor.a1',
      source: 'human',
      since: '2026-10-06T19:00:00Z',
    });
    expect(list).toHaveBeenCalledWith({
      limit: 5,
      userId: 'Ireena',
      userName: 'Ireena',
      thingUuid: 'Actor.a1',
      source: 'human',
      sinceIso: '2026-10-06T19:00:00Z',
    });
  });

  it('rejects a limit over 200, an unknown source and a bad time', async () => {
    const { tools } = makeTools();
    await expect(tools.handleListChanges({ limit: 201 })).rejects.toThrow();
    await expect(tools.handleListChanges({ source: 'robots' })).rejects.toThrow();
    await expect(tools.handleListChanges({ since: 'yesterday-ish' })).rejects.toThrow();
  });
});

describe('plan-undo-changes', () => {
  it('needs an id and offers the three scopes', () => {
    const tool = makeTools()
      .tools.getToolDefinitions()
      .find(t => t.name === 'plan-undo-changes');
    expect(tool?.inputSchema.required).toEqual(['id']);
    expect((tool?.inputSchema.properties.scope as { enum: string[] }).enum).toEqual([
      'just-this',
      'everything-since',
      'world-since',
    ]);
    expect(tool?.description).not.toContain(EM_DASH);
  });

  it('plans just-this by default and passes rewindTable on', async () => {
    const { tools, plan } = makeTools();
    await tools.handlePlanUndoChanges({ id: ' act:a1 ' });
    expect(plan).toHaveBeenCalledWith({ id: 'act:a1', scope: 'just-this' });
    await tools.handlePlanUndoChanges({ id: 'chg-1', scope: 'world-since', rewindTable: true });
    expect(plan).toHaveBeenLastCalledWith({
      id: 'chg-1',
      scope: 'world-since',
      rewindTable: true,
    });
  });

  it('rejects a missing id and an unknown scope', async () => {
    const { tools } = makeTools();
    await expect(tools.handlePlanUndoChanges({})).rejects.toThrow();
    await expect(tools.handlePlanUndoChanges({ id: 'x', scope: 'galaxy' })).rejects.toThrow();
  });
});
