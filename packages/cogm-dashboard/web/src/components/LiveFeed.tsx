// The Live Feed (D-092), ported from the old page: the session events as they happen, newest
// first, in the During view's feed slot. It only reads: the events come from the stream (the
// server replays its recent ones on every connect), the newest 120 stay on screen, and the head
// counts every event since the page loaded. The rules are in lib/feed.ts; styles.css draws the
// rows (.event, .sev-*) and moments.css sizes the card per During layout.
//
// The old pane has no controls (no filter, clear or pause), and none was added. What is new: the
// list is a real list that can be scrolled with the keyboard, new events are announced (one short
// message per batch, see below), a feed shown while the bridge is away says so, and the card has
// the "?" the old page added from help-links.json.
import { memo, useState, type JSX } from 'react';

import { foldBodyId } from '../lib/duringFolds';
import {
  FEED_AWAY_EMPTY_TEXT,
  FEED_AWAY_TEXT,
  FEED_EMPTY_TEXT,
  FEED_LOADING_TEXT,
  announcement,
  eventIso,
  eventTime,
  feedFace,
  feedMeta,
  freshEntries,
  severityClass,
  type FeedEvent,
  type FeedFace,
  type FeedLog,
} from '../lib/feed';
import { useBridgeAway, useFeed } from '../lib/stream';
import { Panel } from '../ui';

import { FoldButton, type DuringFolds } from './Folds';

/** One event: its line, the kind as a chip and the time. Memoised: 120 rows, one new at a time. */
const EventRow = memo(function EventRow({ event }: { event: FeedEvent }): JSX.Element {
  return (
    <div role="listitem" className={`event ${severityClass(event.eventType)}`}>
      <div className="event-desc">{event.text}</div>
      <div className="event-meta">
        <span className="event-type">{event.eventType}</span>
        <span>
          <time dateTime={eventIso(event.timestampMs)}>{eventTime(event.timestampMs)}</time>
        </span>
      </div>
    </div>
  );
});

/** What each face of the pane says instead of the list. */
function messageFor(face: Exclude<FeedFace, 'ready'>, log: FeedLog | null): string {
  if (face === 'loading') return FEED_LOADING_TEXT;
  if (face === 'bridge-down') return FEED_AWAY_EMPTY_TEXT;
  return log ? FEED_EMPTY_TEXT : FEED_LOADING_TEXT;
}

/**
 * What a screen reader hears of new events: one short message per batch in a polite status, not
 * the list itself as a live region. The list is long and its first load would be read out whole
 * (80 events), and a burst of hits would queue up one announcement each. The first log the page
 * gets is not announced, and a folded card says nothing (it is hidden).
 */
function useAnnouncement(log: FeedLog | null): string {
  const [seenLog, setSeenLog] = useState(log);
  const [said, setSaid] = useState('');
  if (log !== seenLog) {
    setSeenLog(log);
    const text = announcement(freshEntries(seenLog, log));
    if (text) setSaid(text);
  }
  return said;
}

/**
 * The Live Feed card. `folds` makes it a During fold card (a fold button first in the head, a
 * folded card showing only its head); without it, it is a plain pane.
 */
export function LiveFeed({ folds }: { folds?: DuringFolds }): JSX.Element {
  const log = useFeed();
  const away = useBridgeAway();
  const said = useAnnouncement(log);
  const face = feedFace(log, away);
  const folded = folds?.isFolded('feed') === true;
  const entries = log?.entries ?? [];

  return (
    <Panel
      id="pane-feed"
      className={folded ? 'is-folded' : undefined}
      title="Live Feed"
      titleId="feed-title"
      aria-labelledby="feed-title"
      help="dashboard#live-feed"
      status={<span id="feed-meta">{feedMeta(log?.total ?? 0)}</span>}
      {...(folds
        ? {
            headStart: <FoldButton card="feed" folds={folds} />,
            ...(folded ? { onTitleClick: () => folds.toggle('feed') } : {}),
          }
        : {})}
      lead={
        <>
          {/* Always in the page, so a screen reader hears the text when it arrives. */}
          <p className="strip-away" id="feed-away" role="status">
            {away && face === 'ready' ? FEED_AWAY_TEXT : ''}
          </p>
          <p className="visually-hidden" id="feed-announce" role="status">
            {said}
          </p>
        </>
      }
      bodyId={foldBodyId('feed')}
      state={face}
      {...(face === 'ready' ? {} : { stateMessage: messageFor(face, log) })}
      bodyProps={{
        role: 'list',
        'aria-label': 'Live feed events, newest first',
        // The list scrolls and nothing in it takes the Tab key: the keyboard scrolls the list
        // itself.
        tabIndex: 0,
      }}
    >
      {entries.map(event => (
        <EventRow key={event.id} event={event} />
      ))}
    </Panel>
  );
}
