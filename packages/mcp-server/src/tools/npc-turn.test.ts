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
  moveLimit: 30,
  units: 'ft',
  squareSize: 5,
  actions: [
    { name: 'Bite', activityTypes: ['attack'], rangeFt: 5, longRangeFt: null, melee: true },
  ],
  multiattack: null,
  engageWith: 'Bite',
  targets: [],
  suggested: null,
  notes: [],
};

function reply(extra: Partial<NpcTurnPlan> = {}): NpcTurnPlan {
  return { context: CONTEXT, steps: [], attack: null, attacks: [], ...extra };
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

  it('passes a multiattack and a Dash to the module and returns the path and cost', async () => {
    const bite = {
      itemName: 'Bite',
      target: 'Hero',
      targetAC: 16,
      inReach: true,
      blockedByWall: false,
      rollWith: 'use-npc-activity {}',
      damageWith: 'plan-actor-change {}',
    };
    planReply = reply({
      summary: 'NPC turn: Wolf to (6,2), then Bite on Hero, Bite on Hero',
      ops: [{ kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 600 } }],
      steps: ['Wolf: (2,2) to (6,2), 25 ft, going round an obstacle'],
      attack: bite,
      attacks: [bite, bite],
      path: [
        { gridX: 2, gridY: 2 },
        { gridX: 6, gridY: 2 },
      ],
      moveCost: 25,
    });
    const args = {
      moveTo: { gridX: 6, gridY: 2 },
      dash: true,
      attacks: [
        { itemName: 'Bite', target: 'Hero' },
        { itemName: 'Bite', target: 'Hero' },
      ],
    };
    const result = await tools.handleToolCall('plan-npc-turn', args);
    expect(query.mock.calls[1]).toEqual(['foundry-mcp-bridge.planNpcTurn', args]);
    expect(result.attacks).toHaveLength(2);
    expect(result.moveCost).toBe(25);
    expect(result.path?.at(-1)).toEqual({ gridX: 6, gridY: 2 });
    expect(result.plan?.planId).toBe('plan-1');
  });

  it('keeps an older module reply working (one attack, no list)', async () => {
    const one = { itemName: 'Bite', target: 'Hero' } as never;
    planReply = { ...reply({ attack: one }), attacks: undefined as never };
    const result = await tools.handleToolCall('plan-npc-turn', {});
    expect(result.attacks).toEqual([one]);
  });

  it('says so when an older module answers a request for attacks or a Dash without checking them', async () => {
    planReply = { ...reply(), attacks: undefined as never };
    await expect(
      tools.handleToolCall('plan-npc-turn', { attacks: [{ itemName: 'Bite', target: 'Hero' }] })
    ).rejects.toThrow(/module is older than this server/);
    await expect(tools.handleToolCall('plan-npc-turn', { dash: true })).rejects.toThrow(
      /module is older/
    );
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('says so when an older module answers results or an activity without part 3 fields', async () => {
    await expect(
      tools.handleToolCall('plan-npc-turn', { results: [{ target: 'Hero', amount: 3 }] })
    ).rejects.toThrow(/does not plan damage results, activities or legendary actions/);
    await expect(
      tools.handleToolCall('plan-npc-turn', {
        attacks: [{ itemName: 'Cloud', target: 'Hero', activity: 'Cloud' }],
      })
    ).rejects.toThrow(/module is older/);
    expect(createPlan).not.toHaveBeenCalled();
    planReply = reply({ context: { ...CONTEXT, ownTurn: true } });
    await expect(
      tools.handleToolCall('plan-npc-turn', { results: [{ target: 'Hero', amount: 3 }] })
    ).resolves.toBeDefined();
  });

  it('rejects bad input and unknown tool names', async () => {
    await expect(
      tools.handleToolCall('plan-npc-turn', { attacks: [{ itemName: 'Bite' }] })
    ).rejects.toThrow();
    await expect(
      tools.handleToolCall('plan-npc-turn', {
        attacks: Array.from({ length: 11 }, () => ({ itemName: 'Bite', target: 'Hero' })),
      })
    ).rejects.toThrow();
    await expect(
      tools.handleToolCall('plan-npc-turn', { moveTo: { gridX: -1, gridY: 2 } })
    ).rejects.toThrow();
    await expect(tools.handleToolCall('nope', {})).rejects.toThrow(/Unknown NPC turn tool/);
  });
});
