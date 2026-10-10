import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localDateKey } from '../event-pump.js';
import { VaultStore } from '../vault/store.js';
import { PlaySessionTools, type PlaySessionToolsOptions } from './play-session.js';

let dataDir: string;
let store: VaultStore;
let logger: any;
let worldId: string;
let nowMs: number;

function makeTools(extra: Partial<PlaySessionToolsOptions> = {}): PlaySessionTools {
  return new PlaySessionTools({
    worldIds: { current: (): Promise<string> => Promise.resolve(worldId) },
    store,
    logger,
    now: (): number => nowMs,
    ...extra,
  });
}

/** `daysAgo` days before the fixed test date, at local noon (calendar-correct). */
function dateMs(daysAgo: number): number {
  const d = new Date(2026, 8, 28, 12, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

/** A minimal, valid-shaped play log line (O3 contract 1): only `t` matters here. */
function playRecord(t: number, key: string): Record<string, unknown> {
  return { v: 2, key, t, seq: 1, kind: 'hp', userId: null, sceneId: null };
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'play-session-'));
  store = new VaultStore({ dataDir });
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  worldId = 'w1';
  nowMs = new Date(2026, 8, 28, 20, 0, 0).getTime();
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('mark-play-session', () => {
  it('appends a start marker to the local-date session log', async () => {
    const tools = makeTools();
    const result = await tools.handleMarkPlaySession({ action: 'start', note: '  Session 1  ' });
    expect(result).toEqual({
      success: true,
      worldId: 'w1',
      action: 'start',
      markedAt: new Date(nowMs).toISOString(),
    });

    const [line] = (await store.readLines(
      'w1',
      'sessions',
      `${localDateKey(nowMs)}.jsonl`
    )) as Array<Record<string, unknown>>;
    expect(line).toMatchObject({
      timestamp: new Date(nowMs).toISOString(),
      timestampMs: nowMs,
      eventType: 'session-start',
      actorName: null,
      description: 'Play session started',
      details: { source: 'mark-play-session', note: 'Session 1' },
    });
    expect(line.id).toMatch(/^mark-[0-9a-z]+-[0-9a-f]{8}$/);
  });

  it('appends an end marker without a note when none is given', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'end' });
    const [line] = (await store.readLines(
      'w1',
      'sessions',
      `${localDateKey(nowMs)}.jsonl`
    )) as Array<Record<string, unknown>>;
    expect(line).toMatchObject({ eventType: 'session-end', description: 'Play session ended' });
    expect(line.details).toEqual({ source: 'mark-play-session' });
  });

  it('trims the note and rejects one over 200 characters', async () => {
    const tools = makeTools();
    await expect(
      tools.handleMarkPlaySession({ action: 'start', note: 'x'.repeat(201) })
    ).rejects.toThrow();
  });

  it('rejects an unknown action', async () => {
    const tools = makeTools();
    await expect(tools.handleMarkPlaySession({ action: 'pause' })).rejects.toThrow();
  });

  it('calls onMarked with the world id, isolating a throwing listener', async () => {
    const onMarked = vi.fn(() => {
      throw new Error('boom');
    });
    const tools = makeTools({ onMarked });
    await tools.handleMarkPlaySession({ action: 'start' });
    expect(onMarked).toHaveBeenCalledWith('w1');
    expect(logger.warn).toHaveBeenCalledWith(
      'onMarked listener failed',
      expect.objectContaining({ error: 'boom' })
    );
  });
});

