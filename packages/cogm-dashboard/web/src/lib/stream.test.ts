// What the header says about the stream itself: nothing while it is fine, a mark after a grace when
// it has dropped, a mark at once when the browser gave up. Pure; the EventSource is in stream.ts.
import { describe, expect, it, vi } from 'vitest';

import { STREAM_DROP_GRACE_MS, streamTrouble, type StreamLink } from './stream';

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
