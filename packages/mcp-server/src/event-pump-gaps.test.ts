import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventPump, eventSeq } from './event-pump.js';
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

function makePump(): EventPump {
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  return new EventPump({
    foundryClient: foundry,
    worldIds: { current: (): Promise<string> => Promise.resolve('w1') },
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
    const pump = makePump();
    foundry.add(T0);
    foundry.add(T0 + 1000);
    await pump.pollOnce();
    foundry.events = [];
    foundry.seq = 0;
    foundry.add(T0 + 5000); // evt-1 again
    await pump.pollOnce();
    const markers = await gapMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ details: { reason: 'foundry-reload' } });
    expect(markers[0]?.description).toContain('Foundry was reloaded');
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
