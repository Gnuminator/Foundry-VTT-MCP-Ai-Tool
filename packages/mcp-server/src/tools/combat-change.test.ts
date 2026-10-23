/**
 * `plan-combat-change`: Foundry and the guarded-write service are stubs; the tests check the
 * request the module gets, the plan the service gets and what the result carries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMBAT_CHANGE_ACTIONS,
  COMBAT_PLAN_QUERY,
  LIVE_PLAY_FEATURE_ID,
  type CombatChangePlan,
} from '@gnuminator/shared';

import { CombatChangeTools } from './combat-change.js';

function logger(): any {
  const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  l.child = (): unknown => l;
  return l;
}

const BUILT: CombatChangePlan = {
  summary: 'End combat on "Field" (round 3, 4 combatants)',
  ops: [{ kind: 'delete', uuid: 'Combat.c1' }],
  combatId: 'c1',
  warning: 'Undo does not bring back effects.',
};

let query: ReturnType<typeof vi.fn>;
let createPlan: ReturnType<typeof vi.fn>;
let autoApplyEnabled: ReturnType<typeof vi.fn>;
let tools: CombatChangeTools;

beforeEach(() => {
  query = vi.fn(() => Promise.resolve(BUILT));
  createPlan = vi.fn((input: { feature: string; summary: string }) =>
    Promise.resolve({
      planId: 'plan-1',
      feature: input.feature,
      summary: input.summary,
      risk: 'destructive',
      requires: { confirm: true, confirmDestructive: true },
    })
  );
  autoApplyEnabled = vi.fn(() => Promise.resolve(true));
  tools = new CombatChangeTools({
    foundryClient: { query },
    guardedWrites: { createPlan, autoApplyEnabled },
    logger: logger(),
  });
});

describe('definitions', () => {
  it('serves plan-combat-change with the shared action enum', () => {
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['plan-combat-change']);
    expect(defs[0].inputSchema.required).toEqual(['action']);
    expect((defs[0].inputSchema.properties.action as any).enum).toEqual([...COMBAT_CHANGE_ACTIONS]);
  });

  it('has no em dashes', () => {
    expect(JSON.stringify(tools.getToolDefinitions()).includes(String.fromCharCode(0x2014))).toBe(
      false
    );
  });
});

describe('plan-combat-change', () => {
  it('asks the module and leaves out keys that were not given', async () => {
    await tools.handlePlanCombatChange({ action: 'end', combatId: undefined });
    const [method, request] = query.mock.calls[0];
    expect(method).toBe(`foundry-mcp-bridge.${COMBAT_PLAN_QUERY}`);
    expect(method).toBe('foundry-mcp-bridge.planCombatChange');
    expect(request).toEqual({ action: 'end' });
  });

  it('stores the ops as a live-play plan and never auto-applies a delete', async () => {
    const result = await tools.handlePlanCombatChange({ action: 'end' });
    expect(createPlan).toHaveBeenCalledWith({
      feature: LIVE_PLAY_FEATURE_ID,
      summary: BUILT.summary,
      ops: BUILT.ops,
    });
    expect(result.combatId).toBe('c1');
    expect(result.warning).toBe(BUILT.warning);
    expect(result.autoApply).toBe(false);
    expect(autoApplyEnabled).not.toHaveBeenCalled();
  });

  it('passes a start request through and auto-applies a plain write when the GM allows it', async () => {
    query.mockResolvedValueOnce({
      summary: 'Start combat on "Field" with 2 tokens',
      ops: [{ kind: 'create', documentName: 'Combat', data: {} }],
      combatants: ['Brannoc', 'Wolf'],
      skipped: ['x (no actor)'],
    });
    createPlan.mockImplementationOnce((input: { feature: string; summary: string }) =>
      Promise.resolve({
        planId: 'plan-2',
        feature: input.feature,
        summary: input.summary,
        risk: 'write',
        requires: { confirm: true, confirmDestructive: false },
      })
    );
    const result = await tools.handlePlanCombatChange({
      action: 'start',
      tokenIds: ['t1', 't2'],
      sceneId: undefined,
    });
    expect(query.mock.calls[0][1]).toEqual({ action: 'start', tokenIds: ['t1', 't2'] });
    expect(result.combatants).toEqual(['Brannoc', 'Wolf']);
    expect(result.skipped).toEqual(['x (no actor)']);
    expect(result.combatId).toBeUndefined();
    expect(result.autoApply).toBe(true);
  });

  it('rejects an unknown action', async () => {
    await expect(tools.handlePlanCombatChange({ action: 'pause' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('surfaces a refusal from Foundry', async () => {
    query.mockResolvedValueOnce({ success: false, error: 'No active combat encounter.' });
    await expect(tools.handlePlanCombatChange({ action: 'end' })).rejects.toThrow(
      'Could not plan the change: No active combat encounter.'
    );
    expect(createPlan).not.toHaveBeenCalled();
  });
});
