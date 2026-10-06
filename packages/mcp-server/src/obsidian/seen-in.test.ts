import type { PlayRecord } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import type { UnionSessionGroup } from './grouping.js';
import { baseActorUuid, buildSeenIndex, EMPTY_SEEN_INDEX, parseSeenIndex } from './seen-in.js';

function rec(partial: Partial<PlayRecord> & { key: string }): PlayRecord {
  return { v: 2, t: 1, seq: 1, kind: 'hp', userId: null, sceneId: null, ...partial };
}

function group(playRecords: PlayRecord[], eventCount = 0): UnionSessionGroup {
  return {
    events: Array.from({ length: eventCount }, (_, i) => ({ id: `e${i}` })),
    playRecords,
    startedBy: 'gap',
    endedBy: 'open',
  };
}

const npc = (uuid: string): PlayRecord['actor'] => ({ uuid, isPC: false, name: 'N' });

describe('baseActorUuid', () => {
  it('folds token-synthetic actor uuids to the base actor', () => {
    expect(baseActorUuid('Actor.a1')).toBe('Actor.a1');
    expect(baseActorUuid('Scene.s1.Token.t1.Actor.a1')).toBe('Actor.a1');
  });

  it('skips compendium uuids and uuids without an actor segment', () => {
    expect(baseActorUuid('Compendium.dnd5e.monsters.Actor.zzz')).toBeNull();
    expect(baseActorUuid('Scene.s1.Token.t1')).toBeNull();
    expect(baseActorUuid('Item.i1')).toBeNull();
  });
});

/** A `scene` record: the GM viewing `sceneId`, `active` or a preview, with these players online. */
const sceneRec = (
  key: string,
  t: number,
  sceneId: string,
  active: boolean,
  players: string[],
  tokens: unknown[] = []
): PlayRecord => rec({ key, t, kind: 'scene', sceneId, data: { active, players, tokens } });

const join = (
  key: string,
  t: number,
  userId: string,
  extra: Record<string, unknown> = {}
): PlayRecord => rec({ key, t, kind: 'user-join', userId, data: { isGM: false, ...extra } });

