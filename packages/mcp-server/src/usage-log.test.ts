import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { USAGE_LIMITS, usageLogFileName } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localDateKey } from './event-pump.js';
import { usageEvent } from './test-support/usage-events.js';
import { UsageLog, handleRecordUsage, usageLogEnabled } from './usage-log.js';
import { VaultStore } from './vault/store.js';

let dataDir: string;
let store: VaultStore;
let logger: any;
let world: string | null;

function makeLog(extra: Partial<ConstructorParameters<typeof UsageLog>[0]> = {}): UsageLog {
  return new UsageLog({
    store,
    worldIds: {
      current: (): Promise<string> =>
        world ? Promise.resolve(world) : Promise.reject(new Error('Foundry is not connected')),
    },
    logger,
    enabled: true,
    ...extra,
  });
}

async function keysOn(date: string, worldId = 'w1'): Promise<string[]> {
  const lines = (await store.readLines(worldId, 'sessions', usageLogFileName(date))) as Array<{
    key: string;
  }>;
  return lines.map(l => l.key);
}

const DAY1 = new Date(2026, 8, 28, 20, 0, 0).getTime();
const DAY2 = new Date(2026, 8, 29, 1, 0, 0).getTime();

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-log-'));
  store = new VaultStore({ dataDir });
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  world = 'w1';
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('usageLogEnabled', () => {
  it('is on by default and off for off/false/0/no', () => {
    expect(usageLogEnabled({})).toBe(true);
    for (const v of ['off', 'OFF', 'false', '0', 'no']) {
      expect(usageLogEnabled({ FOUNDRY_AI_USAGE_LOG: v })).toBe(false);
    }
    expect(usageLogEnabled({ FOUNDRY_AI_USAGE_LOG: 'on' })).toBe(true);
  });
});

