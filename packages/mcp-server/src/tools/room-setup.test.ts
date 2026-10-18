import { describe, expect, it, vi } from 'vitest';

import { RoomSetupTools } from './room-setup.js';

const logger: any = {
  child: () => logger,
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

function tools(opts: { enabled: boolean; planReply?: unknown }): {
  t: RoomSetupTools;
  query: ReturnType<typeof vi.fn>;
  createPlan: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (method: string) => {
    if (method === 'foundry-mcp-bridge.listGuardedFeatures') {
      return [{ id: 'room-setup', enabled: opts.enabled }];
    }
    return opts.planReply;
  });
  const createPlan = vi.fn(async (p: any) => ({
    id: 'plan1',
    feature: p.feature,
    summary: p.summary,
  }));
  const t = new RoomSetupTools({
    foundryClient: { query },
    guardedWrites: { createPlan } as any,
    logger,
  });
  return { t, query, createPlan };
}

const teleport = {
  action: 'teleport',
  from: { x: 0, y: 0, width: 1, height: 1 },
  to: { x: 4, y: 4, width: 1, height: 1 },
};

describe('plan-room-setup', () => {
  it('is one tool and says what it needs', () => {
    const { t } = tools({ enabled: true });
    const defs = t.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['plan-room-setup']);
    expect(defs[0].description).toMatch(/off by default/);
  });

  it('refuses plainly while the switch is off and never asks the module to plan', async () => {
    const { t, query } = tools({ enabled: false });
    await expect(t.handleToolCall('plan-room-setup', teleport)).rejects.toThrow(/switched off/);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('stores the module ops as a room-setup plan and never auto-applies', async () => {
    const ops = [{ kind: 'create', documentName: 'Region', parentUuid: 'Scene.a', data: {} }];
    const { t, createPlan, query } = tools({
      enabled: true,
      planReply: { summary: 'Add a teleport', ops, regions: [], warnings: ['w'] },
    });
    const result = await t.handleToolCall('plan-room-setup', teleport);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.planRoomSetup', teleport);
    expect(createPlan).toHaveBeenCalledWith({
      feature: 'room-setup',
      summary: 'Add a teleport',
      ops,
    });
    expect(result).toMatchObject({ id: 'plan1', warnings: ['w'], autoApply: false });
  });

  it('rejects a request the schema does not allow', async () => {
    const { t } = tools({ enabled: true });
    await expect(
      t.handleToolCall('plan-room-setup', {
        action: 'spawn',
        name: 'x',
        area: teleport.from,
        creatures: [],
      })
    ).rejects.toThrow();
    await expect(
      t.handleToolCall('plan-room-setup', {
        ...teleport,
        from: { x: 0, y: 0, width: 0, height: 1 },
      })
    ).rejects.toThrow();
  });

  it('shows a module refusal as the reason', async () => {
    const { t } = tools({ enabled: true, planReply: { success: false, error: 'Only a GM' } });
    await expect(t.handleToolCall('plan-room-setup', teleport)).rejects.toThrow(/Only a GM/);
  });
});
