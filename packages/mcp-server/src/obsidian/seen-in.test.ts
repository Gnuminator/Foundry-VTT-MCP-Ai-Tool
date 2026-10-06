import type { PlayRecord } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import type { UnionSessionGroup } from './grouping.js';
import { baseActorUuid, buildSeenIndex, parseSeenIndex } from './seen-in.js';

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

describe('buildSeenIndex', () => {
  const sessions = [{ label: '2026-11-29 S01' }, { label: '2026-12-06 S02' }];

  it('lists NPC actors and scenes per session in session order, without duplicates', () => {
    const index = buildSeenIndex(
      [
        group([
          rec({ key: 'a', actor: npc('Actor.b'), sceneId: 's1' }),
          rec({ key: 'b', actor: npc('Scene.s1.Token.t1.Actor.b'), sceneId: 's1' }),
          rec({ key: 'c', actor: npc('Actor.a'), sceneId: 's2' }),
        ]),
        group([rec({ key: 'd', actor: npc('Actor.b'), sceneId: 's1' })]),
      ],
      sessions
    );
    expect(index).toEqual({
      v: 1,
      actors: { 'Actor.a': ['2026-11-29 S01'], 'Actor.b': ['2026-11-29 S01', '2026-12-06 S02'] },
      scenes: {
        'Scene.s1': ['2026-11-29 S01', '2026-12-06 S02'],
        'Scene.s2': ['2026-11-29 S01'],
      },
    });
    expect(Object.keys(index.actors)).toEqual(['Actor.a', 'Actor.b']);
  });

  it('ignores PCs and compendium actors', () => {
    const index = buildSeenIndex(
      [
        group([
          rec({ key: 'a', actor: { uuid: 'Actor.pc', isPC: true, name: 'Hero' } }),
          rec({ key: 'b', actor: npc('Compendium.dnd5e.monsters.Actor.zzz') }),
        ]),
      ],
      sessions
    );
    expect(index.actors).toEqual({});
    expect(index.scenes).toEqual({});
  });

  it('uses data.tokens entries that are NPCs and not hidden', () => {
    const index = buildSeenIndex(
      [
        group([
          rec({
            key: 's',
            kind: 'scene',
            sceneId: 's1',
            data: {
              tokens: [
                { actorUuid: 'Actor.gob', name: 'Goblin', isPC: false },
                { actorUuid: 'Actor.ghost', name: 'Ghost', isPC: false, hidden: true },
                { actorUuid: 'Actor.hero', name: 'Hero', isPC: true },
                { actorUuid: 42, name: 'Bad', isPC: false },
                'junk',
              ],
            },
          }),
        ]),
      ],
      sessions
    );
    expect(index.actors).toEqual({ 'Actor.gob': ['2026-11-29 S01'] });
    expect(index.scenes).toEqual({ 'Scene.s1': ['2026-11-29 S01'] });
  });

  it('skips groups without a session, and empty groups', () => {
    const index = buildSeenIndex(
      [
        group([]),
        group([rec({ key: 'a', actor: npc('Actor.a'), sceneId: 's1' })]),
        group([rec({ key: 'b', sceneId: 's9' })]),
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
      parseSeenIndex({ actors: { 'Actor.a': ['L1', 3], 'Actor.b': 'x', 'Actor.c': [] }, scenes: 5 })
    ).toEqual({ v: 1, actors: { 'Actor.a': ['L1'] }, scenes: {} });
    expect(parseSeenIndex(null)).toEqual({ v: 1, actors: {}, scenes: {} });
    expect(parseSeenIndex('nope')).toEqual({ v: 1, actors: {}, scenes: {} });
  });
});
