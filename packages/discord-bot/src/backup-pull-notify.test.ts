import { describe, expect, it } from 'vitest';

import type { BackupPullKind, BackupPullReading } from './backup-pull-status.js';
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
const LIMIT = 3 * DAY;

type Available = Extract<BackupPullReading, { state: 'available' }>;

type Spec = number | { problem: 'missing' | 'invalid' | 'unreadable'; ageMs: number };

/**
 * A reading from the age of each kind. A number is the age of a good record; a problem spec is a
 * kind with no usable record, with the time the reader has seen the problem; a kind left out is
 * "missing" with no clock running.
 */
function reading(specs: Partial<Record<BackupPullKind, Spec>>): Available {
  const pulls: Available['pulls'] = [];
  for (const kind of ['restic', 'snapshot'] as const) {
    const spec = specs[kind] ?? { problem: 'missing' as const, ageMs: 0 };
    if (typeof spec === 'number') {
      pulls.push({
        kind,
        pulledAt: new Date(T0 - spec).toISOString(),
        problem: null,
        ageMs: spec,
        stale: spec > LIMIT,
      });
    } else {
      pulls.push({
        kind,
        pulledAt: null,
        problem: { reason: spec.problem, detail: 'test' },
        ageMs: spec.ageMs,
        stale: spec.ageMs > LIMIT,
      });
    }
  }
  return { state: 'available', pulls, stale: pulls.some(p => p.stale), limitDays: 3 };
}

