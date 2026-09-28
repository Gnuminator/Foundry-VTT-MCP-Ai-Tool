import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PlayActorRef, PlayRecord } from '@gnuminator/shared';
import { playLogFileName } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localDateKey } from './event-pump.js';
import { PLAY_PUMP_STATE_FILE, PlayLogPump, playLogSettings } from './play-log-pump.js';
import { buildStats } from './stats/build.js';
import { VaultStore } from './vault/store.js';

/** The module's ring buffer: `seq > sinceSeq` filter, up to `limit` records, one `clientId`. */
class FakeModule {
  records: PlayRecord[] = [];
  connected = true;
  worldId = 'w1';
  clientId = 'client-1';
  fail: string | null = null;
  private seq = 0;

  add(overrides: Partial<PlayRecord> = {}): PlayRecord {
    this.seq += 1;
    const record: PlayRecord = {
      v: 2,
      key: `k-${this.seq}`,
      t: T0,
      seq: this.seq,
      kind: 'hp',
      userId: null,
      sceneId: null,
      ...overrides,
    };
    this.records.push(record);
    return record;
  }

  /** Simulate the ring buffer dropping its oldest `n` records without the pump reading them. */
  evictOldest(n: number): void {
    this.records.splice(0, n);
  }

  query = vi.fn((method: string, data: any): Promise<unknown> => {
    if (this.fail) return Promise.reject(new Error(this.fail));
    if (method === 'foundry-mcp-bridge.getPlayRecords') {
      const sinceSeq = typeof data.sinceSeq === 'number' ? data.sinceSeq : 0;
      const matching = this.records.filter(r => r.seq > sinceSeq).slice(0, data.limit);
      const oldestSeq = this.records[0]?.seq ?? 0;
      const latestSeq = this.records[this.records.length - 1]?.seq ?? 0;
      return Promise.resolve({
        success: true,
        clientId: this.clientId,
        records: matching,
        oldestSeq,
        latestSeq,
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
  extra: Partial<{ onAppended: (worldId: string, count: number) => void }> = {}
): PlayLogPump {
  return new PlayLogPump({
    foundryClient: foundry,
    worldIds: { current: (): Promise<string> => Promise.resolve(foundry.worldId) },
    store,
    logger,
    intervalMs: 5000,
    ...extra,
  });
}

async function loggedKeys(date: string, worldId = 'w1'): Promise<string[]> {
  const lines = (await store.readLines(worldId, 'sessions', playLogFileName(date))) as Array<{
    key: string;
  }>;
  return lines.map(l => l.key);
}

const T0 = new Date(2026, 8, 28, 20, 0, 0).getTime();

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'play-log-pump-'));
  store = new VaultStore({ dataDir });
  foundry = new FakeModule();
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
});

afterEach(async () => {
  vi.useRealTimers();
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('playLogSettings', () => {
  it('is on by default and shares the event pump interval', () => {
    expect(playLogSettings({})).toEqual({ enabled: true, intervalMs: 5000 });
  });

  it('can be switched off and reads FOUNDRY_AI_EVENT_POLL_MS for its interval', () => {
    expect(playLogSettings({ FOUNDRY_AI_PLAY_LOG: 'off' }).enabled).toBe(false);
    expect(playLogSettings({ FOUNDRY_AI_PLAY_LOG: 'FALSE' }).enabled).toBe(false);
    expect(playLogSettings({ FOUNDRY_AI_PLAY_LOG: '0' }).enabled).toBe(false);
    expect(playLogSettings({ FOUNDRY_AI_PLAY_LOG: 'no' }).enabled).toBe(false);
    expect(playLogSettings({ FOUNDRY_AI_EVENT_POLL_MS: '15000' }).intervalMs).toBe(15000);
    expect(playLogSettings({ FOUNDRY_AI_EVENT_POLL_MS: '10' }).intervalMs).toBe(1000);
  });
});

describe('PlayLogPump.pollOnce', () => {
  it('appends new records to the local-date play log, once each', async () => {
    const pump = makePump();
    foundry.add({ key: 'a' });
    foundry.add({ key: 'b' });
    expect(await pump.pollOnce()).toBe(2);
    expect(await pump.pollOnce()).toBe(0);
    foundry.add({ key: 'c' });
    expect(await pump.pollOnce()).toBe(1);

    expect(await store.list('w1', 'sessions')).toEqual([
      playLogFileName(localDateKey(T0)),
      PLAY_PUMP_STATE_FILE,
    ]);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['a', 'b', 'c']);
  });

  it('splits a batch across local dates (midnight)', async () => {
    const pump = makePump();
    const midnight = new Date(2026, 8, 29, 0, 0, 0).getTime();
    foundry.add({ key: 'late', t: midnight - 1 });
    foundry.add({ key: 'early', t: midnight });
    expect(await pump.pollOnce()).toBe(2);
    expect(await loggedKeys('2026-09-28')).toEqual(['late']);
    expect(await loggedKeys('2026-09-29')).toEqual(['early']);
  });

  it('drops a duplicate key inside the same batch', async () => {
    const pump = makePump();
    foundry.add({ key: 'dup' });
    foundry.add({ key: 'dup' });
    foundry.add({ key: 'unique' });
    expect(await pump.pollOnce()).toBe(2);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['dup', 'unique']);
  });

  it('resumes from the saved cursor after a restart, deduping against the file', async () => {
    foundry.add({ key: 'a' });
    foundry.add({ key: 'b' });
    await makePump().pollOnce();

    // A fresh pump instance re-reads the on-disk state and the file's keys.
    const restarted = makePump();
    foundry.add({ key: 'c' });
    expect(await restarted.pollOnce()).toBe(1);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['a', 'b', 'c']);
  });

  it('a second client sending the same keys writes nothing new', async () => {
    foundry.add({ key: 'hp:actor1:value:100' });
    foundry.add({ key: 'hp:actor1:value:200' });
    await makePump().pollOnce();

    // Simulate another GM client (or a reload) recording the same underlying
    // document changes: a new clientId and seq numbering, same keys.
    foundry.clientId = 'client-2';
    foundry.records = [];
    const pump = makePump();
    (foundry as any).seq = 0;
    foundry.add({ key: 'hp:actor1:value:100' });
    foundry.add({ key: 'hp:actor1:value:200' });
    expect(await pump.pollOnce()).toBe(0);
    expect(await loggedKeys(localDateKey(T0))).toEqual([
      'hp:actor1:value:100',
      'hp:actor1:value:200',
    ]);
  });

  it('restarts at sinceSeq 0 when the clientId changes', async () => {
    foundry.add({ key: 'a' });
    foundry.add({ key: 'b' });
    await makePump().pollOnce();

    // The module reloaded: a new clientId, seq restarts at 1, and it only has
    // two records so far. Using the old lastSeq (2) as sinceSeq would miss
    // both of them.
    foundry.clientId = 'client-2';
    foundry.records = [];
    (foundry as any).seq = 0;
    foundry.add({ key: 'x' });
    foundry.add({ key: 'y' });
    const pump = makePump();
    expect(await pump.pollOnce()).toBe(2);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['a', 'b', 'x', 'y']);
    expect(foundry.query).toHaveBeenLastCalledWith('foundry-mcp-bridge.getPlayRecords', {
      sinceSeq: 0,
      limit: 5000,
    });
  });

