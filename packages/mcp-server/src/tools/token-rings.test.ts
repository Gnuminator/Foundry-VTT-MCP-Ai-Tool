/**
 * `plan-token-rings` (I-093): Foundry and the guarded-write service are stubs; the tests check the
 * switch check, the request the module gets and the plan stored.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { TOKEN_RINGS_FEATURE_ID, type GuardedOp } from '@gnuminator/shared';

import { makeTools } from '../test-support/make-tool-harness.js';

import { TokenRingsTools } from './token-rings.js';

const OPS: GuardedOp[] = [
  { kind: 'update', uuid: 'Actor.a1', changes: { 'prototypeToken.ring.enabled': true } },
];

let enabled: boolean;
let query: Mock;
let createPlan: Mock;
let tools: TokenRingsTools;

beforeEach(() => {
  enabled = true;
  createPlan = vi.fn((input: { feature: string; summary: string }) =>
    Promise.resolve({ planId: 'p1', feature: input.feature, summary: input.summary, risk: 'write' })
  );
  const harness = makeTools(TokenRingsTools, {
    queryImpl: (method: string) => {
      if (method === 'foundry-mcp-bridge.listGuardedFeatures') {
        return Promise.resolve([{ id: TOKEN_RINGS_FEATURE_ID, enabled }]);
      }
      return Promise.resolve({
        summary: 'Rings on',
        ops: OPS,
        count: 1,
        remaining: 7,
        alreadyDone: 2,
      });
    },
    extra: { guardedWrites: { createPlan } },
  });
  query = harness.query;
  tools = harness.tools;
});

describe('plan-token-rings', () => {
  it('sends only the given fields and stores the plan under the token-rings feature', async () => {
    const result: any = await tools.handleToolCall('plan-token-rings', {
      action: 'enable',
      actorType: 'npc',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.planTokenRings', {
      action: 'enable',
      actorType: 'npc',
    });
    expect(createPlan).toHaveBeenCalledWith({
      feature: TOKEN_RINGS_FEATURE_ID,
      summary: 'Rings on',
      ops: OPS,
    });
    expect(result).toMatchObject({
      planId: 'p1',
      count: 1,
      remaining: 7,
      alreadyDone: 2,
      autoApply: false,
    });
  });

  it('passes the look and refuses a module that did not plan it', async () => {
    await expect(
      tools.handleToolCall('plan-token-rings', { action: 'enable', look: 'steel' })
    ).rejects.toThrow(/too old/);
    expect(createPlan).not.toHaveBeenCalled();
    query.mockImplementation((method: string) =>
      Promise.resolve(
        method === 'foundry-mcp-bridge.listGuardedFeatures'
          ? [{ id: TOKEN_RINGS_FEATURE_ID, enabled }]
          : {
              summary: 'Rings on with the steel look',
              ops: OPS,
              count: 1,
              remaining: 0,
              alreadyDone: 0,
            }
      )
    );
    await tools.handleToolCall('plan-token-rings', { action: 'enable', look: 'steel' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.planTokenRings', {
      action: 'enable',
      look: 'steel',
    });
    expect(createPlan).toHaveBeenCalledTimes(1);
  });

  it('refuses when the switch is off, without planning', async () => {
    enabled = false;
    await expect(tools.handleToolCall('plan-token-rings', { action: 'enable' })).rejects.toThrow(
      /Token rings/
    );
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('passes placed tokens, scenes and the unmatched names through', async () => {
    query.mockImplementation((method: string) =>
      Promise.resolve(
        method === 'foundry-mcp-bridge.listGuardedFeatures'
          ? [{ id: TOKEN_RINGS_FEATURE_ID, enabled }]
          : {
              summary: 'Rings on for 1 placed token',
              ops: OPS,
              count: 1,
              remaining: 0,
              alreadyDone: 0,
              unmatched: ['scene Nowhere'],
            }
      )
    );
    const result: any = await tools.handleToolCall('plan-token-rings', {
      action: 'enable',
      tokens: 'placed',
      scenes: ['Castle', 'Nowhere'],
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.planTokenRings', {
      action: 'enable',
      tokens: 'placed',
      scenes: ['Castle', 'Nowhere'],
    });
    expect(result.unmatched).toEqual(['scene Nowhere']);
  });

  it('refuses scenes without tokens placed, before it asks the module', async () => {
    await expect(
      tools.handleToolCall('plan-token-rings', { action: 'enable', scenes: ['Castle'] })
    ).rejects.toThrow(/placed/);
    expect(query).not.toHaveBeenCalledWith('foundry-mcp-bridge.planTokenRings', expect.anything());
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('refuses a plan for placed tokens from a module that is too old to know them', async () => {
    await expect(
      tools.handleToolCall('plan-token-rings', { action: 'enable', tokens: 'placed' })
    ).rejects.toThrow(/too old/);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('rejects an unknown action and an unknown tool', async () => {
    await expect(tools.handleToolCall('plan-token-rings', { action: 'spin' })).rejects.toThrow();
    await expect(tools.handleToolCall('nope', {})).rejects.toThrow(/Unknown token rings tool/);
  });

  it('describes one tool', () => {
    expect(tools.getToolDefinitions().map(t => t.name)).toEqual(['plan-token-rings']);
  });
});