const FRESH = reading({ restic: 5 * HOUR, snapshot: 6 * HOUR });
const STALE = reading({ restic: 4 * DAY, snapshot: 4 * DAY });
const RESTIC_STALE = reading({ restic: 4 * DAY, snapshot: 6 * HOUR });
const SNAPSHOT_STALE = reading({ restic: 5 * HOUR, snapshot: 5 * DAY });
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
  it('says nothing while both kinds are fresh', async () => {
    const h = harness();
    expect(await h.notifier.check(FRESH)).toEqual([]);
    expect(await h.notifier.check(FRESH)).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it('sends one DM when both kinds go stale, not one per check', async () => {
    const h = harness();
    await h.notifier.check(FRESH);
    expect(await h.notifier.check(STALE)).toEqual([
      { notice: 'stale', kinds: ['restic', 'snapshot'] },
    ]);
    expect(await h.notifier.check(STALE)).toEqual([]);
    h.advance(15 * 60 * 1000);
    expect(await h.notifier.check(STALE)).toEqual([]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain('restic and snapshot backups');
  });

  it('alarms when only restic is stale, naming restic', async () => {
    const h = harness();
    expect(await h.notifier.check(RESTIC_STALE)).toEqual([{ notice: 'stale', kinds: ['restic'] }]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain("The Pi's restic backup has not been copied to your PC for 4 days");
    expect(h.sent[0]).not.toContain('snapshot backup');
    expect(h.sent[0]).toContain('Last snapshot copy: 6 hours ago.');
  });

  it('alarms when only snapshot is stale, naming snapshot', async () => {
    const h = harness();
    expect(await h.notifier.check(SNAPSHOT_STALE)).toEqual([
      { notice: 'stale', kinds: ['snapshot'] },
    ]);
    expect(h.sent[0]).toContain(
      "The Pi's snapshot backup has not been copied to your PC for 5 days"
    );
    expect(h.sent[0]).not.toContain('restic backup');
    expect(h.sent[0]).toContain('Last restic copy: 5 hours ago.');
  });

  it('alarms for a stale kind when the other kind was never recorded', async () => {
    const h = harness();
    expect(await h.notifier.check(reading({ snapshot: 4 * DAY }))).toEqual([
      { notice: 'stale', kinds: ['snapshot'] },
    ]);
    expect(h.sent[0]).toContain('Last restic copy: not recorded yet.');
    // The never-recorded kind stays silent: a lone fresh kind raises nothing.
    const h2 = harness();
    expect(await h2.notifier.check(reading({ restic: HOUR }))).toEqual([]);
    expect(h2.sent).toEqual([]);
  });

  it('a second kind going stale later gets its own DM while the first keeps its schedule', async () => {
    const h = harness();
    expect(await h.notifier.check(RESTIC_STALE)).toEqual([{ notice: 'stale', kinds: ['restic'] }]);
    h.advance(2 * HOUR);
    expect(await h.notifier.check(STALE)).toEqual([{ notice: 'stale', kinds: ['snapshot'] }]);
    // Restic's reminder is due 24 h after its own DM, not after snapshot's.
    h.advance(BACKUP_PULL_REMINDER_MS - 2 * HOUR);
    expect(await h.notifier.check(STALE)).toEqual([{ notice: 'reminder', kinds: ['restic'] }]);
    h.advance(2 * HOUR);
    expect(await h.notifier.check(STALE)).toEqual([{ notice: 'reminder', kinds: ['snapshot'] }]);
    expect(h.sent).toHaveLength(4);
  });

  it('reminds at most once a day per stale kind', async () => {
    const h = harness();
    expect(await h.notifier.check(STALE)).toEqual([
      { notice: 'stale', kinds: ['restic', 'snapshot'] },
    ]);
    h.advance(BACKUP_PULL_REMINDER_MS - 1);
    expect(await h.notifier.check(STALE)).toEqual([]);
    h.advance(1);
    expect(await h.notifier.check(STALE)).toEqual([
      { notice: 'reminder', kinds: ['restic', 'snapshot'] },
    ]);
    h.advance(HOUR);
    expect(await h.notifier.check(STALE)).toEqual([]);
    h.advance(BACKUP_PULL_REMINDER_MS);
    expect(await h.notifier.check(STALE)).toHaveLength(1);
    expect(h.sent).toHaveLength(3);
    expect(h.sent[1]).toContain('(reminder)');
    expect(h.sent[0]).not.toContain('(reminder)');
  });

  it('sends one "copied again" DM when both fresh copies arrive, then nothing', async () => {
    const h = harness();
    await h.notifier.check(STALE);
    expect(await h.notifier.check(FRESH)).toEqual([
      { notice: 'recovered', kinds: ['restic', 'snapshot'] },
    ]);
    expect(await h.notifier.check(FRESH)).toEqual([]);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toContain("copied the Pi's restic and snapshot backups again");
    expect(h.sent[1]).toContain('safe on both sides');
    // Going stale again starts over with a first DM, not a reminder.
    h.advance(1000);
    expect(await h.notifier.check(STALE)).toEqual([
      { notice: 'stale', kinds: ['restic', 'snapshot'] },
    ]);
  });

  it('one kind recovers while the other stays stale: a DM for the recovered kind only', async () => {
    const h = harness();
    await h.notifier.check(STALE);
    h.advance(3 * HOUR);
    // Restic is copied again; snapshot is still stale and not yet due a reminder.
    const resticBack = reading({ restic: HOUR, snapshot: 4 * DAY + 3 * HOUR });
    expect(await h.notifier.check(resticBack)).toEqual([
      { notice: 'recovered', kinds: ['restic'] },
    ]);
    expect(h.sent[1]).toContain("copied the Pi's restic backups again");
    expect(h.sent[1]).toContain('The snapshot copy is still out of date.');
    expect(h.sent[1]).not.toContain('safe on both sides');
    expect(await h.notifier.check(resticBack)).toEqual([]);
    // Snapshot keeps its own reminder schedule, counted from its first DM.
    h.advance(BACKUP_PULL_REMINDER_MS - 3 * HOUR);
    const later = reading({ restic: 5 * HOUR, snapshot: 5 * DAY });
    expect(await h.notifier.check(later)).toEqual([{ notice: 'reminder', kinds: ['snapshot'] }]);
    expect(h.sent[2]).toContain('snapshot backup has not been copied');
    expect(h.sent[2]).toContain('(reminder)');
    // Snapshot recovers last.
    expect(await h.notifier.check(FRESH)).toEqual([{ notice: 'recovered', kinds: ['snapshot'] }]);
    expect(h.sent[3]).toContain('safe on both sides');
    expect(h.sent).toHaveLength(4);
  });

  it('a recovered kind going stale again starts with a first DM while the other is only reminded', async () => {
    const h = harness();
    await h.notifier.check(STALE);
    await h.notifier.check(reading({ restic: HOUR, snapshot: 4 * DAY }));
    h.advance(HOUR);
    expect(await h.notifier.check(STALE)).toEqual([{ notice: 'stale', kinds: ['restic'] }]);
  });

  it('recovers silently when no stale DM ever went out', async () => {
    const h = harness();
    h.setSend(false);
    expect(await h.notifier.check(STALE)).toEqual([]);
    h.setSend(true);
    expect(await h.notifier.check(FRESH)).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it('says nothing and changes nothing for a missing or invalid record', async () => {
    const h = harness();
    expect(await h.notifier.check(MISSING)).toEqual([]);
    expect(await h.notifier.check(INVALID)).toEqual([]);
    expect(h.sent).toEqual([]);
    // In the middle of a stale period an unreadable file does not recover it or repeat the DM.
    expect(await h.notifier.check(STALE)).toHaveLength(1);
    expect(await h.notifier.check(MISSING)).toEqual([]);
    expect(await h.notifier.check(INVALID)).toEqual([]);
    expect(await h.notifier.check(STALE)).toEqual([]);
    expect(h.sent).toHaveLength(1);
  });

  it('a kind whose file went missing keeps its state and says nothing', async () => {
    const h = harness();
    await h.notifier.check(STALE);
    expect(await h.notifier.check(reading({ restic: 4 * DAY }))).toEqual([]);
    expect(h.sent).toHaveLength(1);
  });

  it('records nothing when the DM cannot be sent, and tries again next time', async () => {
    const h = harness();
    h.setSend(false);
    expect(await h.notifier.check(STALE)).toEqual([]);
    expect(await h.notifier.check(STALE)).toEqual([]);
    h.setSend(true);
    expect(await h.notifier.check(STALE)).toEqual([
      { notice: 'stale', kinds: ['restic', 'snapshot'] },
    ]);
    expect(h.sent).toHaveLength(1);
  });

  it('retries a failed "copied again" DM', async () => {
    const h = harness();
    await h.notifier.check(STALE);
    h.setSend(false);
    expect(await h.notifier.check(FRESH)).toEqual([]);
    h.setSend(true);
    expect(await h.notifier.check(FRESH)).toEqual([
      { notice: 'recovered', kinds: ['restic', 'snapshot'] },
    ]);
  });

  it('a kind with an unreadable record alarms after the limit, with a "record unreadable" line', async () => {
    const h = harness();
    const quiet = reading({ restic: HOUR, snapshot: { problem: 'invalid', ageMs: DAY } });
    expect(await h.notifier.check(quiet)).toEqual([]);
    const loud = reading({ restic: HOUR, snapshot: { problem: 'invalid', ageMs: 4 * DAY } });
    expect(await h.notifier.check(loud)).toEqual([{ notice: 'stale', kinds: ['snapshot'] }]);
    expect(h.sent[0]).toContain('record of the snapshot copy has been unreadable for 4 days');
    expect(h.sent[0]).toContain('Last snapshot copy: record unreadable.');
    expect(h.sent[0]).toContain('Last restic copy: 1 hour ago.');
    // Not repeated before the reminder is due.
    expect(await h.notifier.check(loud)).toEqual([]);
  });

  it('a never-recorded kind alarms once the reader says the other has been recorded past the limit', async () => {
    const h = harness();
    const r = reading({ restic: HOUR, snapshot: { problem: 'missing', ageMs: 4 * DAY } });
    expect(await h.notifier.check(r)).toEqual([{ notice: 'stale', kinds: ['snapshot'] }]);
    expect(h.sent[0]).toContain('No snapshot copy has been recorded for 4 days');
    expect(h.sent[0]).toContain('Last snapshot copy: not recorded yet.');
    // Its first good copy later sends "copied again".
    expect(await h.notifier.check(FRESH)).toEqual([{ notice: 'recovered', kinds: ['snapshot'] }]);
  });

  it('a stale kind whose file just broke is not "copied again" and keeps its reminder schedule', async () => {
    const h = harness();
    await h.notifier.check(RESTIC_STALE);
    h.advance(HOUR);
    const broke = reading({ restic: { problem: 'invalid', ageMs: 0 }, snapshot: 6 * HOUR });
    expect(await h.notifier.check(broke)).toEqual([]);
    h.advance(BACKUP_PULL_REMINDER_MS);
    const brokeLong = reading({ restic: { problem: 'invalid', ageMs: 5 * DAY }, snapshot: HOUR });
    expect(await h.notifier.check(brokeLong)).toEqual([{ notice: 'reminder', kinds: ['restic'] }]);
    expect(h.sent).toHaveLength(2);
  });

  it('alarms for both a stale kind and a broken kind in one DM', async () => {
    const h = harness();
    const r = reading({ restic: 4 * DAY, snapshot: { problem: 'unreadable', ageMs: 5 * DAY } });
    expect(await h.notifier.check(r)).toEqual([{ notice: 'stale', kinds: ['restic', 'snapshot'] }]);
    expect(h.sent[0]).toContain("The Pi's restic backup has not been copied to your PC for 4 days");
    expect(h.sent[0]).toContain('record of the snapshot copy has been unreadable for 5 days');
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

  it('the stale DM names the kinds, how long each, the limit and what to do', () => {
    const text = backupPullMessage('stale', reading({ restic: 4 * DAY, snapshot: 5 * DAY }));
    expect(text).toContain('restic and snapshot backups have not been copied to your PC');
    expect(text).toContain('restic for 4 days and snapshot for 5 days');
    expect(text).toContain('the limit is 3 days');
    expect(text).toContain('Last restic copy: 4 days ago.');
    expect(text).toContain('Last snapshot copy: 5 days ago.');
    expect(text).toContain('Turn the PC on');
    expect(text).toContain('Foundry Pi restic copy');
    expect(text).toContain('Foundry Pi snapshot pull');
  });

  it('says "not recorded yet" for a kind that was never copied', () => {
    const text = backupPullMessage('stale', reading({ restic: 4 * DAY }));
    expect(text).toContain('Last snapshot copy: not recorded yet.');
  });

  it('uses no em dashes', () => {
    const dash = String.fromCharCode(0x2014);
    for (const notice of ['stale', 'reminder', 'recovered'] as const) {
      for (const r of [STALE, RESTIC_STALE, SNAPSHOT_STALE, FRESH]) {
        for (const kinds of [['restic'], ['snapshot'], ['restic', 'snapshot']] as const) {
          expect(backupPullMessage(notice, r, kinds).includes(dash)).toBe(false);
        }
      }
    }
  });
});
