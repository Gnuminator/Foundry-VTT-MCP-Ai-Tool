/**
 * Paper nights in the grouping and the stats (Design "Paper and Foundry nights", item C): a paper
 * start marker makes a paper session, and what a paper sync wrote (feature `paper-sync`) is kept
 * out of the play numbers and shown as a net change.
 */
import type { PlayActorRef, PlayRecord } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { groupWithPlayRecords, type SessionEvent } from '../obsidian/grouping.js';
import { renderCampaignStatsNote, renderSessionNote } from '../obsidian/render.js';
import { PAPER_SYNC_FEATURE } from '../paper-night.js';

import { buildStats } from './build.js';

const ILVARA: PlayActorRef = { uuid: 'Actor.pc1', isPC: true, name: 'Ilvara', playerOwned: true };
const BRAM: PlayActorRef = { uuid: 'Actor.pc2', isPC: true, name: 'Bram', playerOwned: true };
const NIGHT = Date.parse('2026-11-29T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function marker(
  id: string,
  type: 'session-start' | 'session-end',
  t: number,
  mode?: 'paper'
): SessionEvent {
  return {
    id,
    timestamp: new Date(t).toISOString(),
    timestampMs: t,
    eventType: type,
    details: { source: 'mark-play-session', ...(mode ? { mode } : {}) },
  };
}

function gmChange(id: string, t: number, changeId: string, feature: string): SessionEvent {
  return {
    id,
    timestamp: new Date(t).toISOString(),
    timestampMs: t,
    eventType: 'gm-change',
    description: 'Applied: paper sync',
    details: { changeId, feature, mode: 'apply' },
  };
}

function change(
  key: string,
  t: number,
  kind: PlayRecord['kind'],
  actor: PlayActorRef,
  fields: Partial<PlayRecord>
): PlayRecord {
  return {
    v: 2,
    key,
    t,
    seq: 1,
    kind,
    userId: null,
    sceneId: null,
    actor,
    ...fields,
  };
}

const hp = (
  key: string,
  t: number,
  actor: PlayActorRef,
  before: number,
  after: number,
  extra: Partial<PlayRecord> = {}
): PlayRecord =>
  change(key, t, 'hp', actor, {
    path: 'system.attributes.hp.value',
    before,
    after,
    delta: after - before,
    ...extra,
  });

describe('grouping with a paper night', () => {
  it('flags a group started by a paper start marker, and no other', () => {
    const groups = groupWithPlayRecords(
      [
        marker('p1', 'session-start', NIGHT, 'paper'),
        marker('p2', 'session-end', NIGHT + 1000),
        marker('l1', 'session-start', NIGHT + 7 * DAY),
        marker('l2', 'session-end', NIGHT + 7 * DAY + 1000),
      ],
      []
    );
    expect(groups.map(g => g.paper)).toEqual([true, false]);
  });

  it('does not let a sync a few days later open a session of its own', () => {
    const syncAt = NIGHT + 3 * DAY;
    const groups = groupWithPlayRecords(
      [
        marker('p1', 'session-start', NIGHT, 'paper'),
        marker('p2', 'session-end', NIGHT + 1000),
        gmChange('g1', syncAt, 'chg1', PAPER_SYNC_FEATURE),
      ],
      [hp('h1', syncAt, ILVARA, 30, 18, { source: { changeId: 'chg1' } })]
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.paperSync.events.map(e => e.id)).toEqual(['g1']);
    expect(groups[0]?.paperSync.records.map(r => r.key)).toEqual(['h1']);
    expect(groups[0]?.playRecords).toEqual([]);
    expect(groups[0]?.events.map(e => e.id)).toEqual(['p1', 'p2']);
  });

  it('gives a sync to a paper night marked after it on the same date', () => {
    // The sync ran at 10:00; the night was marked afterwards, at the default 12:00 that day.
    const marked = new Date(2026, 10, 29, 12).getTime();
    const syncAt = marked - 2 * 60 * 60 * 1000;
    const groups = groupWithPlayRecords(
      [
        marker('p1', 'session-start', marked, 'paper'),
        gmChange('g1', syncAt, 'chg1', PAPER_SYNC_FEATURE),
      ],
      [hp('h1', syncAt, ILVARA, 30, 18, { source: { changeId: 'chg1' } })]
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.paperSync.records.map(r => r.key)).toEqual(['h1']);
  });

  it('gives a sync to the night marked after it on the same date, not to an older night', () => {
    const older = new Date(2026, 10, 8, 12).getTime();
    const marked = new Date(2026, 10, 15, 12).getTime();
    const syncAt = new Date(2026, 10, 15, 10).getTime();
    const groups = groupWithPlayRecords(
      [
        marker('a', 'session-start', older, 'paper'),
        marker('b', 'session-start', marked, 'paper'),
        gmChange('g1', syncAt, 'chg1', PAPER_SYNC_FEATURE),
      ],
      [hp('h1', syncAt, ILVARA, 30, 18, { source: { changeId: 'chg1' } })]
    );
    expect(groups.map(g => g.paperSync.records.length)).toEqual([0, 1]);
  });

  it('does not give a sync to a paper night on another date that starts after it', () => {
    const groups = groupWithPlayRecords(
      [
        marker('p1', 'session-start', NIGHT + 3 * DAY, 'paper'),
        gmChange('g1', NIGHT, 'chg1', PAPER_SYNC_FEATURE),
      ],
      [hp('h1', NIGHT, ILVARA, 30, 18, { source: { changeId: 'chg1' } })]
    );
    expect(groups[0]?.paperSync.records).toEqual([]);
  });

  it('keeps a sync of another feature as ordinary play', () => {
    const groups = groupWithPlayRecords(
      [gmChange('g1', NIGHT, 'chg1', 'actor-changes')],
      [hp('h1', NIGHT, ILVARA, 30, 18, { source: { changeId: 'chg1' } })]
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.paper).toBe(false);
    expect(groups[0]?.playRecords).toHaveLength(1);
  });

  it('gives a sync to the newest paper night before it', () => {
    const second = NIGHT + 14 * DAY;
    const groups = groupWithPlayRecords(
      [
        marker('p1', 'session-start', NIGHT, 'paper'),
        marker('p2', 'session-start', second, 'paper'),
        gmChange('g1', second + DAY, 'chg1', PAPER_SYNC_FEATURE),
      ],
      [hp('h1', second + DAY, ILVARA, 30, 18, { source: { changeId: 'chg1' } })]
    );
    expect(groups.map(g => g.paperSync.records.length)).toEqual([0, 1]);
  });
});

