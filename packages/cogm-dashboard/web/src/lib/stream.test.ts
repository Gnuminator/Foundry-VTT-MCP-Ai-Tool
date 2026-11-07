// What the header says about the stream itself: nothing while it is fine, a mark after a grace when
// it has dropped, a mark at once when the browser gave up. Pure; the EventSource is in stream.ts.
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHANGES_KEY,
  CHANGES_RELOAD_MS,
  COMBAT_KEY,
  REFRESH_COMBAT_MAX_MS,
  refreshCombat,
  FEED_KEY,
  STREAM_DROP_GRACE_MS,
  STREAM_GIVE_UP_AFTER,
  STREAM_LINK_KEY,
  STREAM_RETRY_MAX_MS,
  onEvents,
  onStatus,
  startStream,
  streamRetryDelay,
  streamTrouble,
  withKnownPortraits,
  type StreamLink,
  STREAM_WATCHDOG_MS,
} from './stream';
import { readCombat } from './combat';

// auth.ts reads the page's location when it loads; there is no page here.
vi.mock('./auth', () => ({ streamUrl: (): string => '/api/stream' }));
const callTool = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ callTool }));

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

/** An EventSource the test drives: the browser's states, and the calls the stream makes. */
class FakeSource {
  static readonly CLOSED = 2;
  static all: FakeSource[] = [];
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSource.all.push(this);
  }
  listeners = new Map<string, Array<(e: MessageEvent<string>) => void>>();
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  /** The server sent an event. */
  emit(type: string, data: unknown = {}): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent<string>);
    }
  }
  close(): void {
    this.closed = true;
    this.readyState = FakeSource.CLOSED;
  }
  /** The browser gave up (a non-200 answer). */
  giveUp(): void {
    this.readyState = FakeSource.CLOSED;
    this.onerror?.();
  }
}

describe('startStream', () => {
  let queryClient: QueryClient;
  let stop: () => void;
  const link = (): StreamLink | undefined => queryClient.getQueryData<StreamLink>(STREAM_LINK_KEY);
  const last = (): FakeSource => FakeSource.all[FakeSource.all.length - 1];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeSource);
    FakeSource.all = [];
    queryClient = new QueryClient();
    stop = startStream(queryClient, {
      create: () => new FakeSource() as unknown as EventSource,
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return (): void => clearTimeout(timer);
      },
    });
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('closes and reopens a stream that has been silent for the watchdog time', () => {
    last().onopen?.();
    expect(FakeSource.all).toHaveLength(1);
    vi.advanceTimersByTime(STREAM_WATCHDOG_MS - 6000);
    expect(FakeSource.all).toHaveLength(1);
    vi.advanceTimersByTime(12_000);
    expect(FakeSource.all).toHaveLength(2);
    expect(FakeSource.all[0]?.closed).toBe(true);
    expect(FakeSource.all[1]?.closed).toBe(false);
  });

  it('leaves a stream alone while events keep coming in', () => {
    last().onopen?.();
    for (let i = 0; i < 7; i += 1) {
      vi.advanceTimersByTime(17_000);
      last().emit('status', { foundry: 'reachable' });
    }
    // Two minutes in, far past the watchdog time, but never silent for that long.
    expect(FakeSource.all).toHaveLength(1);
    expect(FakeSource.all[0]?.closed).toBe(false);
  });

  it('cancels the watchdog when stopped', () => {
    last().onopen?.();
    stop();
    vi.advanceTimersByTime(STREAM_WATCHDOG_MS + 10_000);
    expect(FakeSource.all).toHaveLength(1);
  });

  it('a world reset clears the old fight, and a fight read still out does not bring it back', async () => {
    queryClient.setQueryData(COMBAT_KEY, { active: true });
    let answer: (v: unknown) => void = () => {};
    callTool.mockImplementationOnce(() => new Promise(resolve => (answer = resolve)));
    const read = refreshCombat(queryClient);
    last().emit('reset');
    expect(queryClient.getQueryData(COMBAT_KEY)).toBeNull();
    answer({ active: true, round: 3, turn: 0, combatants: [] });
    await read;
    expect(queryClient.getQueryData(COMBAT_KEY)).toBeNull();
  });

  it('waits 2, 4, 8, then 10 seconds between new connections', () => {
    expect([1, 2, 3, 4, 5].map(streamRetryDelay)).toEqual([2000, 4000, 8000, 10_000, 10_000]);
  });

  it('makes a new connection after the browser gave up, and is open again when it answers', async () => {
    last().onopen?.();
    expect(link()?.state).toBe('open');
    const first = last();
    first.giveUp();
    expect(first.closed).toBe(true);
    expect(link()?.state).toBe('dropped');
    expect(FakeSource.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(streamRetryDelay(1));
    expect(FakeSource.all).toHaveLength(2);
    last().onopen?.();
    expect(link()?.state).toBe('open');
  });

  it('says closed only after the new connections keep failing, and keeps trying', async () => {
    for (let i = 1; i <= STREAM_GIVE_UP_AFTER; i += 1) {
      expect(link()?.state).not.toBe('closed');
      last().giveUp();
      await vi.advanceTimersByTimeAsync(streamRetryDelay(i));
    }
    expect(link()?.state).toBe('closed');
    const before = FakeSource.all.length;
    last().giveUp();
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_MAX_MS);
    expect(FakeSource.all.length).toBe(before + 1);
    last().onopen?.();
    expect(link()?.state).toBe('open');
  });

  it('leaves a drop the browser retries by itself alone', () => {
    last().readyState = 0;
    last().onerror?.();
    expect(link()?.state).toBe('dropped');
    expect(FakeSource.all).toHaveLength(1);
  });

  it('stops for good when the page goes', async () => {
    last().giveUp();
    stop();
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_MAX_MS * 2);
    expect(FakeSource.all).toHaveLength(1);
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

  it('reloads the lists when Foundry becomes reachable again, not on a first or repeated status', async () => {
    const status = (foundry: string): unknown => ({
      controlChannel: 'connected',
      foundry,
      lastError: null,
      lastPollAt: null,
      foundryDownSince: null,
    });
    onStatus(queryClient, status('reachable'));
    onStatus(queryClient, status('reachable'));
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS * 2);
    expect(reloaded()).toBe(false);
    onStatus(queryClient, status('unreachable'));
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS * 2);
    expect(reloaded()).toBe(false);
    onStatus(queryClient, status('reachable'));
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS);
    expect(reloaded()).toBe(true);
    // A dropped bridge link reports unknown, not unreachable.
    queryClient.setQueryData(AI, []);
    onStatus(queryClient, status('unknown'));
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS * 2);
    expect(reloaded()).toBe(false);
    onStatus(queryClient, status('reachable'));
    await vi.advanceTimersByTimeAsync(CHANGES_RELOAD_MS);
    expect(reloaded()).toBe(true);
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

