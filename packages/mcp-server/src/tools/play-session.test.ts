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
    worldIds: { currentOrLastKnown: (): Promise<string> => Promise.resolve(worldId) },
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
      mode: 'live',
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

describe('mark-play-session, paper nights', () => {
  async function lines(date: string): Promise<Array<Record<string, any>>> {
    return (await store.readLines('w1', 'sessions', `${date}.jsonl`)) as Array<Record<string, any>>;
  }

  it('marks a paper start right now', async () => {
    const result = await makeTools().handleMarkPlaySession({ action: 'start', mode: 'paper' });
    expect(result).toMatchObject({ mode: 'paper', markedAt: new Date(nowMs).toISOString() });
    const [line] = await lines(localDateKey(nowMs));
    expect(line).toMatchObject({
      eventType: 'session-start',
      description: 'Paper session started',
      details: { source: 'mark-play-session', mode: 'paper' },
    });
  });

  it('puts a past date at local noon in that date file', async () => {
    const result = await makeTools().handleMarkPlaySession({
      action: 'start',
      mode: 'paper',
      date: '2026-09-20',
    });
    const at = new Date(2026, 8, 20, 12, 0).getTime();
    expect(result.markedAt).toBe(new Date(at).toISOString());
    const [line] = await lines('2026-09-20');
    expect(line).toMatchObject({ timestampMs: at, eventType: 'session-start' });
    expect(await lines(localDateKey(nowMs))).toEqual([]);
  });

  it('takes a time, so an end can follow a start on the same date', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({
      action: 'start',
      mode: 'paper',
      date: '2026-09-20',
      time: '19:00',
    });
    await tools.handleMarkPlaySession({
      action: 'end',
      mode: 'paper',
      date: '2026-09-20',
      time: '23:30',
    });
    const got = await lines('2026-09-20');
    expect(got.map(l => l.eventType)).toEqual(['session-start', 'session-end']);
    expect(got[1]?.timestampMs).toBe(new Date(2026, 8, 20, 23, 30).getTime());
  });

  it('puts a date-only end at 23:59, after a date-only start', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start', mode: 'paper', date: '2026-09-20' });
    await tools.handleMarkPlaySession({ action: 'end', mode: 'paper', date: '2026-09-20' });
    const got = await lines('2026-09-20');
    expect(got.map(l => l.timestampMs)).toEqual([
      new Date(2026, 8, 20, 12, 0).getTime(),
      new Date(2026, 8, 20, 23, 59).getTime(),
    ]);
  });

  it("uses now for today's date without a time", async () => {
    const result = await makeTools().handleMarkPlaySession({
      action: 'start',
      mode: 'paper',
      date: localDateKey(nowMs),
    });
    expect(result.markedAt).toBe(new Date(nowMs).toISOString());
  });

  it('refuses a future date, a time later today, a date that does not exist and a bare time', async () => {
    const tools = makeTools();
    const paper = { action: 'start', mode: 'paper' };
    await expect(tools.handleMarkPlaySession({ ...paper, date: '2026-09-29' })).rejects.toThrow(
      /future/
    );
    await expect(
      tools.handleMarkPlaySession({ ...paper, date: localDateKey(nowMs), time: '23:00' })
    ).rejects.toThrow(/future/);
    await expect(tools.handleMarkPlaySession({ ...paper, date: '2026-02-31' })).rejects.toThrow(
      /not a date/
    );
    await expect(tools.handleMarkPlaySession({ ...paper, time: '19:00' })).rejects.toThrow(
      /needs a date/
    );
    await expect(tools.handleMarkPlaySession({ ...paper, date: '20-9-2026' })).rejects.toThrow();
  });

  it('keeps date, time and synced for paper nights only', async () => {
    const tools = makeTools();
    await expect(
      tools.handleMarkPlaySession({ action: 'start', date: '2026-09-20' })
    ).rejects.toThrow(/paper/);
    await expect(tools.handleMarkPlaySession({ action: 'end', synced: true })).rejects.toThrow(
      /paper/
    );
  });

  it('works with Foundry closed through the last known world', async () => {
    const tools = makeTools({
      worldIds: { currentOrLastKnown: (): Promise<string> => Promise.resolve('last-world') },
    });
    const result = await tools.handleMarkPlaySession({
      action: 'start',
      mode: 'paper',
      date: '2026-09-20',
    });
    expect(result.worldId).toBe('last-world');
    expect(await store.readLines('last-world', 'sessions', '2026-09-20.jsonl')).toHaveLength(1);
  });

  it('fails clearly when Foundry is closed and no world is known', async () => {
    const tools = makeTools({
      worldIds: {
        currentOrLastKnown: (): Promise<string> => Promise.reject(new Error('no world yet')),
      },
    });
    await expect(tools.handleMarkPlaySession({ action: 'start', mode: 'paper' })).rejects.toThrow(
      'no world yet'
    );
  });
});

