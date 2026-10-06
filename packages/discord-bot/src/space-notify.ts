/**
 * Storage space notices (2026-10-06): the bot reads the Pi's space status file every 15 minutes and
 * sends the owner a Discord DM when space gets low or critical, or when the check goes stale.
 *
 * Rules, kept in `SpaceNotifier` (no Discord in it, so tests run it with a fake `send`):
 * - one DM when the state gets worse (ok to low, low to critical, anything to stale from ok, ...);
 * - while the state stays bad, at most one reminder every 24 hours;
 * - one "back to normal" DM when it recovers;
 * - a missing, unreadable or invalid status file says nothing and changes nothing;
 * - if a DM cannot be sent, nothing is recorded, so the next check tries again.
 * The state lives in memory: a bot restart can repeat one DM.
 */

import type { SpaceDisk, SpaceReading, SpaceStatus } from './space-status.js';

export const SPACE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const SPACE_REMINDER_MS = 24 * 60 * 60 * 1000;

/** What the notifier tracks: the worse of the check's age and its level. */
export type SpaceState = 'ok' | 'stale' | 'low' | 'critical';

const RANK: Record<SpaceState, number> = { ok: 0, stale: 1, low: 2, critical: 3 };

export type SpaceNoticeKind = 'worse' | 'reminder' | 'recovered';

export function spaceStateOf(reading: SpaceReading): SpaceState | null {
  if (reading.state !== 'available') return null;
  if (reading.stale) return 'stale';
  return reading.status.level;
}

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function pct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function diskLine(disk: SpaceDisk): string {
  const jobs = disk.jobs.length > 0 ? ` Used by: ${disk.jobs.join(', ')}.` : '';
  return `${disk.mount} has ${pct(disk.freePercent)} free (${gb(disk.freeBytes)}).${jobs}`;
}

function hoursSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 3_600_000));
}

/** The DM text. Plain English; names the disk, the free space and the jobs it affects. */
export function spaceMessage(
  kind: SpaceNoticeKind,
  state: SpaceState,
  status: SpaceStatus,
  now: number
): string {
  if (kind === 'recovered') {
    const lowest = [...status.disks].sort((a, b) => a.freePercent - b.freePercent)[0];
    const where = lowest
      ? ` The tightest disk, ${lowest.mount}, has ${pct(lowest.freePercent)} free.`
      : '';
    return `Storage space on ${status.host} is back to normal.${where}`;
  }
  const again = kind === 'reminder' ? ' (reminder)' : '';
  if (state === 'stale') {
    return (
      `The storage space check on ${status.host} has not run for ${hoursSince(status.checkedAt, now)} hours` +
      `${again}. The last check was at ${status.checkedAt}. Ask Claude to look at the Pi's space-check timer.`
    );
  }
  const bad = status.disks.filter(d => d.level !== 'ok');
  const lines = (bad.length > 0 ? bad : status.disks).map(diskLine).join('\n');
  if (state === 'critical') {
    return (
      `Storage space is CRITICAL on ${status.host}${again}.\n${lines}\n` +
      'A backup, snapshot or sync that needs more space than is free will stop. Free some space now.'
    );
  }
  return (
    `Storage space is low on ${status.host}${again} (under ${status.thresholdPercent}% free).\n${lines}\n` +
    'Backups still run, but free some space soon.'
  );
}

export interface SpaceNotifierOptions {
  /** Send one DM; resolves true when it was delivered. */
  send: (text: string) => Promise<boolean>;
  now?: () => number;
  reminderMs?: number;
}

export class SpaceNotifier {
  private state: SpaceState = 'ok';
  private lastNoticeAt: number | null = null;
  private readonly now: () => number;
  private readonly reminderMs: number;

  constructor(private readonly options: SpaceNotifierOptions) {
    this.now = options.now ?? Date.now;
    this.reminderMs = options.reminderMs ?? SPACE_REMINDER_MS;
  }

  /** Look at one reading and send a DM when the rules say so. Returns what it sent, if anything. */
  async check(reading: SpaceReading): Promise<SpaceNoticeKind | null> {
    const next = spaceStateOf(reading);
    if (next === null || reading.state !== 'available') return null;
    const now = this.now();
    const status = reading.status;

    if (next === 'ok') {
      // Nothing was ever sent for the bad state: recover silently.
      if (this.state === 'ok') return null;
      if (this.lastNoticeAt === null) {
        this.state = 'ok';
        return null;
      }
      if (!(await this.options.send(spaceMessage('recovered', next, status, now)))) return null;
      this.state = 'ok';
      this.lastNoticeAt = null;
      return 'recovered';
    }

    const worse = RANK[next] > RANK[this.state];
    const reminderDue = this.lastNoticeAt !== null && now - this.lastNoticeAt >= this.reminderMs;
    if (!worse && !reminderDue) {
      // Better but still not ok: follow it quietly, so a later worsening counts again.
      this.state = next;
      return null;
    }
    const kind: SpaceNoticeKind = worse ? 'worse' : 'reminder';
    if (!(await this.options.send(spaceMessage(kind, next, status, now)))) return null;
    this.state = next;
    this.lastNoticeAt = now;
    return kind;
  }
}

/** A Discord application's owner: a user, or a team (whose owner is a user id). */
export interface ApplicationOwnerLike {
  id?: string;
  ownerId?: string | null;
}

/** The id to DM: the configured one, else the bot application's owner (or its team's owner). */
export function resolveOwnerId(
  configured: string | undefined,
  owner: ApplicationOwnerLike | null | undefined
): string | null {
  if (configured) return configured;
  if (!owner) return null;
  // A Team has `ownerId` (the member who owns it); a User has just `id`.
  return owner.ownerId ?? owner.id ?? null;
}
