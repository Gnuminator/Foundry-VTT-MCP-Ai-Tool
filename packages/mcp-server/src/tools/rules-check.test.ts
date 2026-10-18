import { describe, expect, it, vi } from 'vitest';

import { RulesCheckTools } from './rules-check.js';

const logger: any = {
  child: () => logger,
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

const resources = {
  success: true,
  actorId: 'a1',
  actorName: 'Ireena',
  spellSlots: { level1: { current: 2, max: 4, expended: 2 } },
};
const spell = {
  success: true,
  entityType: 'item',
  entity: {
    id: 'i1',
    name: 'Magic Missile',
    type: 'spell',
    level: 1,
    activities: [
      { id: 'x', name: 'Cast', type: 'attack', activation: 'Action', range: '120 Feet' },
    ],
    system: {},
  },
};
const combat = {
  success: true,
  active: true,
  round: 1,
  turn: 0,
  current: { name: 'Ireena' },
  combatants: [{ name: 'Ireena', actorId: 'a1', isCurrentTurn: true }],
};

function tools(opts: {
  enabled?: boolean;
  entity?: unknown;
  combat?: unknown;
  distance?: unknown;
}) {
  const query = vi.fn(async (method: string) => {
    switch (method) {
      case 'foundry-mcp-bridge.listGuardedFeatures':
        return [{ id: 'rules-check', enabled: opts.enabled ?? true }];
      case 'foundry-mcp-bridge.getCharacterResources':
        return resources;
      case 'foundry-mcp-bridge.getCharacterEntity':
        return opts.entity ?? spell;
      case 'foundry-mcp-bridge.getCombatState':
        return opts.combat ?? combat;
      case 'foundry-mcp-bridge.measureDistance':
        if (opts.distance instanceof Error) throw opts.distance;
        return opts.distance ?? { success: true, distance: 30, units: 'ft' };
      default:
        throw new Error(`unexpected ${method}`);
    }
  });
  return { t: new RulesCheckTools({ foundryClient: { query } as any, logger }), query };
}

describe('check-action', () => {
  it('is one read-only tool', () => {
    const defs = tools({}).t.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['check-action']);
    expect(defs[0]?.description).toMatch(/off by default/);
  });

  it('refuses while the switch is off and reads nothing else', async () => {
    const { t, query } = tools({ enabled: false });
    await expect(t.handleToolCall('check-action', { actor: 'Ireena', item: 'x' })).rejects.toThrow(
      /switched off/
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reports a legal cast with slots, range and turn', async () => {
    const { t } = tools({});
    const r = await t.handleToolCall('check-action', {
      actor: 'Ireena',
      item: 'Magic Missile',
      target: 'Zombie',
    });
    expect(r.verdict).toBe('legal');
    expect(r.checks.map(c => c.check)).toEqual(['turn', 'action-cost', 'range', 'slots']);
    expect(r.checks.find(c => c.check === 'slots')?.reason).toMatch(/2 of 4/);
  });

  it('measures from the combatant token name', async () => {
    const named = {
      ...combat,
      combatants: [{ name: 'Ireena (token)', actorId: 'a1', isCurrentTurn: true }],
    };
    const { t, query } = tools({ combat: named });
    await t.handleToolCall('check-action', {
      actor: 'Ireena',
      item: 'Magic Missile',
      target: 'Zombie',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.measureDistance', {
      fromTokenName: 'Ireena (token)',
      toTokenName: 'Zombie',
    });
  });

  it('keeps going with unknown range when the distance cannot be measured', async () => {
    const { t } = tools({ distance: new Error('no such token') });
    const r = await t.handleToolCall('check-action', {
      actor: 'Ireena',
      item: 'Magic Missile',
      target: 'Ghost',
    });
    expect(r.checks.find(c => c.check === 'range')?.status).toBe('unknown');
    expect(r.verdict).toBe('unclear');
  });

  it('treats a scene measured in metres as unmeasurable', async () => {
    const { t } = tools({ distance: { success: true, distance: 9, units: 'm' } });
    const r = await t.handleToolCall('check-action', {
      actor: 'Ireena',
      item: 'Magic Missile',
      target: 'Z',
    });
    expect(r.checks.find(c => c.check === 'range')?.reason).toMatch(/not feet/);
  });

  it('works without a running combat', async () => {
    const { t } = tools({ combat: { success: true, active: false } });
    const r = await t.handleToolCall('check-action', { actor: 'Ireena', item: 'Magic Missile' });
    expect(r.checks[0]?.status).toBe('info');
  });

  it('names the activities when the requested one is missing', async () => {
    const { t } = tools({});
    await expect(
      t.handleToolCall('check-action', { actor: 'Ireena', item: 'Magic Missile', activity: 'Nope' })
    ).rejects.toThrow(/has no activity "Nope".*Cast/);
  });

  it('refuses an effect', async () => {
    const { t } = tools({
      entity: { success: true, entityType: 'effect', entity: { name: 'Bless' } },
    });
    await expect(
      t.handleToolCall('check-action', { actor: 'Ireena', item: 'Bless' })
    ).rejects.toThrow(/effect/);
  });
});
