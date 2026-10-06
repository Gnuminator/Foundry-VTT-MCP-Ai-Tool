import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import {
  LogThrottle,
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

function reading(level: SpaceLevel, stale = false, freePercent?: number): SpaceReading {
  return { state: 'available', status: status(level, freePercent), stale, ageMs: 0 };
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
    expect(await h.notifier.check(reading('ok', false, 50))).toBe('recovered');
    expect(await h.notifier.check(reading('ok', false, 50))).toBeNull();
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

describe('SpaceNotifier hysteresis', () => {
  it('stays low (no DMs) while a disk hovers between 20% and 22% after a low notice', async () => {
    const h = harness();
    expect(await h.notifier.check(reading('low', false, 19.9))).toBe('worse');
    for (const free of [20.1, 19.9, 21.9, 20.5, 19.95, 21.0]) {
      h.advance(15 * 60_000);
      expect(await h.notifier.check(reading(free >= 20 ? 'ok' : 'low', false, free))).toBeNull();
    }
    expect(h.sent).toHaveLength(1);
  });

  it('recovers only at 22% or more, and then a new dip is a fresh DM', async () => {
    const h = harness();
    await h.notifier.check(reading('low', false, 19.9));
    h.advance(60_000);
    expect(await h.notifier.check(reading('ok', false, 21.99))).toBeNull();
    h.advance(60_000);
    expect(await h.notifier.check(reading('ok', false, 22))).toBe('recovered');
    expect(h.sent).toHaveLength(2);
    h.advance(60_000);
    expect(await h.notifier.check(reading('low', false, 19.9))).toBe('worse');
  });

  it('still sends the 24 hour reminder while held in the 20% to 22% band', async () => {
    const h = harness();
    await h.notifier.check(reading('low', false, 19.9));
    h.advance(SPACE_REMINDER_MS + 1000);
    expect(await h.notifier.check(reading('ok', false, 20.5))).toBe('reminder');
    expect(h.sent[1]).toContain('(reminder)');
    expect(h.sent[1]).toContain('low');
  });

  it('uses the threshold in the file, not a fixed 20', async () => {
    const h = harness();
    const at = (free: number, level: SpaceLevel): SpaceReading => {
      const r = reading(level, false, free);
      if (r.state === 'available') r.status.thresholdPercent = 30;
      return r;
    };
    await h.notifier.check(at(29, 'low'));
    h.advance(60_000);
    expect(await h.notifier.check(at(31, 'ok'))).toBeNull();
    h.advance(60_000);
    expect(await h.notifier.check(at(32, 'ok'))).toBe('recovered');
  });

  it('every disk must clear the margin, not just the worst reading level', async () => {
    const h = harness();
    await h.notifier.check(reading('low', false, 19));
    const r = reading('ok', false, 50);
    if (r.state === 'available') {
      r.status.disks.push({ ...r.status.disks[0], mount: '/', level: 'ok', freePercent: 21 });
    }
    h.advance(60_000);
    expect(await h.notifier.check(r)).toBeNull();
  });

  it('leaves critical only above the critical line plus 1 point', async () => {
    const h = harness();
    expect(await h.notifier.check(reading('critical', false, 4.9))).toBe('worse');
    // 5.5% is "low" by the file, but inside the critical margin: still critical, no DM.
    h.advance(60_000);
    expect(await h.notifier.check(reading('low', false, 5.5))).toBeNull();
    // A drop again is not "worse", because the state never left critical.
    h.advance(60_000);
    expect(await h.notifier.check(reading('critical', false, 4.9))).toBeNull();
    expect(h.sent).toHaveLength(1);
    // At 6% it is low: quiet, and a later critical counts again.
    h.advance(60_000);
    expect(await h.notifier.check(reading('low', false, 6))).toBeNull();
    h.advance(60_000);
    expect(await h.notifier.check(reading('critical', false, 4.9))).toBe('worse');
  });

  it('goes from critical straight to ok only past the low margin', async () => {
    const h = harness();
    await h.notifier.check(reading('critical', false, 4));
    h.advance(60_000);
    expect(await h.notifier.check(reading('ok', false, 21))).toBeNull();
    h.advance(60_000);
    expect(await h.notifier.check(reading('ok', false, 30))).toBe('recovered');
  });

  it('does not hold an ok state: a first low is a DM at once', async () => {
    const h = harness();
    expect(await h.notifier.check(reading('ok', false, 21))).toBeNull();
    expect(await h.notifier.check(reading('low', false, 19.9))).toBe('worse');
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

describe('resolveOwnerId with discord.js owner shapes', () => {
  it('uses a User owner id', () => {
    expect(resolveOwnerId(undefined, { id: '222' })).toBe('222');
  });

  it('never uses a Team id: it takes the team owner user', () => {
    expect(resolveOwnerId(undefined, { id: 'team-1', ownerId: '333', members: [] })).toBe('333');
    expect(
      resolveOwnerId(undefined, {
        id: 'team-1',
        ownerId: null,
        owner: { id: '444', user: { id: '444' } },
      })
    ).toBe('444');
  });

  it('falls back to a member of the team (a Map like discord.js Collection, or an array)', () => {
    const members = new Map([['555', { id: '555', user: { id: '555' } }]]);
    expect(resolveOwnerId(undefined, { id: 'team-1', ownerId: null, members })).toBe('555');
    expect(resolveOwnerId(undefined, { id: 'team-1', members: [{ user: { id: '666' } }] })).toBe(
      '666'
    );
  });

  it('is null for a Team with no user id anywhere', () => {
    expect(
      resolveOwnerId(undefined, { id: 'team-1', ownerId: null, owner: null, members: new Map() })
    ).toBeNull();
    expect(resolveOwnerId(undefined, { id: 'team-1', ownerId: null })).toBeNull();
  });

  it('a configured id wins over any owner', () => {
    expect(resolveOwnerId('111', { id: 'team-1', ownerId: null })).toBe('111');
  });
});

describe('LogThrottle', () => {
  it('logs once, stays quiet for 24 hours, then logs again', () => {
    let now = T0;
    const t = new LogThrottle(SPACE_REMINDER_MS, () => now);
    expect(t.shouldLog()).toBe(true);
    now += SPACE_REMINDER_MS - 1;
    expect(t.shouldLog()).toBe(false);
    now += 1;
    expect(t.shouldLog()).toBe(true);
    expect(t.shouldLog()).toBe(false);
  });

  it('logs again right after a reset (a DM went through)', () => {
    const t = new LogThrottle(SPACE_REMINDER_MS, () => T0);
    expect(t.shouldLog()).toBe(true);
    t.reset();
    expect(t.shouldLog()).toBe(true);
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
