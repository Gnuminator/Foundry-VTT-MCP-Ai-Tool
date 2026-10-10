// Fixtures for the Live Feed stories: event logs as the stream's `events` message leaves them in
// the cache (lib/feed.ts). Made up, like every fixture here: a harbor town and a lantern crew,
// no campaign text. Times are absolute and the shots run in UTC, so the clock column is fixed.
import { EMPTY_FEED, addFeedEvents, type FeedEvent, type FeedLog } from '../../lib/feed';

import { at } from './common';

/** A log from events listed oldest first, as the server sends them. */
export function feedLog(events: readonly FeedEvent[]): FeedLog {
  return addFeedEvents(EMPTY_FEED, events);
}

const ev = (id: string, ms: number, eventType: string, text: string): FeedEvent => ({
  id,
  timestampMs: ms,
  eventType,
  text,
});

/** The stream said it has no events yet. */
export const FEED_NONE: FeedLog = EMPTY_FEED;

/** Six events of a quiet evening, oldest first. */
const FEW_EVENTS: FeedEvent[] = [
  ev('f1', at(19, 2), 'scene-change', 'The scene is now Harbor Market'),
  ev('f2', at(19, 5), 'combat-start', 'Combat begins in Harbor Market'),
  ev('f3', at(19, 6), 'roll', 'Mira rolls Perception: 17'),
  ev('f4', at(19, 7), 'damage', 'Ogre Brute takes 11 slashing damage'),
  ev('f5', at(19, 8), 'condition-applied', 'Goblin Archer gained "Prone"'),
  ev('f6', at(19, 9), 'healing', 'Brannoc heals 6 hit points'),
];

export const FEED_FEW: FeedLog = feedLog(FEW_EVENTS);

/** One event of every kind the module logs, oldest first. */
const KIND_EVENTS: FeedEvent[] = [
  ev('k1', at(20, 0), 'scene-change', 'The scene is now Old Mill'),
  ev('k2', at(20, 1), 'journal-created', 'Journal "Harbor rumors" was created'),
  ev('k3', at(20, 2), 'journal-updated', 'Journal "Harbor rumors" was changed'),
  ev('k4', at(20, 3), 'combat-start', 'Combat begins in Old Mill'),
  ev('k5', at(20, 4), 'roll', 'Brannoc attacks the Ogre Brute: 17 vs AC 14, hit'),
  ev('k6', at(20, 5), 'damage-roll', 'Brannoc rolls damage: 9 slashing'),
  ev('k7', at(20, 6), 'gm-roll', 'GM roll for the Ancient Wyrm: Stealth 22 (secret)'),
  ev('k8', at(20, 7), 'damage', 'Ogre Brute takes 9 slashing damage'),
  ev('k9', at(20, 8), 'healing', 'Mira heals 7 hit points'),
  ev('k10', at(20, 9), 'condition-applied', 'Ogre Brute gained "Poisoned"'),
  ev('k11', at(20, 10), 'condition-removed', 'Ogre Brute lost "Poisoned"'),
  ev('k12', at(20, 11), 'resource-spent', 'Mira used a level 2 spell slot'),
  ev('k13', at(20, 12), 'death', 'Goblin Archer dropped to 0 hit points'),
  ev('k14', at(20, 13), 'stabilize', 'Mira is stable'),
  ev('k15', at(20, 14), 'gm-change', 'Applied: moved the Ogre Brute token'),
  ev('k16', at(20, 15), 'combat-end', 'Combat ended after 4 rounds'),
];

export const FEED_KINDS: FeedLog = feedLog(KIND_EVENTS);

/** A line long enough to wrap on a narrow card. */
const LONG_EVENTS: FeedEvent[] = [
  ev(
    'l1',
    at(21, 0),
    'roll',
    'Brannoc attacks the Ogre Brute with a longsword: 1d20 + 7 = 19 against armor class 11, a hit, then rolls 1d8 + 4 = 9 slashing damage'
  ),
  ev('l2', at(21, 1), 'a-kind-from-a-module-that-is-quite-long', 'Something happened'),
];

export const FEED_LONG: FeedLog = feedLog(LONG_EVENTS);

/** 130 events, a minute apart: the log keeps the newest 120 and has counted all 130. */
export const FEED_CAPPED: FeedLog = feedLog(
  Array.from({ length: 130 }, (_, i) => {
    const kinds = ['damage', 'healing', 'roll', 'condition-applied'] as const;
    const kind = kinds[i % kinds.length] ?? 'roll';
    return ev(`m${i + 1}`, at(18, 0) + i * 60_000, kind, `Event number ${i + 1} of the evening`);
  })
);
