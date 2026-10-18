import { describe, expect, it } from 'vitest';

import {
  hoursMinutes,
  plural,
  statsForDiscord,
  summarizeSession,
  times,
  type PlayStats,
} from './afterStats';

const STATS: PlayStats = {
  pcs: [{ name: 'Ireena' }, { name: 'Ismark' }],
  session: {
    label: 'Session 3',
    durationMin: 185,
    endedAt: '2026-10-18T22:30:00.000Z',
    rolls: 142,
    crits: 3,
    fumbles: 1,
    highestRoll: { total: 27, name: 'Ireena', label: 'Perception' },
    combats: [
      { damageDealt: { Ireena: 20, Ismark: 8, Wolf: 99 }, downs: ['Ismark'] },
      { damageDealt: { Ireena: 15 }, downs: [] },
    ],
  },
};

describe('summarizeSession', () => {
  it('is null without a session', () => {
    expect(summarizeSession(null)).toBeNull();
    expect(summarizeSession({ session: null })).toBeNull();
  });

  it('sums a hero’s damage over the fights and ignores monsters', () => {
    const s = summarizeSession(STATS);
    expect(s?.mostDamage).toEqual({ name: 'Ireena', amount: 35, fights: 2 });
    expect(s?.fights).toBe(2);
    expect(s).toMatchObject({ rolls: 142, nat20: 3, nat1: 1, durationMin: 185 });
  });

  it('counts downs per fight on an older bridge, and uses pcDownsByName when it has it', () => {
    expect(summarizeSession(STATS)?.downs).toEqual([['Ismark', 1]]);
    const withMap = {
      ...STATS,
      session: { ...STATS.session, pcDownsByName: { Ireena: 2, Ismark: 0 } },
    };
    expect(summarizeSession(withMap)?.downs).toEqual([['Ireena', 2]]);
  });

  it('has no most damage when no hero dealt any', () => {
    const none = { ...STATS, session: { ...STATS.session, combats: [] } };
    expect(summarizeSession(none)).toMatchObject({ mostDamage: null, fights: 0, downs: [] });
  });
});

describe('statsForDiscord', () => {
  it('leaves out the highest roll, which may have been private', () => {
    const text = statsForDiscord(summarizeSession(STATS)!);
    expect(text).toBe(
      [
        '**Session 3** (3 h 5 min)',
        'Rolls: 142 (3 natural 20s, 1 natural 1)',
        'Most damage: Ireena, 35 hp over 2 fights',
        'Went down: Ismark once',
      ].join('\n')
    );
    expect(text).not.toContain('27');
    expect(text).not.toContain('Perception');
  });

  it('says nobody went down', () => {
    const quiet = { ...STATS, session: { ...STATS.session, combats: [] } };
    expect(statsForDiscord(summarizeSession(quiet)!)).toContain('Went down: nobody');
  });
});

describe('words', () => {
  it('words counts', () => {
    expect([1, 2, 3].map(times)).toEqual(['once', 'twice', '3 times']);
    expect(plural(1, 'fight', 'fights')).toBe('1 fight');
    expect(plural(0, 'fight', 'fights')).toBe('0 fights');
    expect(hoursMinutes(45)).toBe('45 min');
    expect(hoursMinutes(60)).toBe('1 h 0 min');
  });
});
