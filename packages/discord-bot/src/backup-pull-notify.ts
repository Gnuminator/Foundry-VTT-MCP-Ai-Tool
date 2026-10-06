/**
 * Stale backup copy notices (PB-06, 2026-10-06): the bot reads the Pi's record of when this PC last
 * copied its backups (backup-pull-status.ts) every 15 minutes and sends the owner a Discord DM
 * when a kind of copy (restic or snapshot) is older than the limit (3 days by default).
 *
 * The two kinds are separate backups, so each is judged on its own: a restic copy that keeps
 * arriving does not hide a snapshot copy that stopped, and the other way round.
 *
 * Rules, kept per kind in `BackupPullNotifier` (no Discord in it, so tests run it with a fake `send`):
 * - one DM when a kind goes stale, naming the stale kind or kinds and how old each copy is;
 * - while a kind stays stale, at most one reminder every 24 hours for that kind;
 * - one "copied again" DM when a stale kind gets a fresh copy (only if a stale DM was sent for it),
 *   while the other kind keeps its own reminder schedule;
 * - a kind whose record is missing, unreadable or invalid is judged by the reader (see
 *   backup-pull-status.ts): it counts as stale once that has lasted longer than the limit and the DM
 *   says "record unreadable" or "not recorded"; before that it says nothing and changes nothing;
 * - an unavailable reading (no copy ever recorded at all) says nothing and changes nothing, so a
 *   fresh install or a dev machine never raises a false alarm;
 * - if a DM cannot be sent, nothing is recorded for the kinds in it, so the next check tries again.
 * The state lives in memory: a bot restart can repeat one DM.
 */

import type { BackupPullKind, BackupPullReading, BackupPullStatus } from './backup-pull-status.js';
import { BACKUP_PULL_KINDS } from './backup-pull-status.js';

export const BACKUP_PULL_REMINDER_MS = 24 * 60 * 60 * 1000;

export type BackupPullNoticeKind = 'stale' | 'reminder' | 'recovered';

