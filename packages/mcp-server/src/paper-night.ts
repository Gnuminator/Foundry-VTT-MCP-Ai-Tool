/**
 * Paper nights (Design "Paper and Foundry nights", item C). Two facts the play log, the stats, the
 * recap and the pre-flight all need, kept in one place:
 *
 * - A paper session is a session whose start marker (`mark-play-session` with `mode: "paper"`)
 *   says so in `details.mode`.
 * - A paper sync is a guarded change made under the feature {@link PAPER_SYNC_FEATURE}
 *   (`plan-paper-sync`). The module logs a `gm-change` session event with `details.changeId` and
 *   `details.feature` for every apply and undo, and the play records that write produced carry the
 *   same `source.changeId`. The sync copies the paper sheet into Foundry, so it is not play: stats
 *   keep it out of the play numbers and show it as a net change instead.
 */
import type { PlayRecord } from '@gnuminator/shared';

import { localDateKey } from './event-pump.js';

/** The guarded feature name `plan-paper-sync` registers; the stats recognise a sync by it. */
export const PAPER_SYNC_FEATURE = 'paper-sync';

export type SessionMode = 'live' | 'paper';

/** The part of a session-log event these helpers read (grouping's `SessionEvent` fits). */
export interface PaperEventLike {
  eventType?: string;
  details?: Record<string, unknown> | null;
}

/** A `session-start` marker written with `mode: "paper"`. */
export function isPaperStartMarker(event: PaperEventLike): boolean {
  return event.eventType === 'session-start' && event.details?.mode === 'paper';
}

/** A `gm-change` event of a paper sync (an apply or an undo). */
export function isPaperSyncEvent(event: PaperEventLike): boolean {
  return event.eventType === 'gm-change' && event.details?.feature === PAPER_SYNC_FEATURE;
}

/** The change ids of every paper sync apply and undo in the session log. */
export function paperSyncChangeIds(events: readonly PaperEventLike[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    const id = event.details?.changeId;
    if (isPaperSyncEvent(event) && typeof id === 'string') ids.add(id);
  }
  return ids;
}

/**
 * Which paper night a sync at `timeMs` belongs to, as an index into `starts` (the nights' start
 * times in ms), or -1. A night on the sync's own local date that starts after it, because a night
 * is often marked after the fact (a marker made "now" or at the default noon can land after a sync
 * run earlier the same day); otherwise the newest night that started before the sync.
 *
 * A sync that fails halfway logs no `gm-change` event (the module logs it after every op
 * succeeded), so its records are not recognised here and count as play; `plan-paper-sync` should
 * keep that case rare.
 */
export function nightForSync(starts: readonly number[], timeMs: number): number {
  const day = localDateKey(timeMs);
  let found = -1;
  starts.forEach((start, i) => {
    const sameDayLater = start > timeMs && localDateKey(start) === day;
    if (sameDayLater && (found < 0 || start < starts[found])) found = i;
  });
  if (found >= 0) return found;
  starts.forEach((start, i) => {
    if (start <= timeMs && (found < 0 || start >= starts[found])) found = i;
  });
  return found;
}

/** A play record a paper sync wrote. */
export function isPaperSyncRecord(record: PlayRecord, changeIds: ReadonlySet<string>): boolean {
  const id = record.source?.changeId;
  return typeof id === 'string' && changeIds.has(id);
}