describe('buildStats with a paper night', () => {
  const syncAt = NIGHT + 2 * DAY;
  const events = (): SessionEvent[] => [
    marker('p1', 'session-start', NIGHT, 'paper'),
    marker('p2', 'session-end', NIGHT + 4 * 60 * 60 * 1000),
    gmChange('g1', syncAt, 'chg1', PAPER_SYNC_FEATURE),
    gmChange('g2', syncAt + 1000, 'chg2', PAPER_SYNC_FEATURE),
  ];
  const sync = (): PlayRecord[] => [
    hp('h1', syncAt, ILVARA, 30, 18, { source: { changeId: 'chg1' } }),
    change('s1', syncAt, 'slot', ILVARA, {
      path: 'system.spells.spell2.value',
      before: 3,
      after: 1,
      delta: -2,
      source: { changeId: 'chg1' },
    }),
    change('c1', syncAt, 'currency', ILVARA, {
      path: 'system.currency.gp',
      before: 112,
      after: 87,
      delta: -25,
      source: { changeId: 'chg1' },
    }),
    change('i1', syncAt, 'item-delete', ILVARA, {
      item: { name: 'Rope', type: 'loot' } as never,
      before: 1,
      source: { changeId: 'chg1' },
    }),
    hp('h2', syncAt + 1000, BRAM, 10, 22, { source: { changeId: 'chg2' } }),
    change('x1', syncAt + 1000, 'xp', BRAM, {
      path: 'system.details.xp.value',
      before: 0,
      after: 300,
      delta: 300,
      source: { changeId: 'chg2' },
    }),
  ];

  it('is one paper session whose duration is the marked night', () => {
    const stats = buildStats({ worldId: 'w', logEvents: events(), playRecords: sync() });
    expect(stats.sessions).toHaveLength(1);
    expect(stats.sessions[0]).toMatchObject({ mode: 'paper', durationMin: 240, rolls: 0 });
    expect(stats.campaign).toMatchObject({ sessions: 1, paperSessions: 1 });
  });

  it('keeps the sync out of damage, healing, slots, loot, currency, XP and the per-PC totals', () => {
    const stats = buildStats({ worldId: 'w', logEvents: events(), playRecords: sync() });
    expect(stats.sessions[0]).toMatchObject({
      partyDamageTaken: 0,
      partyHealing: 0,
      spellSlotsSpent: 0,
      playRecords: 0,
      pcDowns: 0,
    });
    expect(stats.pcs).toEqual([]);
  });

  it('shows the net change per character', () => {
    const net = buildStats({ worldId: 'w', logEvents: events(), playRecords: sync() }).sessions[0]
      ?.paperNet;
    expect(net?.records).toBe(6);
    expect(net?.characters).toEqual([
      {
        uuid: 'Actor.pc2',
        name: 'Bram',
        hpLost: 0,
        hpGained: 12,
        slotsSpent: 0,
        slotsRegained: 0,
        resourcesSpent: 0,
        currency: {},
        xpGained: 300,
        itemsGained: {},
        itemsLost: {},
      },
      {
        uuid: 'Actor.pc1',
        name: 'Ilvara',
        hpLost: 12,
        hpGained: 0,
        slotsSpent: 2,
        slotsRegained: 0,
        resourcesSpent: 0,
        currency: { gp: -25 },
        xpGained: 0,
        itemsGained: {},
        itemsLost: { Rope: 1 },
      },
    ]);
  });

  it('adds the nets of every night into the campaign block', () => {
    const second = NIGHT + 14 * DAY;
    const stats = buildStats({
      worldId: 'w',
      logEvents: [
        ...events(),
        marker('p3', 'session-start', second, 'paper'),
        gmChange('g3', second + DAY, 'chg3', PAPER_SYNC_FEATURE),
      ],
      playRecords: [
        ...sync(),
        hp('h3', second + DAY, ILVARA, 18, 25, { source: { changeId: 'chg3' } }),
      ],
    });
    expect(stats.campaign.paperSessions).toBe(2);
    const ilvara = stats.campaign.paperNet?.characters.find(c => c.name === 'Ilvara');
    expect(ilvara).toMatchObject({ hpLost: 12, hpGained: 7, slotsSpent: 2 });
    expect(stats.campaign.paperNet?.records).toBe(7);
  });

  it('keeps two characters with the same name apart in the campaign block', () => {
    const twin: PlayActorRef = { uuid: 'Actor.pc9', isPC: true, name: 'Ilvara', playerOwned: true };
    const stats = buildStats({
      worldId: 'w',
      logEvents: events(),
      playRecords: [...sync(), hp('h9', syncAt, twin, 10, 4, { source: { changeId: 'chg1' } })],
    });
    expect(stats.campaign.paperNet?.characters.filter(c => c.name === 'Ilvara')).toHaveLength(2);
  });

  it('keeps a sync with no paper night out of the play numbers but in the campaign block', () => {
    const stats = buildStats({
      worldId: 'w',
      logEvents: [gmChange('g1', syncAt, 'chg1', PAPER_SYNC_FEATURE)],
      playRecords: [hp('h1', syncAt, ILVARA, 30, 18, { source: { changeId: 'chg1' } })],
    });
    expect(stats.sessions).toEqual([]);
    expect(stats.pcs).toEqual([]);
    expect(stats.campaign.paperNet?.characters[0]).toMatchObject({ name: 'Ilvara', hpLost: 12 });
  });

  it('leaves a live night, with the same kind of records from another feature, as it was', () => {
    const stats = buildStats({
      worldId: 'w',
      logEvents: [
        marker('l1', 'session-start', NIGHT),
        gmChange('g1', NIGHT + 1000, 'chg1', 'actor-changes'),
      ],
      playRecords: [hp('h1', NIGHT + 1000, ILVARA, 30, 18, { source: { changeId: 'chg1' } })],
    });
    expect(stats.sessions[0]).toMatchObject({ mode: 'live', paperNet: null, partyDamageTaken: 12 });
    expect(stats.campaign).toMatchObject({ paperSessions: 0, paperNet: null });
  });

  it('has a paper night with no sync yet: net is null', () => {
    const stats = buildStats({
      worldId: 'w',
      logEvents: [marker('p1', 'session-start', NIGHT, 'paper')],
      playRecords: [],
    });
    expect(stats.sessions[0]).toMatchObject({ mode: 'paper', paperNet: null });
  });
});

