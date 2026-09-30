/**
 * `get-party` and `plan-party-change` (I-079): Foundry and the guarded-write
 * service are stubs; the tests check which plan each action builds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PartyGroup, PartyMember, PartyState } from '@gnuminator/shared';

import { PartyTools } from './party.js';

function logger(): any {
  const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  l.child = (): unknown => l;
  return l;
}

function member(id: string, name: string, tokens: PartyMember['tokens'] = []): PartyMember {
  return {
    actorId: id,
    uuid: `Actor.${id}`,
    name,
    type: 'character',
    level: 3,
    hp: { value: 20, max: 28, temp: 0 },
    ac: 16,
    passivePerception: 13,
    exhaustion: 0,
    hitDice: { value: 2, max: 3 },
    deathSaves: null,
    conditions: [],
    inspiration: false,
    tokens,
  };
}

function party(extra: Partial<PartyGroup> = {}): PartyGroup {
  return {
    actorId: 'g1',
    uuid: 'Actor.g1',
    name: 'The Party',
    primary: true,
    level: 3,
    pace: { value: 'normal', label: 'Normal', slowed: false },
    members: [
      member('a1', 'Ana', [{ tokenId: 't1', name: 'Ana', hidden: false, inCombat: false }]),
      member('b1', 'Bo', [{ tokenId: 't2', name: 'Bo', hidden: false, inCombat: true }]),
    ],
    restCards: {
      long: {
        type: 'request',
        flavor: 'Long Rest (8 hours, new day)',
        system: { handler: 'rest', targets: [{ actor: 'Actor.a1' }, { actor: 'Actor.b1' }] },
      },
    },
    ...extra,
  };
}

function state(extra: Partial<PartyState> = {}): PartyState {
  return {
    groups: [party()],
    paceOptions: [
      { value: 'slow', label: 'Slow' },
      { value: 'normal', label: 'Normal' },
      { value: 'fast', label: 'Fast' },
    ],
    scene: { sceneId: 's1', name: 'Test Arena' },
    encounter: { combatId: 'c1', uuid: 'Combat.c1', round: 1, started: true },
    warnings: [],
    ...extra,
  };
}

let query: ReturnType<typeof vi.fn>;
let createPlan: ReturnType<typeof vi.fn>;
let tools: PartyTools;

beforeEach(() => {
  query = vi.fn(() => Promise.resolve(state()));
  createPlan = vi.fn((input: unknown) => Promise.resolve({ planId: 'p1', input }));
  tools = new PartyTools({
    foundryClient: { query } as any,
    guardedWrites: { createPlan } as any,
    logger: logger(),
  });
});

describe('get-party', () => {
  it('returns the module state from getPartyState', async () => {
    await expect(tools.handleGetParty({})).resolves.toEqual(state());
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getPartyState', {});
  });

  it('turns a module refusal into an error', async () => {
    query.mockResolvedValueOnce({ success: false, error: 'GM only' });
    await expect(tools.handleGetParty({})).rejects.toThrow(/GM only/);
  });
});

describe('plan-party-change', () => {
  it('pace: plans an update of the travel pace on the primary party', async () => {
    await tools.handlePlanPartyChange({ action: 'pace', pace: 'fast' });
    expect(createPlan).toHaveBeenCalledWith({
      feature: 'party',
      summary: "Set The Party's travel pace to Fast (was Normal)",
      ops: [
        { kind: 'update', uuid: 'Actor.g1', changes: { 'system.attributes.travel.pace': 'fast' } },
      ],
    });
  });

  it('pace: refuses the pace the party already has, a missing pace and an unknown one', async () => {
    await expect(tools.handlePlanPartyChange({ action: 'pace', pace: 'normal' })).rejects.toThrow(
      /already travels at Normal/
    );
    await expect(tools.handlePlanPartyChange({ action: 'pace' })).rejects.toThrow(/needs "pace"/);
    await expect(tools.handlePlanPartyChange({ action: 'pace', pace: 'warp' })).rejects.toThrow(
      /Unknown pace/
    );
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('add-to-combat: adds only tokens not yet in the encounter', async () => {
    await tools.handlePlanPartyChange({ action: 'add-to-combat' });
    expect(createPlan).toHaveBeenCalledWith({
      feature: 'party',
      summary: 'Add Ana to the encounter on "Test Arena"',
      ops: [
        {
          kind: 'create',
          documentName: 'Combatant',
          parentUuid: 'Combat.c1',
          data: { tokenId: 't1', sceneId: 's1', actorId: 'a1' },
        },
      ],
    });
  });

  it('add-to-combat: starts an encounter when there is none', async () => {
    query.mockResolvedValueOnce(state({ encounter: null }));
    await tools.handlePlanPartyChange({ action: 'add-to-combat' });
    expect(createPlan.mock.calls[0]?.[0]).toMatchObject({
      summary: 'Start an encounter on "Test Arena" with Ana',
      ops: [
        {
          kind: 'create',
          documentName: 'Combat',
          data: {
            scene: 's1',
            active: true,
            combatants: [{ tokenId: 't1', sceneId: 's1', actorId: 'a1' }],
          },
        },
      ],
    });
  });

  it('add-to-combat: explains when nobody can be added', async () => {
    const allIn = party({
      members: [member('b1', 'Bo', [{ tokenId: 't2', name: 'Bo', hidden: false, inCombat: true }])],
    });
    query.mockResolvedValueOnce(state({ groups: [allIn] }));
    await expect(tools.handlePlanPartyChange({ action: 'add-to-combat' })).rejects.toThrow(
      /already in the encounter/
    );
    query.mockResolvedValueOnce(state({ groups: [party({ members: [member('a1', 'Ana')] })] }));
    await expect(tools.handlePlanPartyChange({ action: 'add-to-combat' })).rejects.toThrow(
      /has a token on "Test Arena"/
    );
    query.mockResolvedValueOnce(state({ scene: null }));
    await expect(tools.handlePlanPartyChange({ action: 'add-to-combat' })).rejects.toThrow(
      /No active scene/
    );
  });

  it('rest-request: plans the module-built card as a chat message (long by default)', async () => {
    await tools.handlePlanPartyChange({ action: 'rest-request' });
    expect(createPlan).toHaveBeenCalledWith({
      feature: 'party',
      summary: 'Post a long rest request for The Party (Ana, Bo)',
      ops: [{ kind: 'create', documentName: 'ChatMessage', data: party().restCards.long }],
    });
  });

  it('rest-request: refuses a rest type the module did not build', async () => {
    await expect(
      tools.handlePlanPartyChange({ action: 'rest-request', rest: 'short' })
    ).rejects.toThrow(/did not provide a short rest request/);
  });

  it('picks a group by id, or the only group, and explains a missing party', async () => {
    const other = party({ actorId: 'g2', uuid: 'Actor.g2', name: 'Scouts', primary: false });
    query.mockResolvedValueOnce(state({ groups: [party(), other] }));
    await tools.handlePlanPartyChange({ action: 'pace', pace: 'slow', groupId: 'g2' });
    expect(createPlan.mock.calls[0]?.[0]).toMatchObject({
      summary: expect.stringMatching(/^Set Scouts/),
    });

    query.mockResolvedValueOnce(state({ groups: [other] }));
    await tools.handlePlanPartyChange({ action: 'pace', pace: 'slow' });
    expect(createPlan.mock.calls[1]?.[0]).toMatchObject({
      summary: expect.stringMatching(/^Set Scouts/),
    });

    query.mockResolvedValueOnce(state({ groups: [] }));
    await expect(tools.handlePlanPartyChange({ action: 'pace', pace: 'slow' })).rejects.toThrow(
      /There is no party/
    );
    query.mockResolvedValueOnce(state({ groups: [other, { ...other, actorId: 'g3' }] }));
    await expect(tools.handlePlanPartyChange({ action: 'pace', pace: 'slow' })).rejects.toThrow(
      /no primary party/
    );
    query.mockResolvedValueOnce(state());
    await expect(
      tools.handlePlanPartyChange({ action: 'pace', pace: 'slow', groupId: 'nope' })
    ).rejects.toThrow(/No group actor/);
  });

  it('rejects an unknown action', async () => {
    await expect(tools.handlePlanPartyChange({ action: 'dance' })).rejects.toThrow();
  });
});
