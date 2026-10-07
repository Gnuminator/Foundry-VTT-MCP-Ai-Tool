import { describe, expect, it, vi } from 'vitest';

import { ChangeHistoryTools } from './change-history.js';

function makeTools(): { tools: ChangeHistoryTools; list: ReturnType<typeof vi.fn> } {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const list = vi.fn(() => Promise.resolve({ changes: [] }));
  return { tools: new ChangeHistoryTools({ changeHistory: { list }, logger }), list };
}

describe('list-changes', () => {
  it('is one read-only tool that does not promise undo of human changes', () => {
    const [tool, ...rest] = makeTools().tools.getToolDefinitions();
    expect(rest).toEqual([]);
    expect(tool?.name).toBe('list-changes');
    expect(tool?.description).toContain('not available yet');
    expect(tool?.description).not.toContain(String.fromCharCode(0x2014));
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
