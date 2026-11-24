import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HINT_AFTER,
  buildSpotlight,
  readHintAfter,
  readSpotlight,
  speakingText,
  spotlightHint,
  spotlightScope,
  type SpotlightRow,
} from './spotlight';

describe('buildSpotlight', () => {
  it('gives a silent character a row and scales bars to the busiest', () => {
    const rows = buildSpotlight(
      {
        players: [
          { name: 'Ebbe', actions: 10 },
          { name: 'Mira', actions: 5 },
        ],
      },
      ['Ebbe', 'Mira', 'Tor'],
      []
    );
    expect(rows.map(r => [r.name, r.actions, r.actionsBar])).toEqual([
      ['Ebbe', 10, 1],
      ['Mira', 5, 0.5],
      ['Tor', 0, 0],
    ]);
    expect(rows.every(r => r.speakingMs === null)).toBe(true);
  });

  it('puts a log name and a roster name that differ on one row', () => {
    const rows = buildSpotlight(
      { players: [{ name: 'Ebbe', actions: 4 }] },
      ['Ebbe Stonefist', 'Mira'],
      []
    );
    expect(rows.map(r => [r.name, r.actions])).toEqual([
      ['Ebbe Stonefist', 4],
      ['Mira', 0],
    ]);
  });

  it('matches on actor id, so a first-word match never folds another character in', () => {
    const rows = buildSpotlight(
      {
        players: [
          { name: 'Ebbe', actions: 4, actorId: 'a2' },
          { name: 'Ebbe', actions: 3, actorId: 'a1' },
        ],
      },
      [
        { name: 'Ebbe Stonefist', actorId: 'a1' },
        { name: 'Ebbe Twin', actorId: 'a2' },
      ],
      []
    );
    expect(rows.map(r => [r.name, r.actions])).toEqual([
      ['Ebbe Twin', 4],
      ['Ebbe Stonefist', 3],
    ]);
  });

  it('folds a transformed actor with a new id into its character by name', () => {
    const rows = buildSpotlight(
      { players: [{ name: 'Ebbe Stonefist (Brown Bear)', actions: 2, actorId: 'zz' }] },
      [{ name: 'Ebbe Stonefist', actorId: 'a1' }],
      []
    );
    expect(rows.map(r => [r.name, r.actions])).toEqual([['Ebbe Stonefist', 2]]);
  });

  it('matches speakers by name or first word and leaves the GM out', () => {
    const rows = buildSpotlight(
      { players: [{ name: 'Ebbe Stonefist', actions: 2 }] },
      ['Ebbe Stonefist', 'Mira'],
      [
        { name: 'ebbe', ms: 60_000 },
        { name: 'Mira', ms: 30_000 },
        { name: 'Danni', ms: 600_000 },
      ]
    );
    expect(rows.find(r => r.name === 'Ebbe Stonefist')?.speakingMs).toBe(60_000);
    expect(rows.find(r => r.name === 'Mira')?.speakingBar).toBe(0.5);
    expect(rows.some(r => r.name === 'Danni')).toBe(false);
  });
});

describe('spotlightHint', () => {
  const rows = (...n: number[]): SpotlightRow[] =>
    buildSpotlight({ players: n.map((actions, i) => ({ name: `P${i}`, actions })) }, [], []);

  it('stays quiet under the threshold', () => {
    expect(spotlightHint(rows(10, 0), 20)).toBeNull();
  });
  it('names a quiet character after the threshold', () => {
    expect(spotlightHint(rows(15, 10, 1), 20)).toContain('P2 has had little spotlight');
  });
  it('is off at 0 and quiet when balanced', () => {
    expect(spotlightHint(rows(30, 0), 0)).toBeNull();
    expect(spotlightHint(rows(10, 9, 8), 20)).toBeNull();
  });
});

describe('helpers', () => {
  it('reads payloads and settings defensively', () => {
    expect(readSpotlight(null).players).toEqual([]);
    expect(spotlightScope(true)).toContain('this session');
    expect(spotlightScope(false)).toContain('since the dashboard started');
    expect(readSpotlight({ players: [], session: true }).session).toBe(true);
    expect(readSpotlight({ players: [{ name: 'A', actions: 2 }, { x: 1 }] }).players).toHaveLength(
      1
    );
    expect(readHintAfter(null)).toBe(DEFAULT_HINT_AFTER);
    expect(readHintAfter('abc')).toBe(DEFAULT_HINT_AFTER);
    expect(readHintAfter('')).toBe(DEFAULT_HINT_AFTER);
    expect(readHintAfter('0')).toBe(0);
    expect(readHintAfter('12')).toBe(12);
  });
  it('writes speaking time in plain units', () => {
    expect(speakingText(40_000)).toBe('40 s');
    expect(speakingText(7 * 60_000)).toBe('7 min');
    expect(speakingText(65 * 60_000)).toBe('1 h 5 min');
  });
});
