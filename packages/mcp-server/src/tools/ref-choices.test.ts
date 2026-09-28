import { describe, expect, it, vi } from 'vitest';

import { RefChoiceTools } from './ref-choices.js';

function setup(overrides: Record<string, unknown> = {}): {
  tools: RefChoiceTools;
  query: ReturnType<typeof vi.fn>;
} {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const query = vi.fn();
  const guardedWrites: any = {
    listPlans: vi.fn(() => [
      {
        planId: 'plan-1',
        feature: 'tarokka',
        summary: 'Store a new Tarokka reading',
        risk: 'write',
        expiresAt: '2026-09-28T10:15:00.000Z',
      },
    ]),
    listRecentChanges: vi.fn(() =>
      Promise.resolve([
        {
          changeId: 'chg-1',
          feature: 'tarokka',
          summary: 'Reveal the tome',
          mode: 'apply',
          canUndo: true,
          appliedAt: '2026-09-28T10:00:00.000Z',
        },
        {
          changeId: 'chg-0',
          feature: 'tarokka',
          summary: 'Undo: Links',
          mode: 'undo',
          canUndo: false,
          appliedAt: '2026-09-28T09:00:00.000Z',
        },
      ])
    ),
  };
  const tools = new RefChoiceTools({
    foundryClient: { query } as any,
    guardedWrites,
    logger,
    ...overrides,
  });
  return { tools, query };
}

describe('list-ref-choices', () => {
  it('forwards Foundry kinds to the module with the validated request', async () => {
    const { tools, query } = setup();
    query.mockResolvedValue({
      kind: 'token',
      choices: [{ id: 't1', name: 'Goblin' }],
      truncated: false,
      note: 'Tokens on "Barovia"',
    });
    const result = await tools.handleListRefChoices({ kind: 'token', parent: 'scene-1', limit: 5 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.listRefChoices', {
      kind: 'token',
      parent: 'scene-1',
      limit: 5,
    });
    expect(result).toEqual({
      kind: 'token',
      choices: [{ id: 't1', name: 'Goblin' }],
      truncated: false,
      note: 'Tokens on "Barovia"',
    });
  });

  it('surfaces a refusal from Foundry', async () => {
    const { tools, query } = setup();
    query.mockResolvedValue({ success: false, error: 'Failed to list choices: not a GM' });
    await expect(tools.handleListRefChoices({ kind: 'actor' })).rejects.toThrow(/not a GM/);
  });

  it('lists pending plans and recorded changes from the backend', async () => {
    const { tools, query } = setup();
    const plans = await tools.handleListRefChoices({ kind: 'plan' });
    expect(plans.choices).toEqual([
      {
        id: 'plan-1',
        name: 'Store a new Tarokka reading',
        detail: 'write, expires 10:15 UTC',
        group: 'tarokka',
      },
    ]);
    const undoable = await tools.handleListRefChoices({
      kind: 'change',
      filter: { undoable: true },
    });
    expect(undoable.choices.map(c => c.id)).toEqual(['chg-1']);
    const all = await tools.handleListRefChoices({ kind: 'change', query: 'undo' });
    expect(all.choices.map(c => c.id)).toEqual(['chg-0']);
    expect(query).not.toHaveBeenCalled();
  });

  it('lists Tarokka cards of the deck a position uses', async () => {
    const { tools } = setup();
    const high = await tools.handleListRefChoices({ kind: 'tarokka-card', parent: 'ally' });
    expect(high.choices).toHaveLength(14);
    expect(high.choices.every(c => c.group === 'High deck')).toBe(true);
    expect(high.note).toBe('Ally: high deck');
    const common = await tools.handleListRefChoices({ kind: 'tarokka-card', parent: 'tome' });
    expect(common.choices).toHaveLength(40);
    expect(common.choices).toContainEqual({
      id: 'swords-7',
      name: 'Seven of Swords',
      group: 'Common deck',
    });
    const all = await tools.handleListRefChoices({ kind: 'tarokka-card' });
    expect(all.choices).toHaveLength(54);
  });

  it('lists map jobs when map generation is set up', async () => {
    expect((await setup().tools.handleListRefChoices({ kind: 'map-job' })).note).toBe(
      'Map generation is not set up'
    );
    const jobs = {
      listJobs: vi.fn(() => [
        {
          id: 'job-1',
          params: { prompt: 'A misty village' },
          status: 'complete',
          progress_percent: 100,
        },
      ]),
    };
    const { tools } = setup({ jobs });
    expect((await tools.handleListRefChoices({ kind: 'map-job' })).choices).toEqual([
      { id: 'job-1', name: 'A misty village', detail: 'complete, 100%' },
    ]);
  });

  it('caps with truncated and validates the request', async () => {
    const { tools } = setup();
    const capped = await tools.handleListRefChoices({ kind: 'tarokka-card', limit: 3 });
    expect(capped.choices).toHaveLength(3);
    expect(capped.truncated).toBe(true);
    await expect(tools.handleListRefChoices({ kind: 'nope' })).rejects.toThrow();
    await expect(tools.handleListRefChoices({ kind: 'actor', limit: 9999 })).rejects.toThrow();
  });
});
