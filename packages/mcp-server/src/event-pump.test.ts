import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_EVENT_POLL_MS,
  EventPump,
  PUMP_STATE_FILE,
  eventPumpSettings,
  localDateKey,
} from './event-pump.js';
import { VaultStore } from './vault/store.js';

/** The module's buffer: strictly-after filter, newest `limit` events. */
class FakeModule {
  events: Array<{ id: string; timestamp: string; timestampMs: number; eventType: string }> = [];
  connected = true;
  worldId = 'w1';
  fail: string | null = null;
  private seq = 0;

  add(ms: number, eventType = 'damage'): string {
    const id = `evt-${(this.seq += 1)}`;
    this.events.push({ id, timestamp: new Date(ms).toISOString(), timestampMs: ms, eventType });
    return id;
  }

  query = vi.fn((method: string, data: any): Promise<unknown> => {
    if (this.fail) return Promise.reject(new Error(this.fail));
    if (method === 'foundry-mcp-bridge.getRecentEvents') {
      const since = data.sinceTimestamp ? Date.parse(data.sinceTimestamp) : null;
      const matching = this.events.filter(e => since === null || e.timestampMs > since);
      return Promise.resolve({ success: true, events: matching.slice(-data.limit) });
    }
    return Promise.reject(new Error(`unexpected ${method}`));
  });

  isConnected = (): boolean => this.connected;
}

let dataDir: string;
let store: VaultStore;
let foundry: FakeModule;
let logger: any;

function makePump(): EventPump {
  return new EventPump({
    foundryClient: foundry,
    worldIds: { current: (): Promise<string> => Promise.resolve(foundry.worldId) },
    store,
    logger,
    intervalMs: 5000,
  });
}

async function logged(worldId = 'w1'): Promise<string[]> {
  const out: string[] = [];
  for (const file of await store.list(worldId, 'sessions')) {
    if (!file.endsWith('.jsonl')) continue;
    for (const line of await store.readLines(worldId, 'sessions', file)) {
      out.push((line as { id: string }).id);
    }
  }
  return out;
}

const T0 = new Date(2026, 8, 28, 20, 0, 0).getTime();

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-pump-'));
  store = new VaultStore({ dataDir });
  foundry = new FakeModule();
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
});

