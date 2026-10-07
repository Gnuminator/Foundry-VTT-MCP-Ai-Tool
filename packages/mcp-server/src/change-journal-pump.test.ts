import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ChangeRecord } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHANGE_JOURNAL_RETENTION_DAYS,
  CHANGE_PUMP_STATE_FILE,
  ChangeJournalPump,
  DEFAULT_CHANGE_JOURNAL_MAX_BYTES,
  changeJournalDateOf,
  changeJournalFileName,
  changeJournalSettings,
} from './change-journal-pump.js';
import { localDateKey } from './event-pump.js';
import { VaultStore } from './vault/store.js';

const T0 = new Date(2026, 9, 6, 20, 0, 0).getTime();

/** The module's change journal: `seq > sinceSeq` filter, up to `limit` records, one `clientId`. */
class FakeModule {
  records: ChangeRecord[] = [];
  connected = true;
  worldId = 'w1';
  clientId = 'client-1';
  fail: string | null = null;
  private seq = 0;

  add(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
    this.seq += 1;
    const record: ChangeRecord = {
      v: 1,
      key: `k-${this.seq}`,
      seq: this.seq,
      t: T0,
      actionId: `a-${this.seq}`,
      op: 'update',
      userId: 'u1',
      userName: 'Ireena',
      userIsGM: false,
      documentName: 'Actor',
      uuid: 'Actor.a1',
      parentUuid: null,
      name: 'Ireena',
      rootUuid: 'Actor.a1',
      rootName: 'Ireena',
      sceneId: null,
      ...overrides,
    };
    this.records.push(record);
    return record;
  }

  reload(clientId: string): void {
    this.clientId = clientId;
    this.records = [];
    this.seq = 0;
  }

  /** Simulate the ring buffer dropping its oldest `n` records without the pump reading them. */
  evictOldest(n: number): void {
    this.records.splice(0, n);
  }

  query = vi.fn((method: string, data: any): Promise<unknown> => {
    if (this.fail) return Promise.reject(new Error(this.fail));
    if (method === 'foundry-mcp-bridge.getChangeJournal') {
      const sinceSeq = typeof data.sinceSeq === 'number' ? data.sinceSeq : 0;
      const matching = this.records.filter(r => r.seq > sinceSeq).slice(0, data.limit);
      return Promise.resolve({
        success: true,
        clientId: this.clientId,
        records: matching,
        oldestSeq: this.records[0]?.seq ?? 0,
        latestSeq: this.records[this.records.length - 1]?.seq ?? 0,
      });
    }
    return Promise.reject(new Error(`unexpected ${method}`));
  });

  isConnected = (): boolean => this.connected;
}

let dataDir: string;
let store: VaultStore;
let foundry: FakeModule;
let logger: any;

function makePump(
  extra: Partial<{
    onAppended: (worldId: string, records: ChangeRecord[]) => void;
    now: () => number;
    maxBytes: number;
  }> = {}
): ChangeJournalPump {
  return new ChangeJournalPump({
    foundryClient: foundry,
    worldIds: { current: (): Promise<string> => Promise.resolve(foundry.worldId) },
    store,
    logger,
    intervalMs: 5000,
    ...extra,
  });
}

async function loggedKeys(date: string, worldId = 'w1'): Promise<string[]> {
  const lines = (await store.readLines(worldId, 'gm', changeJournalFileName(date))) as Array<{
    key: string;
  }>;
  return lines.map(l => l.key);
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'change-journal-pump-'));
  store = new VaultStore({ dataDir });
  foundry = new FakeModule();
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
});

