import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NpcTurnPlan } from '@gnuminator/shared';

import { NpcTurnTools } from './npc-turn.js';

function logger(): any {
  const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  l.child = (): unknown => l;
  return l;
}

const CONTEXT: NpcTurnPlan['context'] = {
  round: 2,
  token: { id: 't1', name: 'Wolf', gridX: 2, gridY: 2 },
  actor: { id: 'a1', name: 'Wolf' },
  speed: 30,
  units: 'ft',
  squareSize: 5,
  actions: [
    { name: 'Bite', activityTypes: ['attack'], rangeFt: 5, longRangeFt: null, melee: true },
  ],
  targets: [],
  notes: [],
};

function reply(extra: Partial<NpcTurnPlan> = {}): NpcTurnPlan {
  return { context: CONTEXT, steps: [], attack: null, ...extra };
}

let query: ReturnType<typeof vi.fn>;
let createPlan: ReturnType<typeof vi.fn>;
let enabled: boolean;
let planReply: NpcTurnPlan;
let tools: NpcTurnTools;

beforeEach(() => {
  enabled = true;
  planReply = reply();
  query = vi.fn((method: string) =>
    method === 'foundry-mcp-bridge.listGuardedFeatures' ? [{ id: 'npc-turn', enabled }] : planReply
  );
  createPlan = vi.fn((input: { feature: string; summary: string }) =>
    Promise.resolve({
      planId: 'plan-1',
      feature: input.feature,
      summary: input.summary,
      risk: 'write',
      requires: { confirm: true, confirmDestructive: false },
    })
  );
  tools = new NpcTurnTools({
    foundryClient: { query },
    guardedWrites: { createPlan },
    logger: logger(),
  });
});

describe('plan-npc-turn', () => {
  it('has no em dashes and tells the caller how to apply and undo', () => {
    const text = JSON.stringify(tools.getToolDefinitions());
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(text).toContain('apply-planned-change');
    expect(text).toContain('undo-change');
  });

  it('refuses while the switch is off, without asking the module', async () => {
    enabled = false;
    await expect(tools.handleToolCall('plan-npc-turn', {})).rejects.toThrow(/switched off/);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns only the context when no move was asked for', async () => {
    const result = await tools.handleToolCall('plan-npc-turn', {});
    expect(result.plan).toBeUndefined();
    expect(result.context.token.name).toBe('Wolf');
    expect(createPlan).not.toHaveBeenCalled();
    expect(result.autoApply).toBe(false);
  });

  it('stores the move as a guarded plan under the npc-turn feature', async () => {
    planReply = reply({
      summary: 'NPC turn: Wolf to (6,2)',
      ops: [{ kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 600 } }],
      steps: ['Wolf: (2,2) to (6,2), 20 ft'],
    });
    const result = await tools.handleToolCall('plan-npc-turn', { moveTo: { gridX: 6, gridY: 2 } });
    expect(query.mock.calls[1]).toEqual([
      'foundry-mcp-bridge.planNpcTurn',
      { moveTo: { gridX: 6, gridY: 2 } },
    ]);
    expect(createPlan).toHaveBeenCalledWith({
      feature: 'npc-turn',
      summary: 'NPC turn: Wolf to (6,2)',
      ops: planReply.ops,
    });
    expect(result.plan?.planId).toBe('plan-1');
    expect(result.steps).toEqual(['Wolf: (2,2) to (6,2), 20 ft']);
  });

  it('rejects bad input and unknown tool names', async () => {
    await expect(
      tools.handleToolCall('plan-npc-turn', { moveTo: { gridX: -1, gridY: 2 } })
    ).rejects.toThrow();
    await expect(tools.handleToolCall('nope', {})).rejects.toThrow(/Unknown NPC turn tool/);
  });
});
