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
const DAY = 24 * 60 * 60 * 1000;

function record(kind: string, at: string): string {
  return JSON.stringify({ version: 1, kind, pulledAt: at });
}

/** A fake folder: file name to text; a missing name throws ENOENT, a name in `denied` EACCES. */
function reader(
  files: Record<string, string>,
  opts: { staleDays?: number; denied?: string[]; log?: (m: string) => void } = {}
): ReturnType<typeof createBackupPullReader> {
  return createBackupPullReader({
    dir: '/pulls',
    now: () => NOW,
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
    expect(parseBackupPull('restic', record('restic', '2026-10-09T10:00:00Z'))).toEqual({
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
      expect(parseBackupPull('restic', text).ok, text).toBe(false);
    }
  });
});

describe('createBackupPullReader', () => {
  it('is fresh when the newest copy of either kind is within the limit', () => {
    const r = reader({
      'restic.json': record('restic', '2026-10-09T12:30:00Z'),
      'snapshot.json': record('snapshot', '2026-10-05T12:00:00Z'),
    })();
    expect(r.state).toBe('available');
    if (r.state !== 'available') return;
    expect(r.stale).toBe(false);
    expect(r.newestAt).toBe('2026-10-09T12:30:00Z');
    expect(r.pulls.map(p => p.kind)).toEqual(['restic', 'snapshot']);
    expect(r.ageMs).toBe(23.5 * 60 * 60 * 1000);
    expect(r.limitDays).toBe(3);
  });

  it('is stale when both kinds are older than 3 days (the newest decides)', () => {
    const r = reader({
      'restic.json': record('restic', '2026-10-06T12:30:00Z'),
      'snapshot.json': record('snapshot', '2026-10-06T12:00:00Z'),
    })();
    expect(r.state === 'available' && r.stale).toBe(true);
    if (r.state === 'available') expect(r.newestAt).toBe('2026-10-06T12:30:00Z');
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

  it('counts a single recorded kind', () => {
    const r = reader({ 'snapshot.json': record('snapshot', '2026-10-09T12:00:00Z') })();
    expect(r.state).toBe('available');
    if (r.state === 'available')
      expect(r.pulls).toEqual([{ kind: 'snapshot', pulledAt: '2026-10-09T12:00:00Z' }]);
  });

  it('treats a time ahead of the clock as fresh, not negative', () => {
    const r = reader({ 'restic.json': record('restic', '2026-10-10T12:05:00Z') })();
    expect(r.state === 'available' && r.ageMs).toBe(0);
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

  it('is unavailable for bad JSON in every file, and logs once', () => {
    const messages: string[] = [];
    const read = reader(
      { 'restic.json': '{oops', 'snapshot.json': '' },
      { log: m => messages.push(m) }
    );
    const r = read();
    expect(r.state === 'unavailable' && r.reason).toBe('invalid');
    read();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('invalid');
  });

  it('uses the good file when the other one is broken', () => {
    const r = reader({
      'restic.json': '{oops',
      'snapshot.json': record('snapshot', '2026-10-09T12:00:00Z'),
    })();
    expect(r.state).toBe('available');
  });

  it('is unavailable and unreadable when the folder cannot be read', () => {
    const r = reader({}, { denied: ['restic.json', 'snapshot.json'] })();
    expect(r.state === 'unavailable' && r.reason).toBe('unreadable');
  });

  it('logs a problem again after the files were usable in between', () => {
    const messages: string[] = [];
    const files: Record<string, string> = {};
    const read = reader(files, { log: m => messages.push(m) });
    read();
    files['restic.json'] = record('restic', '2026-10-09T12:00:00Z');
    expect(read().state).toBe('available');
    delete files['restic.json'];
    read();
    expect(messages).toHaveLength(2);
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
