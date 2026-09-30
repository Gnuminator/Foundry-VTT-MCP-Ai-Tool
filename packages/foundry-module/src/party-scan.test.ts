/**
 * Unit tests for the party scan (I-079): groups, members, pace, tokens on the
 * encounter's scene and the rest request cards.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PARTY_FEATURE_ID,
  PARTY_REST_TYPES,
  PARTY_STATE_QUERY,
  getPartyState,
} from './party-scan.js';
import {
  PARTY_FEATURE_ID as SHARED_FEATURE,
  PARTY_REST_TYPES as SHARED_REST_TYPES,
  PARTY_STATE_QUERY as SHARED_QUERY,
} from '../../../shared/src/party.js';
import { createTestWorld, makeToken, type TestWorld } from './test-support/foundry-mock/index.js';

let world: TestWorld;
let restore: () => void;

const g = globalThis as any;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  g.CONFIG.DND5E = {
    travelPace: {
      slow: { label: 'Slow' },
      normal: { label: 'Normal' },
      fast: { label: 'Fast' },
    },
    restTypes: {
      short: { label: 'Short Rest', icon: 'fa-solid fa-utensils', duration: { normal: 60 } },
      long: {
        label: 'Long Rest',
        icon: 'fa-solid fa-campground',
        duration: { normal: 480 },
        newDay: true,
      },
    },
  };
  g.CONFIG.statusEffects = [
    { id: 'poisoned', name: 'Poisoned' },
    { id: 'prone', name: 'Prone' },
    { id: 'exhaustion', name: 'Exhaustion' },
  ];
});

afterEach(() => {
  restore();
});

function hero(id: string, name: string, extra: Record<string, any> = {}): any {
  return world.addActor({
    id,
    name,
    type: 'character',
    uuid: `Actor.${id}`,
    statuses: new Set<string>(extra.statuses ?? []),
    system: {
      details: { level: extra.level ?? 3 },
      attributes: {
        hp: { value: extra.hp ?? 20, max: 28, temp: 0 },
        ac: { value: 16 },
        exhaustion: extra.exhaustion ?? 0,
        hd: { value: 2, max: 3 },
        death: { success: 1, failure: 2 },
        inspiration: extra.inspiration ?? false,
      },
      skills: { prc: { passive: 13 } },
    },
  });
}

function group(id: string, name: string, members: any[], extra: Record<string, any> = {}): any {
  return world.addActor({
    id,
    name,
    type: 'group',
    uuid: `Actor.${id}`,
    system: {
      level: 3,
      members: members.map(actor => ({ actor })),
      attributes: { travel: { pace: extra.pace ?? 'normal' } },
      ...(extra.getTravelPace ? { getTravelPace: extra.getTravelPace } : {}),
    },
    ...(extra.createRestFlavor ? { createRestFlavor: extra.createRestFlavor } : {}),
  });
}

describe('wire contract', () => {
  it('mirrors the shared constants', () => {
    expect(PARTY_STATE_QUERY).toBe(SHARED_QUERY);
    expect(PARTY_FEATURE_ID).toBe(SHARED_FEATURE);
    expect(PARTY_REST_TYPES).toEqual(SHARED_REST_TYPES);
  });
});

describe('groups', () => {
  it('lists only group actors, the primary party first', () => {
    const a = hero('a1', 'Ana');
    group('g2', 'Alpha Band', [a]);
    const party = group('g1', 'The Party', [a]);
    world.addActor({ id: 'n1', name: 'Wolf', type: 'npc' });
    g.game.actors.party = party;
    const state = getPartyState();
    expect(state.groups.map(x => [x.name, x.primary])).toEqual([
      ['The Party', true],
      ['Alpha Band', false],
    ]);
    expect(state.warnings).toEqual([]);
  });

  it('reads member numbers, conditions without exhaustion, and death saves only at 0 HP', () => {
    const a = hero('a1', 'Ana', { statuses: ['prone', 'exhaustion', 'poisoned'], exhaustion: 2 });
    const b = hero('b1', 'Bo', { hp: 0, inspiration: true });
    group('g1', 'The Party', [a, b]);
    const [party] = getPartyState().groups;
    expect(party?.members[0]).toMatchObject({
      actorId: 'a1',
      uuid: 'Actor.a1',
      name: 'Ana',
      type: 'character',
      level: 3,
      hp: { value: 20, max: 28, temp: 0 },
      ac: 16,
      passivePerception: 13,
      exhaustion: 2,
      hitDice: { value: 2, max: 3 },
      deathSaves: null,
      conditions: ['Poisoned', 'Prone'],
      inspiration: false,
    });
    expect(party?.members[1]).toMatchObject({
      deathSaves: { success: 1, failure: 2 },
      inspiration: true,
    });
  });

  it('gives a level only to characters', () => {
    const wolf = world.addActor({
      id: 'w1',
      name: 'Wolf',
      type: 'npc',
      system: { details: { level: 0, cr: 0.25 }, attributes: { hp: { value: 11, max: 11 } } },
    });
    group('g1', 'The Party', [hero('a1', 'Ana'), wolf]);
    expect(getPartyState().groups[0]?.members.map(m => m.level)).toEqual([3, null]);
  });

  it('skips missing member actors', () => {
    const a = hero('a1', 'Ana');
    group('g1', 'The Party', [a, null]);
    expect(getPartyState().groups[0]?.members.map(m => m.name)).toEqual(['Ana']);
  });

  it('warns when dnd5e is not loaded', () => {
    g.CONFIG.DND5E = undefined;
    expect(getPartyState().warnings[0]).toMatch(/dnd5e/);
  });
});

describe('pace', () => {
  it('uses getTravelPace when dnd5e has it (slowed members force slow)', () => {
    const a = hero('a1', 'Ana');
    group('g1', 'The Party', [a], {
      pace: 'fast',
      getTravelPace: () => ({ pace: { value: 'slow', label: 'Slow', slowed: true } }),
    });
    expect(getPartyState().groups[0]?.pace).toEqual({ value: 'slow', label: 'Slow', slowed: true });
  });

  it('falls back to the stored pace and lists the pace options', () => {
    const a = hero('a1', 'Ana');
    group('g1', 'The Party', [a], { pace: 'fast' });
    const state = getPartyState();
    expect(state.groups[0]?.pace).toEqual({ value: 'fast', label: 'Fast', slowed: false });
    expect(state.paceOptions).toEqual([
      { value: 'slow', label: 'Slow' },
      { value: 'normal', label: 'Normal' },
      { value: 'fast', label: 'Fast' },
    ]);
  });
});

describe('tokens and encounter', () => {
  it('reads member tokens on the active scene without an encounter', () => {
    const a = hero('a1', 'Ana');
    group('g1', 'The Party', [a]);
    world.addScene({
      id: 's1',
      name: 'Test Arena',
      active: true,
      tokens: [
        makeToken({ id: 't1', name: 'Ana', actorId: 'a1', hidden: true }),
        makeToken({ id: 't2', name: 'Wolf', actorId: 'w1' }),
      ],
    });
    const state = getPartyState();
    expect(state.scene).toEqual({ sceneId: 's1', name: 'Test Arena' });
    expect(state.encounter).toBeNull();
    expect(state.groups[0]?.members[0]?.tokens).toEqual([
      { tokenId: 't1', name: 'Ana', hidden: true, inCombat: false },
    ]);
  });

  it("uses the encounter's scene and marks tokens already in combat", () => {
    const a = hero('a1', 'Ana');
    const b = hero('b1', 'Bo');
    group('g1', 'The Party', [a, b]);
    world.addScene({ id: 's0', name: 'Elsewhere', active: true });
    world.addScene({
      id: 's1',
      name: 'Test Arena',
      tokens: [
        makeToken({ id: 't1', name: 'Ana', actorId: 'a1' }),
        makeToken({ id: 't2', name: 'Bo', actorId: 'b1' }),
      ],
    });
    world.setCombat({
      id: 'c1',
      scene: 's1',
      round: 2,
      started: true,
      turns: [{ id: 'cb1', tokenId: 't1', sceneId: 's1' }],
    });
    const state = getPartyState();
    expect(state.scene?.sceneId).toBe('s1');
    expect(state.encounter).toEqual({ combatId: 'c1', uuid: 'Combat.c1', round: 2, started: true });
    expect(state.groups[0]?.members.map(m => m.tokens[0]?.inCombat)).toEqual([true, false]);
  });
});

describe('rest cards', () => {
  it('builds dnd5e rest request cards for the members', () => {
    const a = hero('a1', 'Ana');
    const b = hero('b1', 'Bo');
    group('g1', 'The Party', [a, b], {
      createRestFlavor: (config: any) =>
        `Rest (${config.type}, ${config.duration} min${config.newDay ? ', new day' : ''})`,
    });
    const cards = getPartyState().groups[0]?.restCards;
    expect(cards?.long).toMatchObject({
      type: 'request',
      flavor: 'Rest (long, 480 min, new day)',
      speaker: { actor: 'g1', alias: 'The Party' },
      system: {
        button: { icon: 'fa-solid fa-campground', label: 'Long Rest' },
        data: { newDay: true, recoverTemp: false, recoverTempMax: false, type: 'long' },
        handler: 'rest',
        targets: [{ actor: 'Actor.a1' }, { actor: 'Actor.b1' }],
      },
    });
    expect(cards?.short).toMatchObject({
      flavor: 'Rest (short, 60 min)',
      system: { data: { newDay: false, type: 'short' } },
    });
  });
});
