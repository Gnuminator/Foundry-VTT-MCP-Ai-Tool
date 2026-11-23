/** Renown scan (dnd5e 6.1): faction actors, renown items and per-faction totals on stub actors. */
import { RENOWN_STATE_QUERY as SHARED_QUERY } from '@gnuminator/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { getRenownState, RENOWN_STATE_QUERY } from './renown-scan.js';

const g = globalThis as Record<string, unknown>;

function setup(): void {
  const faction = {
    id: 'f1',
    uuid: 'Actor.f1',
    name: 'Harpers',
    type: 'faction',
    identifier: 'harpers',
    system: {
      type: { value: 'guild' },
      ranks: { r2: { name: 'Lord', renown: 10 }, r1: { name: 'Agent', renown: 3 } },
      members: [{ uuid: 'Actor.a1', rank: 'r1', role: 'Scout' }],
    },
    items: [],
  };
  const hero = {
    id: 'a1',
    uuid: 'Actor.a1',
    name: 'Ana',
    type: 'character',
    system: {},
    items: [
      {
        id: 'i1',
        uuid: 'Actor.a1.Item.i1',
        name: 'A',
        type: 'renown',
        system: {
          modifiers: [
            { faction: 'harpers', value: 2 },
            { faction: 'zhentarim', value: 1 },
          ],
        },
      },
      {
        id: 'i2',
        uuid: 'Actor.a1.Item.i2',
        name: 'B',
        type: 'renown',
        system: { modifiers: [{ faction: 'harpers', value: 2 }] },
      },
      { id: 'i3', uuid: 'Actor.a1.Item.i3', name: 'Sword', type: 'weapon', system: {} },
    ],
  };
  const idle = { id: 'a2', name: 'Bo', type: 'npc', system: {}, items: [] };
  const contents = [faction, hero, idle];
  g.game = {
    actors: { contents, get: (id: string): unknown => contents.find(a => a.id === id) },
    settings: { get: (): boolean => true },
    i18n: { localize: (k: string): string => k },
  };
  g.CONFIG = { DND5E: { factionCategories: { guild: { label: 'Guild' } } } };
}

afterEach(() => {
  delete g.game;
  delete g.CONFIG;
});

describe('getRenownState', () => {
  it('mirrors the shared query name', () => {
    expect(RENOWN_STATE_QUERY).toBe(SHARED_QUERY);
  });

  it('reads factions, ranks, members and totals', () => {
    setup();
    const state = getRenownState();
    expect(state.enabled).toBe(true);
    expect(state.factions).toHaveLength(1);
    const f = state.factions[0];
    expect(f.identifier).toBe('harpers');
    expect(f.ranks.map(r => r.id)).toEqual(['r1', 'r2']);
    expect(f.members).toEqual([{ uuid: 'Actor.a1', name: 'Ana', rank: 'r1', role: 'Scout' }]);
    expect(state.holders).toHaveLength(1);
    expect(state.creatures).toEqual([
      { actorId: 'a1', name: 'Ana' },
      { actorId: 'a2', name: 'Bo' },
    ]);
    const scores = state.holders[0].scores;
    expect(scores.find(s => s.faction === 'harpers')).toMatchObject({ value: 4, rank: 'r1' });
    expect(scores.find(s => s.faction === 'zhentarim')).toMatchObject({
      value: 1,
      factionName: 'zhentarim',
      rank: null,
    });
  });

  it('lets the dnd5e system.isCreature flag decide who can join a faction', () => {
    setup();
    g.game.actors.contents.push(
      { id: 'v1', name: 'Cart', type: 'vehicle', system: { isCreature: true }, items: [] },
      { id: 'n9', name: 'Statue', type: 'npc', system: { isCreature: false }, items: [] }
    );
    expect(getRenownState().creatures.map(c => c.actorId)).toEqual(['a1', 'a2', 'v1']);
  });

  it('warns when dnd5e is missing', () => {
    g.game = { actors: { contents: [] } };
    g.CONFIG = {};
    const state = getRenownState();
    expect(state.enabled).toBe(false);
    expect(state.warnings[0]).toMatch(/dnd5e/);
  });
});
