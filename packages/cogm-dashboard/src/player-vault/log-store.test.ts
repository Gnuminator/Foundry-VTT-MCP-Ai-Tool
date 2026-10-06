import { promises as fsp, readFileSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PlayerEvent } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Logger } from '../logger.js';
import { PLAYER_LOG_MAX_EVENTS, PLAYER_LOG_SESSION_GAP_MS, PlayerLogStore } from './log-store.js';

const logger = new Logger('error');
const HOUR = 60 * 60 * 1000;
const T0 = new Date(2026, 9, 3, 10, 0, 0).getTime();

function ev(id: string, timestampMs: number, text = `text ${id}`): PlayerEvent {
  return { id, timestampMs, type: 'chat', text };
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
    const stored = readFileSync(path.join(dir, 'w.jsonl'), 'utf8');
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
    expect(readFileSync(path.join(nested, 'w.jsonl'), 'utf8')).toContain('"id":"a"');
  });

  it('skips malformed lines when loading', () => {
    const lines = [
      JSON.stringify(ev('a', T0)),
      '{not json',
      JSON.stringify({ id: 'b', timestampMs: 'x', type: 'chat', text: 't' }),
      '',
      JSON.stringify(ev('c', T0 + 1)),
    ];
    writeFileSync(path.join(dir, 'w.jsonl'), `${lines.join('\n')}\n`);
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

  it('drops the oldest events beyond the cap and rewrites the file', async () => {
    const store = new PlayerLogStore(dir, logger);
    const first: PlayerEvent[] = [];
    for (let i = 1; i <= PLAYER_LOG_MAX_EVENTS; i++) first.push(ev(`e${i}`, T0 + i));
    store.append('w', first);
    expect(
      store.append('w', [
        ev('new1', T0 + PLAYER_LOG_MAX_EVENTS + 1),
        ev('new2', T0 + PLAYER_LOG_MAX_EVENTS + 2),
      ])
    ).toBe(2);
    await store.flush();

    const events = store.sessions('w').flatMap(s => s.events);
    expect(events).toHaveLength(PLAYER_LOG_MAX_EVENTS);
    expect(events[0].id).toBe('e3');
    expect(events[events.length - 1].id).toBe('new2');

    const lines = readFileSync(path.join(dir, 'w.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(PLAYER_LOG_MAX_EVENTS);
    expect(lines[0]).toContain('"e3"');
    expect(await fsp.readdir(dir)).toEqual(['w.jsonl']);

    // A dropped id is new again if it comes back.
    expect(store.append('w', [ev('e1', T0 + 1)])).toBe(1);
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
