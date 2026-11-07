import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventPump, PUMP_STATE_FILE, eventSeq } from './event-pump.js';
import { VaultStore } from './vault/store.js';

/** The module's buffer: strictly-after filter, newest `limit` events, `evt-<n>` ids per load. */
class FakeModule {
  events: Array<{ id: string; timestamp: string; timestampMs: number; eventType: string }> = [];
  connected = true;
  fail: string | null = null;
  seq = 0;

  add(ms: number): void {
    const id = `evt-${(this.seq += 1)}`;
    this.events.push({
      id,
      timestamp: new Date(ms).toISOString(),
      timestampMs: ms,
      eventType: 'x',
    });
  }

  query = vi.fn((method: string, data: any): Promise<unknown> => {
    if (this.fail) return Promise.reject(new Error(this.fail));
    if (method !== 'foundry-mcp-bridge.getRecentEvents') {
      return Promise.reject(new Error(`unexpected ${method}`));
    }
    const since = data.sinceTimestamp ? Date.parse(data.sinceTimestamp) : null;
    const matching = this.events.filter(e => since === null || e.timestampMs > since);
    return Promise.resolve({ success: true, events: matching.slice(-data.limit) });
  });

  isConnected = (): boolean => this.connected;
}

const T0 = new Date(2026, 8, 28, 20, 0, 0).getTime();
let dataDir: string;
let store: VaultStore;
let foundry: FakeModule;

function makePump(worldIds?: { current: () => Promise<string> }): EventPump {
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  return new EventPump({
    foundryClient: foundry,
    worldIds: worldIds ?? { current: (): Promise<string> => Promise.resolve('w1') },
    store,
    logger,
    intervalMs: 5000,
  });
}

async function gapMarkers(): Promise<Array<Record<string, any>>> {
  const out: Array<Record<string, any>> = [];
  for (const file of await store.list('w1', 'sessions')) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)) continue;
    for (const line of await store.readLines('w1', 'sessions', file)) {
      if ((line as { eventType?: string }).eventType === 'pump-gap') out.push(line as never);
    }
  }
  return out;
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-pump-gaps-'));
  store = new VaultStore({ dataDir });
  foundry = new FakeModule();
});