afterEach(async () => {
  vi.useRealTimers();
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('changeJournalSettings', () => {
  it('is on by default, shares the event pump interval and caps the files at 64 MB', () => {
    expect(changeJournalSettings({})).toEqual({
      enabled: true,
      intervalMs: 5000,
      maxBytes: DEFAULT_CHANGE_JOURNAL_MAX_BYTES,
    });
  });

  it('can be switched off and reads FOUNDRY_AI_EVENT_POLL_MS for its interval', () => {
    for (const off of ['off', 'FALSE', '0', 'no']) {
      expect(changeJournalSettings({ FOUNDRY_AI_CHANGE_JOURNAL: off }).enabled).toBe(false);
    }
    expect(changeJournalSettings({ FOUNDRY_AI_EVENT_POLL_MS: '15000' }).intervalMs).toBe(15000);
    expect(changeJournalSettings({ FOUNDRY_AI_EVENT_POLL_MS: '10' }).intervalMs).toBe(1000);
  });

  it('reads FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB for the byte cap and ignores nonsense', () => {
    expect(changeJournalSettings({ FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB: '8' }).maxBytes).toBe(
      8 * 1024 * 1024
    );
    expect(changeJournalSettings({ FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB: '0.5' }).maxBytes).toBe(
      512 * 1024
    );
    for (const bad of ['', 'lots', '0', '-3']) {
      expect(changeJournalSettings({ FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB: bad }).maxBytes).toBe(
        DEFAULT_CHANGE_JOURNAL_MAX_BYTES
      );
    }
  });
});

describe('changeJournalDateOf', () => {
  it('reads the date of a journal file and nothing else', () => {
    expect(changeJournalDateOf('changes-2026-10-07.jsonl')).toBe('2026-10-07');
    expect(changeJournalDateOf(CHANGE_PUMP_STATE_FILE)).toBeNull();
    expect(changeJournalDateOf('changes-2026-10-07.jsonl.tmp')).toBeNull();
    expect(changeJournalDateOf('audit-log.jsonl')).toBeNull();
  });
});

describe('ChangeJournalPump retention', () => {
  const day = (back: number): string => localDateKey(new Date(2026, 9, 7 - back, 12).getTime());
  const NOW = new Date(2026, 9, 7, 20, 0, 0).getTime();

  async function seedFile(date: string, lines: number, size = 10): Promise<void> {
    const values = Array.from({ length: lines }, (_, i) => ({
      key: `${date}-${i}`,
      pad: 'x'.repeat(size),
    }));
    await store.appendLines('w1', 'gm', changeJournalFileName(date), values);
  }

  it('removes files older than the retention span on the first poll, and keeps the rest', async () => {
    await seedFile(day(CHANGE_JOURNAL_RETENTION_DAYS + 2), 1);
    await seedFile(day(CHANGE_JOURNAL_RETENTION_DAYS + 1), 1);
    await seedFile(day(CHANGE_JOURNAL_RETENTION_DAYS), 1);
    await seedFile(day(1), 1);
    await store.write('w1', 'gm', 'other.json', { keep: true });
    const pump = makePump({ now: () => NOW });
    await pump.pollOnce();
    expect(await store.list('w1', 'gm')).toEqual(
      [
        CHANGE_PUMP_STATE_FILE,
        'other.json',
        changeJournalFileName(day(CHANGE_JOURNAL_RETENTION_DAYS)),
        changeJournalFileName(day(1)),
      ].sort()
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Change journal files removed',
      expect.objectContaining({
        files: [
          changeJournalFileName(day(CHANGE_JOURNAL_RETENTION_DAYS + 2)),
          changeJournalFileName(day(CHANGE_JOURNAL_RETENTION_DAYS + 1)),
        ],
      })
    );
  });

  it('removes the oldest files while the total is over the byte cap, never the newest', async () => {
    await seedFile(day(3), 20, 100);
    await seedFile(day(2), 20, 100);
    await seedFile(day(1), 20, 100);
    const pump = makePump({ now: () => NOW, maxBytes: 3000 });
    await pump.pollOnce();
    expect(await store.list('w1', 'gm')).toEqual(
      [CHANGE_PUMP_STATE_FILE, changeJournalFileName(day(1))].sort()
    );
    // A cap too small for even the newest file still keeps that file.
    await seedFile(day(0), 20, 100);
    const tiny = makePump({ now: () => NOW, maxBytes: 1 });
    await tiny.pollOnce();
    expect(await store.list('w1', 'gm')).toEqual(
      [CHANGE_PUMP_STATE_FILE, changeJournalFileName(day(0))].sort()
    );
  });

  it('runs once per local day', async () => {
    let now = NOW;
    const pump = makePump({ now: () => now });
    await pump.pollOnce();
    await seedFile(day(CHANGE_JOURNAL_RETENTION_DAYS + 1), 1);
    await pump.pollOnce();
    expect(await store.list('w1', 'gm')).toContain(
      changeJournalFileName(day(CHANGE_JOURNAL_RETENTION_DAYS + 1))
    );
    now += 24 * 60 * 60 * 1000;
    await pump.pollOnce();
    expect(await store.list('w1', 'gm')).not.toContain(
      changeJournalFileName(day(CHANGE_JOURNAL_RETENTION_DAYS + 1))
    );
  });
});

describe('ChangeJournalPump.pollOnce', () => {
  it('appends new records to the local-date file in the gm area, once each', async () => {
    const pump = makePump();
    foundry.add({ key: 'a' });
    foundry.add({ key: 'b' });
    expect(await pump.pollOnce()).toBe(2);
    expect(await pump.pollOnce()).toBe(0);
    foundry.add({ key: 'c' });
    expect(await pump.pollOnce()).toBe(1);

    expect(await store.list('w1', 'gm')).toEqual(
      [CHANGE_PUMP_STATE_FILE, changeJournalFileName(localDateKey(T0))].sort()
    );
    expect(await loggedKeys(localDateKey(T0))).toEqual(['a', 'b', 'c']);
  });

  it('splits a batch across local dates (midnight)', async () => {
    const midnight = new Date(2026, 9, 7, 0, 0, 0).getTime();
    foundry.add({ key: 'late', t: midnight - 1 });
    foundry.add({ key: 'early', t: midnight });
    expect(await makePump().pollOnce()).toBe(2);
    expect(await loggedKeys('2026-10-06')).toEqual(['late']);
    expect(await loggedKeys('2026-10-07')).toEqual(['early']);
  });

  it('drops a duplicate key inside the same batch', async () => {
    foundry.add({ key: 'dup' });
    foundry.add({ key: 'dup' });
    foundry.add({ key: 'unique' });
    expect(await makePump().pollOnce()).toBe(2);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['dup', 'unique']);
  });

  it('resumes from the saved cursor after a restart, deduping against the file', async () => {
    foundry.add({ key: 'a' });
    foundry.add({ key: 'b' });
    await makePump().pollOnce();

    const restarted = makePump();
    foundry.add({ key: 'c' });
    expect(await restarted.pollOnce()).toBe(1);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['a', 'b', 'c']);
  });

  it('a second GM browser reporting the same keys writes nothing new', async () => {
    foundry.add({ key: 'update:Actor.a1:100' });
    foundry.add({ key: 'update:Actor.a1:200' });
    await makePump().pollOnce();

    foundry.reload('client-2');
    foundry.add({ key: 'update:Actor.a1:100' });
    foundry.add({ key: 'update:Actor.a1:200' });
    expect(await makePump().pollOnce()).toBe(0);
    expect(await loggedKeys(localDateKey(T0))).toEqual([
      'update:Actor.a1:100',
      'update:Actor.a1:200',
    ]);
  });

  it('restarts at sinceSeq 0 when the clientId changes', async () => {
    foundry.add({ key: 'a' });
    foundry.add({ key: 'b' });
    await makePump().pollOnce();

    foundry.reload('client-2');
    foundry.add({ key: 'x' });
    foundry.add({ key: 'y' });
    expect(await makePump().pollOnce()).toBe(2);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['a', 'b', 'x', 'y']);
    expect(foundry.query).toHaveBeenLastCalledWith('foundry-mcp-bridge.getChangeJournal', {
      sinceSeq: 0,
      limit: 500,
    });
  });

  it('logs a warning when the ring buffer wraps past the saved cursor', async () => {
    foundry.add({ key: 'a' });
    foundry.add({ key: 'b' });
    foundry.add({ key: 'c' });
    await makePump().pollOnce(); // lastSeq saved as 3

    foundry.add({ key: 'd' });
    foundry.add({ key: 'e' });
    foundry.evictOldest(4); // only 'e' (seq 5) is left; 'd' is unrecoverable
    expect(await makePump().pollOnce()).toBe(1);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['a', 'b', 'c', 'e']);
    expect(logger.warn).toHaveBeenCalledWith(
      'Change journal records lost: the ring buffer wrapped before the pump read them',
      expect.objectContaining({ worldId: 'w1', expectedFrom: 4, oldestSeq: 5 })
    );
  });

  it('does not warn about loss across a clientId change', async () => {
    foundry.add({ key: 'a' });
    await makePump().pollOnce();
    foundry.reload('client-2');
    foundry.add({ key: 'z' });
    expect(await makePump().pollOnce()).toBe(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reads every page when more than 500 records are waiting', async () => {
    const pump = makePump();
    for (let i = 0; i < 1203; i++) foundry.add({ key: `k-${i}`, t: T0 + i });
    expect(await pump.pollOnce()).toBe(1203);
    expect(foundry.query).toHaveBeenCalledTimes(3);
    expect(foundry.query.mock.calls.map(c => c[1].sinceSeq)).toEqual([0, 500, 1000]);
    expect((await loggedKeys(localDateKey(T0))).length).toBe(1203);
    // Caught up: the next poll asks once, from the last record.
    expect(await pump.pollOnce()).toBe(0);
    expect(foundry.query).toHaveBeenCalledTimes(4);
    expect(foundry.query).toHaveBeenLastCalledWith('foundry-mcp-bridge.getChangeJournal', {
      sinceSeq: 1203,
      limit: 500,
    });
  });

  it('a page of exactly 500 asks once more and stops on the empty page', async () => {
    for (let i = 0; i < 500; i++) foundry.add({ key: `k-${i}`, t: T0 + i });
    expect(await makePump().pollOnce()).toBe(500);
    expect(foundry.query).toHaveBeenCalledTimes(2);
  });

  it('drops invalid records without throwing', async () => {
    foundry.records.push({ v: 2, key: 'bad-version', t: T0, seq: 1 } as unknown as ChangeRecord);
    foundry.records.push({ v: 1, key: 123, t: T0, seq: 2 } as unknown as ChangeRecord);
    foundry.records.push({
      v: 1,
      key: 'bad-time',
      t: Number.NaN,
      seq: 3,
    } as unknown as ChangeRecord);
    foundry.records.push({
      v: 1,
      key: 'no-op',
      t: T0,
      seq: 4,
      actionId: 'a',
    } as unknown as ChangeRecord);
    (foundry as any).seq = 4;
    foundry.add({ key: 'good' }); // seq 5

    expect(await makePump().pollOnce()).toBe(1);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['good']);
    expect(logger.warn).toHaveBeenCalledWith('Change journal dropped invalid records', {
      worldId: 'w1',
      count: 4,
    });
  });

  it('does nothing while Foundry is disconnected', async () => {
    foundry.connected = false;
    foundry.add({ key: 'a' });
    expect(await makePump().pollOnce()).toBe(0);
    expect(foundry.query).not.toHaveBeenCalled();
  });

  it('survives query errors and recovers, logging each failure once', async () => {
    const pump = makePump();
    foundry.fail = 'Connection closed';
    expect(await pump.pollOnce()).toBe(0);
    expect(await pump.pollOnce()).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    foundry.fail = null;
    foundry.add({ key: 'a' });
    expect(await pump.pollOnce()).toBe(1);
    expect(logger.info).toHaveBeenCalledWith('Change journal recovered');

    foundry.query.mockResolvedValueOnce({ success: false, error: 'Access denied' });
    expect(await pump.pollOnce()).toBe(0);
    expect(logger.warn).toHaveBeenLastCalledWith('Change journal poll failed', {
      error: 'Access denied',
    });
  });

  it('keeps a cursor per world', async () => {
    const pump = makePump();
    foundry.add({ key: 'a' });
    await pump.pollOnce();
    foundry.worldId = 'w2';
    foundry.reload('client-w2');
    foundry.add({ key: 'b' });
    expect(await pump.pollOnce()).toBe(1);
    expect(await loggedKeys(localDateKey(T0), 'w2')).toEqual(['b']);
  });
});