afterEach(async () => {
  vi.useRealTimers();
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('eventPumpSettings', () => {
  it('is on by default with a 5 s interval', () => {
    expect(eventPumpSettings({})).toEqual({ enabled: true, intervalMs: DEFAULT_EVENT_POLL_MS });
  });

  it('can be switched off and slowed down, but not below 1 s', () => {
    expect(eventPumpSettings({ FOUNDRY_AI_EVENT_LOG: 'off' }).enabled).toBe(false);
    expect(eventPumpSettings({ FOUNDRY_AI_EVENT_LOG: 'FALSE' }).enabled).toBe(false);
    expect(eventPumpSettings({ FOUNDRY_AI_EVENT_POLL_MS: '15000' }).intervalMs).toBe(15000);
    expect(eventPumpSettings({ FOUNDRY_AI_EVENT_POLL_MS: '10' }).intervalMs).toBe(1000);
    expect(eventPumpSettings({ FOUNDRY_AI_EVENT_POLL_MS: 'x' }).intervalMs).toBe(5000);
  });
});

describe('EventPump.pollOnce', () => {
  it('appends new events to the local-date file, once each', async () => {
    const pump = makePump();
    foundry.add(T0);
    foundry.add(T0 + 10);
    expect(await pump.pollOnce()).toBe(2);
    expect(await pump.pollOnce()).toBe(0);
    foundry.add(T0 + 20);
    expect(await pump.pollOnce()).toBe(1);

    expect(await store.list('w1', 'sessions')).toEqual([
      `${localDateKey(T0)}.jsonl`,
      PUMP_STATE_FILE,
    ]);
    expect(await logged()).toEqual(['evt-1', 'evt-2', 'evt-3']);
    const [first] = await store.readLines('w1', 'sessions', `${localDateKey(T0)}.jsonl`);
    expect(first).toMatchObject({ id: 'evt-1', eventType: 'damage', timestampMs: T0 });
  });

  it('asks from 1 ms before the cursor and keeps events that share its millisecond', async () => {
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    foundry.add(T0); // same millisecond as the cursor: a strict "after" filter would miss it
    expect(await pump.pollOnce()).toBe(1);
    expect(foundry.query).toHaveBeenLastCalledWith('foundry-mcp-bridge.getRecentEvents', {
      limit: 1000,
      sinceTimestamp: new Date(T0 - 1).toISOString(),
    });
    expect(await logged()).toEqual(['evt-1', 'evt-2']);
  });

  it('splits a batch across local dates', async () => {
    const pump = makePump();
    const midnight = new Date(2026, 8, 29, 0, 0, 0).getTime();
    foundry.add(midnight - 1);
    foundry.add(midnight);
    await pump.pollOnce();
    expect(await store.readLines('w1', 'sessions', '2026-09-28.jsonl')).toHaveLength(1);
    expect(await store.readLines('w1', 'sessions', '2026-09-29.jsonl')).toHaveLength(1);
  });

  it('resumes from the saved cursor after a restart without duplicates', async () => {
    foundry.add(T0);
    foundry.add(T0 + 5);
    await makePump().pollOnce();
    foundry.add(T0 + 5);
    const restarted = makePump();
    expect(await restarted.pollOnce()).toBe(1);
    expect(await logged()).toEqual(['evt-1', 'evt-2', 'evt-3']);
  });

  it('keeps a cursor per world', async () => {
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    foundry.worldId = 'w2';
    expect(await pump.pollOnce()).toBe(1);
    expect(await logged('w2')).toEqual(['evt-1']);
  });

  it('does nothing while Foundry is disconnected', async () => {
    foundry.connected = false;
    foundry.add(T0);
    expect(await makePump().pollOnce()).toBe(0);
    expect(foundry.query).not.toHaveBeenCalled();
  });

  it('skips malformed events and survives errors, logging each failure once', async () => {
    const pump = makePump();
    foundry.events.push({ id: 5 as never, timestamp: 'x', timestampMs: NaN, eventType: 'bad' });
    foundry.add(T0);
    expect(await pump.pollOnce()).toBe(1);

    foundry.fail = 'Connection closed';
    expect(await pump.pollOnce()).toBe(0);
    expect(await pump.pollOnce()).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    foundry.fail = null;
    foundry.add(T0 + 1);
    expect(await pump.pollOnce()).toBe(1);
    expect(logger.info).toHaveBeenCalledWith('Event log recovered');

    foundry.query.mockResolvedValueOnce({ success: false, error: 'Access denied' });
    expect(await pump.pollOnce()).toBe(0);
    expect(logger.warn).toHaveBeenLastCalledWith('Event log poll failed', {
      error: 'Access denied',
    });
  });

  it('does not overlap polls', async () => {
    const pump = makePump();
    foundry.add(T0);
    const [a, b] = await Promise.all([pump.pollOnce(), pump.pollOnce()]);
    expect(a + b).toBe(2); // the same in-flight poll, counted by both callers
    expect(foundry.query).toHaveBeenCalledTimes(1);
    expect(await logged()).toEqual(['evt-1']);
  });
});

describe('EventPump timer', () => {
  it('polls on its interval until stopped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const pump = makePump();
    const spy = vi.spyOn(pump, 'pollOnce');
    pump.start();
    pump.start();
    vi.advanceTimersByTime(15_000);
    expect(spy).toHaveBeenCalledTimes(3);
    pump.stop();
    vi.advanceTimersByTime(15_000);
    expect(spy).toHaveBeenCalledTimes(3);
    await store.flush();
  });
});
