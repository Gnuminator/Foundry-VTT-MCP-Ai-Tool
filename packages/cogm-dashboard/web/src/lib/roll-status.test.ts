import { describe, expect, it } from 'vitest';

import {
  NUDGE_AFTER_MS,
  latestRound,
  nudgeLine,
  nudgeTargets,
  readRollRows,
  resultsLine,
  roundHeadline,
  rowLine,
  type RollRow,
} from './roll-status';

const row = (over: Partial<RollRow>): RollRow => ({
  id: 'r',
  sentAt: 1_000_000,
  label: 'Perception Skill Check (Private)',
  isPublic: false,
  targetName: 'Tom',
  actorId: 'a',
  userId: 'u',
  status: 'sent',
  ...over,
});

describe('readRollRows', () => {
  it('keeps well formed rows and drops the rest', () => {
    const rows = readRollRows([
      { id: 'a', sentAt: 1, label: 'x', targetName: 'Tom', status: 'rolled', total: 9 },
      { id: 'b' },
      null,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'rolled', total: 9 });
    expect(readRollRows('nope')).toEqual([]);
  });
});

describe('latestRound', () => {
  const now = 1_010_000;

  it('groups the requests sent together and counts who is still waiting', () => {
    const rows = [
      row({ id: '4', targetName: 'Ilvara', sentAt: 1_000_300 }),
      row({ id: '3', targetName: 'Brenna', sentAt: 1_000_200, status: 'rolled', total: 17 }),
      row({ id: '2', targetName: 'Tom', sentAt: 1_000_100 }),
      row({ id: '1', targetName: 'Old', sentAt: 500_000, label: 'Stealth' }),
    ];
    const round = latestRound(rows, now);
    expect(round?.rows.map(r => r.targetName)).toEqual(['Tom', 'Brenna', 'Ilvara']);
    expect(roundHeadline(round!)).toBe('Perception Skill Check: waiting for 2 of 3');
    expect(round?.rows.map(rowLine)).toEqual([
      'Tom: waiting',
      'Brenna rolled 17',
      'Ilvara: waiting',
    ]);
  });

  it('says so when everyone has rolled', () => {
    const rows = [
      row({ id: '2', targetName: 'B', status: 'rolled', total: 3 }),
      row({ id: '1', targetName: 'A', status: 'rolled' }),
    ];
    expect(roundHeadline(latestRound(rows, now)!)).toBe('Perception Skill Check: all 2 rolled');
  });

  it('gives the ask an id and a start time, offers a nudge after five minutes', () => {
    const rows = [
      row({ id: '2', targetName: 'Brenna', sentAt: now, status: 'rolled', total: 17 }),
      row({ id: '1', targetName: 'Tom', sentAt: now - 1000 }),
    ];
    const round = latestRound(rows, now)!;
    expect(round.id).toBe('1');
    expect(round.sentAt).toBe(now - 1000);
    expect(nudgeTargets(round, now + 60_000)).toEqual([]);
    const late = nudgeTargets(round, now + NUDGE_AFTER_MS);
    expect(late.map(r => r.targetName)).toEqual(['Tom']);
    expect(nudgeLine(round, late)).toBe('Still waiting for Tom: Perception Skill Check.');
  });

  it('writes the results line, also for a single member', () => {
    const round = latestRound(
      [
        row({ id: '2', targetName: 'B', status: 'rolled', total: 3 }),
        row({ id: '1', targetName: 'A', status: 'rolled' }),
      ],
      now
    )!;
    expect(resultsLine(round)).toBe('Perception Skill Check: A rolled, B 3.');
    expect(resultsLine(latestRound([row({ status: 'rolled', total: 9 })], now)!)).toBe(
      'Perception Skill Check: Tom 9.'
    );
  });

  it('shows nothing without requests or after two hours', () => {
    expect(latestRound([], now)).toBeNull();
    expect(latestRound([row({})], 1_000_000 + 3 * 60 * 60 * 1000)).toBeNull();
  });
});
