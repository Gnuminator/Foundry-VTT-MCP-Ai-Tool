import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import {
  SPACE_REMINDER_MS,
  SpaceNotifier,
  resolveOwnerId,
  spaceMessage,
  spaceStateOf,
} from './space-notify.js';
import type { SpaceLevel, SpaceReading, SpaceStatus } from './space-status.js';

const T0 = Date.parse('2026-10-06T12:00:00Z');

function status(level: SpaceLevel, freePercent = 12.3): SpaceStatus {
  return {
    version: 1,
    checkedAt: '2026-10-06T11:45:00Z',
    host: 'foundry-pi',
    thresholdPercent: 20,
    criticalPercent: 5,
    level,
    disks: [
      {
        mount: '/mnt/backup',
        paths: ['/mnt/dietpi-backup'],
        jobs: ['dietpi-backup snapshots (destination)', 'restic backup (destination)'],
        totalBytes: 100e9,
        freeBytes: 12.3e9,
        freePercent,
        level,
      },
    ],
  };
}

function reading(level: SpaceLevel, stale = false): SpaceReading {
  return { state: 'available', status: status(level), stale, ageMs: 0 };
}

const MISSING: SpaceReading = { state: 'unavailable', reason: 'missing', detail: 'no status file' };

function harness(sendResult = true): {
  notifier: SpaceNotifier;
  sent: string[];
  advance: (ms: number) => void;
  setSend: (ok: boolean) => void;
} {
  let now = T0;
  let ok = sendResult;
  const sent: string[] = [];
  const notifier = new SpaceNotifier({
    now: () => now,
    send: (text): Promise<boolean> => {
      if (ok) sent.push(text);
      return Promise.resolve(ok);
    },
  });
  return {
    notifier,
    sent,
    advance: (ms): void => {
      now += ms;
    },
    setSend: (value): void => {
      ok = value;
    },
  };
}

describe('SpaceNotifier', () => {
  it('says nothing while space is ok', async () => {
    const h = harness();
    expect(await h.notifier.check(reading('ok'))).toBeNull();
    expect(h.sent).toEqual([]);
  });

  it('sends one DM when space turns low, then stays quiet', async () => {
    const h = harness();
    expect(await h.notifier.check(reading('low'))).toBe('worse');
    h.advance(15 * 60_000);
    expect(await h.notifier.check(reading('low'))).toBeNull();
    expect(h.sent).toHaveLength(1);
  });

  it('sends another DM when it gets worse', async () => {
    const h = harness();
    await h.notifier.check(reading('low'));
    h.advance(60_000);
    expect(await h.notifier.check(reading('critical'))).toBe('worse');
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toContain('CRITICAL');
  });

  it('reminds at most once per 24 hours while it stays bad', async () => {
    const h = harness();
    await h.notifier.check(reading('critical'));
    h.advance(SPACE_REMINDER_MS - 1000);
    expect(await h.notifier.check(reading('critical'))).toBeNull();
    h.advance(2000);
    expect(await h.notifier.check(reading('critical'))).toBe('reminder');
    h.advance(60 * 60_000);
    expect(await h.notifier.check(reading('critical'))).toBeNull();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toContain('(reminder)');
  });

  it('does not DM when it improves but is still low, and counts a later worsening', async () => {
    const h = harness();
    await h.notifier.check(reading('critical'));
    h.advance(60_000);
    expect(await h.notifier.check(reading('low'))).toBeNull();
    h.advance(60_000);
    expect(await h.notifier.check(reading('critical'))).toBe('worse');
  });

  it('sends one back-to-normal DM on recovery and nothing after', async () => {
    const h = harness();
    await h.notifier.check(reading('low'));
    h.advance(60_000);
    expect(await h.notifier.check(reading('ok'))).toBe('recovered');
    expect(await h.notifier.check(reading('ok'))).toBeNull();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toContain('back to normal');
    // A new problem after the recovery is a fresh DM.
    expect(await h.notifier.check(reading('low'))).toBe('worse');
  });

  it('handles a stale check like a problem, with its own text', async () => {
    const h = harness();
    expect(await h.notifier.check(reading('ok', true))).toBe('worse');
    expect(h.sent[0]).toContain('has not run');
    h.advance(60_000);
    expect(await h.notifier.check(reading('ok', true))).toBeNull();
    expect(await h.notifier.check(reading('ok'))).toBe('recovered');
  });

  it('ignores a missing file and keeps its state', async () => {
    const h = harness();
    await h.notifier.check(reading('low'));
    expect(await h.notifier.check(MISSING)).toBeNull();
    // Still low: no new DM, and no false recovery.
    h.advance(60_000);
    expect(await h.notifier.check(reading('low'))).toBeNull();
    expect(h.sent).toHaveLength(1);
    const fresh = harness();
    expect(await fresh.notifier.check(MISSING)).toBeNull();
    expect(fresh.sent).toEqual([]);
  });

  it('records nothing when a DM fails, so the next check tries again', async () => {
    const h = harness(false);
    expect(await h.notifier.check(reading('low'))).toBeNull();
    h.setSend(true);
    h.advance(15 * 60_000);
    expect(await h.notifier.check(reading('low'))).toBe('worse');
    expect(h.sent).toHaveLength(1);
  });
});

