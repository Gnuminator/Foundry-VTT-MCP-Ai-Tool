import { describe, expect, it, vi } from 'vitest';

import { GuardedChangeTools } from './guarded-changes.js';

function makeTools(): {
  tools: GuardedChangeTools;
  guardedWrites: Record<string, ReturnType<typeof vi.fn>>;
  query: ReturnType<typeof vi.fn>;
  logger: any;
} {
  const guardedWrites = {
    getPlan: vi.fn(() => ({ planId: 'p1' })),
    listPlans: vi.fn(() => [{ planId: 'p1' }]),
    applyPlan: vi.fn(() => Promise.resolve({ changeId: 'c1' })),
    undo: vi.fn(() => Promise.resolve({ changeId: 'c2' })),
    listRecentChanges: vi.fn(() => Promise.resolve([{ changeId: 'c1' }])),
  };
  const query = vi.fn(() => Promise.resolve({ opened: true }) as Promise<unknown>);
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const tools = new GuardedChangeTools({
    guardedWrites: guardedWrites as never,
    foundryClient: { query },
    logger,
  });
  return { tools, guardedWrites, query, logger };
}

describe('GuardedChangeTools definitions', () => {
  it('exposes the five M0 tools with object schemas', () => {
    const defs = makeTools().tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'get-planned-change',
      'apply-planned-change',
      'list-recent-changes',
      'undo-change',
      'open-in-foundry',
    ]);
    for (const d of defs) expect(d.inputSchema.type).toBe('object');
    const byName = Object.fromEntries(defs.map(d => [d.name, d.inputSchema as any]));
    expect(byName['apply-planned-change'].required).toEqual(['planId', 'confirm']);
    expect(byName['undo-change'].required).toEqual(['changeId', 'confirm']);
    expect(byName['open-in-foundry'].required).toEqual(['uuid']);
  });
});

describe('GuardedChangeTools handlers', () => {
  it('shows one plan, or lists pending plans', async () => {
    const { tools, guardedWrites } = makeTools();
    expect(await tools.handleGetPlannedChange({ planId: 'p1' })).toEqual({ planId: 'p1' });
    expect(guardedWrites.getPlan).toHaveBeenCalledWith('p1');
    expect(await tools.handleGetPlannedChange(undefined)).toEqual({ plans: [{ planId: 'p1' }] });
  });

  it('passes the confirmation flags through to apply', async () => {
    const { tools, guardedWrites } = makeTools();
    await tools.handleApplyPlannedChange({ planId: 'p1', confirm: true, confirmDestructive: true });
    expect(guardedWrites.applyPlan).toHaveBeenCalledWith(
      'p1',
      { confirm: true, confirmDestructive: true },
      undefined
    );
    await tools.handleApplyPlannedChange({ planId: 'p1' });
    expect(guardedWrites.applyPlan).toHaveBeenLastCalledWith('p1', {}, undefined);
    await tools.handleApplyPlannedChange({ planId: 'p1', confirm: true }, 'Danni');
    expect(guardedWrites.applyPlan).toHaveBeenLastCalledWith('p1', { confirm: true }, 'Danni');
    await expect(tools.handleApplyPlannedChange({})).rejects.toThrow();
    await expect(
      tools.handleApplyPlannedChange({ planId: 'p1', confirm: 'yes' })
    ).rejects.toThrow();
  });

  it('logs and rethrows a refused apply or undo', async () => {
    const { tools, guardedWrites, logger } = makeTools();
    guardedWrites.applyPlan.mockRejectedValueOnce(new Error('needs confirm: true'));
    await expect(tools.handleApplyPlannedChange({ planId: 'p1' })).rejects.toThrow(/needs confirm/);
    guardedWrites.undo.mockRejectedValueOnce(new Error('Conflict'));
    await expect(tools.handleUndoChange({ changeId: 'c1', confirm: true })).rejects.toThrow(
      'Conflict'
    );
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('lists recent changes with a bounded limit', async () => {
    const { tools, guardedWrites } = makeTools();
    expect(await tools.handleListRecentChanges({})).toEqual({ changes: [{ changeId: 'c1' }] });
    expect(guardedWrites.listRecentChanges).toHaveBeenCalledWith(20);
    await tools.handleListRecentChanges({ limit: 5 });
    expect(guardedWrites.listRecentChanges).toHaveBeenLastCalledWith(5);
    await expect(tools.handleListRecentChanges({ limit: 501 })).rejects.toThrow();
  });

  it('undoes with the confirm flag', async () => {
    const { tools, guardedWrites } = makeTools();
    await tools.handleUndoChange({ changeId: 'c1', confirm: true });
    expect(guardedWrites.undo).toHaveBeenCalledWith('c1', { confirm: true }, undefined);
    await expect(tools.handleUndoChange({ confirm: true })).rejects.toThrow();
  });

  it('passes who asked on to the undo', async () => {
    const { tools, guardedWrites } = makeTools();
    await tools.handleUndoChange({ changeId: 'c1', confirm: true }, 'Danni');
    expect(guardedWrites.undo).toHaveBeenCalledWith('c1', { confirm: true }, 'Danni');
  });

  it('opens a document through the bridge and surfaces refusals', async () => {
    const { tools, query } = makeTools();
    expect(await tools.handleOpenInFoundry({ uuid: 'JournalEntry.a', userId: 'gm2' })).toEqual({
      opened: true,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.openDocumentForGm', {
      uuid: 'JournalEntry.a',
      userId: 'gm2',
    });
    query.mockResolvedValueOnce({ success: false, error: 'Access denied' });
    await expect(tools.handleOpenInFoundry({ uuid: 'JournalEntry.a' })).rejects.toThrow(
      'Access denied'
    );
    await expect(tools.handleOpenInFoundry({})).rejects.toThrow();
  });
});
