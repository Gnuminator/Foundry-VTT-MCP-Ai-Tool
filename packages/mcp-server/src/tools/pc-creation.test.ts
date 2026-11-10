import { describe, expect, it, vi } from 'vitest';

import { PcCreationTools } from './pc-creation.js';

const logger: any = {
  child: () => logger,
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

function tools(
  enabled: boolean,
  planReply?: unknown
): {
  t: PcCreationTools;
  query: ReturnType<typeof vi.fn>;
  createPlan: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (method: string) =>
    method === 'foundry-mcp-bridge.listGuardedFeatures'
      ? [{ id: 'pc-creation', enabled }]
      : planReply
  );
  const createPlan = vi.fn(async (p: any) => ({
    id: 'plan1',
    feature: p.feature,
    summary: p.summary,
  }));
  const t = new PcCreationTools({
    foundryClient: { query },
    guardedWrites: { createPlan } as any,
    logger,
  });
  return { t, query, createPlan };
}

describe('plan-pc-creation', () => {
  it('is one tool', () => {
    expect(
      tools(true)
        .t.getToolDefinitions()
        .map(d => d.name)
    ).toEqual(['plan-pc-creation']);
  });

  it('refuses plainly while the switch is off, without asking the module to plan', async () => {
    const { t, query } = tools(false);
    await expect(t.handleToolCall('plan-pc-creation', { name: 'Ebbe' })).rejects.toThrow(
      /switched off/
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('stores the module op as a pc-creation plan and never auto-applies', async () => {
    const ops = [{ kind: 'create', documentName: 'Actor', data: { name: 'Ebbe' }, keepId: true }];
    const { t, createPlan } = tools(true, {
      summary: 'Create the character "Ebbe"',
      ops,
      actor: { name: 'Ebbe', owner: null },
      items: [],
      warnings: ['w'],
    });
    const out = await t.handleToolCall('plan-pc-creation', { name: 'Ebbe' });
    expect(createPlan).toHaveBeenCalledWith({
      feature: 'pc-creation',
      summary: 'Create the character "Ebbe"',
      ops,
    });
    expect(out).toMatchObject({ id: 'plan1', autoApply: false, warnings: ['w'] });
  });

  it('rejects bad input before asking anything', async () => {
    const { t, query } = tools(true);
    await expect(t.handleToolCall('plan-pc-creation', {})).rejects.toThrow();
    await expect(
      t.handleToolCall('plan-pc-creation', { name: 'A', items: [{}] })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