describe('rendering a paper night', () => {
  const syncAt = NIGHT + DAY;
  const logEvents = [
    marker('p1', 'session-start', NIGHT, 'paper'),
    gmChange('g1', syncAt, 'chg1', PAPER_SYNC_FEATURE),
  ];
  const playRecords = [hp('h1', syncAt, ILVARA, 30, 18, { source: { changeId: 'chg1' } })];

  it('the session note says paper, that dice are not tracked, and lists the net change', () => {
    const stats = buildStats({ worldId: 'w', logEvents, playRecords });
    const group = groupWithPlayRecords(logEvents, playRecords)[0];
    const note = renderSessionNote(
      'w',
      {
        events: [...group.events, ...group.paperSync.events],
        startedBy: group.startedBy,
        endedBy: group.endedBy,
      },
      stats.sessions[0]
    );
    expect(note).toContain('session_mode: "paper"');
    expect(note).toContain('Rolls are physical dice and not tracked');
    expect(note).toContain('### Paper night: net change');
    expect(note).toContain('- Ilvara: HP -12 / +0');
    expect(note).not.toContain('Highest roll');
  });

  it('the campaign note adds the paper block', () => {
    const stats = buildStats({ worldId: 'w', logEvents, playRecords });
    expect(renderCampaignStatsNote('w', stats)).toContain('## Paper nights: net change');
  });
});
