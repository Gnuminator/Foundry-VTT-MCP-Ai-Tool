import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../logger.js';
import { ChannelError, type McpControlClient, ToolError } from './mcp-control-client.js';
import { PollingGameFeed } from './polling-feed.js';
import type { BridgeStatus, GameFeedHandlers } from './types.js';

/** A stand-in control client: connected, and every tool call answers as `behaviour` says. */
class FakeClient extends EventEmitter {
  isConnected = true;
  behaviour: 'ok' | 'module-down' | 'channel-down' = 'ok';
  start(): void {}
  close(): void {}
  callTool(tool: string): Promise<unknown> {
    if (this.behaviour === 'module-down') {
      return Promise.reject(new ToolError('Foundry module not connected', tool));
    }
    if (this.behaviour === 'channel-down') {
      return Promise.reject(new ChannelError('channel closed'));
    }
    return Promise.resolve({ success: true, events: [], errors: [], active: false });
  }
}

function setup(): { client: FakeClient; statuses: BridgeStatus[]; feed: PollingGameFeed } {
  const client = new FakeClient();
  const statuses: BridgeStatus[] = [];
  const handlers: GameFeedHandlers = {
    onEvents: () => {},
    onCombat: () => {},
    onErrors: () => {},
    onStatus: s => statuses.push(s),
  };
  const feed = new PollingGameFeed(client as unknown as McpControlClient, handlers, {
    pollIntervalMs: 1000,
    combatPollIntervalMs: 1000,
    errorPollIntervalMs: 1000,
    logger: new Logger('error'),
  });
  return { client, statuses, feed };
}

const last = (list: BridgeStatus[]): BridgeStatus => list[list.length - 1];

describe('PollingGameFeed foundryDownSince', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is null while Foundry is reachable', async () => {
    const { feed, statuses } = setup();
    feed.start();
    await vi.advanceTimersByTimeAsync(1100);
    expect(last(statuses).foundry).toBe('reachable');
    expect(last(statuses).foundryDownSince).toBeNull();
    feed.stop();
  });

  it('is set when Foundry first becomes unreachable and stays fixed while it is', async () => {
    const { feed, client, statuses } = setup();
    feed.start();
    await vi.advanceTimersByTimeAsync(1100);
    client.behaviour = 'module-down';
    await vi.advanceTimersByTimeAsync(1000);
    const first = last(statuses);
    expect(first.foundry).toBe('unreachable');
    expect(Date.parse(first.foundryDownSince as string)).toBeGreaterThanOrEqual(
      Date.parse('2026-09-30T10:00:01.100Z')
    );
    expect(Date.parse(first.foundryDownSince as string)).toBeLessThanOrEqual(
      Date.parse('2026-09-30T10:00:02.100Z')
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(last(statuses).foundryDownSince).toBe(first.foundryDownSince);
    feed.stop();
  });

  it('clears again when Foundry is reachable, and restarts from the next outage', async () => {
    const { feed, client, statuses } = setup();
    feed.start();
    client.behaviour = 'module-down';
    await vi.advanceTimersByTimeAsync(1100);
    expect(last(statuses).foundryDownSince).not.toBeNull();

    client.behaviour = 'ok';
    await vi.advanceTimersByTimeAsync(1000);
    expect(last(statuses).foundry).toBe('reachable');
    expect(last(statuses).foundryDownSince).toBeNull();

    client.behaviour = 'module-down';
    await vi.advanceTimersByTimeAsync(1000);
    const again = last(statuses).foundryDownSince;
    expect(again).not.toBeNull();
    expect(Date.parse(again as string)).toBeGreaterThan(Date.parse('2026-09-30T10:00:02.000Z'));
    feed.stop();
  });

  it('is cleared by an unknown verdict (the control channel is the problem)', async () => {
    const { feed, client, statuses } = setup();
    feed.start();
    client.behaviour = 'module-down';
    await vi.advanceTimersByTimeAsync(1100);
    expect(last(statuses).foundryDownSince).not.toBeNull();

    client.behaviour = 'channel-down';
    await vi.advanceTimersByTimeAsync(1000);
    expect(last(statuses).foundry).toBe('unknown');
    expect(last(statuses).foundryDownSince).toBeNull();
    feed.stop();
  });
});

/** A client whose get-recent-events answers from a list of events, as the module does. */
class EventsClient extends FakeClient {
  log: Array<{ id: string; timestamp: string; timestampMs: number }> = [];
  clockMs = Date.parse('2026-09-30T10:00:00.000Z');
  calls: Array<Record<string, unknown>> = [];
  callTool(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (tool !== 'get-recent-events') return super.callTool(tool);
    this.calls.push(args);
    const since = typeof args.sinceTimestamp === 'string' ? Date.parse(args.sinceTimestamp) : null;
    const limit = typeof args.limit === 'number' ? args.limit : 100;
    const events = this.log.filter(e => since === null || e.timestampMs > since).slice(-limit);
    const latest =
      events.length > 0 ? events[events.length - 1].timestamp : (args.sinceTimestamp ?? null);
    return Promise.resolve({
      success: true,
      events,
      latestTimestamp: latest,
      serverTime: new Date(this.clockMs).toISOString(),
    });
  }
  add(id: string, ms: number): void {
    this.log.push({ id, timestamp: new Date(ms).toISOString(), timestampMs: ms });
  }
}

describe('PollingGameFeed event cursor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function eventsSetup(): { client: EventsClient; got: string[]; feed: PollingGameFeed } {
    const client = new EventsClient();
    const got: string[] = [];
    const handlers: GameFeedHandlers = {
      onEvents: events => got.push(...events.map(e => e.id)),
      onCombat: () => {},
      onErrors: () => {},
      onStatus: () => {},
    };
    const feed = new PollingGameFeed(client as unknown as McpControlClient, handlers, {
      pollIntervalMs: 1000,
      combatPollIntervalMs: 60_000,
      errorPollIntervalMs: 60_000,
      logger: new Logger('error'),
    });
    return { client, got, feed };
  }

  it('hands each event on once', async () => {
    const { client, got, feed } = eventsSetup();
    client.add('a', Date.parse('2026-09-30T09:59:00.000Z'));
    feed.start();
    await vi.advanceTimersByTimeAsync(1100);
    client.add('b', Date.parse('2026-09-30T10:00:00.500Z'));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(got).toEqual(['a', 'b']);
    feed.stop();
  });

  it('finds an event stamped behind the cursor (a clock that is behind) within a few polls', async () => {
    const { client, got, feed } = eventsSetup();
    client.add('a', Date.parse('2026-09-30T10:00:00.000Z'));
    feed.start();
    await vi.advanceTimersByTimeAsync(1100);
    // The next event carries an older time than the cursor: the cursor read cannot return it.
    client.add('late', Date.parse('2026-09-30T09:59:50.000Z'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(got).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(got).toEqual(['a', 'late']);
    feed.stop();
  });

  it('starts over when the cursor is ahead of the module clock', async () => {
    const { client, got, feed } = eventsSetup();
    client.add('future', Date.parse('2026-09-30T11:00:00.000Z'));
    client.clockMs = Date.parse('2026-09-30T10:00:00.000Z');
    feed.start();
    await vi.advanceTimersByTimeAsync(1100);
    expect(got).toEqual(['future']);
    client.add('now', Date.parse('2026-09-30T10:00:05.000Z'));
    await vi.advanceTimersByTimeAsync(2100);
    expect(got).toEqual(['future', 'now']);
    feed.stop();
  });
});
