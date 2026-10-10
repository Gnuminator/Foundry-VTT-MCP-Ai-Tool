// The Live Feed's rules (D-092), as plain data and functions: reading the stream's `events` off
// the wire, merging a batch into the log (unseen ids only, newest first, capped), the line a GM
// reads for an event, the pane's count, which face the pane shows and what a screen reader is
// told. No React here, so the rules have unit tests; components/LiveFeed.tsx does the rest.
//
// Differences from the old page, on purpose: events are ordered by their time rather than by
// when they arrived (a replay after a reconnect cannot put old events on top), "1 event" is
// singular, the class an event gets is made safe, a feed shown while the bridge is away says so,
// and a screen reader hears new events (the old list was silent).

/** One session event as the live feed shows it: what to print and what sorts it. */
export interface FeedEvent {
  id: string;
  timestampMs: number;
  /** damage, healing, roll, gm-roll, gm-change, ...: the module's own name for the kind. */
  eventType: string;
  /** The line the GM reads: a roll's full breakdown when there is one, else the description. */
  text: string;
}

/** The events this page has seen. */
export interface FeedLog {
  /** Newest first, at most MAX_FEED_ENTRIES. */
  entries: readonly FeedEvent[];
  /** Every event added since the page loaded, also the ones the cap pushed out. */
  total: number;
  /** The ids already added (the newest MAX_SEEN_IDS of them), so a replay adds nothing twice. */
  seen: ReadonlySet<string>;
}

/** The old page keeps 120 entries on screen; the server keeps the newest 80 (COGM_MAX_EVENTS). */
export const MAX_FEED_ENTRIES = 120;

/** How many added ids are remembered; far more than the server ever replays. */
export const MAX_SEEN_IDS = 1000;

export const EMPTY_FEED: FeedLog = { entries: [], total: 0, seen: new Set() };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The line for an event: a roll's full breakdown for the GM, else the event's description. */
function lineOf(description: string, details: unknown): string {
  const breakdown = isRecord(details) ? details['breakdown'] : undefined;
  return typeof breakdown === 'string' && breakdown ? breakdown : description;
}

/** One event off the wire (feed/types.ts SessionEvent), or null when it cannot be shown. */
export function readFeedEvent(v: unknown): FeedEvent | null {
  if (!isRecord(v)) return null;
  const id = v['id'];
  const ms = v['timestampMs'];
  const type = v['eventType'];
  if (typeof id !== 'string' || id === '') return null;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || Number.isNaN(new Date(ms).getTime())) {
    return null;
  }
  if (typeof type !== 'string') return null;
  const description = typeof v['description'] === 'string' ? v['description'] : '';
  return { id, timestampMs: ms, eventType: type, text: lineOf(description, v['details']) || type };
}

/** The events of a stream message (`events` array), in the order sent; unreadable ones dropped. */
export function readFeedEvents(v: unknown): FeedEvent[] {
  if (!Array.isArray(v)) return [];
  const events: FeedEvent[] = [];
  for (const raw of v) {
    const ev = readFeedEvent(raw);
    if (ev) events.push(ev);
  }
  return events;
}

/**
 * Adds a batch (oldest first, as the server sends it) to the log: events with a new id only,
 * newest first by time, an event that arrived later above one with the same time, capped. The
 * count goes up by what was new. The same log comes back when nothing was.
 */
export function addFeedEvents(log: FeedLog, batch: readonly FeedEvent[]): FeedLog {
  const seen = new Set(log.seen);
  const fresh: FeedEvent[] = [];
  for (const ev of batch) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    fresh.push(ev);
  }
  if (fresh.length === 0) return log;
  // Sets keep insertion order: the oldest ids go first.
  for (const id of seen) {
    if (seen.size <= MAX_SEEN_IDS) break;
    seen.delete(id);
  }
  // Array.prototype.sort is stable: of two events with the same time, the one listed first stays
  // first, and that is the one that arrived last.
  const entries = [...fresh.reverse(), ...log.entries]
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, MAX_FEED_ENTRIES);
  return { entries, total: log.total + fresh.length, seen };
}

/** The pane's count: every event since the page loaded. */
export function feedMeta(total: number): string {
  return `${total} ${total === 1 ? 'event' : 'events'}`;
}

/**
 * The class that colours an event's rail and type chip (styles.css `.event.sev-damage`, ...). The
 * kind comes from the module; only letters, digits and dashes are kept, so it cannot break out of
 * the attribute.
 */
export function severityClass(eventType: string): string {
  const safe = eventType.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `sev-${safe || 'other'}`;
}

/** The time an event shows: the browser's own time format, as the old page did. */
export function eventTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString();
}

/** The event's time in the machine format of a <time> element. */
export function eventIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

// --- What the pane shows ----------------------------------------------------------------------

export const FEED_AWAY_TEXT = 'The bridge is away: new events will show here when it is back.';

/** What each face says instead of the list. */
export const FEED_LOADING_TEXT = 'Loading events…';
export const FEED_EMPTY_TEXT = 'Waiting for events…';
export const FEED_AWAY_EMPTY_TEXT =
  'The bridge is away, so no events are coming in. They will show here when it is back.';

export type FeedFace = 'loading' | 'empty' | 'bridge-down' | 'ready';

/**
 * Which face the pane shows. Events on screen always win (and the pane then marks the bridge
 * being away above the list); with none, an away bridge is the news, else the stream has not
 * answered yet (loading) or has and had nothing (empty).
 */
export function feedFace(log: FeedLog | null, away: boolean): FeedFace {
  if (log && log.entries.length > 0) return 'ready';
  if (away) return 'bridge-down';
  return log ? 'empty' : 'loading';
}

// --- What a screen reader hears ---------------------------------------------------------------

/** The entries that `next` has and `prev` had not seen: nothing for the first log the page gets. */
export function freshEntries(prev: FeedLog | null, next: FeedLog | null): FeedEvent[] {
  if (!prev || !next) return [];
  return next.entries.filter(e => !prev.seen.has(e.id));
}

/**
 * One short message for the events that arrived together (newest first): the line itself for one,
 * a count and the newest line for several, so a burst of hits is one announcement and not twenty.
 */
export function announcement(fresh: readonly FeedEvent[]): string {
  const [newest] = fresh;
  if (!newest) return '';
  return fresh.length === 1 ? newest.text : `${fresh.length} new events. Latest: ${newest.text}`;
}