afterEach(async () => {
  vi.useRealTimers();
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('eventSeq', () => {
  it('reads the counter from the module id forms and nothing else', () => {
    expect(eventSeq('evt-lx2k9a-17')).toBe(17);
    expect(eventSeq('evt-3')).toBe(3);
    expect(eventSeq('AbCdEf123')).toBeNull();
  });
});

describe('EventPump gaps and health', () => {
  it('writes no marker on a normal run', async () => {
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    foundry.add(T0 + 1000);
    await pump.pollOnce();
    expect(await gapMarkers()).toHaveLength(0);
    expect(pump.health.snapshot()).toMatchObject({ gapCount: 0, lostCount: 0 });
  });

  it('marks a ring wrap when the buffer hands back a full batch', async () => {
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    for (let i = 1; i <= 1000; i++) foundry.add(T0 + i * 10);
    await pump.pollOnce();
    const markers = await gapMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ details: { pump: 'session events', reason: 'ring-wrap' } });
  });

  it('marks a Foundry reload when the event counter goes backwards', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 2000);
    const pump = makePump();
    foundry.add(T0);
    foundry.add(T0 + 1000);
    await pump.pollOnce();
    foundry.events = [];
    foundry.seq = 0;
    foundry.add(T0 + 5000); // evt-1 again
    vi.setSystemTime(T0 + 6000);
    await pump.pollOnce();
    const markers = await gapMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ details: { reason: 'foundry-reload' } });
    expect(markers[0]?.description).toContain('Foundry was reloaded');
  });

  it('writes no marker for an empty first poll after a night, nor for the event after it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const pump = makePump();
    foundry.add(T0);
    foundry.add(T0 + 1000);
    await pump.pollOnce();

    foundry.connected = false;
    await pump.pollOnce();
    const next = T0 + 14 * 3_600_000;
    vi.setSystemTime(next);
    foundry.connected = true;
    foundry.events = [];
    foundry.seq = 0; // Foundry reopened: a fresh page load, nothing happened yet
    await pump.pollOnce();
    vi.setSystemTime(next + 5000);
    foundry.add(next + 4000); // evt-1 again, lower than the saved counter
    await pump.pollOnce();
    expect(await gapMarkers()).toHaveLength(0);
    expect(pump.health.snapshot().gapCount).toBe(0);
  });

  it('writes one marker for a reload behind an outage with an empty reconnect poll', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const pump = makePump();
    foundry.add(T0);
    foundry.add(T0 + 1000);
    await pump.pollOnce();

    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 60_000);
    foundry.connected = true;
    foundry.events = [];
    foundry.seq = 0;
    await pump.pollOnce(); // reconnected, nothing to read yet
    expect(await gapMarkers()).toHaveLength(0);
    vi.setSystemTime(T0 + 70_000);
    foundry.add(T0 + 65_000);
    await pump.pollOnce();
    const markers = await gapMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ details: { reason: 'foundry-reload' } });
  });

  it('holds a long outage until events show no reload explains it, then marks the link', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 60_000);
    foundry.connected = true;
    await pump.pollOnce(); // empty reconnect poll
    expect(await gapMarkers()).toHaveLength(0);
    foundry.add(T0 + 61_000);
    vi.setSystemTime(T0 + 65_000);
    await pump.pollOnce();
    const markers = await gapMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ details: { reason: 'link-down' } });
  });

  it('counts the 3 h rule from the world own newest event, not from the other world', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    let world = 'w1';
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = (): unknown => logger;
    const pump = new EventPump({
      foundryClient: foundry,
      worldIds: { current: (): Promise<string> => Promise.resolve(world) },
      store,
      logger,
      intervalMs: 5000,
    });
    // w2 saved long ago (4 days) with its own counter
    await store.write('w2', 'sessions', PUMP_STATE_FILE, {
      cursorMs: T0 - 4 * 86_400_000,
      boundaryIds: [],
      lastSeq: 40,
    });
    foundry.add(T0);
    await pump.pollOnce(); // world w1 is read fine just now
    world = 'w2';
    foundry.events = [];
    foundry.seq = 0;
    foundry.add(T0 + 2000);
    vi.setSystemTime(T0 + 3000);
    await pump.pollOnce();
    expect(await gapMarkers()).toHaveLength(0);
  });

  it('does not repeat a marker every poll while the data append keeps failing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 2000);
    const pump = makePump();
    foundry.add(T0);
    foundry.add(T0 + 1000);
    await pump.pollOnce();
    foundry.events = [];
    foundry.seq = 0;
    foundry.add(T0 + 5000);
    vi.setSystemTime(T0 + 6000);
    const real = store.appendLines.bind(store);
    vi.spyOn(store, 'appendLines').mockImplementation(async (w, k, f, lines) => {
      if ((lines as Array<{ eventType?: string }>)[0]?.eventType === 'pump-gap') {
        return real(w, k, f, lines);
      }
      throw new Error('locked');
    });
    await pump.pollOnce();
    await pump.pollOnce();
    await pump.pollOnce();
    expect(await gapMarkers()).toHaveLength(1);
    expect(pump.health.snapshot().gapCount).toBe(1);
  });

  it('marks an outage past a blip, and ignores a short one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();

    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 5000);
    foundry.connected = true;
    await pump.pollOnce();
    expect(await gapMarkers()).toHaveLength(0);

    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 60_000);
    await pump.pollOnce();
    expect(pump.health.snapshot().notRecordingSince).not.toBeNull();
    foundry.connected = true;
    foundry.add(T0 + 61_000);
    await pump.pollOnce();
    const markers = await gapMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ details: { reason: 'link-down' } });
    expect(pump.health.snapshot()).toMatchObject({ notRecordingSince: null, gapCount: 1 });
  });

  it('treats Foundry closed overnight and reopened as a new night, not a gap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const pump = makePump();
    foundry.add(T0);
    foundry.add(T0 + 1000);
    await pump.pollOnce();

    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 12 * 3_600_000);
    await pump.pollOnce();
    foundry.connected = true;
    foundry.events = [];
    foundry.seq = 0; // a fresh page load
    foundry.add(T0 + 12 * 3_600_000);
    await pump.pollOnce();
    expect(await gapMarkers()).toHaveLength(0);
    expect(pump.health.snapshot().gapCount).toBe(0);

    // The counter was reset to the new load, so a reload mid-session is still caught.
    vi.setSystemTime(T0 + 12 * 3_600_000 + 60_000);
    foundry.add(T0 + 12 * 3_600_000 + 30_000);
    await pump.pollOnce();
    foundry.events = [];
    foundry.seq = 0;
    foundry.add(T0 + 12 * 3_600_000 + 90_000);
    vi.setSystemTime(T0 + 12 * 3_600_000 + 120_000);
    await pump.pollOnce();
    const markers = await gapMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ details: { reason: 'foundry-reload' } });
  });

  it('does not turn a short blip into a link-down line when the next event comes later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 5000);
    foundry.connected = true;
    await pump.pollOnce(); // back after 5 s, nothing to read
    foundry.add(T0 + 40_000);
    vi.setSystemTime(T0 + 41_000);
    await pump.pollOnce();
    expect(await gapMarkers()).toHaveLength(0);
    expect(pump.health.snapshot().gapCount).toBe(0);
  });

  it('writes no reload marker when the data append fails once on a plain batch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 2000);
    const pump = makePump();
    foundry.add(T0);
    foundry.add(T0 + 1000);
    await pump.pollOnce();
    foundry.add(T0 + 3000);
    foundry.add(T0 + 4000);
    vi.setSystemTime(T0 + 5000);
    const spy = vi.spyOn(store, 'appendLines').mockRejectedValueOnce(new Error('locked'));
    await pump.pollOnce();
    spy.mockRestore();
    await pump.pollOnce();
    expect(await gapMarkers()).toHaveLength(0);
    expect(pump.health.snapshot().gapCount).toBe(0);
  });

  it('is no ring wrap when the batch is full but holds the saved boundary id', async () => {
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    // The module returns the newest 1000 since the cursor: the boundary event plus 999 new ones.
    for (let i = 1; i <= 999; i++) foundry.add(T0 + i * 10);
    await pump.pollOnce();
    expect(await gapMarkers()).toHaveLength(0);
    expect(pump.health.snapshot().gapCount).toBe(0);
  });

  it.each([
    {
      name: 'a longer later outage replaces a shorter unfiled one',
      first: 60_000,
      second: 130_000,
    },
    {
      name: 'a shorter later outage does not replace a longer unfiled one',
      first: 130_000,
      second: 60_000,
    },
  ])('of two unfiled outages the longer is kept: $name', async ({ first, second }) => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    let failWorld = false;
    const pump = makePump({
      current: (): Promise<string> =>
        failWorld ? Promise.reject(new Error('no world')) : Promise.resolve('w1'),
    });
    foundry.add(T0);
    await pump.pollOnce();
    // Outage one: back, but the world-id fetch fails, so it stays unfiled.
    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + first);
    foundry.connected = true;
    failWorld = true;
    await pump.pollOnce();
    // Outage two, also unfiled.
    const secondStart = T0 + first + 10_000;
    vi.setSystemTime(secondStart);
    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(secondStart + second);
    foundry.connected = true;
    await pump.pollOnce();
    // A good poll with an event files the longer one.
    failWorld = false;
    foundry.add(secondStart + second + 1000);
    vi.setSystemTime(secondStart + second + 2000);
    await pump.pollOnce();
    const gap = pump.health.snapshot().lastGap;
    expect(await gapMarkers()).toHaveLength(1);
    if (first >= second) expect(gap?.toMs).toBe(T0 + first);
    else expect(gap?.toMs).toBe(secondStart + second);
  });

  it('clears "not recording" when the link returns even if the query then fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 60_000);
    await pump.pollOnce();
    expect(pump.health.snapshot().notRecordingSince).not.toBeNull();
    foundry.connected = true;
    foundry.fail = 'refused';
    await pump.pollOnce();
    expect(pump.health.snapshot().notRecordingSince).toBeNull();
    expect(pump.health.snapshot().lastError?.message).toBe('refused');
  });

  it('clears "not recording" when the link returns even if the world-id fetch then fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    let failWorld = false;
    const pump = makePump({
      current: (): Promise<string> =>
        failWorld ? Promise.reject(new Error('no world')) : Promise.resolve('w1'),
    });
    foundry.add(T0);
    await pump.pollOnce();
    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 60_000);
    await pump.pollOnce();
    expect(pump.health.snapshot().notRecordingSince).not.toBeNull();
    foundry.connected = true;
    failWorld = true;
    await pump.pollOnce();
    expect(pump.health.snapshot().notRecordingSince).toBeNull();
    // The outage start survives the failed fetch, so the next good poll still marks the link.
    failWorld = false;
    foundry.add(T0 + 90_000);
    vi.setSystemTime(T0 + 92_000);
    await pump.pollOnce();
    const markers = await gapMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ details: { reason: 'link-down' } });
    // The window ends when the link came back, not when the failed fetch was retried.
    expect(pump.health.snapshot().lastGap?.toMs).toBe(T0 + 60_000);
  });

  it('writes only the ring-wrap marker when an outage also overflowed the buffer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 60_000);
    await pump.pollOnce();
    foundry.connected = true;
    for (let i = 1; i <= 1000; i++) foundry.add(T0 + 1000 + i);
    vi.setSystemTime(T0 + 62_000);
    await pump.pollOnce();
    const markers = await gapMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ details: { reason: 'ring-wrap' } });
    expect(markers[0]?.description).not.toContain('read back');
  });

  it('retries a failed link-down line and writes it exactly once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 60_000);
    await pump.pollOnce();
    foundry.connected = true;
    foundry.add(T0 + 61_000);
    vi.setSystemTime(T0 + 62_000);
    const spy = vi.spyOn(store, 'appendLines').mockRejectedValueOnce(new Error('locked'));
    await pump.pollOnce();
    spy.mockRestore();
    expect(await gapMarkers()).toHaveLength(0);
    await pump.pollOnce();
    await pump.pollOnce();
    const markers = await gapMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ details: { reason: 'link-down' } });
    expect(markers[0]?.description).not.toContain('may be missing');
    expect(pump.health.snapshot().gapCount).toBe(1);
  });

  it('writes no second inverted line when the state save fails after a link-down line', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const pump = makePump();
    foundry.add(T0);
    await pump.pollOnce();
    foundry.connected = false;
    await pump.pollOnce();
    vi.setSystemTime(T0 + 60_000);
    await pump.pollOnce();
    foundry.connected = true;
    foundry.add(T0 + 61_000);
    vi.setSystemTime(T0 + 62_000);
    const spy = vi.spyOn(store, 'write').mockRejectedValueOnce(new Error('disk full'));
    await pump.pollOnce();
    spy.mockRestore();
    await pump.pollOnce();
    foundry.add(T0 + 70_000);
    vi.setSystemTime(T0 + 71_000);
    await pump.pollOnce();
    expect(await gapMarkers()).toHaveLength(1);
  });

  it('records the last error and clears it on the next good read', async () => {
    const pump = makePump();
    foundry.fail = 'refused';
    await pump.pollOnce();
    expect(pump.health.snapshot().lastError?.message).toBe('refused');
    foundry.fail = null;
    await pump.pollOnce();
    expect(pump.health.snapshot().lastError).toBeNull();
    expect(pump.health.snapshot().lastSuccessAt).not.toBeNull();
  });
});
