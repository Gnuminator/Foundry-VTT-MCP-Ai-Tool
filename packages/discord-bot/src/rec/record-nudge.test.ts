import { describe, expect, it } from 'vitest';

import { NO_RECORDING_MS, OVERRUN_MS, RecordNudge } from './record-nudge.js';

const T = 1_700_000_000_000;
const open = { open: true, endedAt: null };
const iso = (ms: number): string => new Date(ms).toISOString();

describe('RecordNudge: session open, no recording', () => {
  it('says nothing before 5 minutes, then once, with a problem on the health line', () => {
    const n = new RecordNudge();
    expect(n.check(open, false, T)).toEqual([]);
    expect(n.check(open, false, T + NO_RECORDING_MS - 1)).toEqual([]);
    expect(n.problems(T + NO_RECORDING_MS - 1, false)).toEqual([]);
    const first = n.check(open, false, T + NO_RECORDING_MS);
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('/record start');
    expect(n.check(open, false, T + NO_RECORDING_MS + 60_000)).toEqual([]);
    expect(n.problems(T + NO_RECORDING_MS + 60_000, false)[0]?.kind).toBe('norecord');
  });

  it('clears when a recording starts and arms again for the next gap', () => {
    const n = new RecordNudge();
    n.check(open, false, T);
    n.check(open, false, T + NO_RECORDING_MS);
    n.check(open, true, T + NO_RECORDING_MS + 1000);
    expect(n.problems(T + NO_RECORDING_MS + 1000, true)).toEqual([]);
    n.check(open, false, T + 20 * 60_000);
    expect(n.check(open, false, T + 20 * 60_000 + NO_RECORDING_MS)).toHaveLength(1);
  });

  it('ignores an unreadable dashboard and a closed session', () => {
    const n = new RecordNudge();
    n.check(open, false, T);
    expect(n.check(null, false, T + NO_RECORDING_MS)).toEqual([]);
    expect(n.check({ open: false, endedAt: null }, false, T + NO_RECORDING_MS)).toEqual([]);
    expect(n.problems(T + NO_RECORDING_MS, false)).toEqual([]);
  });
});

describe('RecordNudge: recording after the session ended', () => {
  const ended = (at: number): { open: boolean; endedAt: string } => ({
    open: false,
    endedAt: iso(at),
  });

  it('speaks once 30 minutes after the end, with a problem while it lasts', () => {
    const n = new RecordNudge();
    const e = ended(T);
    expect(n.check(e, true, T + OVERRUN_MS - 1)).toEqual([]);
    const first = n.check(e, true, T + OVERRUN_MS);
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('/record stop');
    expect(n.check(e, true, T + OVERRUN_MS + 60_000)).toEqual([]);
    expect(n.problems(T + OVERRUN_MS + 60_000, true)[0]?.kind).toBe('overrun');
  });

  it('is quiet when the recording stops, and speaks again for a later session end', () => {
    const n = new RecordNudge();
    n.check(ended(T), true, T + OVERRUN_MS);
    n.check(ended(T), false, T + OVERRUN_MS + 1000);
    expect(n.problems(T + OVERRUN_MS + 1000, false)).toEqual([]);
    const later = T + 5 * 3_600_000;
    expect(n.check(ended(later), true, later + OVERRUN_MS)).toHaveLength(1);
  });

  it('says nothing while the session is still open', () => {
    const n = new RecordNudge();
    expect(n.check(open, true, T + 10 * OVERRUN_MS)).toEqual([]);
  });
});
