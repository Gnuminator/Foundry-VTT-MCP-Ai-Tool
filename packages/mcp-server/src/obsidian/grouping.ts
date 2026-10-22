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
import {
  isPaperStartMarker,
  isPaperSyncEvent,
  isPaperSyncRecord,
  paperSyncChangeIds,
} from '../paper-night.js';

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
  /** Started with `mark-play-session` `mode: "paper"` (sheets and dice on paper). */
  paper: boolean;
  /**
   * What the paper syncs after this night wrote (`paper-night.ts`): never boundaries of a session
   * and never in `events` or `playRecords`, so a sync a day later is not a session of its own.
   * Empty unless the group is a paper night.
   */
  paperSync: PaperSyncShare;
}

export interface PaperSyncShare {
  events: SessionEvent[];
  records: PlayRecord[];
}

/** Paper-sync events and records split off the logs (`paper-night.ts`). */
export interface PaperSyncSplit {
  logEvents: SessionEvent[];
  playRecords: PlayRecord[];
  syncEvents: SessionEvent[];
  syncRecords: PlayRecord[];
}

/** Take the paper syncs out of the logs: they are not play, so they open no session. */
export function splitPaperSync(
  logEvents: SessionEvent[],
  playRecords: PlayRecord[]
): PaperSyncSplit {
  const ids = paperSyncChangeIds(logEvents);
  if (ids.size === 0) return { logEvents, playRecords, syncEvents: [], syncRecords: [] };
  const split: PaperSyncSplit = { logEvents: [], playRecords: [], syncEvents: [], syncRecords: [] };
  for (const event of logEvents) {
    const id = event.details?.changeId;
    const sync = isPaperSyncEvent(event) && typeof id === 'string' && ids.has(id);
    (sync ? split.syncEvents : split.logEvents).push(event);
  }
  for (const record of playRecords) {
    (isPaperSyncRecord(record, ids) ? split.syncRecords : split.playRecords).push(record);
  }
  return split;
}

/** A group started by a paper start marker. */
export function isPaperGroup(group: SessionGroup): boolean {
  return group.startedBy === 'marker' && group.events.some(isPaperStartMarker);
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
  const split = splitPaperSync(logEvents, playRecords);
  const byEventId = new Map<string, PlayRecord>();
  for (const record of split.playRecords) byEventId.set(playRecordEventId(record), record);
  const union = [...split.logEvents, ...split.playRecords.map(playRecordAsEvent)];
  const groups = groupSessionEvents(union)
    .map((group): UnionSessionGroup => {
      const events: SessionEvent[] = [];
      const records: PlayRecord[] = [];
      for (const event of group.events) {
        const record = event.id ? byEventId.get(event.id) : undefined;
        if (record) records.push(record);
        else events.push(event);
      }
      records.sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));
      return {
        events,
        playRecords: records,
        startedBy: group.startedBy,
        endedBy: group.endedBy,
        paper: isPaperGroup(group),
        paperSync: { events: [], records: [] },
      };
    })
    .filter(group => !isAmbientOnly(group));

  // A sync belongs to the newest paper night that started before it.
  const nights = groups
    .filter(group => group.paper)
    .map(group => ({ group, startMs: groupStartMs(group) }))
    .sort((a, b) => a.startMs - b.startMs);
  const nightFor = (timeMs: number): UnionSessionGroup | null => {
    let found: UnionSessionGroup | null = null;
    for (const night of nights) if (night.startMs <= timeMs) found = night.group;
    return found;
  };
  for (const event of split.syncEvents) {
    nightFor(eventTimeMs(event))?.paperSync.events.push(event);
  }
  for (const record of split.syncRecords) nightFor(record.t)?.paperSync.records.push(record);
  return groups;
}

function groupStartMs(group: UnionSessionGroup): number {
  let min = Infinity;
  for (const event of group.events) min = Math.min(min, eventTimeMs(event));
  for (const record of group.playRecords) min = Math.min(min, record.t);
  return Number.isFinite(min) ? min : 0;
}

/**
 * The paper-sync records no paper night claims (a sync with no paper marker before it). Stats
 * still keep them out of the play numbers and add them to the campaign net change.
 */
export function unclaimedPaperSync(
  groups: readonly UnionSessionGroup[],
  split: Pick<PaperSyncSplit, 'syncRecords'>
): PlayRecord[] {
  const claimed = new Set<string>();
  for (const group of groups) for (const record of group.paperSync.records) claimed.add(record.key);
  return split.syncRecords.filter(record => !claimed.has(record.key));
}