describe('unsyncedPaperNights', () => {
  const paperStart = (
    day: number,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    id: `m${day}`,
    timestamp: new Date(2026, 8, day, 12).toISOString(),
    timestampMs: new Date(2026, 8, day, 12).getTime(),
    eventType: 'session-start',
    details: { source: 'mark-play-session', mode: 'paper', ...extra },
  });
  const syncEvent = (day: number, mode = 'apply'): Record<string, unknown> => ({
    id: `s${day}`,
    timestamp: new Date(2026, 8, day, 20).toISOString(),
    timestampMs: new Date(2026, 8, day, 20).getTime(),
    eventType: 'gm-change',
    details: { changeId: `c${day}`, feature: 'paper-sync', mode },
  });
  const put = (day: number, lines: unknown[]): Promise<void> =>
    store.appendLines('w1', 'sessions', `2026-09-${String(day).padStart(2, '0')}.jsonl`, lines);

  it('is empty with no paper night', async () => {
    await put(20, [
      {
        id: 'a',
        timestamp: new Date(2026, 8, 20, 12).toISOString(),
        eventType: 'session-start',
        details: {},
      },
    ]);
    expect(await makeTools().unsyncedPaperNights()).toEqual([]);
  });

  it('lists a paper night with no sync after it', async () => {
    await put(20, [paperStart(20)]);
    expect(await makeTools().unsyncedPaperNights()).toEqual([
      { date: '2026-09-20', startedAt: new Date(2026, 8, 20, 12).toISOString() },
    ]);
  });

  it('clears a night once a paper sync was applied after it', async () => {
    await put(20, [paperStart(20)]);
    await put(22, [syncEvent(22)]);
    expect(await makeTools().unsyncedPaperNights()).toEqual([]);
  });

  it('counts a sync for the newest paper night before it only', async () => {
    await put(10, [paperStart(10)]);
    await put(20, [paperStart(20)]);
    await put(22, [syncEvent(22)]);
    expect((await makeTools().unsyncedPaperNights()).map(n => n.date)).toEqual(['2026-09-10']);
  });

  it('does not count an undo, or a sync before the night', async () => {
    await put(18, [syncEvent(18)]);
    await put(20, [paperStart(20)]);
    await put(22, [syncEvent(22, 'undo')]);
    expect((await makeTools().unsyncedPaperNights()).map(n => n.date)).toEqual(['2026-09-20']);
  });

  it('counts a sync that ran earlier the same day as a night marked afterwards', async () => {
    // Sync at 10:00 on the 20th; the night was marked after it, at the default 12:00.
    await put(20, [
      { ...syncEvent(20), timestampMs: new Date(2026, 8, 20, 10).getTime() },
      paperStart(20),
    ]);
    expect(await makeTools().unsyncedPaperNights()).toEqual([]);
  });

  it('gives a same-day sync to the night marked after it, leaving an older night unsynced', async () => {
    await put(10, [paperStart(10)]);
    await put(20, [
      { ...syncEvent(20), timestampMs: new Date(2026, 8, 20, 10).getTime() },
      paperStart(20),
    ]);
    expect((await makeTools().unsyncedPaperNights()).map(n => n.date)).toEqual(['2026-09-10']);
  });

  it('clears a night the GM marked done', async () => {
    await put(20, [paperStart(20, { synced: true })]);
    expect(await makeTools().unsyncedPaperNights()).toEqual([]);
  });
});

describe('get-play-session after a paper night', () => {
  it('does not report an old paper night as open because a sync ran later', async () => {
    // Paper start on the 27th; the sync ran on the 28th, an hour before "now" (20:00).
    await store.appendLines('w1', 'sessions', '2026-09-27.jsonl', [
      {
        id: 'p',
        timestamp: new Date(2026, 8, 27, 12).toISOString(),
        timestampMs: new Date(2026, 8, 27, 12).getTime(),
        eventType: 'session-start',
        details: { source: 'mark-play-session', mode: 'paper' },
      },
    ]);
    const syncAt = new Date(2026, 8, 28, 19).getTime();
    await store.appendLines('w1', 'sessions', '2026-09-28.jsonl', [
      {
        id: 's',
        timestamp: new Date(syncAt).toISOString(),
        timestampMs: syncAt,
        eventType: 'gm-change',
        details: { changeId: 'c1', feature: 'paper-sync', mode: 'apply' },
      },
    ]);
    await store.appendLines('w1', 'sessions', '2026-09-28.play.jsonl', [
      { ...playRecord(syncAt, 'r1'), source: { changeId: 'c1' } },
    ]);
    const result = await makeTools().handleGetPlaySession({});
    expect(result.open).toBe(false);
    expect(result.startedAt).toBeNull();
  });

  it('still counts ordinary activity after a paper start as open', async () => {
    const start = new Date(2026, 8, 28, 19).getTime();
    await store.appendLines('w1', 'sessions', '2026-09-28.jsonl', [
      {
        id: 'p',
        timestamp: new Date(start).toISOString(),
        timestampMs: start,
        eventType: 'session-start',
        details: { source: 'mark-play-session', mode: 'paper' },
      },
    ]);
    expect((await makeTools().handleGetPlaySession({})).open).toBe(true);
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
      previousEndedAt: null,
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
      previousEndedAt: null,
    });
  });

  it('while open, reports when the session before ended', async () => {
    const tools = makeTools();
    await tools.handleMarkPlaySession({ action: 'start' });
    await tools.handleMarkPlaySession({ action: 'end' });
    const ended = new Date(nowMs).toISOString();
    nowMs += 60_000;
    await tools.handleMarkPlaySession({ action: 'start' });
    expect(await tools.handleGetPlaySession({})).toMatchObject({
      open: true,
      previousEndedAt: ended,
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
      previousEndedAt: null,
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
      previousEndedAt: null,
    });
  });
});
