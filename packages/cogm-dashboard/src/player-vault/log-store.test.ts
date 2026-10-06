import { promises as fsp, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PlayerEvent } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Logger } from '../logger.js';
import {
  PLAYER_LOG_MAX_SESSION_EVENTS,
  PLAYER_LOG_SESSION_GAP_MS,
  PLAYER_LOG_TRIMMED_TYPE,
  PlayerLogStore,
} from './log-store.js';

const logger = new Logger('error');
const HOUR = 60 * 60 * 1000;
const T0 = new Date(2026, 9, 3, 10, 0, 0).getTime();

function ev(id: string, timestampMs: number, text = `text ${id}`): PlayerEvent {
  return { id, timestampMs, type: 'chat', text };
}

/** The day file an event at `ms` is stored in (UTC day), below the world folder. */
function dayFile(base: string, world: string, ms: number): string {
  return path.join(base, world, `${new Date(ms).toISOString().slice(0, 10)}.jsonl`);
}

let dir: string;
beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'player-log-'));
});
afterEach(async () => {
  // Retries: a write still settling on Windows can leave the folder briefly not empty.
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('PlayerLogStore', () => {
  it('uses the bridge session gap by default', () => {
    expect(PLAYER_LOG_SESSION_GAP_MS).toBe(3 * HOUR);
  });

  it('dedupes by id and counts only new events', () => {
    const store = new PlayerLogStore(null, logger);
    expect(store.append('w', [ev('a', T0), ev('b', T0 + 1), ev('a', T0 + 2)])).toBe(2);
    expect(store.append('w', [ev('b', T0 + 1), ev('c', T0 + 3)])).toBe(1);
    expect(store.sessions('w')[0].events.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps only the four event fields', async () => {
    const store = new PlayerLogStore(dir, logger);
    const dirty = { ...ev('a', T0), secret: 'gm only', actorId: 'x' } as PlayerEvent;
    store.append('w', [dirty]);
    await store.flush();
    expect(Object.keys(store.sessions('w')[0].events[0]).sort()).toEqual([
      'id',
      'text',
      'timestampMs',
      'type',
    ]);
    const stored = readFileSync(dayFile(dir, 'w', T0), 'utf8');
    expect(stored).not.toContain('secret');
    expect(stored).not.toContain('actorId');
  });

  it('refuses invalid events', () => {
    const store = new PlayerLogStore(null, logger);
    const bad = [
      { id: '', timestampMs: T0, type: 'chat', text: 'x' },
      { id: 'a', timestampMs: 0, type: 'chat', text: 'x' },
      { id: 'b', timestampMs: -5, type: 'chat', text: 'x' },
      { id: 'c', timestampMs: Number.NaN, type: 'chat', text: 'x' },
      { id: 'd', timestampMs: Infinity, type: 'chat', text: 'x' },
      { id: 'e', timestampMs: '5', type: 'chat', text: 'x' },
      { id: 'f', timestampMs: T0, type: 5, text: 'x' },
      { id: 'g', timestampMs: T0, type: 'chat', text: null },
      { id: 7, timestampMs: T0, type: 'chat', text: 'x' },
      null,
      'string',
    ] as unknown as PlayerEvent[];
    expect(store.append('w', bad)).toBe(0);
    expect(store.has('w')).toBe(false);
  });

  it('has() is false until an event is stored', () => {
    const store = new PlayerLogStore(null, logger);
    expect(store.has('w')).toBe(false);
    store.append('w', [ev('a', T0)]);
    expect(store.has('w')).toBe(true);
    expect(store.has('other')).toBe(false);
  });

  it('persists across a new instance', async () => {
    const first = new PlayerLogStore(dir, logger);
    first.append('w', [ev('a', T0), ev('b', T0 + 1000)]);
    first.append('w', [ev('c', T0 + 2000)]);
    await first.flush();

    const second = new PlayerLogStore(dir, logger);
    expect(second.has('w')).toBe(true);
    expect(second.sessions('w')[0].events.map(e => e.id)).toEqual(['a', 'b', 'c']);
    expect(second.append('w', [ev('c', T0 + 2000)])).toBe(0);
    expect(second.digest('w')).toBe(first.digest('w'));
  });

  it('creates the folder when it is missing', async () => {
    const nested = path.join(dir, 'a', 'b');
    const store = new PlayerLogStore(nested, logger);
    store.append('w', [ev('a', T0)]);
    await store.flush();
    expect(readFileSync(dayFile(nested, 'w', T0), 'utf8')).toContain('"id":"a"');
  });

  it('skips malformed lines when loading', () => {
    const lines = [
      JSON.stringify(ev('a', T0)),
      '{not json',
      JSON.stringify({ id: 'b', timestampMs: 'x', type: 'chat', text: 't' }),
      '',
      JSON.stringify(ev('c', T0 + 1)),
    ];
    mkdirSync(path.join(dir, 'w'));
    writeFileSync(dayFile(dir, 'w', T0), `${lines.join('\n')}\n`);
    const store = new PlayerLogStore(dir, logger);
    expect(store.sessions('w')[0].events.map(e => e.id)).toEqual(['a', 'c']);
  });

  it('splits sessions at the gap: exactly the gap stays, one more splits', () => {
    const gapMs = 1000;
    const store = new PlayerLogStore(null, logger, { gapMs });
    store.append('w', [ev('a', T0), ev('b', T0 + gapMs), ev('c', T0 + gapMs * 2 + 1)]);
    const sessions = store.sessions('w');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].events.map(e => e.id)).toEqual(['a', 'b']);
    expect(sessions[1].events.map(e => e.id)).toEqual(['c']);
  });

  it('sorts events by time then id before splitting', () => {
    const store = new PlayerLogStore(null, logger);
    store.append('w', [ev('z', T0 + 5), ev('b', T0 + 5), ev('a', T0 + 10), ev('first', T0)]);
    expect(store.sessions('w')[0].events.map(e => e.id)).toEqual(['first', 'b', 'z', 'a']);
  });

  it('labels sessions by local date, with (2) and (3) for the same day', () => {
    const store = new PlayerLogStore(null, logger, { gapMs: HOUR });
    const day = (h: number): number => new Date(2026, 9, 3, h, 0, 0).getTime();
    const nextDay = new Date(2026, 9, 4, 10, 0, 0).getTime();
    store.append('w', [ev('a', day(1)), ev('b', day(5)), ev('c', day(9)), ev('d', nextDay)]);
    expect(store.sessions('w').map(s => s.label)).toEqual([
      '2026-10-03',
      '2026-10-03 (2)',
      '2026-10-03 (3)',
      '2026-10-04',
    ]);
  });

  it('returns no sessions for an unknown world', () => {
    expect(new PlayerLogStore(null, logger).sessions('nothing')).toEqual([]);
  });

  it('keeps worlds apart', async () => {
    const store = new PlayerLogStore(dir, logger);
    store.append('one', [ev('a', T0)]);
    store.append('two', [ev('b', T0)]);
    await store.flush();
    expect(store.sessions('one')[0].events).toHaveLength(1);
    expect(store.sessions('two')[0].events[0].id).toBe('b');
  });

  it('keeps all of 40 long sessions and only appends on each new event', async () => {
    const store = new PlayerLogStore(dir, logger);
    const DAY = 24 * HOUR;
    for (let s = 0; s < 40; s++) {
      const start = T0 + s * 7 * DAY;
      const batch: PlayerEvent[] = [];
      for (let i = 0; i < 600; i++) batch.push(ev(`s${s}-e${i}`, start + i * 1000));
      store.append('w', batch);
    }
    await store.flush();
    const sessions = store.sessions('w');
    expect(sessions).toHaveLength(40);
    expect(sessions.every(s => s.events.length === 600)).toBe(true);
    expect(sessions[0].events[0].id).toBe('s0-e0');
    // One file per day, under the world folder.
    expect((await fsp.readdir(path.join(dir, 'w'))).length).toBe(40);

    // A new event appends to its own day file; the older day files are not rewritten.
    const firstFile = dayFile(dir, 'w', T0);
    const old = new Date(Date.now() - 60_000);
    await fsp.utimes(firstFile, old, old);
    const before = (await fsp.stat(firstFile)).mtimeMs;
    const last = T0 + 39 * 7 * DAY + 600 * 1000;
    store.append('w', [ev('late', last)]);
    await store.flush();
    expect((await fsp.stat(firstFile)).mtimeMs).toBe(before);
    expect(readFileSync(dayFile(dir, 'w', last), 'utf8')).toContain('"late"');

    const reloaded = new PlayerLogStore(dir, logger);
    expect(reloaded.sessions('w')).toHaveLength(40);
    expect(reloaded.sessions('w').flatMap(s => s.events)).toHaveLength(40 * 600 + 1);
  });

  it('trims only a session over the per-session cap, oldest first, with a note', async () => {
    const cap = 100;
    const store = new PlayerLogStore(dir, logger, { maxSessionEvents: cap });
    const small = [ev('old-1', T0 - 10 * HOUR), ev('old-2', T0 - 10 * HOUR + 1000)];
    const big: PlayerEvent[] = [];
    for (let i = 0; i < 130; i++) big.push(ev(`b${String(i).padStart(3, '0')}`, T0 + i * 1000));
    store.append('w', [...small, ...big]);

    const sessions = store.sessions('w');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].events.map(e => e.id)).toEqual(['old-1', 'old-2']);
    const trimmed = sessions[1].events;
    expect(trimmed[0].type).toBe(PLAYER_LOG_TRIMMED_TYPE);
    expect(trimmed[0].text).toMatch(/^40 earlier events .* last 100 per session/);
    const real = trimmed.slice(1);
    expect(real).toHaveLength(90);
    expect(real[0].id).toBe('b040');
    expect(real[real.length - 1].id).toBe('b129');

    // A second trim adds up the count in one note; the small session is never touched.
    const more: PlayerEvent[] = [];
    for (let i = 130; i < 150; i++) more.push(ev(`b${i}`, T0 + i * 1000));
    store.append('w', more);
    const again = store.sessions('w');
    expect(again[0].events.map(e => e.id)).toEqual(['old-1', 'old-2']);
    const notes = again[1].events.filter(e => e.type === PLAYER_LOG_TRIMMED_TYPE);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toMatch(/^60 earlier events/);
    expect(again[1].events.filter(e => e.type !== PLAYER_LOG_TRIMMED_TYPE)).toHaveLength(90);
    // A dropped event that comes back in this process stays dropped.
    expect(store.append('w', [ev('b000', T0)])).toBe(0);

    // The rewritten files hold the same log after a restart.
    await store.flush();
    const reloaded = new PlayerLogStore(dir, logger, { maxSessionEvents: cap });
    expect(reloaded.sessions('w')).toEqual(again);
  });

  it('uses a generous default per-session cap', () => {
    expect(PLAYER_LOG_MAX_SESSION_EVENTS).toBeGreaterThanOrEqual(5_000);
  });

  it('digest changes on new events and not on duplicates', () => {
    const store = new PlayerLogStore(null, logger);
    const empty = store.digest('w');
    store.append('w', [ev('a', T0)]);
    const one = store.digest('w');
    expect(one).not.toBe(empty);
    store.append('w', [ev('a', T0)]);
    expect(store.digest('w')).toBe(one);
    store.append('w', [ev('b', T0 + 1)]);
    expect(store.digest('w')).not.toBe(one);
    expect(store.digest('w')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('digest does not depend on arrival order', () => {
    const a = new PlayerLogStore(null, logger);
    const b = new PlayerLogStore(null, logger);
    a.append('w', [ev('x', T0), ev('y', T0 + 1)]);
    b.append('w', [ev('y', T0 + 1), ev('x', T0)]);
    expect(a.digest('w')).toBe(b.digest('w'));
  });

  it('works in memory only without a folder', async () => {
    const store = new PlayerLogStore(null, logger);
    store.append('w', [ev('a', T0)]);
    await store.flush();
    expect(store.has('w')).toBe(true);
    expect(await fsp.readdir(dir)).toEqual([]);
  });

  it('keeps memory state when the disk write fails', async () => {
    const blocker = path.join(dir, 'file');
    writeFileSync(blocker, 'x');
    const store = new PlayerLogStore(path.join(blocker, 'sub'), logger);
    expect(store.append('w', [ev('a', T0)])).toBe(1);
    await expect(store.flush()).resolves.toBeUndefined();
    expect(store.has('w')).toBe(true);
  });
});
