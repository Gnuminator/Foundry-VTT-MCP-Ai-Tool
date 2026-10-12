// The Live Feed's rules: reading events off the stream, merging a batch (dedupe, order, cap),
// the count, the class, the pane's face and what a screen reader hears. Pure functions, no DOM.
import { describe, expect, it } from 'vitest';

import {
  EMPTY_FEED,
  MAX_FEED_ENTRIES,
  MAX_SEEN_IDS,
  addFeedEvents,
  announcement,
  eventIso,
  eventTime,
  feedFace,
  feedMeta,
  freshEntries,
  readFeedEvent,
  readFeedEvents,
  severityClass,
  type FeedEvent,
  type FeedLog,
} from './feed';

const ev = (id: string, ms: number, over: Partial<FeedEvent> = {}): FeedEvent => ({
  id,
  timestampMs: ms,
  eventType: 'damage',
  text: `Event ${id}`,
  ...over,
});

const ids = (log: FeedLog): string[] => log.entries.map(e => e.id);

describe('readFeedEvent', () => {
  const raw = {
    id: 'e1',
    timestamp: '2026-10-10T20:00:00.000Z',
    timestampMs: 1_000,
    eventType: 'damage',
    actorName: 'Goblin',
    actorId: 'a1',
    description: 'Goblin takes 7 slashing damage',
    details: {},
  };

  it('reads the fields the feed shows', () => {
    expect(readFeedEvent(raw)).toEqual({
      id: 'e1',
      timestampMs: 1_000,
      eventType: 'damage',
      text: 'Goblin takes 7 slashing damage',
    });
  });

  it('shows a roll breakdown to the GM instead of the description', () => {
    const roll = {
      ...raw,
      eventType: 'roll',
      description: 'Brannoc attacks',
      details: { breakdown: 'Brannoc attacks the Ogre: 17 vs AC 14, hit' },
    };
    expect(readFeedEvent(roll)?.text).toBe('Brannoc attacks the Ogre: 17 vs AC 14, hit');
  });

  it('ignores a breakdown that is empty or not text', () => {
    expect(readFeedEvent({ ...raw, details: { breakdown: '' } })?.text).toBe(raw.description);
    expect(readFeedEvent({ ...raw, details: { breakdown: 5 } })?.text).toBe(raw.description);
    expect(readFeedEvent({ ...raw, details: null })?.text).toBe(raw.description);
  });

  it('falls back to the kind when there is no text at all', () => {
    expect(readFeedEvent({ ...raw, description: '' })?.text).toBe('damage');
    expect(readFeedEvent({ ...raw, description: undefined })?.text).toBe('damage');
  });

  it('refuses what cannot be shown', () => {
    expect(readFeedEvent(null)).toBeNull();
    expect(readFeedEvent('x')).toBeNull();
    expect(readFeedEvent([])).toBeNull();
    expect(readFeedEvent({ ...raw, id: '' })).toBeNull();
    expect(readFeedEvent({ ...raw, id: 4 })).toBeNull();
    expect(readFeedEvent({ ...raw, timestampMs: 'now' })).toBeNull();
    expect(readFeedEvent({ ...raw, timestampMs: Number.NaN })).toBeNull();
    // A time Date cannot hold would throw in <time dateTime>.
    expect(readFeedEvent({ ...raw, timestampMs: 9e15 })).toBeNull();
    expect(readFeedEvent({ ...raw, eventType: undefined })).toBeNull();
  });
});

