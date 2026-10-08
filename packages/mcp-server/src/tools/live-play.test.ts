/**
 * `plan-actor-change` (F5) and `plan-token-change` (F5 L2): Foundry and the guarded-write
 * service are stubs; the tests check the request the module gets, the plan the service gets and
 * when the result says `autoApply`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LIVE_ACTOR_ACTIONS,
  LIVE_PLAN_QUERY,
  LIVE_PLAY_FEATURE_ID,
  LIVE_TOKEN_ACTIONS,
  LIVE_TOKEN_FIELDS,
  type GuardedOp,
  type LiveChangePlan,
} from '@gnuminator/shared';

import { LivePlayTools } from './live-play.js';

function logger(): any {
  const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  l.child = (): unknown => l;
  return l;
}

const OPS: GuardedOp[] = [
  { kind: 'update', uuid: 'Actor.a1', changes: { 'system.attributes.hp.value': 5 } },
];

function built(extra: Partial<LiveChangePlan> = {}): LiveChangePlan {
  return {
    summary: '6 fire damage to Wolf',
    ops: OPS,
    targets: [{ target: 'Wolf', actorUuid: 'Actor.a1', line: 'Wolf: 6 fire damage, HP 11 to 5' }],
    ...extra,
  };
}

let query: ReturnType<typeof vi.fn>;
let createPlan: ReturnType<typeof vi.fn>;
let autoApplyEnabled: ReturnType<typeof vi.fn>;
let tools: LivePlayTools;

beforeEach(() => {
  query = vi.fn(() => Promise.resolve(built()));
  createPlan = vi.fn((input: { feature: string; summary: string }) =>
    Promise.resolve({
      planId: 'plan-1',
      feature: input.feature,
      summary: input.summary,
      risk: 'write',
      requires: { confirm: true, confirmDestructive: false },
    })
  );
  autoApplyEnabled = vi.fn(() => Promise.resolve(false));
  tools = new LivePlayTools({
    foundryClient: { query },
    guardedWrites: { createPlan, autoApplyEnabled },
    logger: logger(),
  });
});

describe('definitions', () => {
  it('serves plan-actor-change and plan-token-change, with the action enum', () => {
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['plan-actor-change', 'plan-token-change']);
    const def = defs[0];
    expect(def.inputSchema.type).toBe('object');
    expect(def.inputSchema.required).toEqual(['action', 'targets']);
    expect((def.inputSchema.properties.action as any).enum).toEqual([...LIVE_ACTOR_ACTIONS]);
    expect(LIVE_ACTOR_ACTIONS).toEqual([
      'damage',
      'healing',
      'temp-hp',
      'condition',
      'resource',
      'clear-conditions',
    ]);
  });

  it('declares that active defaults to on, and the handler does not invent it', async () => {
    const def = tools.getToolDefinitions()[0];
    expect(def.inputSchema.properties.active).toMatchObject({ type: 'boolean', default: true });
    await tools.handlePlanActorChange({
      action: 'condition',
      targets: ['Wolf'],
      condition: 'prone',
    });
    expect(query.mock.calls[0][1]).not.toHaveProperty('active');
  });

  it('tells the caller about autoApply and apply-planned-change', () => {
    const def = tools.getToolDefinitions()[0];
    expect(def.description).toContain('autoApply: true');
    expect(def.description).toContain('apply-planned-change');
    expect(def.description).toContain('undo-change');
  });

  it('has no em dashes', () => {
    const text = JSON.stringify(tools.getToolDefinitions());
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});

describe('plan-actor-change', () => {
  it('asks the module with scope actor and leaves out keys that were not given', async () => {
    await tools.handlePlanActorChange({
      action: 'damage',
      targets: ['Wolf 1'],
      amount: 6,
      damageType: 'fire',
      active: undefined,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [method, request] = query.mock.calls[0];
    expect(method).toBe(`foundry-mcp-bridge.${LIVE_PLAN_QUERY}`);
    expect(method).toBe('foundry-mcp-bridge.planLiveChange');
    expect(request).toEqual({
      scope: 'actor',
      action: 'damage',
      targets: ['Wolf 1'],
      amount: 6,
      damageType: 'fire',
    });
    expect(Object.keys(request)).not.toContain('active');
    expect(Object.values(request)).not.toContain(undefined);
  });

  it('forwards every optional field', async () => {
    await tools.handlePlanActorChange({
      action: 'condition',
      targets: ['Wolf 1', 'Wolf 2'],
      condition: 'exhaustion',
      active: true,
      level: 3,
      conditions: ['prone'],
      resource: 'spell3',
      value: 2,
      multiplier: 0.5,
      ignoreResistance: true,
      amount: 4,
      damageType: 'cold',
    });
    expect(query.mock.calls[0][1]).toEqual({
      scope: 'actor',
      action: 'condition',
      targets: ['Wolf 1', 'Wolf 2'],
      condition: 'exhaustion',
      active: true,
      level: 3,
      conditions: ['prone'],
      resource: 'spell3',
      value: 2,
      multiplier: 0.5,
      ignoreResistance: true,
      amount: 4,
      damageType: 'cold',
    });
  });

  it('stores the module ops as a plan of the live-play feature', async () => {
    await tools.handlePlanActorChange({ action: 'damage', targets: ['Wolf'], amount: 6 });
    expect(createPlan).toHaveBeenCalledWith({
      feature: LIVE_PLAY_FEATURE_ID,
      summary: '6 fire damage to Wolf',
      ops: OPS,
    });
    expect(LIVE_PLAY_FEATURE_ID).toBe('live-play');
  });

  it('returns the plan with the per-target preview and autoApply false by default', async () => {
    const result = await tools.handlePlanActorChange({
      action: 'damage',
      targets: ['Wolf'],
      amount: 6,
    });
    expect(result).toMatchObject({
      planId: 'plan-1',
      feature: 'live-play',
      risk: 'write',
      targets: [{ target: 'Wolf', actorUuid: 'Actor.a1', line: 'Wolf: 6 fire damage, HP 11 to 5' }],
      autoApply: false,
    });
    expect(autoApplyEnabled).toHaveBeenCalledWith('live-play');
  });

  it('says autoApply true when the plan is a write and the switch is on', async () => {
    autoApplyEnabled.mockResolvedValue(true);
    const result = await tools.handlePlanActorChange({
      action: 'healing',
      targets: ['Wolf'],
      amount: 3,
    });
    expect(result.autoApply).toBe(true);
  });

  it('never says autoApply for a destructive plan, and does not even ask', async () => {
    autoApplyEnabled.mockResolvedValue(true);
    createPlan.mockResolvedValueOnce({
      planId: 'plan-2',
      feature: 'live-play',
      summary: 'Remove Poisoned from Wolf',
      risk: 'destructive',
      requires: { confirm: true, confirmDestructive: true },
    });
    query.mockResolvedValueOnce(
      built({
        summary: 'Remove Poisoned from Wolf',
        ops: [{ kind: 'delete', uuid: 'Actor.a1.ActiveEffect.e1' }],
      })
    );
    const result = await tools.handlePlanActorChange({
      action: 'condition',
      targets: ['Wolf'],
      condition: 'poisoned',
      active: false,
    });
    expect(result.risk).toBe('destructive');
    expect(result.autoApply).toBe(false);
    expect(autoApplyEnabled).not.toHaveBeenCalled();
  });

  it('turns a module refusal into an error and plans nothing', async () => {
    query.mockResolvedValueOnce({ success: false, error: 'GM only' });
    await expect(
      tools.handlePlanActorChange({ action: 'damage', targets: ['Wolf'], amount: 6 })
    ).rejects.toThrow('Could not plan the change: GM only');
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('uses a default message when the module refuses without one', async () => {
    query.mockResolvedValueOnce({ success: false });
    await expect(
      tools.handlePlanActorChange({ action: 'damage', targets: ['Wolf'], amount: 6 })
    ).rejects.toThrow('Could not plan the change: refused by Foundry');
  });

  it('passes on an error the module throws ("Nothing to change") and a plan failure', async () => {
    query.mockRejectedValueOnce(new Error('Nothing to change: Wolf: is not Poisoned'));
    await expect(
      tools.handlePlanActorChange({
        action: 'condition',
        targets: ['Wolf'],
        condition: 'poisoned',
        active: false,
      })
    ).rejects.toThrow(/Nothing to change/);
    createPlan.mockRejectedValueOnce(new Error('Live play is switched off'));
    await expect(
      tools.handlePlanActorChange({ action: 'damage', targets: ['Wolf'], amount: 6 })
    ).rejects.toThrow('Live play is switched off');
  });

  it('rejects a request without targets, an unknown action and bad numbers', async () => {
    const bad: unknown[] = [
      { action: 'damage', amount: 3 },
      { action: 'damage', targets: [], amount: 3 },
      { action: 'damage', targets: [''], amount: 3 },
      { action: 'explode', targets: ['Wolf'] },
      { action: 'damage', targets: ['Wolf'], amount: -1 },
      { action: 'damage', targets: ['Wolf'], amount: 2.5 },
      { action: 'damage', targets: ['Wolf'], amount: 3, multiplier: 0 },
      { action: 'resource', targets: ['Wolf'], resource: 'spell1', value: -1 },
      undefined,
    ];
    for (const args of bad) {
      await expect(tools.handlePlanActorChange(args), JSON.stringify(args)).rejects.toThrow();
    }
    expect(query).not.toHaveBeenCalled();
    expect(createPlan).not.toHaveBeenCalled();
  });
});

const TOKEN_OPS: GuardedOp[] = [
  { kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 500, y: 400 } },
];

function tokenPlan(extra: Partial<LiveChangePlan> = {}): LiveChangePlan {
  return {
    summary: 'Move Wolf 1 to (5,4)',
    ops: TOKEN_OPS,
    targets: [
      {
        target: 'Wolf 1',
        actorUuid: 'Scene.s1.Token.t1',
        line: 'Wolf 1: (2,2) to (5,4), 15 ft',
      },
    ],
    ...extra,
  };
}

describe('plan-token-change definition', () => {
  const def = (): any => tools.getToolDefinitions().find(d => d.name === 'plan-token-change');

  it('requires action and tokens, with the action enum', () => {
    expect(def().inputSchema.type).toBe('object');
    expect(def().inputSchema.required).toEqual(['action', 'tokens']);
    expect(def().inputSchema.properties.action.enum).toEqual([...LIVE_TOKEN_ACTIONS]);
    expect(LIVE_TOKEN_ACTIONS).toEqual(['move', 'update', 'delete']);
    expect(def().inputSchema.properties.tokens).toMatchObject({ type: 'array' });
  });

  it('offers the move parameters and one parameter per update field', () => {
    const props = Object.keys(def().inputSchema.properties);
    for (const key of ['gridX', 'gridY', 'x', 'y', 'dx', 'dy']) expect(props).toContain(key);
    for (const key of Object.keys(LIVE_TOKEN_FIELDS)) expect(props, key).toContain(key);
    expect(def().inputSchema.properties.disposition.enum).toEqual([-2, -1, 0, 1]);
  });

  it('says that a delete is destructive and points at apply-planned-change and undo-change', () => {
    expect(def().description).toContain('apply-planned-change');
    expect(def().description).toContain('undo-change');
    expect(def().description).toContain('destructive');
  });

  it('has no em dashes', () => {
    const text = JSON.stringify(def());
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});

describe('plan-token-change', () => {
  beforeEach(() => {
    query.mockImplementation(() => Promise.resolve(tokenPlan()));
  });

  it('asks the module with scope token, no undefined keys and no changes without fields', async () => {
    await tools.handlePlanTokenChange({
      action: 'move',
      tokens: ['Wolf 1'],
      gridX: 5,
      gridY: 4,
      x: undefined,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [method, request] = query.mock.calls[0];
    expect(method).toBe(`foundry-mcp-bridge.${LIVE_PLAN_QUERY}`);
    expect(request).toEqual({
      scope: 'token',
      action: 'move',
      tokens: ['Wolf 1'],
      gridX: 5,
      gridY: 4,
    });
    expect(Object.keys(request)).not.toContain('changes');
    expect(Object.keys(request)).not.toContain('x');
    expect(Object.values(request)).not.toContain(undefined);
  });

  it('passes dx and dy for several tokens', async () => {
    await tools.handlePlanTokenChange({
      action: 'move',
      tokens: ['Wolf 1', 'Wolf 2'],
      dx: 2,
      dy: -1,
    });
    expect(query.mock.calls[0][1]).toEqual({
      scope: 'token',
      action: 'move',
      tokens: ['Wolf 1', 'Wolf 2'],
      dx: 2,
      dy: -1,
    });
  });

  it('collects the update fields into changes, keeping false and 0', async () => {
    await tools.handlePlanTokenChange({
      action: 'update',
      tokens: ['Wolf 1'],
      hidden: false,
      lightDim: 0,
      disposition: -1,
      lightColor: '#ff9329',
      sightEnabled: undefined,
    });
    expect(query.mock.calls[0][1]).toEqual({
      scope: 'token',
      action: 'update',
      tokens: ['Wolf 1'],
      changes: { hidden: false, lightDim: 0, disposition: -1, lightColor: '#ff9329' },
    });
  });

  it('accepts every update field in LIVE_TOKEN_FIELDS', async () => {
    const all: Record<string, string | number | boolean> = {
      name: 'Grey Wolf',
      hidden: true,
      disposition: 1,
      elevation: 10,
      rotation: 90,
      lockRotation: true,
      width: 2,
      height: 2,
      sightEnabled: true,
      sightRange: 60,
      visionMode: 'darkvision',
      lightDim: 40,
      lightBright: 20,
      lightColor: '#ff9329',
      lightAnimation: 'torch',
    };
    expect(Object.keys(all).sort()).toEqual(Object.keys(LIVE_TOKEN_FIELDS).sort());
    await tools.handlePlanTokenChange({ action: 'update', tokens: ['Wolf 1'], ...all });
    expect(query.mock.calls[0][1]).toEqual({
      scope: 'token',
      action: 'update',
      tokens: ['Wolf 1'],
      changes: all,
    });
  });

  it('asks for a delete with only the token list', async () => {
    await tools.handlePlanTokenChange({ action: 'delete', tokens: ['Wolf 1', 't2'] });
    expect(query.mock.calls[0][1]).toEqual({
      scope: 'token',
      action: 'delete',
      tokens: ['Wolf 1', 't2'],
    });
  });

  it('stores the module ops as a plan of the live-play feature', async () => {
    await tools.handlePlanTokenChange({ action: 'move', tokens: ['Wolf 1'], gridX: 5, gridY: 4 });
    expect(createPlan).toHaveBeenCalledWith({
      feature: LIVE_PLAY_FEATURE_ID,
      summary: 'Move Wolf 1 to (5,4)',
      ops: TOKEN_OPS,
    });
  });

  it('returns the plan with the preview and autoApply false', async () => {
    const result = await tools.handlePlanTokenChange({
      action: 'move',
      tokens: ['Wolf 1'],
      gridX: 5,
      gridY: 4,
    });
    expect(result).toMatchObject({
      planId: 'plan-1',
      feature: 'live-play',
      risk: 'write',
      targets: [{ target: 'Wolf 1', line: 'Wolf 1: (2,2) to (5,4), 15 ft' }],
      autoApply: false,
    });
  });

  it('keeps autoApply false even when the switch is on and the plan is a write', async () => {
    autoApplyEnabled.mockResolvedValue(true);
    const result = await tools.handlePlanTokenChange({
      action: 'update',
      tokens: ['Wolf 1'],
      hidden: true,
    });
    expect(result.risk).toBe('write');
    expect(result.autoApply).toBe(false);
    expect(autoApplyEnabled).not.toHaveBeenCalled();
  });

  it('returns a destructive delete plan with autoApply false', async () => {
    autoApplyEnabled.mockResolvedValue(true);
    createPlan.mockResolvedValueOnce({
      planId: 'plan-3',
      feature: 'live-play',
      summary: 'Delete Wolf 1 from Arena',
      risk: 'destructive',
      requires: { confirm: true, confirmDestructive: true },
    });
    query.mockResolvedValueOnce(
      tokenPlan({
        summary: 'Delete Wolf 1 from Arena',
        ops: [{ kind: 'delete', uuid: 'Scene.s1.Token.t1' }],
      })
    );
    const result = await tools.handlePlanTokenChange({ action: 'delete', tokens: ['Wolf 1'] });
    expect(result.risk).toBe('destructive');
    expect(result.autoApply).toBe(false);
  });

  it('turns a module refusal into an error and plans nothing', async () => {
    query.mockResolvedValueOnce({ success: false, error: 'GM only' });
    await expect(
      tools.handlePlanTokenChange({ action: 'delete', tokens: ['Wolf 1'] })
    ).rejects.toThrow('Could not plan the change: GM only');
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('uses a default message when the module refuses without one', async () => {
    query.mockResolvedValueOnce({ success: false });
    await expect(
      tools.handlePlanTokenChange({ action: 'delete', tokens: ['Wolf 1'] })
    ).rejects.toThrow('Could not plan the change: refused by Foundry');
  });

  it('passes on an error the module throws and a plan failure', async () => {
    query.mockRejectedValueOnce(new Error('Several tokens are named "Wolf" on Arena: use the id'));
    await expect(
      tools.handlePlanTokenChange({ action: 'delete', tokens: ['Wolf'] })
    ).rejects.toThrow(/Several tokens/);
    createPlan.mockRejectedValueOnce(new Error('Live play is switched off'));
    await expect(
      tools.handlePlanTokenChange({ action: 'delete', tokens: ['Wolf 1'] })
    ).rejects.toThrow('Live play is switched off');
  });

  it('rejects a request without tokens, an unknown action and bad values', async () => {
    const bad: unknown[] = [
      { action: 'move', gridX: 1 },
      { action: 'move', tokens: [], gridX: 1 },
      { action: 'move', tokens: [''], gridX: 1 },
      { action: 'teleport', tokens: ['Wolf'] },
      { action: 'move', tokens: ['Wolf'], gridX: 1.5 },
      { action: 'move', tokens: ['Wolf'], dx: 'left' },
      { action: 'update', tokens: ['Wolf'], hidden: 'yes' },
      { action: 'update', tokens: ['Wolf'], width: 0 },
      { action: 'update', tokens: ['Wolf'], lightDim: -1 },
      { action: 'update', tokens: ['Wolf'], name: '' },
      undefined,
      null,
    ];
    for (const args of bad) {
      await expect(tools.handlePlanTokenChange(args), JSON.stringify(args)).rejects.toThrow();
    }
    expect(query).not.toHaveBeenCalled();
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('leaves the actor plan tool alone: its request still has scope actor', async () => {
    await tools.handlePlanActorChange({ action: 'damage', targets: ['Wolf'], amount: 6 });
    expect(query.mock.calls[0][1]).toMatchObject({ scope: 'actor' });
  });
});