describe('buildSeenIndex', () => {
  const sessions = [{ label: '2026-11-29 S01' }, { label: '2026-12-06 S02' }];
  const S1 = '2026-11-29 S01';
  const S2 = '2026-12-06 S02';

  it('lists actors and active scenes per session in session order, without duplicates', () => {
    const index = buildSeenIndex(
      [
        group([
          sceneRec('s', 1, 's1', true, ['p1']),
          rec({ key: 'a', t: 2, kind: 'roll', actor: npc('Actor.b') }),
          rec({ key: 'b', t: 3, kind: 'hp', actor: npc('Scene.s1.Token.t1.Actor.b') }),
          sceneRec('s2', 4, 's2', true, ['p1']),
          rec({ key: 'c', t: 5, kind: 'combat-turn', actor: npc('Actor.a') }),
        ]),
        group([
          sceneRec('s', 1, 's1', true, ['p1']),
          rec({ key: 'd', t: 2, kind: 'chat', actor: npc('Actor.b') }),
        ]),
      ],
      sessions
    );
    expect(index).toEqual({
      v: 1,
      actors: { 'Actor.a': [S1], 'Actor.b': [S1, S2] },
      scenes: { 'Scene.s1': [S1, S2], 'Scene.s2': [S1] },
    });
    expect(Object.keys(index.actors)).toEqual(['Actor.a', 'Actor.b']);
  });

  it('counts nothing in a session where the GM was alone (prep)', () => {
    const index = buildSeenIndex(
      [
        group([
          sceneRec(
            's',
            1,
            's1',
            true,
            [],
            [{ actorUuid: 'Actor.gob', name: 'Goblin', isPC: false }]
          ),
          rec({ key: 'a', t: 2, kind: 'roll', actor: npc('Actor.rahadin') }),
          rec({ key: 'b', t: 3, kind: 'hp', actor: npc('Actor.rahadin') }),
          rec({ key: 'g', t: 4, kind: 'user-join', userId: 'gm2', data: { isGM: true } }),
          rec({ key: 'c', t: 5, kind: 'chat', actor: npc('Actor.rahadin') }),
        ]),
      ],
      sessions
    );
    expect(index).toEqual({ v: 1, actors: {}, scenes: {} });
  });

  it('never counts GM lifecycle work (create, delete, items, token moves), even with players online', () => {
    const lifecycle = [
      'actor-create',
      'actor-delete',
      'item-create',
      'item-delete',
      'token-create',
      'token-delete',
      'token-move',
    ] as const;
    const index = buildSeenIndex(
      [
        group([
          sceneRec('s', 1, 's1', true, ['p1']),
          ...lifecycle.map((kind, i) => rec({ key: kind, t: 2 + i, kind, actor: npc('Actor.r') })),
        ]),
      ],
      sessions
    );
    expect(index.actors).toEqual({});
  });

  it('skips whispered and blind rolls, item use and chat', () => {
    const index = buildSeenIndex(
      [
        group([
          sceneRec('s', 1, 's1', true, ['p1']),
          rec({ key: 'a', t: 2, kind: 'roll', actor: npc('Actor.w'), data: { whisper: true } }),
          rec({ key: 'b', t: 3, kind: 'item-use', actor: npc('Actor.b'), data: { blind: true } }),
          rec({
            key: 'c',
            t: 4,
            kind: 'chat',
            actor: npc('Actor.c'),
            data: { whisper: true, blind: false },
          }),
          rec({
            key: 'd',
            t: 5,
            kind: 'chat',
            actor: npc('Actor.ok'),
            data: { whisper: false, blind: false },
          }),
        ]),
      ],
      sessions
    );
    expect(index.actors).toEqual({ 'Actor.ok': [S1] });
  });

  it('does not count a scene the GM only previews, nor its tokens', () => {
    const gob = { actorUuid: 'Actor.gob', name: 'Goblin', isPC: false };
    const index = buildSeenIndex(
      [
        group([
          sceneRec('a', 1, 'vallaki', true, ['p1']),
          sceneRec('b', 2, 'amber', false, ['p1'], [gob]),
          rec({ key: 'r', t: 3, kind: 'roll', actor: npc('Actor.pc'), sceneId: 'amber' }),
          sceneRec('c', 4, 'vallaki', true, ['p1']),
        ]),
      ],
      sessions
    );
    expect(index.scenes).toEqual({ 'Scene.vallaki': [S1] });
    expect(index.actors).toEqual({ 'Actor.pc': [S1] });
  });

  it("follows players joining and leaving, and uses a joining player's active scene snapshot", () => {
    const tokens = [
      { actorUuid: 'Actor.gob', name: 'Goblin', isPC: false },
      { actorUuid: 'Actor.ghost', name: 'Ghost', isPC: false, hidden: true },
      { actorUuid: 'Actor.hero', name: 'Hero', isPC: true },
      { actorUuid: 42, name: 'Bad', isPC: false },
      'junk',
    ];
    const index = buildSeenIndex(
      [
        group([
          sceneRec('s', 1, 's1', false, []),
          rec({ key: 'early', t: 2, kind: 'roll', actor: npc('Actor.early') }),
          join('j', 3, 'p1', { activeSceneId: 'sA', tokens }),
          rec({ key: 'mid', t: 4, kind: 'roll', actor: npc('Actor.mid') }),
          rec({ key: 'l', t: 5, kind: 'user-leave', userId: 'p1', data: { isGM: false } }),
          rec({ key: 'late', t: 6, kind: 'roll', actor: npc('Actor.late') }),
        ]),
      ],
      sessions
    );
    expect(index.actors).toEqual({ 'Actor.gob': [S1], 'Actor.hero': [S1], 'Actor.mid': [S1] });
    expect(index.scenes).toEqual({ 'Scene.sA': [S1] });
  });

  it('orders records by time before following who is online', () => {
    const index = buildSeenIndex(
      [
        group([
          rec({ key: 'r', t: 5, kind: 'roll', actor: npc('Actor.x') }),
          sceneRec('s', 1, 's1', true, ['p1']),
        ]),
      ],
      sessions
    );
    expect(index.actors).toEqual({ 'Actor.x': [S1] });
  });

  it('lists nothing for records from before 2026-10 (no presence data)', () => {
    const index = buildSeenIndex(
      [
        group([
          rec({ key: 's', kind: 'scene', sceneId: 's1', data: { sceneName: 'Old' } }),
          rec({ key: 'j', kind: 'user-join', userId: 'p1', data: { name: 'Alice' } }),
          rec({ key: 'r', kind: 'roll', actor: npc('Actor.a'), sceneId: 's1' }),
        ]),
      ],
      sessions
    );
    expect(index).toEqual({ v: 1, actors: {}, scenes: {} });
  });

  it('indexes character actors too, and skips compendium actors', () => {
    const index = buildSeenIndex(
      [
        group([
          sceneRec('s', 1, 's1', true, ['p1']),
          rec({
            key: 'a',
            t: 2,
            kind: 'roll',
            actor: { uuid: 'Actor.side', isPC: true, name: 'Sidekick' },
          }),
          rec({ key: 'b', t: 3, kind: 'roll', actor: npc('Compendium.dnd5e.monsters.Actor.zzz') }),
        ]),
      ],
      sessions
    );
    expect(index.actors).toEqual({ 'Actor.side': [S1] });
  });

  it('skips groups without a session, and empty groups', () => {
    const index = buildSeenIndex(
      [
        group([]),
        group([
          sceneRec('s', 1, 's1', true, ['p1']),
          rec({ key: 'a', t: 2, kind: 'roll', actor: npc('Actor.a') }),
        ]),
        group([sceneRec('s', 1, 's9', true, ['p1'])]),
      ],
      [{ label: 'L1' }, { label: 'L2' }]
    );
    expect(index.actors).toEqual({ 'Actor.a': ['L2'] });
    expect(index.scenes).toEqual({ 'Scene.s1': ['L2'] });
  });

  it('counts a group that has only session-log events but no play records as empty of ids', () => {
    expect(buildSeenIndex([group([], 3)], sessions)).toEqual({ v: 1, actors: {}, scenes: {} });
  });
});

describe('parseSeenIndex', () => {
  it('keeps good lists and drops bad shapes', () => {
    expect(
      parseSeenIndex({
        v: 1,
        actors: { 'Actor.a': ['L1', 3], 'Actor.b': 'x', 'Actor.c': [] },
        scenes: 5,
      })
    ).toEqual({ v: 1, actors: { 'Actor.a': ['L1'] }, scenes: {} });
    // Another (or no) version reads as empty.
    expect(parseSeenIndex({ v: 2, actors: { 'Actor.a': ['L1'] } })).toEqual(EMPTY_SEEN_INDEX);
    expect(parseSeenIndex({ actors: { 'Actor.a': ['L1'] } })).toEqual(EMPTY_SEEN_INDEX);
    expect(parseSeenIndex(null)).toEqual({ v: 1, actors: {}, scenes: {} });
    expect(parseSeenIndex('nope')).toEqual({ v: 1, actors: {}, scenes: {} });
  });
});