  it('logs a warning when the ring buffer wraps past the saved cursor', async () => {
    foundry.add({ key: 'a' });
    foundry.add({ key: 'b' });
    foundry.add({ key: 'c' });
    await makePump().pollOnce(); // lastSeq saved as 3

    // 'd' (seq 4) is never read by the pump before the ring buffer evicts it
    // along with everything up to and including it.
    foundry.add({ key: 'd' });
    foundry.add({ key: 'e' });
    foundry.evictOldest(4); // only 'e' (seq 5) is left; 'd' is unrecoverable
    const pump = makePump();
    expect(await pump.pollOnce()).toBe(1);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['a', 'b', 'c', 'e']);
    expect(logger.warn).toHaveBeenCalledWith(
      'Play log records lost: the ring buffer wrapped before the pump read them',
      expect.objectContaining({ worldId: 'w1', expectedFrom: 4, oldestSeq: 5 })
    );
  });

  it('does not warn about loss across a clientId change', async () => {
    foundry.add({ key: 'a' });
    await makePump().pollOnce();

    foundry.clientId = 'client-2';
    foundry.records = [];
    (foundry as any).seq = 10; // the new buffer's own numbering, unrelated to the old cursor
    foundry.add({ key: 'z' });
    expect(await makePump().pollOnce()).toBe(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('drops invalid records without throwing', async () => {
    const pump = makePump();
    foundry.records.push({ v: 1, key: 'bad-version', t: T0, seq: 1 } as unknown as PlayRecord);
    foundry.records.push({ v: 2, key: 123, t: T0, seq: 2 } as unknown as PlayRecord);
    foundry.records.push({ v: 2, key: 'bad-time', t: Number.NaN, seq: 3 } as unknown as PlayRecord);
    foundry.records.push({ v: 2, key: 'no-kind', t: T0, seq: 4 } as unknown as PlayRecord);
    (foundry as any).seq = 4;
    foundry.add({ key: 'good' }); // seq 5

    expect(await pump.pollOnce()).toBe(1);
    expect(await loggedKeys(localDateKey(T0))).toEqual(['good']);
    expect(logger.warn).toHaveBeenCalledWith('Play log dropped invalid records', {
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
    expect(logger.info).toHaveBeenCalledWith('Play log recovered');

    foundry.query.mockResolvedValueOnce({ success: false, error: 'Access denied' });
    expect(await pump.pollOnce()).toBe(0);
    expect(logger.warn).toHaveBeenLastCalledWith('Play log poll failed', {
      error: 'Access denied',
    });
  });

  it('does not overlap polls', async () => {
    const pump = makePump();
    foundry.add({ key: 'a' });
    const [a, b] = await Promise.all([pump.pollOnce(), pump.pollOnce()]);
    expect(a + b).toBe(2); // the same in-flight poll (1 record), counted by both callers
    expect(foundry.query).toHaveBeenCalledTimes(1);
  });

  it('keeps a cursor per world', async () => {
    const pump = makePump();
    foundry.add({ key: 'a' });
    await pump.pollOnce();
    foundry.worldId = 'w2';
    foundry.clientId = 'client-w2';
    foundry.records = [];
    (foundry as any).seq = 0;
    foundry.add({ key: 'b' });
    expect(await pump.pollOnce()).toBe(1);
    expect(await loggedKeys(localDateKey(T0), 'w2')).toEqual(['b']);
  });

  it('handles 1000 records in one poll', async () => {
    const pump = makePump();
    for (let i = 0; i < 1000; i++) foundry.add({ key: `k-${i}`, t: T0 + i });
    const start = Date.now();
    expect(await pump.pollOnce()).toBe(1000);
    expect(Date.now() - start).toBeLessThan(5000);
    expect((await loggedKeys(localDateKey(T0))).length).toBe(1000);
  });
});

describe('PlayLogPump onAppended', () => {
  it('is called once per non-empty poll, with the world id and count', async () => {
    const onAppended = vi.fn();
    const pump = makePump({ onAppended });
    foundry.add({ key: 'a' });
    foundry.add({ key: 'b' });
    expect(await pump.pollOnce()).toBe(2);
    expect(onAppended).toHaveBeenCalledTimes(1);
    expect(onAppended).toHaveBeenCalledWith('w1', 2);

    expect(await pump.pollOnce()).toBe(0);
    expect(onAppended).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing listener: the poll still returns its count and logs the failure', async () => {
    const onAppended = vi.fn(() => {
      throw new Error('boom');
    });
    const pump = makePump({ onAppended });
    foundry.add({ key: 'a' });
    expect(await pump.pollOnce()).toBe(1);
    expect(onAppended).toHaveBeenCalledWith('w1', 1);
    expect(logger.warn).toHaveBeenCalledWith(
      'onAppended listener failed',
      expect.objectContaining({ error: 'boom' })
    );
  });
});

describe('PlayLogPump timer', () => {
  it('polls on its interval until stopped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const pump = makePump();
    // Stubbed: real polls would still be writing when afterEach removes the temp dir (ENOTEMPTY).
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

describe('PlayLogPump into buildStats (no double counting)', () => {
  // docs/OBSIDIAN-PLAN.md O3 test list, item 4: damage/healing must be counted
  // once even when the same underlying change reaches the pump twice (two GM
  // clients, or a client reload replaying its buffer). The pump's key dedupe
  // (already covered above: "a second client sending the same keys writes
  // nothing new") is what makes this true; this test carries that guarantee
  // through to the stats built from the resulting file.
  const PC: PlayActorRef = { uuid: 'Actor.actor1', isPC: true, name: 'Ireena' };
  const HP_KEY = 'hp:Actor.actor1:system.attributes.hp.value:123';
  const hpOverrides: Partial<PlayRecord> = {
    key: HP_KEY,
    kind: 'hp',
    actor: PC,
    path: 'system.attributes.hp.value',
    before: 20,
    after: 12,
    delta: -8,
  };

  it('an HP change two GM clients both report (same deterministic key) is written once and counted once', async () => {
    // Client 1 records the change first.
    foundry.add(hpOverrides);
    await makePump().pollOnce();

    // A second GM client saw the same underlying document change and computed
    // the same deterministic key, but through its own clientId/seq numbering.
    foundry.clientId = 'client-2';
    foundry.records = [];
    (foundry as any).seq = 0;
    foundry.add(hpOverrides);
    const secondClientPump = makePump();
    expect(await secondClientPump.pollOnce()).toBe(0); // dropped: the key is already on disk

    const lines = (await store.readLines(
      'w1',
      'sessions',
      playLogFileName(localDateKey(T0))
    )) as PlayRecord[];
    expect(lines).toHaveLength(1); // written once, not twice

    const stats = buildStats({ worldId: 'w1', logEvents: [], playRecords: lines });
    expect(stats.sessions[0]?.partyDamageTaken).toBe(8); // the one HP delta, not 16
    expect(stats.pcs.find(p => p.uuid === PC.uuid)?.damageTaken).toBe(8);
  });

  it('the pump reading the same poll result twice (no listener) still yields one line and one count', async () => {
    // A poll that is retried before the caller commits its own side effects
    // would ask the same sinceSeq again; the module keeps returning the same
    // records, and the key dedupe against the file (not just the in-batch set)
    // is what keeps a second poll from doubling the count.
    const pump = makePump();
    foundry.add(hpOverrides);
    expect(await pump.pollOnce()).toBe(1);
    expect(await pump.pollOnce()).toBe(0); // nothing new: lastSeq already covers it

    const lines = (await store.readLines(
      'w1',
      'sessions',
      playLogFileName(localDateKey(T0))
    )) as PlayRecord[];
    const stats = buildStats({ worldId: 'w1', logEvents: [], playRecords: lines });
    expect(stats.sessions[0]?.partyDamageTaken).toBe(8);
  });
});
