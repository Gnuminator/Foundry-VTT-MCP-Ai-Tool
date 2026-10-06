/**
 * Stale backup copy notices (PB-06, 2026-10-06): the bot reads the Pi's record of when this PC last
 * copied its backups (backup-pull-status.ts) every 15 minutes and sends the owner a Discord DM
 * when the newest successful copy of either kind is older than the limit (3 days by default).
 *
 * Rules, kept in `BackupPullNotifier` (no Discord in it, so tests run it with a fake `send`):
 * - one DM when the copies go stale;
 * - while they stay stale, at most one reminder every 24 hours;
 * - one "copied again" DM when a fresh copy arrives (only if a stale DM was sent);
 * - an unavailable reading (no copy ever recorded, unreadable or invalid file) says nothing and
 *   changes nothing, so a fresh install or a dev machine never raises a false alarm;
 * - if a DM cannot be sent, nothing is recorded, so the next check tries again.
 * The state lives in memory: a bot restart can repeat one DM.
 */

import type { BackupPull, BackupPullReading } from './backup-pull-status.js';

export const BACKUP_PULL_REMINDER_MS = 24 * 60 * 60 * 1000;

export type BackupPullNoticeKind = 'stale' | 'reminder' | 'recovered';

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

function kindLine(label: string, pull: BackupPull | undefined, now: number): string {
  return pull
    ? `${label}: ${agoText(Math.max(0, now - Date.parse(pull.pulledAt)))}.`
    : `${label}: not recorded yet.`;
}

type AvailableReading = Extract<BackupPullReading, { state: 'available' }>;

/** The DM text. Plain English; says how long ago each kind was copied and what to do. */
export function backupPullMessage(
  kind: BackupPullNoticeKind,
  reading: AvailableReading,
  now: number
): string {
  if (kind === 'recovered') {
    return `The PC has copied the Pi's backups again (${agoText(reading.ageMs)}). Backups are safe on both sides again.`;
  }
  const restic = reading.pulls.find(p => p.kind === 'restic');
  const snapshot = reading.pulls.find(p => p.kind === 'snapshot');
  const again = kind === 'reminder' ? ' (reminder)' : '';
  return (
    `The Pi's backups have not been copied to your PC for ${spanText(reading.ageMs)}${again} (the limit is ${reading.limitDays} ${reading.limitDays === 1 ? 'day' : 'days'}).\n` +
    `${kindLine('Last restic copy', restic, now)}\n${kindLine('Last snapshot copy', snapshot, now)}\n` +
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

export class BackupPullNotifier {
  private stale = false;
  private lastNoticeAt: number | null = null;
  private readonly now: () => number;
  private readonly reminderMs: number;

  constructor(private readonly options: BackupPullNotifierOptions) {
    this.now = options.now ?? Date.now;
    this.reminderMs = options.reminderMs ?? BACKUP_PULL_REMINDER_MS;
  }

  /** Look at one reading and send a DM when the rules say so. Returns what it sent, if anything. */
  async check(reading: BackupPullReading): Promise<BackupPullNoticeKind | null> {
    if (reading.state !== 'available') return null;
    const now = this.now();

    if (!reading.stale) {
      if (!this.stale) return null;
      // Nothing was ever sent for the stale state: recover silently.
      if (this.lastNoticeAt === null) {
        this.stale = false;
        return null;
      }
      if (!(await this.options.send(backupPullMessage('recovered', reading, now)))) return null;
      this.stale = false;
      this.lastNoticeAt = null;
      return 'recovered';
    }

    const first = !this.stale || this.lastNoticeAt === null;
    const reminderDue = this.lastNoticeAt !== null && now - this.lastNoticeAt >= this.reminderMs;
    if (!first && !reminderDue) return null;
    const kind: BackupPullNoticeKind = first ? 'stale' : 'reminder';
    if (!(await this.options.send(backupPullMessage(kind, reading, now)))) return null;
    this.stale = true;
    this.lastNoticeAt = now;
    return kind;
  }
}
