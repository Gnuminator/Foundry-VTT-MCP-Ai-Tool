/**
 * `get-renown` and `plan-renown-change` (dnd5e 6.1): Foundry and the guarded-write service are
 * stubs; the tests check which plan each action builds.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { RenownState } from '@gnuminator/shared';

import { makeTools } from '../test-support/make-tool-harness.js';

import { RenownTools } from './renown.js';

function state(extra: Partial<RenownState> = {}): RenownState {
  return {
    enabled: true,
    factions: [
      {
        actorId: 'f1',
        uuid: 'Actor.f1',
        name: 'Harpers',
        identifier: 'harpers',
        category: null,
        ranks: [
          { id: 'r1', name: 'Agent', renown: 3 },
          { id: 'r2', name: 'Lord', renown: 10 },
        ],
        members: [{ uuid: 'Actor.a1', name: 'Ana', rank: 'r1', role: 'Scout' }],
      },
    ],
    holders: [
      {
        actorId: 'a1',
        uuid: 'Actor.a1',
        name: 'Ana',
        type: 'character',
        scores: [{ faction: 'harpers', factionName: 'Harpers', value: 4, rank: 'r1' }],
        items: [
          {
            itemId: 'i1',
            uuid: 'Actor.a1.Item.i1',
            name: 'Renown adjustment: Harpers',
            modifiers: [{ faction: 'harpers', value: 4 }],
          },
        ],
      },
    ],
    creatures: [
      { actorId: 'a1', name: 'Ana' },
      { actorId: 'b1', name: 'Bo' },
    ],
    warnings: [],
    ...extra,
  };
}

describe('RenownTools', () => {
  let query: Mock;
  let createPlan: Mock;
  let tools: RenownTools;

  beforeEach(() => {
    createPlan = vi.fn().mockImplementation(async (input: unknown) => input);
    const harness = makeTools(RenownTools, {
      queryImpl: () => state(),
      extra: { guardedWrites: { createPlan } },
    });
    tools = harness.tools;
    query = harness.query;
  });

  it('reads the state through the module query', async () => {
    const answer = await tools.handleGetRenown({});
    expect(answer.factions[0]?.identifier).toBe('harpers');
    expect(answer).not.toHaveProperty('creatures');
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getRenownState');
  });

  it('adjust updates the AI item the actor already has', async () => {
    await tools.handlePlanRenownChange({
      action: 'adjust',
      actorId: 'a1',
      faction: 'Harpers',
      amount: 2,
    });
    const plan = createPlan.mock.calls[0]?.[0];
    expect(plan.feature).toBe('party');
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Actor.a1.Item.i1',
        changes: { 'system.modifiers': [{ faction: 'harpers', value: 6 }] },
      },
    ]);
  });

  it('set creates a renown item with the difference when none of ours exists', async () => {
    query.mockResolvedValue(
      state({
        holders: [
          {
            actorId: 'a1',
            uuid: 'Actor.a1',
            name: 'Ana',
            type: 'character',
            scores: [{ faction: 'harpers', factionName: 'Harpers', value: 4, rank: 'r1' }],
            items: [
              {
                itemId: 'h',
                uuid: 'Actor.a1.Item.h',
                name: 'Hand-made',
                modifiers: [{ faction: 'harpers', value: 4 }],
              },
            ],
          },
        ],
      })
    );
    await tools.handlePlanRenownChange({
      action: 'set',
      actorId: 'a1',
      faction: 'harpers',
      amount: 1,
    });
    expect(createPlan.mock.calls[0]?.[0].ops).toEqual([
      {
        kind: 'create',
        documentName: 'Item',
        parentUuid: 'Actor.a1',
        data: {
          name: 'Renown adjustment: Harpers',
          type: 'renown',
          system: { modifiers: [{ faction: 'harpers', value: -3 }] },
        },
      },
    ]);
  });

  it('refuses when renown is off, the faction is unknown or nothing would change', async () => {
    const base = { action: 'adjust', actorId: 'a1', faction: 'harpers', amount: 1 };
    query.mockResolvedValue(state({ enabled: false }));
    await expect(tools.handlePlanRenownChange(base)).rejects.toThrow(/Renown is off/);
    query.mockResolvedValue(state());
    await expect(tools.handlePlanRenownChange({ ...base, faction: 'nope' })).rejects.toThrow(
      /No faction "nope"/
    );
    await expect(tools.handlePlanRenownChange({ ...base, amount: 0 })).rejects.toThrow(
      /already has 4/
    );
  });

  it('set-member adds a member and updates a rank', async () => {
    await tools.handlePlanRenownChange({
      action: 'set-member',
      factionId: 'f1',
      member: 'b1',
      rank: 'r2',
    });
    expect(createPlan.mock.calls[0]?.[0].ops[0].changes['system.members']).toEqual([
      { uuid: 'Actor.a1', rank: 'r1', role: 'Scout' },
      { uuid: 'Actor.b1', rank: 'r2', role: '' },
    ]);
    await tools.handlePlanRenownChange({
      action: 'set-member',
      factionId: 'f1',
      member: 'a1',
      rank: 'r2',
    });
    expect(createPlan.mock.calls[1]?.[0].ops[0].changes['system.members']).toEqual([
      { uuid: 'Actor.a1', rank: 'r2', role: 'Scout' },
    ]);
    await expect(
      tools.handlePlanRenownChange({
        action: 'set-member',
        factionId: 'f1',
        member: 'a1',
        rank: 'x',
      })
    ).rejects.toThrow(/no rank "x"/);
  });

  it('set-member refuses a member that is not a character or NPC and missing parameters', async () => {
    const base = { action: 'set-member', factionId: 'f1', member: 'a1' };
    await expect(tools.handlePlanRenownChange({ ...base, member: 'g1' })).rejects.toThrow(
      /not a character or NPC/
    );
    await expect(tools.handlePlanRenownChange({ ...base, member: 'Actor.a1' })).rejects.toThrow(
      /not a character or NPC/
    );
    await expect(
      tools.handlePlanRenownChange({ action: 'set-member', member: 'a1' })
    ).rejects.toThrow(/needs "factionId"/);
    await expect(
      tools.handlePlanRenownChange({ action: 'set-member', factionId: 'f1' })
    ).rejects.toThrow(/needs "member"/);
    query.mockResolvedValue(state({ enabled: false }));
    await expect(tools.handlePlanRenownChange({ ...base, rank: 'r2' })).rejects.toThrow(
      /Renown is off/
    );
  });

  it('set-member refuses a rank when the faction has none', async () => {
    const s = state();
    s.factions[0].ranks = [];
    query.mockResolvedValue(s);
    await expect(
      tools.handlePlanRenownChange({
        action: 'set-member',
        factionId: 'f1',
        member: 'b1',
        rank: 'r1',
      })
    ).rejects.toThrow(/has no ranks/);
  });
});
