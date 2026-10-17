// What the header says about the stream itself: nothing while it is fine, a mark after a grace when
// it has dropped, a mark at once when the browser gave up. Pure; the EventSource is in stream.ts.
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHANGES_KEY,
  CHANGES_RELOAD_MS,
  FEED_KEY,
  STREAM_DROP_GRACE_MS,
  onEvents,
  streamTrouble,
  type StreamLink,
} from './stream';

// auth.ts reads the page's location when it loads; there is no page here.
vi.mock('./auth', () => ({ streamUrl: (): string => '/api/stream' }));

const T = 1_000_000;
const dropped: StreamLink = { state: 'dropped', since: T };

describe('streamTrouble', () => {
  it('has nothing to say before the stream first answers, or while it is open', () => {
    expect(streamTrouble(undefined, T)).toBeNull();
    expect(streamTrouble({ state: 'open', since: T }, T + 10 * STREAM_DROP_GRACE_MS)).toBeNull();
  });

  it('waits out a short drop: a reconnect inside the grace is never shown', () => {
    expect(streamTrouble(dropped, T)).toBeNull();
    expect(streamTrouble(dropped, T + STREAM_DROP_GRACE_MS - 1)).toBeNull();
  });

  it('says so once the stream has been down for the grace', () => {
    expect(streamTrouble(dropped, T + STREAM_DROP_GRACE_MS)).toBe('dropped');
    expect(streamTrouble(dropped, T + 60_000)).toBe('dropped');
  });

  it('says so at once when the browser gave up', () => {
    expect(streamTrouble({ state: 'closed', since: T }, T)).toBe('closed');
  });
});

describe('the events handler and Recent Changes', () => {
  const event = (id: string, eventType: string): unknown => ({
    id,
    timestampMs: 1_000,
    eventType,
    description: `Event ${id}`,
  });
  const AI = [...CHANGES_KEY, 'ai'];
  let queryClient: QueryClient;

  // A list the panel loaded (nothing observes it here, so a reload shows as `isInvalidated`).
  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    queryClient.setQueryData(AI, []);
  });
  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });
  const reloaded = (): boolean => queryClient.getQueryState(AI)?.isInvalidated === true;

  it('puts the events in the feed and reloads the lists once, after a burst of gm-change events', async () => {
    onEvents(queryClient, { events: [event('a', 'gm-change'), event('b', 'gm-change')] });
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS - 100);
    onEvents(queryClient, { events: [event('c', 'gm-change')] });
    expect(queryClient.getQueryData(FEED_KEY)).toMatchObject({ total: 3 });
    // The second batch started the wait again: the burst has not ended yet.
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS - 1);
    expect(reloaded()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(reloaded()).toBe(true);
  });

  it('leaves the lists alone for other kinds of event', async () => {
    onEvents(queryClient, { events: [event('a', 'damage'), event('b', 'gm-roll')] });
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS * 2);
    expect(reloaded()).toBe(false);
  });

  it('leaves the lists alone for a replay of events it has seen, as after a reconnect', async () => {
    onEvents(queryClient, { events: [event('a', 'gm-change')] });
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS);
    expect(reloaded()).toBe(true);
    queryClient.setQueryData(AI, []);
    expect(reloaded()).toBe(false);
    onEvents(queryClient, { events: [event('a', 'gm-change')] });
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS * 2);
    expect(reloaded()).toBe(false);
    // A new one still does.
    onEvents(queryClient, { events: [event('a', 'gm-change'), event('b', 'gm-change')] });
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS);
    expect(reloaded()).toBe(true);
  });
});