describe('UsageLog.append', () => {
  it('writes one line per event to the local-date file', async () => {
    const log = makeLog();
    const a = usageEvent({ t: DAY1 });
    const b = usageEvent({ t: DAY1 + 1000 });
    expect(await log.append('w1', [a, b])).toBe(2);
    expect(await keysOn('2026-09-28')).toEqual([a.key, b.key]);
  });

  it('splits a batch across local dates', async () => {
    const log = makeLog();
    const a = usageEvent({ t: DAY1 });
    const b = usageEvent({ t: DAY2 });
    expect(await log.append('w1', [a, b])).toBe(2);
    expect(await keysOn('2026-09-28')).toEqual([a.key]);
    expect(await keysOn('2026-09-29')).toEqual([b.key]);
  });

  it('drops duplicate keys within a batch, across batches and after a restart', async () => {
    const log = makeLog();
    const a = usageEvent({ t: DAY1 });
    expect(await log.append('w1', [a, a])).toBe(1);
    expect(await log.append('w1', [a])).toBe(0);
    const restarted = makeLog();
    const b = usageEvent({ t: DAY1 });
    expect(await restarted.append('w1', [a, b])).toBe(1);
    expect(await keysOn('2026-09-28')).toEqual([a.key, b.key]);
  });

  it('never writes the same key twice for concurrent appends', async () => {
    const log = makeLog();
    const a = usageEvent({ t: DAY1 });
    const results = await Promise.all([log.append('w1', [a]), log.append('w1', [a])]);
    expect(results.reduce((x, y) => x + y, 0)).toBe(1);
    expect(await keysOn('2026-09-28')).toEqual([a.key]);
  });

  it('asks the resolver when the world is null and uses it', async () => {
    const log = makeLog();
    const a = usageEvent({ t: DAY1 });
    expect(await log.append(null, [a])).toBe(1);
    expect(await keysOn('2026-09-28')).toEqual([a.key]);
  });

  it('holds events while no world is known and writes them once one is', async () => {
    const log = makeLog();
    world = null;
    const a = usageEvent({ t: DAY1 });
    expect(await log.append(null, [a])).toBe(0);
    expect(log.pendingCount).toBe(1);
    expect(await log.flushPending()).toBe(0);
    expect(log.pendingCount).toBe(1);

    world = 'w1';
    const b = usageEvent({ t: DAY1 });
    expect(await log.append(null, [b])).toBe(2);
    expect(log.pendingCount).toBe(0);
    expect(await keysOn('2026-09-28')).toEqual([a.key, b.key]);
  });

  it('flushPending writes the held events when the world becomes known', async () => {
    const log = makeLog();
    world = null;
    await log.append(null, [usageEvent({ t: DAY1 })]);
    await log.flushPending('w9');
    expect((await keysOn('2026-09-28', 'w9')).length).toBe(1);
  });

  it('caps the in-memory buffer and drops the oldest events', async () => {
    const log = makeLog();
    world = null;
    const total = USAGE_LIMITS.maxBuffered + 20;
    const events = Array.from({ length: total }, (_, i) => usageEvent({ t: DAY1 + i, seq: i }));
    for (let i = 0; i < events.length; i += 100) {
      await log.append(null, events.slice(i, i + 100));
    }
    expect(log.pendingCount).toBe(USAGE_LIMITS.maxBuffered);
    expect(logger.warn).toHaveBeenCalled();
    world = 'w1';
    await log.flushPending();
    const keys = await keysOn('2026-09-28');
    expect(keys).toHaveLength(USAGE_LIMITS.maxBuffered);
    expect(keys[0]).toBe(events[20]?.key);
  });

  it('writes nothing and holds nothing when switched off', async () => {
    const log = makeLog({ enabled: false });
    expect(log.enabled).toBe(false);
    expect(await log.append('w1', [usageEvent({ t: DAY1 })])).toBe(0);
    world = null;
    expect(await log.append(null, [usageEvent({ t: DAY1 })])).toBe(0);
    expect(log.pendingCount).toBe(0);
    expect(await keysOn('2026-09-28')).toEqual([]);
  });

  it('triggers the listener after a non-empty append only, and survives a throwing listener', async () => {
    const onAppended = vi.fn();
    const log = makeLog({ onAppended });
    const a = usageEvent({ t: DAY1 });
    await log.append('w1', [a]);
    expect(onAppended).toHaveBeenCalledWith('w1', 1);
    await log.append('w1', [a]);
    expect(onAppended).toHaveBeenCalledTimes(1);

    const throwing = makeLog({
      onAppended: () => {
        throw new Error('boom');
      },
    });
    await expect(throwing.append('w1', [usageEvent({ t: DAY2 })])).resolves.toBe(1);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('handleRecordUsage (control method record_usage)', () => {
  it('sanitizes again, keeps surface and who as sent, and answers accepted and dropped', async () => {
    const log = makeLog();
    const good = usageEvent({
      t: Date.now(),
      surface: 'player',
      name: 'player.handouts.open',
      who: { role: 'player', userId: 'u-p', name: 'Ada' },
    });
    const bad = { ...usageEvent(), name: 'Not A Name' };
    const extra = { ...usageEvent({ t: Date.now() }), secret: 'typed text', description: 'x' };
    const result = await handleRecordUsage(log, { events: [good, bad, extra, 'junk'] });
    expect(result).toEqual({ accepted: 2, dropped: 2 });
    const lines = (await store.readLines(
      'w1',
      'sessions',
      usageLogFileName(localDateKey(good.t))
    )) as any[];
    const written = lines.find(l => l.key === good.key);
    expect(written.surface).toBe('player');
    expect(written.who).toEqual({ role: 'player', userId: 'u-p', name: 'Ada' });
    expect(JSON.stringify(lines)).not.toContain('typed text');
  });

  it('answers zero for a missing or malformed params object', async () => {
    const log = makeLog();
    expect(await handleRecordUsage(log, undefined)).toEqual({ accepted: 0, dropped: 0 });
    expect(await handleRecordUsage(log, { events: 'nope' })).toEqual({ accepted: 0, dropped: 0 });
  });
});
