import { LOOSE_ENDS_MAX_PER_KIND, type PlayRecord } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { computeLooseEnds, type LooseEndsGroup } from './prep-loose-ends.js';

function rec(partial: Partial<PlayRecord>): PlayRecord {
  return { v: 2, key: 'k', t: 0, seq: 0, kind: 'chat', userId: null, sceneId: null, ...partial };
}

const npc = (id: string, name: string, extra: Partial<PlayRecord> = {}): PlayRecord =>
  rec({ actor: { uuid: `Actor.${id}`, isPC: false, name }, ...extra });

function session(
  records: PlayRecord[],
  journals: Array<{ id: string; name: string }> = []
): LooseEndsGroup {
  return {
    playRecords: records,
    events: journals.map(j => ({
      eventType: 'journal-updated',
      details: { journalId: j.id, name: j.name },
    })),
  };
}

describe('computeLooseEnds', () => {
  it('is null without a session', () => {
    expect(computeLooseEnds({ groups: [], openQuests: [], scenes: [] })).toBeNull();
  });

  it('names the stale quest, the once-met NPC and the unused scene with last seen session', () => {
    const groups = [
      session(
        [npc('a1', 'Ismark', { sceneId: 'cellar' }), npc('a2', 'Ireena')],
        [
          { id: 'q1', name: 'Old Bones' },
          { id: 'q2', name: 'The Wizard of Wines' },
        ]
      ),
      session([npc('a2', 'Ireena', { sceneId: 'village' })], [{ id: 'q2', name: 'Wizard' }]),
      session([npc('a2', 'Ireena', { sceneId: 'village' })], [{ id: 'q2', name: 'Wizard' }]),
    ];
    const result = computeLooseEnds({
      groups,
      openQuests: [
        { journalId: 'q1', name: 'Old Bones', status: 'Active', open: true },
        { journalId: 'q2', name: 'The Wizard of Wines', status: 'Active', open: true },
      ],
      scenes: [
        { id: 'cellar', name: 'Cellar' },
        { id: 'village', name: 'Village' },
        { id: 'tower', name: 'Tower' },
      ],
    });
    expect(result?.quests.map(q => q.label)).toEqual(['Old Bones: last seen session 1']);
    expect(result?.npcs.map(n => n.label)).toEqual(['Ismark: last seen session 1']);
    expect(result?.scenes.map(s => s.label)).toEqual(['Cellar: last seen session 1']);
    expect(result?.neverVisitedScenes).toBe(1);
  });

  it('counts an unlinked token actor as its base actor and ignores PCs', () => {
    const groups = [
      session([
        rec({ actor: { uuid: 'Scene.s.Token.t.Actor.w1', isPC: false, name: 'Wolf' } }),
        rec({ actor: { uuid: 'Actor.pc', isPC: true, name: 'Ilvara' } }),
      ]),
      session([npc('w1', 'Wolf')]),
    ];
    const result = computeLooseEnds({ groups, openQuests: null, scenes: null });
    expect(result?.npcs).toEqual([]);
    expect(result?.unavailable).toEqual(['quests', 'scenes']);
    expect(result?.neverVisitedScenes).toBeNull();
  });

  it('reports a never-touched open quest and caps each list', () => {
    const groups = [session([]), session([])];
    const openQuests = Array.from({ length: LOOSE_ENDS_MAX_PER_KIND + 2 }, (_, i) => ({
      journalId: `q${i}`,
      name: `Quest ${String(i).padStart(2, '0')}`,
      status: 'Active',
      open: true,
    }));
    const result = computeLooseEnds({ groups, openQuests, scenes: [] });
    expect(result?.quests).toHaveLength(LOOSE_ENDS_MAX_PER_KIND);
    expect(result?.quests[0]?.label).toBe('Quest 00: not seen in any logged session');
    expect(result?.omitted.quests).toBe(2);
  });

  it('counts an NPC only when it spoke, not a monster that took damage', () => {
    const groups = [
      session([
        npc('m1', 'Zombie', { kind: 'hp' }),
        npc('n1', 'Ismark'),
        npc('f1', 'Fresh', { sceneId: 'fresh' }),
      ]),
      session([rec({ sceneId: 'fresh' })]),
    ];
    const result = computeLooseEnds({
      groups,
      openQuests: [],
      scenes: [{ id: 'fresh', name: 'Fresh scene' }],
    });
    expect(result?.npcs.map(n => n.name)).toEqual(['Fresh', 'Ismark']);
    expect(result?.scenes).toEqual([]);
  });

  it('matches a quest by id first; the name only helps events without an id', () => {
    const groups = [
      {
        playRecords: [],
        events: [{ eventType: 'journal-updated', details: { name: 'Old Bones' } }],
      },
      session([]),
      session([], [{ id: 'other', name: 'Old Bones' }]),
    ];
    const result = computeLooseEnds({
      groups,
      openQuests: [{ journalId: 'q1', name: 'Old Bones', status: 'Active', open: true }],
      scenes: [],
    });
    expect(result?.quests.map(q => q.label)).toEqual(['Old Bones: last seen session 1']);
  });

  it('leaves the latest session alone: nothing is stale yet', () => {
    const groups = [session([npc('a1', 'Ismark')], [{ id: 'q1', name: 'Old Bones' }])];
    const result = computeLooseEnds({
      groups,
      openQuests: [{ journalId: 'q1', name: 'Old Bones', status: 'Active', open: true }],
      scenes: [],
    });
    expect(result?.quests).toEqual([]);
    expect(result?.npcs).toEqual([]);
  });
});
