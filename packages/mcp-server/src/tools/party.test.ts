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

describe('plan-party-change: place (I-097)', () => {
  const placement = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    scene: { sceneId: 's2', uuid: 'Scene.s2', name: 'Vallaki' },
    anchor: { x: 1050, y: 950, label: 'around the centre of your view' },
    tokens: [
      { actorId: 'a1', name: 'Ana', data: { name: 'Ana', actorId: 'a1', x: 1000, y: 900 } },
      { actorId: 'b1', name: 'Bo', data: { name: 'Bo', actorId: 'b1', x: 1100, y: 900 } },
    ],
    skipped: [],
    warnings: [],
    ...extra,
  });

  function answer(place: Record<string, unknown>): void {
    query.mockImplementation((method: string) =>
      Promise.resolve(method === 'foundry-mcp-bridge.planPartyPlacement' ? place : state())
    );
  }

  it('asks the module where the tokens go and plans one token create each', async () => {
    answer(placement());
    await tools.handlePlanPartyChange({ action: 'place', hidden: true });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.planPartyPlacement', {
      groupId: 'g1',
      hidden: true,
    });
    expect(createPlan).toHaveBeenCalledWith({
      feature: 'party',
      summary: 'Place Ana, Bo on "Vallaki" around the centre of your view',
      ops: [
        {
          kind: 'create',
          documentName: 'Token',
          parentUuid: 'Scene.s2',
          data: { name: 'Ana', actorId: 'a1', x: 1000, y: 900 },
        },
        {
          kind: 'create',
          documentName: 'Token',
          parentUuid: 'Scene.s2',
          data: { name: 'Bo', actorId: 'b1', x: 1100, y: 900 },
        },
      ],
    });
  });

  it('passes a named spot on, and names who was left out and why', async () => {
    answer(
      placement({
        anchor: { x: 1550, y: 450, label: 'at the note "Inn door"' },
        tokens: [{ actorId: 'a1', name: 'Ana', data: {} }],
        skipped: [{ name: 'Bo', reason: 'already on this scene' }],
        warnings: ["Walls were not checked (Foundry's map is not drawn)"],
      })
    );
    await tools.handlePlanPartyChange({ action: 'place', at: 'note', target: 'Inn door' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.planPartyPlacement', {
      groupId: 'g1',
      at: 'note',
      target: 'Inn door',
    });
    const input = createPlan.mock.calls[0]?.[0] as { summary: string };
    expect(input.summary).toBe(
      'Place Ana on "Vallaki" at the note "Inn door"; not placed: Bo (already on this scene). Walls were not checked (Foundry\'s map is not drawn)'
    );
  });

  it('refuses when nobody can be placed, with the reasons', async () => {
    answer(placement({ tokens: [], skipped: [{ name: 'Ana', reason: 'already on this scene' }] }));
    await expect(tools.handlePlanPartyChange({ action: 'place' })).rejects.toThrow(
      'Nobody to place from The Party on "Vallaki" (Ana: already on this scene)'
    );
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('rejects an unknown spot kind before asking Foundry', async () => {
    await expect(tools.handlePlanPartyChange({ action: 'place', at: 'moon' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalledWith(
      'foundry-mcp-bridge.planPartyPlacement',
      expect.anything()
    );
  });
});
