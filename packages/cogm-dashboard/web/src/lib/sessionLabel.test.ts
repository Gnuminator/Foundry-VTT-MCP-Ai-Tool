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
    expect(
      sessionLabel(
        { open: true, startedAt: '2026-10-08T19:30:00.000Z', endedAt: null },
        false,
        'en-GB'
      )
    ).toMatch(/^Session since \d{2}:\d{2}$/);
  });

  it('does not show a time it cannot read', () => {
    expect(sessionLabel({ open: true, startedAt: 'not a time', endedAt: null }, false)).toBe(
      'Session active'
    );
  });
});
