import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SPACE_STATUS_PATH,
  SPACE_STALE_MS,
  createSpaceStatusReader,
  parseSpaceStatus,
  spaceStatusPath,
} from './space-status.js';

const NOW = Date.parse('2026-10-06T12:00:00Z');

function file(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    checkedAt: '2026-10-06T11:30:00Z',
    host: 'foundry-pi',
    thresholdPercent: 20,
    criticalPercent: 5,
    level: 'ok',
    disks: [
      {
        mount: '/',
        paths: ['/var/lib/foundry'],
        jobs: ['restic backup (source)'],
        totalBytes: 100,
        freeBytes: 63,
        freePercent: 63,
        level: 'ok',
      },
    ],
    ...overrides,
  });
}

describe('parseSpaceStatus', () => {
  it('accepts a version 1 file', () => {
    const r = parseSpaceStatus(file());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status.level).toBe('ok');
      expect(r.status.disks[0]?.mount).toBe('/');
      expect(r.status.lastJob).toBeUndefined();
    }
  });

  it('keeps an optional lastJob', () => {
    const r = parseSpaceStatus(
      file({
        lastJob: { name: 'restic backup', at: '2026-10-06T02:30:00Z', level: 'low', ran: true },
      })
    );
    expect(r.ok && r.status.lastJob?.name).toBe('restic backup');
  });

  it('refuses text that is not JSON, another version, or a broken field', () => {
    expect(parseSpaceStatus('nope').ok).toBe(false);
    expect(parseSpaceStatus('[]').ok).toBe(false);
    expect(parseSpaceStatus(file({ version: 2 })).ok).toBe(false);
    expect(parseSpaceStatus(file({ checkedAt: 'yesterday' })).ok).toBe(false);
    expect(parseSpaceStatus(file({ level: 'fine' })).ok).toBe(false);
    expect(parseSpaceStatus(file({ disks: 'none' })).ok).toBe(false);
    expect(parseSpaceStatus(file({ disks: [{ mount: '/' }] })).ok).toBe(false);
  });

  it('never reports a level lower than the worst disk', () => {
    const r = parseSpaceStatus(
      file({
        level: 'ok',
        disks: [
          {
            mount: '/mnt/x',
            paths: [],
            jobs: [],
            totalBytes: 10,
            freeBytes: 1,
            freePercent: 3,
            level: 'critical',
          },
        ],
      })
    );
    expect(r.ok && r.status.level).toBe('critical');
  });
});

describe('createSpaceStatusReader', () => {
  it('reads a fresh file as available and not stale', () => {
    const read = createSpaceStatusReader({ path: 'x', now: () => NOW, readFile: () => file() });
    const r = read();
    expect(r.state).toBe('available');
    if (r.state === 'available') expect(r.stale).toBe(false);
  });

  it('marks a check older than 3 hours as stale', () => {
    const old = new Date(NOW - SPACE_STALE_MS - 60_000).toISOString();
    const read = createSpaceStatusReader({
      path: 'x',
      now: () => NOW,
      readFile: () => file({ checkedAt: old }),
    });
    const r = read();
    expect(r.state === 'available' && r.stale).toBe(true);
  });

  it('does not call a clock-skewed future time stale', () => {
    const future = new Date(NOW + 10 * 60_000).toISOString();
    const read = createSpaceStatusReader({
      path: 'x',
      now: () => NOW,
      readFile: () => file({ checkedAt: future }),
    });
    const r = read();
    expect(r.state === 'available' && r.stale).toBe(false);
  });

  it('gives a typed unavailable result for a missing, unreadable or invalid file', () => {
    const missing = createSpaceStatusReader({
      path: 'x',
      readFile: () => {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      },
    })();
    expect(missing).toMatchObject({ state: 'unavailable', reason: 'missing' });
    const denied = createSpaceStatusReader({
      path: 'x',
      readFile: () => {
        throw Object.assign(new Error('no'), { code: 'EACCES' });
      },
    })();
    expect(denied).toMatchObject({ state: 'unavailable', reason: 'unreadable' });
    const bad = createSpaceStatusReader({ path: 'x', readFile: () => '{' })();
    expect(bad).toMatchObject({ state: 'unavailable', reason: 'invalid' });
  });

  it('logs a problem once and again after the file recovers', () => {
    const logs: string[] = [];
    let present = false;
    const read = createSpaceStatusReader({
      path: 'x',
      now: () => NOW,
      log: m => logs.push(m),
      readFile: () => {
        if (!present) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        return file();
      },
    });
    read();
    read();
    read();
    expect(logs).toHaveLength(1);
    present = true;
    expect(read().state).toBe('available');
    present = false;
    read();
    expect(logs).toHaveLength(2);
  });

  it('reads a real file from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'space-status-'));
    try {
      const p = join(dir, 'status.json');
      writeFileSync(p, file());
      expect(createSpaceStatusReader({ path: p, now: () => NOW })().state).toBe('available');
      expect(createSpaceStatusReader({ path: join(dir, 'none.json') })().state).toBe('unavailable');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('spaceStatusPath', () => {
  it('uses the env var, else the Pi path', () => {
    expect(spaceStatusPath({})).toBe(DEFAULT_SPACE_STATUS_PATH);
    expect(spaceStatusPath({ FOUNDRY_AI_SPACE_STATUS: '/tmp/s.json' })).toBe('/tmp/s.json');
    expect(spaceStatusPath({ FOUNDRY_AI_SPACE_STATUS: '' })).toBe(DEFAULT_SPACE_STATUS_PATH);
  });
});
