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
