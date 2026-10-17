import { describe, expect, it } from 'vitest';

import { sessionLabel } from './sessionLabel';

const closed = { open: false, startedAt: null, endedAt: null };

describe('sessionLabel', () => {
  it('waits, then says unknown when the first read failed', () => {
    expect(sessionLabel(undefined, false)).toBe('Session: …');
    expect(sessionLabel(undefined, true)).toBe('Session: unknown');
  });

  it('keeps the last answer when a later read failed', () => {
    expect(sessionLabel(closed, true)).toBe('No session');
  });

  it('says no session when none is open', () => {
    expect(sessionLabel(closed, false)).toBe('No session');
  });

  it('gives the start time of an open session, or just active when it is unknown', () => {
    expect(sessionLabel({ open: true, startedAt: null, endedAt: null }, false)).toBe(
      'Session active'
    );
    // A local 19:30, so the answer does not depend on the machine's time zone.
    const startedAt = new Date(2026, 9, 8, 19, 30).toISOString();
    expect(sessionLabel({ open: true, startedAt, endedAt: null }, false, 'en-GB')).toBe(
      'Session since 19:30'
    );
  });

  it('does not show a time it cannot read', () => {
    expect(sessionLabel({ open: true, startedAt: 'not a time', endedAt: null }, false)).toBe(
      'Session active'
    );
  });
});
