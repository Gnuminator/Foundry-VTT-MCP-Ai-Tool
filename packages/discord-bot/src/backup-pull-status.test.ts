import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import {
  DEFAULT_BACKUP_PULLS_DIR,
  backupPullsDir,
  createBackupPullReader,
  parseBackupPull,
  parseStaleDays,
} from './backup-pull-status.js';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function record(kind: string, at: string): string {
  return JSON.stringify({ version: 1, kind, pulledAt: at });
}

/** A fake folder: file name to text; a missing name throws ENOENT, a name in `denied` EACCES. */
function reader(
  files: Record<string, string>,
  opts: {
    staleDays?: number;
    denied?: string[];
    log?: (m: string) => void;
    clock?: { now: number };
  } = {}
): ReturnType<typeof createBackupPullReader> {
  return createBackupPullReader({
    dir: '/pulls',
    now: () => opts.clock?.now ?? NOW,
    ...(opts.staleDays !== undefined ? { staleDays: opts.staleDays } : {}),
    ...(opts.log ? { log: opts.log } : {}),
    readFile: path => {
      const name = path.replace(/\\/g, '/').split('/').pop() ?? '';
      if (opts.denied?.includes(name)) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      const text = files[name];
      if (text === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return text;
    },
  });
}

describe('parseBackupPull', () => {
  it('accepts a version 1 record of the right kind', () => {
    expect(parseBackupPull('restic', record('restic', '2026-10-09T10:00:00Z'), NOW)).toEqual({
      ok: true,
      pull: { kind: 'restic', pulledAt: '2026-10-09T10:00:00Z' },
    });
  });

  it('rejects bad JSON, other shapes, versions, kinds and dates', () => {
    for (const text of [
      'not json',
      '[]',
      'null',
      JSON.stringify({ version: 2, kind: 'restic', pulledAt: '2026-10-09T10:00:00Z' }),
      JSON.stringify({ version: 1, kind: 'snapshot', pulledAt: '2026-10-09T10:00:00Z' }),
      JSON.stringify({ version: 1, kind: 'restic' }),
      JSON.stringify({ version: 1, kind: 'restic', pulledAt: 'yesterday' }),
      JSON.stringify({ version: 1, kind: 'restic', pulledAt: 42 }),
    ]) {
      expect(parseBackupPull('restic', text, NOW).ok, text).toBe(false);
    }
  });
});

describe('createBackupPullReader', () => {
  it('is fresh when both kinds are within the limit', () => {
    const r = reader({
      'restic.json': record('restic', '2026-10-09T12:30:00Z'),
      'snapshot.json': record('snapshot', '2026-10-08T12:00:00Z'),
    })();
    expect(r.state).toBe('available');
    if (r.state !== 'available') return;
    expect(r.stale).toBe(false);
    expect(r.pulls.map(p => p.kind)).toEqual(['restic', 'snapshot']);
    expect(r.pulls.map(p => p.stale)).toEqual([false, false]);
    expect(r.pulls[0]?.ageMs).toBe(23.5 * 60 * 60 * 1000);
    expect(r.pulls[1]?.ageMs).toBe(2 * DAY);
    expect(r.limitDays).toBe(3);
  });

  it('judges each kind on its own: only restic stale', () => {
    const r = reader({
      'restic.json': record('restic', '2026-10-05T12:00:00Z'),
      'snapshot.json': record('snapshot', '2026-10-09T12:00:00Z'),
    })();
    expect(r.state).toBe('available');
    if (r.state !== 'available') return;
    expect(r.stale).toBe(true);
    expect(r.pulls.map(p => [p.kind, p.stale])).toEqual([
      ['restic', true],
      ['snapshot', false],
    ]);
  });

  it('judges each kind on its own: only snapshot stale', () => {
    const r = reader({
      'restic.json': record('restic', '2026-10-09T12:00:00Z'),
      'snapshot.json': record('snapshot', '2026-10-05T12:00:00Z'),
    })();
    expect(r.state).toBe('available');
    if (r.state !== 'available') return;
    expect(r.stale).toBe(true);
    expect(r.pulls.map(p => [p.kind, p.stale])).toEqual([
      ['restic', false],
      ['snapshot', true],
    ]);
  });

  it('is stale when both kinds are older than 3 days', () => {
    const r = reader({
      'restic.json': record('restic', '2026-10-06T12:30:00Z'),
      'snapshot.json': record('snapshot', '2026-10-06T12:00:00Z'),
    })();
    expect(r.state === 'available' && r.stale).toBe(true);
    if (r.state === 'available') expect(r.pulls.map(p => p.stale)).toEqual([true, true]);
  });

  it('leaves a kind that was never recorded silent while the other is recent', () => {
    const r = reader({ 'snapshot.json': record('snapshot', '2026-10-09T12:00:00Z') })();
    expect(r.state).toBe('available');
    if (r.state !== 'available') return;
    expect(r.stale).toBe(false);
    expect(r.pulls.map(p => [p.kind, p.problem?.reason ?? null, p.stale])).toEqual([
      ['restic', 'missing', false],
      ['snapshot', null, false],
    ]);
  });

  it('is not stale at exactly the limit and stale just past it', () => {
    const at = (ageMs: number): string => new Date(NOW - ageMs).toISOString();
    const exact = reader({ 'restic.json': record('restic', at(3 * DAY)) })();
    const past = reader({ 'restic.json': record('restic', at(3 * DAY + 1000)) })();
    expect(exact.state === 'available' && exact.stale).toBe(false);
    expect(past.state === 'available' && past.stale).toBe(true);
  });

  it('uses the configured limit', () => {
    const files = { 'restic.json': record('restic', '2026-10-08T12:00:00Z') };
    const two = reader(files, { staleDays: 1 })();
    const seven = reader(files, { staleDays: 7 })();
    expect(two.state === 'available' && two.stale).toBe(true);
    expect(seven.state === 'available' && seven.stale).toBe(false);
    if (two.state === 'available') expect(two.limitDays).toBe(1);
  });

  it('treats a time slightly ahead of the clock as fresh, not negative', () => {
    const r = reader({ 'restic.json': record('restic', '2026-10-10T12:05:00Z') })();
    expect(r.state === 'available' && r.pulls[0]?.ageMs).toBe(0);
    expect(r.state === 'available' && r.stale).toBe(false);
  });

  it('is unavailable (and silent about the Pi) when nothing was ever recorded', () => {
    const messages: string[] = [];
    const read = reader({}, { log: m => messages.push(m) });
    expect(read()).toEqual({
      state: 'unavailable',
      reason: 'missing',
      detail: 'no copy has been recorded yet',
    });
    read();
    expect(messages).toHaveLength(1);
  });

  it('a kind that stays missing becomes stale once the other has been recorded longer than the limit', () => {
    const clock = { now: NOW };
    const files = { 'restic.json': record('restic', '2026-10-10T11:00:00Z') };
    const read = reader(files, { clock });
    const first = read();
    expect(first.state === 'available' && first.pulls[1]?.stale).toBe(false);
    clock.now += 3 * DAY;
    files['restic.json'] = record('restic', new Date(clock.now - HOUR).toISOString());
    const at3 = read();
    expect(at3.state === 'available' && at3.pulls[1]?.stale).toBe(false);
    clock.now += 1000;
    const after = read();
    expect(after.state).toBe('available');
    if (after.state !== 'available') return;
    expect(after.stale).toBe(true);
    expect(after.pulls[0]?.stale).toBe(false);
    expect(after.pulls[1]).toMatchObject({
      kind: 'snapshot',
      pulledAt: null,
      problem: { reason: 'missing' },
      stale: true,
    });
  });

  it('a missing kind stays silent while nothing else is recorded, and the clock starts only when one is', () => {
    const clock = { now: NOW };
    const files: Record<string, string> = {};
    const read = reader(files, { clock });
    read();
    clock.now += 10 * DAY;
    files['restic.json'] = record('restic', new Date(clock.now).toISOString());
    const r = read();
    expect(r.state === 'available' && r.stale).toBe(false);
  });

  it('an invalid record (a zero-length file after a power cut) counts as stale after the limit, and is logged once', () => {
    const clock = { now: NOW };
    const messages: string[] = [];
    const files = {
      'restic.json': record('restic', '2026-10-10T11:00:00Z'),
      'snapshot.json': '',
    };
    const read = reader(files, { clock, log: m => messages.push(m) });
    const first = read();
    expect(first.state === 'available' && first.stale).toBe(false);
    expect(first.state === 'available' && first.pulls[1]?.problem?.reason).toBe('invalid');
    read();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('snapshot invalid');
    clock.now += 3 * DAY + 1000;
    files['restic.json'] = record('restic', new Date(clock.now - HOUR).toISOString());
    const later = read();
    expect(later.state === 'available' && later.stale).toBe(true);
    expect(later.state === 'available' && later.pulls.map(p => p.stale)).toEqual([false, true]);
    expect(messages).toHaveLength(1);
  });

  it('an unreadable record counts as stale after the limit', () => {
    const clock = { now: NOW };
    const files = { 'restic.json': record('restic', '2026-10-10T11:00:00Z') };
    const read = reader(files, { clock, denied: ['snapshot.json'] });
    const first = read();
    expect(first.state === 'available' && first.pulls[1]?.problem).toEqual({
      reason: 'unreadable',
      detail: 'EACCES',
    });
    expect(first.state === 'available' && first.stale).toBe(false);
    clock.now += 4 * DAY;
    files['restic.json'] = record('restic', new Date(clock.now - HOUR).toISOString());
    const later = read();
    expect(later.state === 'available' && later.pulls[1]?.stale).toBe(true);
  });

  it('a problem clears when the file is good again, and is logged again if it returns', () => {
    const clock = { now: NOW };
    const messages: string[] = [];
    const files: Record<string, string> = {
      'restic.json': record('restic', '2026-10-10T11:00:00Z'),
      'snapshot.json': '{oops',
    };
    const read = reader(files, { clock, log: m => messages.push(m) });
    read();
    files['snapshot.json'] = record('snapshot', '2026-10-10T11:30:00Z');
    const ok = read();
    expect(ok.state === 'available' && ok.pulls.map(p => p.problem)).toEqual([null, null]);
    files['snapshot.json'] = '';
    clock.now += HOUR;
    const again = read();
    // The clock started over: only an hour of trouble, not stale.
    expect(again.state === 'available' && again.pulls[1]?.ageMs).toBe(0);
    expect(messages).toHaveLength(2);
  });

  it('with every file broken the reading is still available, so the problem can alarm', () => {
    const clock = { now: NOW };
    const read = reader({ 'restic.json': '{oops', 'snapshot.json': '' }, { clock });
    const r = read();
    expect(r.state).toBe('available');
    expect(r.state === 'available' && r.pulls.map(p => p.problem?.reason)).toEqual([
      'invalid',
      'invalid',
    ]);
    clock.now += 4 * DAY;
    const later = read();
    expect(later.state === 'available' && later.pulls.map(p => p.stale)).toEqual([true, true]);
  });

  it('a time more than a day in the future is an invalid record', () => {
    const r = reader({
      'restic.json': record('restic', '2026-10-11T12:00:01Z'),
      'snapshot.json': record('snapshot', '2026-10-09T12:00:00Z'),
    })();
    expect(r.state === 'available' && r.pulls[0]?.problem?.reason).toBe('invalid');
    expect(r.state === 'available' && r.pulls[0]?.problem?.detail).toContain('in the future');
    // Exactly a day ahead is still tolerated.
    const edge = reader({ 'restic.json': record('restic', '2026-10-11T12:00:00Z') })();
    expect(edge.state === 'available' && edge.pulls[0]?.problem).toBeNull();
  });
});

describe('settings', () => {
  it('parses the stale days: positive numbers only, default 3', () => {
    expect(parseStaleDays(undefined)).toBe(3);
    expect(parseStaleDays('')).toBe(3);
    expect(parseStaleDays('5')).toBe(5);
    expect(parseStaleDays('0.5')).toBe(0.5);
    for (const bad of ['0', '-2', 'abc', 'NaN', '99999']) expect(parseStaleDays(bad)).toBe(3);
  });

  it('finds the folder from the environment, else the Pi default', () => {
    expect(backupPullsDir({})).toBe(DEFAULT_BACKUP_PULLS_DIR);
    expect(backupPullsDir({ FOUNDRY_AI_BACKUP_PULLS: '/x/pulls' })).toBe('/x/pulls');
  });

  it('loadConfig reads both settings from the env file text via process.env', () => {
    const before = {
      dir: process.env['FOUNDRY_AI_BACKUP_PULLS'],
      days: process.env['FOUNDRY_AI_BACKUP_STALE_DAYS'],
    };
    try {
      process.env['FOUNDRY_AI_BACKUP_PULLS'] = '/tmp/pulls';
      process.env['FOUNDRY_AI_BACKUP_STALE_DAYS'] = '4';
      const config = loadConfig('/does/not/exist.env', false);
      expect(config.backupPullsDir).toBe('/tmp/pulls');
      expect(config.backupStaleDays).toBe(4);
      delete process.env['FOUNDRY_AI_BACKUP_PULLS'];
      delete process.env['FOUNDRY_AI_BACKUP_STALE_DAYS'];
      const fresh = loadConfig('/does/not/exist.env', false);
      expect(fresh.backupPullsDir).toBeUndefined();
      expect(fresh.backupStaleDays).toBe(3);
    } finally {
      for (const [key, value] of [
        ['FOUNDRY_AI_BACKUP_PULLS', before.dir],
        ['FOUNDRY_AI_BACKUP_STALE_DAYS', before.days],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