describe('spaceMessage', () => {
  it('names the mount, the free percent, the free GB and the jobs', () => {
    const text = spaceMessage('worse', 'low', status('low'), T0);
    expect(text).toContain('/mnt/backup');
    expect(text).toContain('12.3% free');
    expect(text).toContain('12.3 GB');
    expect(text).toContain('restic backup (destination)');
    expect(text).not.toMatch(/\u2014/);
  });

  it('only lists the disks that are not ok', () => {
    const s = status('low');
    s.disks.push({ ...s.disks[0], mount: '/', level: 'ok', freePercent: 70 });
    const text = spaceMessage('worse', 'low', s, T0);
    expect(text).not.toContain('70% free');
  });
});

describe('spaceStateOf', () => {
  it('is null when unavailable, stale before the level when stale', () => {
    expect(spaceStateOf(MISSING)).toBeNull();
    expect(spaceStateOf(reading('critical', true))).toBe('stale');
    expect(spaceStateOf(reading('low'))).toBe('low');
  });
});

describe('resolveOwnerId', () => {
  it('prefers the configured id, then a user owner, then a team owner', () => {
    expect(resolveOwnerId('111', { id: '222' })).toBe('111');
    expect(resolveOwnerId(undefined, { id: '222' })).toBe('222');
    expect(resolveOwnerId(undefined, { id: 'team', ownerId: '333' })).toBe('333');
    expect(resolveOwnerId(undefined, null)).toBeNull();
    expect(resolveOwnerId('', undefined)).toBeNull();
  });
});

describe('config', () => {
  it('reads DISCORD_OWNER_ID and FOUNDRY_AI_SPACE_STATUS', () => {
    const before = { ...process.env };
    process.env['DISCORD_OWNER_ID'] = '12345678901234567';
    process.env['FOUNDRY_AI_SPACE_STATUS'] = '/tmp/s.json';
    try {
      const c = loadConfig('/nonexistent/discord-bot.env', false);
      expect(c.ownerId).toBe('12345678901234567');
      expect(c.spaceStatusFile).toBe('/tmp/s.json');
    } finally {
      for (const k of ['DISCORD_OWNER_ID', 'FOUNDRY_AI_SPACE_STATUS']) {
        if (before[k] === undefined) delete process.env[k];
        else process.env[k] = before[k];
      }
    }
  });
});

describe('the bot keeps a copy of the shared reader', () => {
  it('is identical to shared/src/space-status.ts', () => {
    const norm = (t: string): string => t.replace(/\r\n/g, '\n');
    const copy = readFileSync(fileURLToPath(new URL('./space-status.ts', import.meta.url)), 'utf8');
    const shared = readFileSync(
      fileURLToPath(new URL('../../../shared/src/space-status.ts', import.meta.url)),
      'utf8'
    );
    expect(norm(copy)).toBe(norm(shared));
  });
});