describe('ChangeJournalPump.pullNow', () => {
  it('fetches the newest records and resolves with nothing', async () => {
    const pump = makePump();
    foundry.add({ key: 'a' });
    await expect(pump.pullNow()).resolves.toBeUndefined();
    expect(await loggedKeys(localDateKey(T0))).toEqual(['a']);
  });

  it('concurrent callers share one pull', async () => {
    const pump = makePump();
    foundry.add({ key: 'a' });
    await Promise.all([pump.pullNow(), pump.pullNow(), pump.pollOnce()]);
    expect(foundry.query).toHaveBeenCalledTimes(1);
  });

  it('is a no-op while Foundry is disconnected', async () => {
    foundry.connected = false;
    await expect(makePump().pullNow()).resolves.toBeUndefined();
    expect(foundry.query).not.toHaveBeenCalled();
  });

  it('rejects when the pull failed, and works again after it recovers', async () => {
    const pump = makePump();
    foundry.fail = 'Connection closed';
    await expect(pump.pullNow()).rejects.toThrow('Connection closed');
    foundry.fail = null;
    await expect(pump.pullNow()).resolves.toBeUndefined();
  });
});

describe('ChangeJournalPump onAppended', () => {
  it('is called once per non-empty poll, with the world id and the records written', async () => {
    const onAppended = vi.fn();
    const pump = makePump({ onAppended });
    foundry.add({ key: 'a' });
    foundry.add({ key: 'b' });
    foundry.add({ key: 'b' });
    expect(await pump.pollOnce()).toBe(2);
    expect(onAppended).toHaveBeenCalledTimes(1);
    expect(onAppended.mock.calls[0][0]).toBe('w1');
    expect((onAppended.mock.calls[0][1] as ChangeRecord[]).map(r => r.key)).toEqual(['a', 'b']);

    expect(await pump.pollOnce()).toBe(0);
    expect(onAppended).toHaveBeenCalledTimes(1);
  });

  it('gets all pages of one poll in one call', async () => {
    const onAppended = vi.fn();
    const pump = makePump({ onAppended });
    for (let i = 0; i < 600; i++) foundry.add({ key: `k-${i}`, t: T0 + i });
    await pump.pollOnce();
    expect(onAppended).toHaveBeenCalledTimes(1);
    expect((onAppended.mock.calls[0][1] as ChangeRecord[]).length).toBe(600);
  });

  it('isolates a throwing listener: the poll still returns its count and logs the failure', async () => {
    const onAppended = vi.fn(() => {
      throw new Error('boom');
    });
    const pump = makePump({ onAppended });
    foundry.add({ key: 'a' });
    expect(await pump.pollOnce()).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'onAppended listener failed',
      expect.objectContaining({ error: 'boom' })
    );
  });
});

describe('ChangeJournalPump timer', () => {
  it('polls on its interval until stopped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const pump = makePump();
    const spy = vi.spyOn(pump, 'pollOnce').mockResolvedValue(0);
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
