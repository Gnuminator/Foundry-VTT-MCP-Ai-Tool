import { describe, expect, it } from 'vitest';

import type { BackupPull, BackupPullReading } from './backup-pull-status.js';
import {
  BACKUP_PULL_REMINDER_MS,
  BackupPullNotifier,
  agoText,
  backupPullMessage,
  spanText,
} from './backup-pull-notify.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-10-10T12:00:00Z');

function reading(
  ageMs: number,
  stale: boolean,
  kinds: Array<'restic' | 'snapshot'> = ['restic', 'snapshot']
): BackupPullReading {
  const pulls: BackupPull[] = kinds.map((kind, i) => ({
    kind,
    pulledAt: new Date(T0 - ageMs - i * HOUR).toISOString(),
  }));
  return {
    state: 'available',
    pulls,
    newestAt: pulls[0]?.pulledAt ?? '',
    ageMs,
    stale,
    limitDays: 3,
  };
}

const FRESH = reading(5 * HOUR, false);
const STALE = reading(4 * DAY, true);
const MISSING: BackupPullReading = {
  state: 'unavailable',
  reason: 'missing',
  detail: 'no copy has been recorded yet',
};
const INVALID: BackupPullReading = {
  state: 'unavailable',
  reason: 'invalid',
  detail: 'restic.json is not valid JSON',
};

function harness(): {
  notifier: BackupPullNotifier;
  sent: string[];
  advance: (ms: number) => void;
  setSend: (ok: boolean) => void;
} {
  let now = T0;
  let ok = true;
  const sent: string[] = [];
  const notifier = new BackupPullNotifier({
    now: () => now,
    send: (text): Promise<boolean> => {
      if (ok) sent.push(text);
      return Promise.resolve(ok);
    },
  });
  return {
    notifier,
    sent,
    advance: (ms: number): void => {
      now += ms;
    },
    setSend: (value: boolean): void => {
      ok = value;
    },
  };
}

describe('BackupPullNotifier', () => {
  it('says nothing while the copies are fresh', async () => {
    const h = harness();
    expect(await h.notifier.check(FRESH)).toBeNull();
    expect(await h.notifier.check(FRESH)).toBeNull();
    expect(h.sent).toEqual([]);
  });

  it('sends one DM when the copies go stale, not one per check', async () => {
    const h = harness();
    await h.notifier.check(FRESH);
    expect(await h.notifier.check(STALE)).toBe('stale');
    expect(await h.notifier.check(STALE)).toBeNull();
    h.advance(15 * 60 * 1000);
    expect(await h.notifier.check(STALE)).toBeNull();
    expect(h.sent).toHaveLength(1);
  });

  it('reminds at most once a day while stale', async () => {
    const h = harness();
    expect(await h.notifier.check(STALE)).toBe('stale');
    h.advance(BACKUP_PULL_REMINDER_MS - 1);
    expect(await h.notifier.check(STALE)).toBeNull();
    h.advance(1);
    expect(await h.notifier.check(STALE)).toBe('reminder');
    h.advance(HOUR);
    expect(await h.notifier.check(STALE)).toBeNull();
    h.advance(BACKUP_PULL_REMINDER_MS);
    expect(await h.notifier.check(STALE)).toBe('reminder');
    expect(h.sent).toHaveLength(3);
    expect(h.sent[1]).toContain('(reminder)');
    expect(h.sent[0]).not.toContain('(reminder)');
  });

  it('sends one "copied again" DM when a fresh copy arrives, then nothing', async () => {
    const h = harness();
    await h.notifier.check(STALE);
    expect(await h.notifier.check(FRESH)).toBe('recovered');
    expect(await h.notifier.check(FRESH)).toBeNull();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toContain('copied the Pi');
    // Going stale again starts over with a first DM, not a reminder.
    h.advance(1000);
    expect(await h.notifier.check(STALE)).toBe('stale');
  });

  it('recovers silently when no stale DM ever went out', async () => {
    const h = harness();
    h.setSend(false);
    expect(await h.notifier.check(STALE)).toBeNull();
    h.setSend(true);
    expect(await h.notifier.check(FRESH)).toBeNull();
    expect(h.sent).toEqual([]);
  });

  it('says nothing and changes nothing for a missing or invalid record', async () => {
    const h = harness();
    expect(await h.notifier.check(MISSING)).toBeNull();
    expect(await h.notifier.check(INVALID)).toBeNull();
    expect(h.sent).toEqual([]);
    // In the middle of a stale period an unreadable file does not recover it or repeat the DM.
    expect(await h.notifier.check(STALE)).toBe('stale');
    expect(await h.notifier.check(MISSING)).toBeNull();
    expect(await h.notifier.check(INVALID)).toBeNull();
    expect(await h.notifier.check(STALE)).toBeNull();
    expect(h.sent).toHaveLength(1);
  });

  it('records nothing when the DM cannot be sent, and tries again next time', async () => {
    const h = harness();
    h.setSend(false);
    expect(await h.notifier.check(STALE)).toBeNull();
    expect(await h.notifier.check(STALE)).toBeNull();
    h.setSend(true);
    expect(await h.notifier.check(STALE)).toBe('stale');
    expect(h.sent).toHaveLength(1);
  });

  it('retries a failed "copied again" DM', async () => {
    const h = harness();
    await h.notifier.check(STALE);
    h.setSend(false);
    expect(await h.notifier.check(FRESH)).toBeNull();
    h.setSend(true);
    expect(await h.notifier.check(FRESH)).toBe('recovered');
  });
});

describe('messages', () => {
  it('formats short spans and ago texts', () => {
    expect(spanText(10 * 60 * 1000)).toBe('less than an hour');
    expect(spanText(HOUR)).toBe('1 hour');
    expect(spanText(30 * HOUR)).toBe('30 hours');
    expect(spanText(2 * DAY)).toBe('2 days');
    expect(spanText(4.7 * DAY)).toBe('4 days');
    expect(agoText(5 * HOUR)).toBe('5 hours ago');
  });

  it('the stale DM names how long, both kinds, the limit and what to do', () => {
    const text = backupPullMessage(
      'stale',
      STALE as Extract<BackupPullReading, { state: 'available' }>,
      T0
    );
    expect(text).toContain('have not been copied to your PC for 4 days');
    expect(text).toContain('the limit is 3 days');
    expect(text).toContain('Last restic copy: 4 days ago.');
    expect(text).toContain('Last snapshot copy: 4 days ago.');
    expect(text).toContain('Turn the PC on');
    expect(text).toContain('Foundry Pi restic copy');
    expect(text).toContain('Foundry Pi snapshot pull');
  });

  it('says "not recorded yet" for a kind that was never copied', () => {
    const only = reading(4 * DAY, true, ['restic']) as Extract<
      BackupPullReading,
      { state: 'available' }
    >;
    const text = backupPullMessage('stale', only, T0);
    expect(text).toContain('Last snapshot copy: not recorded yet.');
  });

  it('uses no em dashes', () => {
    const dash = String.fromCharCode(0x2014);
    for (const kind of ['stale', 'reminder', 'recovered'] as const) {
      const text = backupPullMessage(
        kind,
        STALE as Extract<BackupPullReading, { state: 'available' }>,
        T0
      );
      expect(text.includes(dash)).toBe(false);
    }
  });
});