describe('refreshCombat', () => {
  const fight = readCombat({
    active: true,
    round: 1,
    turn: 0,
    current: null,
    combatants: [{ id: 'a', name: 'Wolf' }],
  });
  const fresh = (): QueryClient => {
    const qc = new QueryClient();
    qc.setQueryData(COMBAT_KEY, fight);
    return qc;
  };
  beforeEach(() => {
    callTool.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('leaves the fight alone when the read fails or says nothing about a fight', async () => {
    const qc = fresh();
    callTool.mockRejectedValueOnce(new Error('away'));
    await refreshCombat(qc);
    callTool.mockResolvedValueOnce({});
    await refreshCombat(qc);
    expect(qc.getQueryData(COMBAT_KEY)).toBe(fight);
  });

  it('gives up on a read that does not answer', async () => {
    const qc = fresh();
    callTool.mockReturnValueOnce(new Promise(() => undefined));
    const done = refreshCombat(qc);
    await vi.advanceTimersByTimeAsync(REFRESH_COMBAT_MAX_MS);
    await done;
    expect(qc.getQueryData(COMBAT_KEY)).toBe(fight);
  });

  it('ends the fight when the tool says none runs', async () => {
    const qc = fresh();
    callTool.mockResolvedValueOnce({ active: false });
    await refreshCombat(qc);
    expect(qc.getQueryData(COMBAT_KEY)).toBeNull();
  });

  it('keeps a fight the stream pushed while the read was out', async () => {
    const qc = fresh();
    const listeners = new Map<string, (e: MessageEvent<string>) => void>();
    const source = {
      readyState: 1,
      onopen: null,
      onerror: null,
      close: (): void => undefined,
      addEventListener: (name: string, fn: (e: MessageEvent<string>) => void): void => {
        listeners.set(name, fn);
      },
    };
    const stop = startStream(qc, {
      create: () => source as unknown as EventSource,
      schedule: (): (() => void) => () => undefined,
    });
    let answer: (raw: unknown) => void = (): void => undefined;
    callTool.mockReturnValueOnce(
      new Promise<unknown>(resolve => {
        answer = resolve;
      })
    );
    const done = refreshCombat(qc);
    // The stream pushes the newer fight, then the older read comes back.
    listeners.get('combat')?.({
      data: JSON.stringify({
        combat: { active: true, round: 3, turn: 0, current: null, combatants: [] },
      }),
    } as MessageEvent<string>);
    answer({ active: true, round: 1, turn: 0, current: null, combatants: [] });
    await done;
    stop();
    expect(qc.getQueryData<{ round: number }>(COMBAT_KEY)?.round).toBe(3);
  });
});

describe('a combat read straight from the tool', () => {
  const raw = (img: string | null): unknown => ({
    active: true,
    round: 2,
    turn: 0,
    current: null,
    combatants: [{ id: 'a', name: 'Wolf', hp: { value: 5, max: 11, temp: 0 }, img }],
  });

  it('keeps the portrait address the stream already had', () => {
    const known = readCombat(raw('http://f/wolf.png'));
    const fresh = readCombat(raw('/tokens/wolf.png'));
    expect(withKnownPortraits(fresh, known)?.combatants[0]?.img).toBe('http://f/wolf.png');
  });

  it('has no portrait when none was ever known, and no fight stays none', () => {
    expect(withKnownPortraits(readCombat(raw('/x.png')), null)?.combatants[0]?.img).toBeNull();
    expect(withKnownPortraits(null, null)).toBeNull();
  });
});