describe('readFeedEvents', () => {
  it('keeps the order and drops the unreadable ones', () => {
    const good = (id: string): unknown => ({
      id,
      timestampMs: 1,
      eventType: 'roll',
      description: id,
    });
    expect(readFeedEvents([good('a'), 7, good('b'), { id: 'c' }]).map(e => e.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('reads anything but a list as no events', () => {
    expect(readFeedEvents(undefined)).toEqual([]);
    expect(readFeedEvents({})).toEqual([]);
    expect(readFeedEvents('x')).toEqual([]);
  });
});

describe('addFeedEvents', () => {
  it('lists the newest first', () => {
    const log = addFeedEvents(EMPTY_FEED, [ev('a', 1), ev('b', 2), ev('c', 3)]);
    expect(ids(log)).toEqual(['c', 'b', 'a']);
    expect(log.total).toBe(3);
  });

  it('puts a later batch above the earlier ones', () => {
    const first = addFeedEvents(EMPTY_FEED, [ev('a', 1), ev('b', 2)]);
    const second = addFeedEvents(first, [ev('c', 3)]);
    expect(ids(second)).toEqual(['c', 'b', 'a']);
    expect(second.total).toBe(3);
  });

  it('orders by time, so a replay of old events cannot land on top', () => {
    const log = addFeedEvents(EMPTY_FEED, [ev('b', 20), ev('c', 30)]);
    expect(ids(addFeedEvents(log, [ev('a', 10)]))).toEqual(['c', 'b', 'a']);
  });

  it('puts the later arrival first when two events share a time', () => {
    const log = addFeedEvents(EMPTY_FEED, [ev('a', 5), ev('b', 5)]);
    expect(ids(log)).toEqual(['b', 'a']);
    expect(ids(addFeedEvents(log, [ev('c', 5)]))).toEqual(['c', 'b', 'a']);
  });

  it('adds an id once, also within one batch', () => {
    const log = addFeedEvents(EMPTY_FEED, [ev('a', 1), ev('a', 1), ev('b', 2)]);
    expect(ids(log)).toEqual(['b', 'a']);
    expect(log.total).toBe(2);
  });

  it('returns the same log when nothing was new', () => {
    const log = addFeedEvents(EMPTY_FEED, [ev('a', 1)]);
    expect(addFeedEvents(log, [ev('a', 1)])).toBe(log);
    expect(addFeedEvents(log, [])).toBe(log);
    expect(addFeedEvents(EMPTY_FEED, [])).toBe(EMPTY_FEED);
  });

  it('does not change the log it was given', () => {
    const log = addFeedEvents(EMPTY_FEED, [ev('a', 1)]);
    addFeedEvents(log, [ev('b', 2)]);
    expect(ids(log)).toEqual(['a']);
    expect(log.total).toBe(1);
    expect(log.seen.has('b')).toBe(false);
    expect(EMPTY_FEED.entries).toHaveLength(0);
  });

  it('keeps the newest 120 and counts them all', () => {
    const batch = Array.from({ length: 150 }, (_, i) => ev(`e${i}`, i));
    const log = addFeedEvents(EMPTY_FEED, batch);
    expect(log.entries).toHaveLength(MAX_FEED_ENTRIES);
    expect(log.entries[0]?.id).toBe('e149');
    expect(log.entries.at(-1)?.id).toBe('e30');
    expect(log.total).toBe(150);
  });

  it('does not bring back an event the cap pushed out', () => {
    const log = addFeedEvents(
      EMPTY_FEED,
      Array.from({ length: 130 }, (_, i) => ev(`e${i}`, i))
    );
    // A reconnect replays the server's window, which still has e5.
    const again = addFeedEvents(log, [ev('e5', 5), ev('e129', 129)]);
    expect(again).toBe(log);
  });

  it('puts a replayed unseen old event below the cap, not on top', () => {
    const log = addFeedEvents(
      EMPTY_FEED,
      Array.from({ length: 120 }, (_, i) => ev(`e${i + 10}`, i + 10))
    );
    const again = addFeedEvents(log, [ev('old', 1)]);
    expect(again.entries).toHaveLength(MAX_FEED_ENTRIES);
    expect(again.entries.map(e => e.id)).not.toContain('old');
  });

  it('remembers only the newest ids', () => {
    const log = addFeedEvents(
      EMPTY_FEED,
      Array.from({ length: MAX_SEEN_IDS + 5 }, (_, i) => ev(`e${i}`, i))
    );
    expect(log.seen.size).toBe(MAX_SEEN_IDS);
    expect(log.seen.has('e0')).toBe(false);
    expect(log.seen.has(`e${MAX_SEEN_IDS + 4}`)).toBe(true);
  });
});

describe('feedMeta', () => {
  it('counts in the singular and the plural', () => {
    expect(feedMeta(0)).toBe('0 events');
    expect(feedMeta(1)).toBe('1 event');
    expect(feedMeta(2)).toBe('2 events');
    expect(feedMeta(340)).toBe('340 events');
  });
});

describe('severityClass', () => {
  it('names the kinds the stylesheet colours', () => {
    expect(severityClass('damage')).toBe('sev-damage');
    expect(severityClass('condition-applied')).toBe('sev-condition-applied');
    expect(severityClass('gm-roll')).toBe('sev-gm-roll');
  });

  it('keeps an odd kind inside the class attribute', () => {
    expect(severityClass('x" onclick="boom')).toBe('sev-xonclickboom');
    expect(severityClass('Damage Roll')).toBe('sev-damageroll');
    expect(severityClass('')).toBe('sev-other');
    expect(severityClass('###')).toBe('sev-other');
  });
});

describe('event times', () => {
  it('shows the browser time and gives <time> the machine time', () => {
    const ms = Date.UTC(2026, 9, 10, 20, 5, 9);
    expect(eventIso(ms)).toBe('2026-10-10T20:05:09.000Z');
    expect(eventTime(ms)).toBe(new Date(ms).toLocaleTimeString());
  });
});

describe('feedFace', () => {
  const one = addFeedEvents(EMPTY_FEED, [ev('a', 1)]);

  it('loads until the stream has said anything', () => {
    expect(feedFace(null, false)).toBe('loading');
  });

  it('is empty once the stream said there is nothing', () => {
    expect(feedFace(EMPTY_FEED, false)).toBe('empty');
  });

  it('shows the list whenever there are events, also when the bridge is away', () => {
    expect(feedFace(one, false)).toBe('ready');
    expect(feedFace(one, true)).toBe('ready');
  });

  it('says the bridge is away when there is nothing to show', () => {
    expect(feedFace(null, true)).toBe('bridge-down');
    expect(feedFace(EMPTY_FEED, true)).toBe('bridge-down');
  });
});

describe('what a screen reader hears', () => {
  it('has nothing to say about the first log the page gets', () => {
    const log = addFeedEvents(EMPTY_FEED, [ev('a', 1), ev('b', 2)]);
    expect(freshEntries(null, log)).toEqual([]);
    expect(freshEntries(log, null)).toEqual([]);
  });

  it('finds what arrived since the last log, newest first', () => {
    const before = addFeedEvents(EMPTY_FEED, [ev('a', 1)]);
    const after = addFeedEvents(before, [ev('b', 2), ev('c', 3)]);
    expect(freshEntries(before, after).map(e => e.id)).toEqual(['c', 'b']);
    expect(freshEntries(after, after)).toEqual([]);
  });

  it('finds the first events after a quiet start', () => {
    const after = addFeedEvents(EMPTY_FEED, [ev('a', 1)]);
    expect(freshEntries(EMPTY_FEED, after).map(e => e.id)).toEqual(['a']);
  });

  it('says one event as it is and a burst as a count and the newest', () => {
    expect(announcement([])).toBe('');
    expect(announcement([ev('a', 1, { text: 'Goblin falls' })])).toBe('Goblin falls');
    expect(announcement([ev('c', 3, { text: 'Third hit' }), ev('b', 2), ev('a', 1)])).toBe(
      '3 new events. Latest: Third hit'
    );
  });
});
