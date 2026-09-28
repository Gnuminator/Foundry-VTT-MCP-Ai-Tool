/**
 * `get-play-stats` (docs/OBSIDIAN-PLAN.md section 8, O3): reads the world's
 * session and play logs from the vault and returns the built totals
 * (`stats/build.ts`) - never the raw records.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayActorRef, PlayRecord } from '@gnuminator/shared';

import { VaultStore } from '../vault/store.js';

import { PlayStatsTools } from './play-stats.js';

let dataDir: string;
let store: VaultStore;
let logger: any;

const WORLD = 'w1';
const PC: PlayActorRef = { uuid: 'Actor.pc1', isPC: true, name: 'Ireena' };
const T0 = Date.parse('2026-10-01T12:00:00.000Z');

function makeTools(worldId = WORLD): PlayStatsTools {
  return new PlayStatsTools({
    worldIds: { current: (): Promise<string> => Promise.resolve(worldId) },
    store,
    logger,
  });
}

function hp(
  key: string,
  t: number,
  before: number,
  after: number,
  extra: Partial<PlayRecord> = {}
): PlayRecord {
  return {
    v: 2,
    key,
    t,
    seq: 1,
    kind: 'hp',
    userId: null,
    sceneId: null,
    actor: PC,
    path: 'system.attributes.hp.value',
    before,
    after,
    delta: after - before,
    ...extra,
  };
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'play-stats-'));
  store = new VaultStore({ dataDir });
  logger = {
    error: (): void => undefined,
    warn: (): void => undefined,
    info: (): void => undefined,
    debug: (): void => undefined,
  };
  logger.child = (): unknown => logger;
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('get-play-stats', () => {
  it('returns empty campaign totals and no session for a world with no logs yet', async () => {
    const result = await makeTools().handleGetPlayStats({});
    expect(result).toMatchObject({
      success: true,
      worldId: WORLD,
      sessionCount: 0,
      session: null,
      pcs: [],
      campaign: { sessions: 0, lastRecordAt: null },
    });
  });

  it('builds campaign, session and PC stats from the play log, defaulting to the latest session', async () => {
    await store.appendLines(WORLD, 'sessions', '2026-10-01.play.jsonl', [hp('hp:1', T0, 20, 12)]);
    const farAway = T0 + 4 * 60 * 60 * 1000; // a second session, over the 3h gap
    await store.appendLines(WORLD, 'sessions', '2026-10-01.play.jsonl', [
      hp('hp:2', farAway, 12, 6),
    ]);

    const result = await makeTools().handleGetPlayStats({});
    expect(result.sessionCount).toBe(2);
    expect(result.session?.number).toBe(2); // "latest" by default
    expect(result.campaign.sessions).toBe(2);
    expect(result.pcs).toHaveLength(1);
    expect(result.pcs[0]).toMatchObject({ name: 'Ireena', damageTaken: 14 });
  });

  it('returns a specific session by number', async () => {
    await store.appendLines(WORLD, 'sessions', '2026-10-01.play.jsonl', [hp('hp:1', T0, 20, 12)]);
    const farAway = T0 + 4 * 60 * 60 * 1000;
    await store.appendLines(WORLD, 'sessions', '2026-10-01.play.jsonl', [
      hp('hp:2', farAway, 12, 6),
    ]);
    const result = await makeTools().handleGetPlayStats({ session: 1 });
    expect(result.session?.number).toBe(1);
  });

  it('returns null for a session number that does not exist', async () => {
    await store.appendLines(WORLD, 'sessions', '2026-10-01.play.jsonl', [hp('hp:1', T0, 20, 12)]);
    const result = await makeTools().handleGetPlayStats({ session: 99 });
    expect(result.session).toBeNull();
  });

  it('filters PCs by a partial, case-insensitive name match', async () => {
    await store.appendLines(WORLD, 'sessions', '2026-10-01.play.jsonl', [hp('hp:1', T0, 20, 12)]);
    const match = await makeTools().handleGetPlayStats({ pcName: 'reen' });
    expect(match.pcs.map(p => p.name)).toEqual(['Ireena']);
    const noMatch = await makeTools().handleGetPlayStats({ pcName: 'nobody' });
    expect(noMatch.pcs).toEqual([]);
  });

  it('never returns raw play records, only the built totals', async () => {
    await store.appendLines(WORLD, 'sessions', '2026-10-01.play.jsonl', [hp('hp:1', T0, 20, 12)]);
    const result = await makeTools().handleGetPlayStats({});
    const json = JSON.stringify(result);
    expect(json).not.toContain('"key"');
    expect(json).not.toContain('system.attributes.hp.value');
  });

  it('rejects an invalid session value', async () => {
    await expect(makeTools().handleGetPlayStats({ session: 'yesterday' })).rejects.toThrow();
    await expect(makeTools().handleGetPlayStats({ session: 0 })).rejects.toThrow();
  });

  it('drops a line that does not look like a play record instead of throwing', async () => {
    await store.appendLines(WORLD, 'sessions', '2026-10-01.play.jsonl', [
      hp('hp:1', T0, 20, 12),
      { not: 'a play record' },
    ]);
    const result = await makeTools().handleGetPlayStats({});
    expect(result.session?.playRecords).toBe(1);
  });
});
