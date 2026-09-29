/**
 * Session grouping (docs/design/OBSIDIAN-PLAN.md O2 item 4, shared contract 3): the
 * renderer and `get-play-session` must agree on how markers and gaps split
 * the event log into play sessions. O3 (shared contract 5) extends this to
 * `groupWithPlayRecords`, grouping the union with the play log.
 */
import type { PlayRecord } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import {
  groupSessionEvents,
  groupWithPlayRecords,
  sessionLabel,
  SESSION_GAP_MS,
  type SessionEvent,
} from './grouping.js';

function ev(
  id: string,
  iso: string,
  eventType = 'note',
  details: Record<string, unknown> | null = null
): SessionEvent {
  return { id, timestamp: iso, eventType, actorName: null, description: id, details };
}

describe('groupSessionEvents', () => {
  it('opens an inferred group for the first event, closed as "open" at the end', () => {
    const groups = groupSessionEvents([
      ev('a', '2026-09-28T10:00:00Z'),
      ev('b', '2026-09-28T10:05:00Z'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ startedBy: 'gap', endedBy: 'open' });
    expect(groups[0]?.events.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('opens an explicit group at session-start and closes it at session-end', () => {
    const groups = groupSessionEvents([
      ev('start', '2026-09-28T18:00:00Z', 'session-start'),
      ev('mid', '2026-09-28T18:30:00Z'),
      ev('end', '2026-09-28T20:00:00Z', 'session-end'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ startedBy: 'marker', endedBy: 'marker' });
    expect(groups[0]?.events.map(e => e.id)).toEqual(['start', 'mid', 'end']);
  });

  it('splits on a gap over SESSION_GAP_MS and starts an inferred group', () => {
    const t0 = Date.parse('2026-09-28T10:00:00Z');
    const groups = groupSessionEvents([
      ev('a', new Date(t0).toISOString()),
      ev('b', new Date(t0 + SESSION_GAP_MS + 1000).toISOString()),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ startedBy: 'gap', endedBy: 'gap' });
    expect(groups[1]).toMatchObject({ startedBy: 'gap', endedBy: 'open' });
  });

  it('does not split within the 3-hour gap, including across midnight', () => {
    const groups = groupSessionEvents([
      ev('a', '2026-09-28T22:30:00Z'),
      ev('b', '2026-09-29T00:30:00Z'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.events.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('drops a session-end marker with no open group (listed in no group)', () => {
    const groups = groupSessionEvents([
      ev('stray-end', '2026-09-28T10:00:00Z', 'session-end'),
      ev('a', '2026-09-28T10:05:00Z'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.events.map(e => e.id)).toEqual(['a']);
  });

  it('closes a still-open group when a new session-start arrives without an end', () => {
    const groups = groupSessionEvents([
      ev('start1', '2026-09-28T10:00:00Z', 'session-start'),
      ev('a', '2026-09-28T10:05:00Z'),
      ev('start2', '2026-09-28T10:10:00Z', 'session-start'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.events.map(e => e.id)).toEqual(['start1', 'a']);
    expect(groups[0]?.endedBy).toBe('marker');
    expect(groups[1]?.events.map(e => e.id)).toEqual(['start2']);
    expect(groups[1]?.endedBy).toBe('open');
  });

  it('marks the previous group ended by the gap when a session-start follows a long quiet spell', () => {
    const groups = groupSessionEvents([
      ev('a', '2026-09-28T09:00:00Z'),
      ev('b', '2026-09-28T09:30:00Z'),
      ev('start', '2026-09-28T13:32:00Z', 'session-start'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ startedBy: 'gap', endedBy: 'gap' });
    expect(groups[1]).toMatchObject({ startedBy: 'marker', endedBy: 'open' });
  });

  it('sorts by timestampMs, falling back to timestamp, with ties broken by id', () => {
    const base = Date.parse('2026-09-28T10:00:00Z');
    const groups = groupSessionEvents([
      { id: 'z', timestamp: '2026-09-28T10:00:00Z', timestampMs: base },
      { id: 'a', timestamp: '2026-09-28T09:00:00Z', timestampMs: base },
      { id: 'm', timestamp: new Date(base + 60_000).toISOString() },
    ]);
    const all = groups.flatMap(g => g.events.map(e => e.id));
    expect(all).toEqual(['a', 'z', 'm']);
  });
});

function playRecord(key: string, t: number, kind: PlayRecord['kind'] = 'roll'): PlayRecord {
  return { v: 2, key, t, seq: 1, kind, userId: null, sceneId: null };
}

describe('groupWithPlayRecords', () => {
  it('leaves out an inferred group of ambient records only (world loaded before Start)', () => {
    const t0 = Date.parse('2026-09-28T14:37:22Z');
    const groups = groupWithPlayRecords(
      [ev('start', '2026-09-28T14:37:58Z', 'session-start')],
      [playRecord('scene:1', t0, 'scene'), playRecord('roll:1', t0 + 60_000)]
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ startedBy: 'marker' });
    expect(groups[0]?.playRecords.map(r => r.key)).toEqual(['roll:1']);
    // Not ambient-only once anything else happens in it.
    const kept = groupWithPlayRecords(
      [],
      [playRecord('scene:2', t0, 'scene'), playRecord('hp:1', t0 + 1000, 'hp')]
    );
    expect(kept).toHaveLength(1);
  });

  it('groups log events alone exactly like groupSessionEvents when there are no play records', () => {
    const events = [ev('a', '2026-09-28T10:00:00Z'), ev('b', '2026-09-28T10:05:00Z')];
    const plain = groupSessionEvents(events);
    const union = groupWithPlayRecords(events, []);
    expect(union).toHaveLength(plain.length);
    expect(union[0]?.events.map(e => e.id)).toEqual(plain[0]?.events.map(e => e.id));
    expect(union[0]?.playRecords).toEqual([]);
  });

  it('splits the log events and play records of a group back into their own arrays', () => {
    const t0 = Date.parse('2026-09-28T10:00:00Z');
    const events = [ev('a', new Date(t0).toISOString())];
    const records = [playRecord('r1', t0 + 1000), playRecord('r2', t0 + 2000)];
    const groups = groupWithPlayRecords(events, records);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.events.map(e => e.id)).toEqual(['a']);
    expect(groups[0]?.playRecords.map(r => r.key)).toEqual(['r1', 'r2']);
  });

  it('a play record can bridge what would otherwise be two separate log-only groups', () => {
    const t0 = Date.parse('2026-09-28T10:00:00Z');
    const events = [
      ev('a', new Date(t0).toISOString()),
      ev('b', new Date(t0 + SESSION_GAP_MS + 1000).toISOString()),
    ];
    // Without any play record, `a` and `b` would be more than SESSION_GAP_MS
    // apart and split into two groups (see the plain groupSessionEvents test
    // above); a play record in between keeps every gap under the limit.
    const bridge = playRecord('bridge', t0 + SESSION_GAP_MS / 2);
    const groups = groupWithPlayRecords(events, [bridge]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.events.map(e => e.id)).toEqual(['a', 'b']);
    expect(groups[0]?.playRecords.map(r => r.key)).toEqual(['bridge']);
  });

  it('groups play records alone into sessions when there are no log events at all', () => {
    const t0 = Date.parse('2026-09-28T10:00:00Z');
    const records = [playRecord('r1', t0), playRecord('r2', t0 + SESSION_GAP_MS + 1000)];
    const groups = groupWithPlayRecords([], records);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.events).toEqual([]);
    expect(groups[0]?.playRecords.map(r => r.key)).toEqual(['r1']);
    expect(groups[1]?.playRecords.map(r => r.key)).toEqual(['r2']);
  });
});

describe('sessionLabel', () => {
  it('pads to two digits below 100, and naturally widens from 100', () => {
    expect(sessionLabel(1)).toBe('01');
    expect(sessionLabel(9)).toBe('09');
    expect(sessionLabel(42)).toBe('42');
    expect(sessionLabel(100)).toBe('100');
    expect(sessionLabel(101)).toBe('101');
  });
});
