/**
 * Group a world's session-log events into play sessions (docs/design/OBSIDIAN-PLAN.md,
 * O2 item 4, shared contract 3). The renderer and the `get-play-session` tool
 * must agree on this: events are sorted by time, then walked once, opening and
 * closing groups on `session-start`/`session-end` markers (from
 * `mark-play-session`) or on a gap over {@link SESSION_GAP_MS} between events.
 *
 * O3 (shared contract 5) extends this to the play log: a play record counts as
 * an event at its own time `t`, with event type `play:<kind>`, purely for
 * session-boundary purposes, so a session's number and bounds are the same
 * whether the code is grouping session-log events alone or the union with play
 * records. {@link groupWithPlayRecords} runs the same {@link groupSessionEvents}
 * over that union and hands back each group's session-log events and play
 * records as two separate, still time-sorted arrays.
 */
import type { PlayRecord } from '@gnuminator/shared';

import { SESSION_GAP_MS } from '../event-pump.js';

export { SESSION_GAP_MS };

export interface SessionEvent {
  id?: string;
  timestamp?: string;
  timestampMs?: number;
  eventType?: string;
  actorName?: string | null;
  description?: string;
  details?: Record<string, unknown> | null;
}

export type StartedBy = 'marker' | 'gap';
export type EndedBy = 'marker' | 'gap' | 'open';

export interface SessionGroup {
  events: SessionEvent[];
  startedBy: StartedBy;
  endedBy: EndedBy;
}

/** The event's time in ms: `timestampMs` when finite, else `Date.parse(timestamp)`. */
export function eventTimeMs(event: SessionEvent): number {
  if (typeof event.timestampMs === 'number' && Number.isFinite(event.timestampMs)) {
    return event.timestampMs;
  }
  const parsed = Date.parse(event.timestamp ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareEvents(a: SessionEvent, b: SessionEvent): number {
  const byTime = eventTimeMs(a) - eventTimeMs(b);
  if (byTime !== 0) return byTime;
  return (a.id ?? '').localeCompare(b.id ?? '');
}

/**
 * Walk time-sorted events into groups (shared contract 3):
 * - `session-start` closes the current group (if any: `ended_by: marker`, or
 *   `gap` when the start comes more than {@link SESSION_GAP_MS} after its last
 *   event) and opens an explicit group.
 * - `session-end` closes an open group (`ended_by: marker`); with no group
 *   open the marker is dropped (listed in no group).
 * - any other event starts an inferred group (`started_by: gap`) when none is
 *   open or the gap since the group's last event exceeds
 *   {@link SESSION_GAP_MS}, closing the previous one (`ended_by: gap`) first.
 * - a group still open at the end is `ended_by: open`.
 */
export function groupSessionEvents(events: SessionEvent[]): SessionGroup[] {
  const sorted = [...events].sort(compareEvents);
  const groups: SessionGroup[] = [];
  let current: SessionGroup | null = null;

  for (const event of sorted) {
    if (event.eventType === 'session-start') {
      if (current) {
        // A start after a long quiet spell: the previous group had already ended by the gap.
        const prev = current.events[current.events.length - 1];
        const quiet = prev !== undefined && eventTimeMs(event) - eventTimeMs(prev) > SESSION_GAP_MS;
        current.endedBy = quiet ? 'gap' : 'marker';
        groups.push(current);
      }
      current = { events: [event], startedBy: 'marker', endedBy: 'open' };
      continue;
    }
    if (event.eventType === 'session-end') {
      if (current) {
        current.events.push(event);
        current.endedBy = 'marker';
        groups.push(current);
        current = null;
      }
      continue;
    }
    const last = current ? current.events[current.events.length - 1] : undefined;
    const gapExceeded =
      last !== undefined && eventTimeMs(event) - eventTimeMs(last) > SESSION_GAP_MS;
    if (!current || gapExceeded) {
      if (current) {
        current.endedBy = 'gap';
        groups.push(current);
      }
      current = { events: [], startedBy: 'gap', endedBy: 'open' };
    }
    current.events.push(event);
  }
  if (current) {
    current.endedBy = 'open';
    groups.push(current);
  }
  return groups;
}

/** "S01".."S99", then "S100", "S101"... (numbers are 1-based). */
export function sessionLabel(n: number): string {
  return String(n).padStart(2, '0');
}

/** A play session group over the union (shared contract 5): the session-log
 * events (for the note's own timeline) and the play records (for stats),
 * each still sorted oldest first. */
export interface UnionSessionGroup extends SessionGroup {
  playRecords: PlayRecord[];
}

function playRecordEventId(record: PlayRecord): string {
  return `play:${record.key}`;
}

/** A play record as a session-boundary marker only: `groupSessionEvents`
 * never sees the record itself, just enough to sort and gap-test it. */
function playRecordAsEvent(record: PlayRecord): SessionEvent {
  return {
    id: playRecordEventId(record),
    timestampMs: record.t,
    eventType: `play:${record.kind}`,
    actorName: record.actor?.name ?? null,
  };
}

/**
 * Play records that happen around a table without anyone playing: opening a
 * scene, users joining, placing tokens, the clock. A group made only of these
 * (e.g. the GM loading the world a minute before pressing Start) is not a
 * play session.
 */
const AMBIENT_KINDS: ReadonlySet<string> = new Set([
  'scene',
  'user-join',
  'user-leave',
  'token-move',
  'token-create',
  'token-delete',
  'actor-create',
  'actor-delete',
  'world-time',
]);

function isAmbientOnly(group: UnionSessionGroup): boolean {
  return (
    group.startedBy === 'gap' &&
    group.events.length === 0 &&
    group.playRecords.every(r => AMBIENT_KINDS.has(r.kind))
  );
}

/**
 * Group the union of session-log events and play records (shared contract 5),
 * then split each group's synthetic events back into the session-log events
 * and play records that produced them. Inferred groups with nothing but
 * ambient play records are left out (they get no session number).
 */
export function groupWithPlayRecords(
  logEvents: SessionEvent[],
  playRecords: PlayRecord[]
): UnionSessionGroup[] {
  const byEventId = new Map<string, PlayRecord>();
  for (const record of playRecords) byEventId.set(playRecordEventId(record), record);
  const union = [...logEvents, ...playRecords.map(playRecordAsEvent)];
  return groupSessionEvents(union)
    .map(group => {
      const events: SessionEvent[] = [];
      const records: PlayRecord[] = [];
      for (const event of group.events) {
        const record = event.id ? byEventId.get(event.id) : undefined;
        if (record) records.push(record);
        else events.push(event);
      }
      records.sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));
      return { events, playRecords: records, startedBy: group.startedBy, endedBy: group.endedBy };
    })
    .filter(group => !isAmbientOnly(group));
}
