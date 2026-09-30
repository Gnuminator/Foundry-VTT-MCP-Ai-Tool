import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { usageLogFileName, type UsageEvent } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usageEvent } from './test-support/usage-events.js';
import { UsageLog } from './usage-log.js';
import { USAGE_PUMP_STATE_FILE, UsagePump } from './usage-pump.js';
import { VaultStore } from './vault/store.js';

const T0 = new Date(2026, 8, 28, 20, 0, 0).getTime();

/** The module's usage buffer: `seq > sinceSeq` filter, one `clientId`. */
class FakeModule {
  records: Array<UsageEvent & { bufferSeq: number }> = [];
  connected = true;
  clientId = 'page-1';
  /** Simulates an older module build without the handler. */
  oldModule = false;
  fail: string | null = null;
  private seq = 0;

  add(overrides: Partial<UsageEvent> = {}): UsageEvent {
    this.seq += 1;
    const event = usageEvent({ t: T0, ...overrides });
    this.records.push({ ...event, bufferSeq: this.seq });
    return event;
  }

  restart(clientId: string): void {
    this.clientId = clientId;
    this.seq = 0;
    this.records = [];
  }

  query = vi.fn((method: string, data: any): Promise<unknown> => {
    if (this.oldModule) {
      return Promise.reject(new Error(`No handler found for query: ${method}`));
    }
    if (this.fail) return Promise.reject(new Error(this.fail));
    if (method !== 'foundry-mcp-bridge.getUsageRecords') {
      return Promise.reject(new Error(`unexpected ${method}`));
    }
    const since = typeof data.sinceSeq === 'number' ? data.sinceSeq : 0;
    const matching = this.records.filter(r => r.bufferSeq > since).slice(0, data.limit);
    return Promise.resolve({
      success: true,
      clientId: this.clientId,
      records: matching.map(({ bufferSeq: _b, ...event }) => event),
      oldestSeq: this.records[0]?.bufferSeq ?? 0,
      latestSeq: this.records[this.records.length - 1]?.bufferSeq ?? 0,
    });
  });

  isConnected = (): boolean => this.connected;
}

let dataDir: string;
let store: VaultStore;
let foundry: FakeModule;
let logger: any;
let world: string;

function makePump(): { pump: UsagePump; log: UsageLog } {
  const worldIds = { current: (): Promise<string> => Promise.resolve(world) };
  const log = new UsageLog({ store, worldIds, logger, enabled: true });
  const pump = new UsagePump({
    foundryClient: foundry,
    worldIds,
    store,
    usageLog: log,
    logger,
    intervalMs: 5000,
  });
  return { pump, log };
}

async function keys(): Promise<string[]> {
  const lines = (await store.readLines('w1', 'sessions', usageLogFileName('2026-09-28'))) as Array<{
    key: string;
  }>;
  return lines.map(l => l.key);
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-pump-'));
  store = new VaultStore({ dataDir });
  foundry = new FakeModule();
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  world = 'w1';
});

afterEach(async () => {
  vi.useRealTimers();
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('UsagePump.pollOnce', () => {
  it('feeds new events to the log once each', async () => {
    const { pump } = makePump();
    const a = foundry.add();
    const b = foundry.add();
    expect(await pump.pollOnce()).toBe(2);
    expect(await pump.pollOnce()).toBe(0);
    const c = foundry.add();
    expect(await pump.pollOnce()).toBe(1);
    expect(await keys()).toEqual([a.key, b.key, c.key]);
  });

  it('does nothing while Foundry is not connected', async () => {
    const { pump } = makePump();
    foundry.add();
    foundry.connected = false;
    expect(await pump.pollOnce()).toBe(0);
    expect(foundry.query).not.toHaveBeenCalled();
  });

  it('drops records that are not usage events', async () => {
    const { pump } = makePump();
    foundry.add();
    foundry.records.push({ ...usageEvent(), name: 'Bad Name', bufferSeq: 2 });
    expect(await pump.pollOnce()).toBe(1);
  });

  it('keeps its cursor across a restart (state file) and does not re-read old events', async () => {
    const first = makePump();
    foundry.add();
    foundry.add();
    await first.pump.pollOnce();
    const state = await store.read<{ clientId: string; lastSeq: number }>(
      'w1',
      'sessions',
      USAGE_PUMP_STATE_FILE
    );
    expect(state?.data).toEqual({ clientId: 'page-1', lastSeq: 2 });

    foundry.query.mockClear();
    const second = makePump();
    const c = foundry.add();
    expect(await second.pump.pollOnce()).toBe(1);
    expect(foundry.query).toHaveBeenCalledTimes(1);
    expect(foundry.query.mock.calls[0]?.[1]).toMatchObject({ sinceSeq: 2 });
    expect((await keys()).at(-1)).toBe(c.key);
  });

  it('re-asks from 0 after a module reload and drops keys it already holds', async () => {
    const { pump } = makePump();
    const a = foundry.add();
    await pump.pollOnce();
    foundry.restart('page-2');
    const b = foundry.add({ clientId: 'client-b', seq: 1 });
    expect(await pump.pollOnce()).toBe(1);
    expect(await keys()).toEqual([a.key, b.key]);

    // The same events offered again (two GM clients, or a replay) are not written twice.
    foundry.restart('page-3');
    foundry.add({ ...a });
    await pump.pollOnce();
    expect(await keys()).toEqual([a.key, b.key]);
  });

  it('stays quiet with an older module that has no getUsageRecords handler', async () => {
    const { pump } = makePump();
    foundry.oldModule = true;
    expect(await pump.pollOnce()).toBe(0);
    expect(await pump.pollOnce()).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    foundry.oldModule = false;
    foundry.add();
    expect(await pump.pollOnce()).toBe(1);
  });

  it('logs a real failure once until it recovers', async () => {
    const { pump } = makePump();
    foundry.fail = 'socket closed';
    await pump.pollOnce();
    await pump.pollOnce();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    foundry.fail = null;
    foundry.add();
    expect(await pump.pollOnce()).toBe(1);
    expect(logger.info).toHaveBeenCalledWith('Usage pump recovered');
  });

  it('writes the events that waited for a world (dashboard batches before Foundry connected)', async () => {
    const worldIds = {
      current: vi
        .fn<[], Promise<string>>()
        .mockRejectedValueOnce(new Error('Foundry is not connected'))
        .mockResolvedValue('w1'),
    };
    const log = new UsageLog({ store, worldIds, logger, enabled: true });
    const held = usageEvent({ t: T0 });
    await log.append(null, [held]);
    expect(log.pendingCount).toBe(1);
    const pump = new UsagePump({
      foundryClient: foundry,
      worldIds,
      store,
      usageLog: log,
      logger,
    });
    await pump.pollOnce();
    expect(log.pendingCount).toBe(0);
    expect(await keys()).toEqual([held.key]);
  });

  it('does not poll when the log is switched off', async () => {
    const worldIds = { current: (): Promise<string> => Promise.resolve('w1') };
    const log = new UsageLog({ store, worldIds, logger, enabled: false });
    const pump = new UsagePump({ foundryClient: foundry, worldIds, store, usageLog: log, logger });
    foundry.add();
    expect(await pump.pollOnce()).toBe(0);
    expect(foundry.query).not.toHaveBeenCalled();
  });
});