describe('get-play-session', () => {
  it('reports no session when the log is empty', async () => {
    const tools = makeTools();
    expect(await tools.handleGetPlaySession({})).toEqual({
      success: true,
      worldId: 'w1',
      open: false,
      startedAt: null,
      lastEventAt: null,
      endedAt: null,
    });
  });

  it('is open right after a start marker', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start' });
    expect(await tools.handleGetPlaySession({})).toEqual({
      success: true,
      worldId: 'w1',
      open: true,
      startedAt: new Date(nowMs).toISOString(),
      lastEventAt: new Date(nowMs).toISOString(),
      endedAt: null,
    });
  });

  it('closes on an end marker', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start' });
    nowMs += 60_000;
    await tools.handleMarkPlaySession({ action: 'end' });
    expect(await tools.handleGetPlaySession({})).toEqual({
      success: true,
      worldId: 'w1',
      open: false,
      startedAt: null,
      lastEventAt: new Date(nowMs).toISOString(),
      endedAt: new Date(nowMs).toISOString(),
    });
  });

  it('keeps the end marker as endedAt when events follow it', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start' });
    nowMs += 60_000;
    await tools.handleMarkPlaySession({ action: 'end' });
    const endedAt = new Date(nowMs).toISOString();
    nowMs += 60_000;
    await store.appendLines('w1', 'sessions', `${localDateKey(nowMs)}.play.jsonl`, [
      playRecord(nowMs, 'after-the-end'),
    ]);
    expect(await tools.handleGetPlaySession({})).toMatchObject({ open: false, endedAt });
  });

  it('closes after a gap of more than 3 hours since the last event, without an end marker', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start' });
    const startedAt = new Date(nowMs).toISOString();
    nowMs += 3 * 60 * 60 * 1000 + 1;
    const result = await tools.handleGetPlaySession({});
    expect(result.open).toBe(false);
    expect(result.startedAt).toBeNull();
    // It went quiet: the last activity (here the start marker itself) is when it ended.
    expect(result.endedAt).toBe(startedAt);
  });

  it('stays open exactly at the 3-hour boundary', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start' });
    nowMs += 3 * 60 * 60 * 1000;
    expect((await tools.handleGetPlaySession({})).open).toBe(true);
  });

  it('uses the newest logged event (not just the marker) for the gap check', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start' });
    const startedAt = new Date(nowMs).toISOString();

    nowMs += 60 * 60 * 1000; // +1h: an ordinary session event extends activity
    await store.appendLines('w1', 'sessions', `${localDateKey(nowMs)}.jsonl`, [
      {
        id: 'evt-1',
        timestamp: new Date(nowMs).toISOString(),
        timestampMs: nowMs,
        eventType: 'damage',
      },
    ]);

    nowMs += 2 * 60 * 60 * 1000 + 30 * 60 * 1000; // +2.5h since the event: still under 3h
    expect(await tools.handleGetPlaySession({})).toMatchObject({ open: true, startedAt });

    nowMs += 60 * 60 * 1000; // now more than 3h since the last event
    expect((await tools.handleGetPlaySession({})).open).toBe(false);
  });

  it('scans across a midnight boundary', async () => {
    const tools = makeTools();
    nowMs = new Date(2026, 8, 28, 23, 0, 0).getTime();
    await tools.handleMarkPlaySession({ action: 'start' });
    nowMs = new Date(2026, 8, 29, 1, 0, 0).getTime(); // next day, 2h later
    expect((await tools.handleGetPlaySession({})).open).toBe(true);
  });

  it('keeps a session per world', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start' });
    worldId = 'w2';
    expect(await tools.handleGetPlaySession({})).toMatchObject({ worldId: 'w2', open: false });
  });

  it('stops scanning after 60 session files, so an older marker is not found', async () => {
    const oldMarker = {
      id: 'mark-old',
      timestamp: new Date(dateMs(65)).toISOString(),
      timestampMs: dateMs(65),
      eventType: 'session-start',
      actorName: null,
      description: 'Play session started',
      details: { source: 'mark-play-session' },
    };
    await store.appendLines('w1', 'sessions', `${localDateKey(dateMs(65))}.jsonl`, [oldMarker]);
    // 61 marker-free days (today back to 60 days ago) push the file above out of the 60-file scan.
    for (let daysAgo = 0; daysAgo <= 60; daysAgo++) {
      const ms = dateMs(daysAgo);
      await store.appendLines('w1', 'sessions', `${localDateKey(ms)}.jsonl`, [
        {
          id: `evt-${daysAgo}`,
          timestamp: new Date(ms).toISOString(),
          timestampMs: ms,
          eventType: 'damage',
        },
      ]);
    }
    const tools = makeTools();
    const result = await tools.handleGetPlaySession({});
    expect(result.open).toBe(false);
    expect(result.startedAt).toBeNull();
  });
});

describe('get-play-session with play records (O3 contract 3)', () => {
  it('uses the newest play-log record for the gap check when there is no other event', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start' });
    const startedAt = new Date(nowMs).toISOString();

    nowMs += 2 * 60 * 60 * 1000; // +2h: a play record (not an ordinary session event) extends activity
    const recordAt = nowMs;
    await store.appendLines('w1', 'sessions', `${localDateKey(nowMs)}.play.jsonl`, [
      playRecord(recordAt, 'hp:actor1:value:1'),
    ]);

    nowMs += 2 * 60 * 60 * 1000 + 30 * 60 * 1000; // +2.5h since the play record: still under 3h
    expect(await tools.handleGetPlaySession({})).toMatchObject({
      open: true,
      startedAt,
      lastEventAt: new Date(recordAt).toISOString(),
    });

    nowMs += 60 * 60 * 1000; // now more than 3h since the last play record
    expect((await tools.handleGetPlaySession({})).open).toBe(false);
  });

  it('reads only the newest play-log file', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start' });

    // An older-dated file with a (contrived) later time must be ignored: only
    // the newest-dated play file is read.
    await store.appendLines('w1', 'sessions', `${localDateKey(dateMs(1))}.play.jsonl`, [
      playRecord(nowMs + 10_000_000, 'from-old-file'),
    ]);
    await store.appendLines('w1', 'sessions', `${localDateKey(nowMs)}.play.jsonl`, [
      playRecord(nowMs, 'from-new-file'),
    ]);

    const result = await tools.handleGetPlaySession({});
    expect(result.lastEventAt).toBe(new Date(nowMs).toISOString());
  });

  it('ignores a play log with no valid records', async () => {
    const tools = makeTools();
    await store.appendLines('w1', 'sessions', `${localDateKey(nowMs)}.play.jsonl`, [
      { v: 2, key: 'no-time', kind: 'hp', userId: null, sceneId: null },
    ]);
    expect(await tools.handleGetPlaySession({})).toEqual({
      success: true,
      worldId: 'w1',
      open: false,
      startedAt: null,
      lastEventAt: null,
      endedAt: null,
    });
  });
});