/** One DM that was sent: what it was, and which kinds it was about. */
export interface BackupPullSent {
  notice: BackupPullNoticeKind;
  kinds: BackupPullKind[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A short, plain length of time: "less than an hour", "5 hours", "4 days". */
export function spanText(ageMs: number): string {
  if (ageMs < HOUR_MS) return 'less than an hour';
  if (ageMs < 2 * DAY_MS) {
    const hours = Math.floor(ageMs / HOUR_MS);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${Math.floor(ageMs / DAY_MS)} days`;
}

/** A short, plain "how long ago". */
export function agoText(ageMs: number): string {
  return `${spanText(ageMs)} ago`;
}

type AvailableReading = Extract<BackupPullReading, { state: 'available' }>;

const KIND_LABEL: Record<BackupPullKind, string> = {
  restic: 'restic',
  snapshot: 'snapshot',
};

/** "restic", "snapshot" or "restic and snapshot". */
function kindsText(kinds: readonly BackupPullKind[]): string {
  return kinds.map(k => KIND_LABEL[k]).join(' and ');
}

function kindLine(kind: BackupPullKind, pull: BackupPullStatus | undefined): string {
  const label = `Last ${KIND_LABEL[kind]} copy`;
  if (!pull || pull.problem?.reason === 'missing') return `${label}: not recorded yet.`;
  if (pull.problem) return `${label}: record unreadable.`;
  return `${label}: ${agoText(pull.ageMs)}.`;
}

function pullOf(reading: AvailableReading, kind: BackupPullKind): BackupPullStatus | undefined {
  return reading.pulls.find(p => p.kind === kind);
}

/**
 * The DM text. Plain English. For "stale" and "reminder", `kinds` are the stale kinds the DM is
 * about; for "recovered", the kinds that were copied again. Both kinds' last copy times are shown.
 */
export function backupPullMessage(
  notice: BackupPullNoticeKind,
  reading: AvailableReading,
  kinds: readonly BackupPullKind[] = reading.pulls.filter(p => p.stale).map(p => p.kind)
): string {
  const stillStale = reading.pulls.filter(p => p.stale).map(p => p.kind);
  if (notice === 'recovered') {
    const ages = kinds
      .map(k => pullOf(reading, k))
      .filter((p): p is BackupPullStatus => p !== undefined)
      .map(p => agoText(p.ageMs));
    const head = `The PC has copied the Pi's ${kindsText(kinds)} backups again (${ages.join(' and ')}).`;
    const tail =
      stillStale.length === 0
        ? 'Backups are safe on both sides again.'
        : `The ${kindsText(stillStale)} copy is still out of date.`;
    return `${head} ${tail}`;
  }
  const again = notice === 'reminder' ? ' (reminder)' : '';
  const pulls = kinds
    .map(k => pullOf(reading, k))
    .filter((p): p is BackupPullStatus => p !== undefined);
  let headline: string;
  if (pulls.every(p => p.problem === null)) {
    const spans = pulls.map(p =>
      pulls.length > 1 ? `${KIND_LABEL[p.kind]} for ${spanText(p.ageMs)}` : spanText(p.ageMs)
    );
    headline =
      kinds.length > 1
        ? `The Pi's ${kindsText(kinds)} backups have not been copied to your PC: ${spans.join(' and ')}`
        : `The Pi's ${kindsText(kinds)} backup has not been copied to your PC for ${spans.join(' and ')}`;
  } else {
    // At least one kind has no usable record: say which, so the cause is clear.
    headline = pulls
      .map(p => {
        if (p.problem === null) {
          return `The Pi's ${KIND_LABEL[p.kind]} backup has not been copied to your PC for ${spanText(p.ageMs)}`;
        }
        if (p.problem.reason === 'missing') {
          return `No ${KIND_LABEL[p.kind]} copy has been recorded for ${spanText(p.ageMs)}`;
        }
        return `The Pi's record of the ${KIND_LABEL[p.kind]} copy has been unreadable for ${spanText(p.ageMs)}, so the copy cannot be checked`;
      })
      .join('; ');
  }
  const limit = `${reading.limitDays} ${reading.limitDays === 1 ? 'day' : 'days'}`;
  return (
    `${headline}${again} (the limit is ${limit}).\n` +
    `${kindLine('restic', pullOf(reading, 'restic'))}\n${kindLine('snapshot', pullOf(reading, 'snapshot'))}\n` +
    'Turn the PC on, or run the two tasks "Foundry Pi restic copy" and "Foundry Pi snapshot pull" in Task Scheduler. ' +
    'Until then the only copies are on the Pi.'
  );
}

export interface BackupPullNotifierOptions {
  /** Send one DM; resolves true when it was delivered. */
  send: (text: string) => Promise<boolean>;
  now?: () => number;
  reminderMs?: number;
}

interface KindState {
  stale: boolean;
  /** When the last stale or reminder DM for this kind went out; null if none did. */
  lastNoticeAt: number | null;
}

export class BackupPullNotifier {
  private readonly states = new Map<BackupPullKind, KindState>();
  private readonly now: () => number;
  private readonly reminderMs: number;

  constructor(private readonly options: BackupPullNotifierOptions) {
    this.now = options.now ?? Date.now;
    this.reminderMs = options.reminderMs ?? BACKUP_PULL_REMINDER_MS;
  }

  private stateOf(kind: BackupPullKind): KindState {
    let state = this.states.get(kind);
    if (!state) {
      state = { stale: false, lastNoticeAt: null };
      this.states.set(kind, state);
    }
    return state;
  }

  /**
   * Look at one reading and send the DMs the rules say so: at most one for kinds that are due a
   * stale notice or reminder, and at most one for kinds that were copied again. Returns what it
   * sent (empty when nothing).
   */
  async check(reading: BackupPullReading): Promise<BackupPullSent[]> {
    if (reading.state !== 'available') return [];
    const now = this.now();
    const sent: BackupPullSent[] = [];

    const recovered: BackupPullKind[] = [];
    const firstStale: BackupPullKind[] = [];
    const reminderDue: BackupPullKind[] = [];
    for (const kind of BACKUP_PULL_KINDS) {
      const pull = pullOf(reading, kind);
      if (!pull) continue;
      // A record that is missing, unreadable or invalid but not yet over the limit tells nothing:
      // say nothing and change nothing (a stale kind whose file just broke is not "copied again").
      if (pull.problem && !pull.stale) continue;
      const state = this.stateOf(kind);
      if (!pull.stale) {
        if (!state.stale) continue;
        if (state.lastNoticeAt === null) {
          // Nothing was ever sent for this stale spell: recover silently.
          state.stale = false;
        } else {
          recovered.push(kind);
        }
        continue;
      }
      if (!state.stale || state.lastNoticeAt === null) {
        firstStale.push(kind);
      } else if (now - state.lastNoticeAt >= this.reminderMs) {
        reminderDue.push(kind);
      }
    }

    if (recovered.length > 0) {
      if (await this.options.send(backupPullMessage('recovered', reading, recovered))) {
        for (const kind of recovered) {
          const state = this.stateOf(kind);
          state.stale = false;
          state.lastNoticeAt = null;
        }
        sent.push({ notice: 'recovered', kinds: recovered });
      }
    }

    const due = BACKUP_PULL_KINDS.filter(k => firstStale.includes(k) || reminderDue.includes(k));
    if (due.length > 0) {
      const notice: BackupPullNoticeKind = firstStale.length > 0 ? 'stale' : 'reminder';
      if (await this.options.send(backupPullMessage(notice, reading, due))) {
        for (const kind of due) {
          const state = this.stateOf(kind);
          state.stale = true;
          state.lastNoticeAt = now;
        }
        sent.push({ notice, kinds: due });
      }
    }
    return sent;
  }
}
