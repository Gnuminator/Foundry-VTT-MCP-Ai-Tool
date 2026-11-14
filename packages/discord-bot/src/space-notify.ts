/**
 * Storage space notices (2026-10-06): the bot reads the Pi's space status file every 15 minutes and
 * sends the owner a Discord DM when space gets low or critical, or when the check goes stale.
 *
 * Rules, kept in `SpaceNotifier` (no Discord in it, so tests run it with a fake `send`):
 * - one DM when the state gets worse (ok to low, low to critical, anything to stale from ok, ...);
 * - while the state stays bad, at most one reminder every 24 hours;
 * - one "back to normal" DM when it recovers, with a margin so a disk hovering around the line does
 *   not flip-flop: after a low state it is "back to normal" only when every disk is at least
 *   RECOVER_MARGIN_POINTS above the threshold (from the file); critical is left only above the
 *   critical line plus CRITICAL_MARGIN_POINTS. In between, the state is held with no new DM
 *   (the 24 hour reminder still applies);
 * - a missing, unreadable or invalid status file says nothing and changes nothing;
 * - if a DM cannot be sent, nothing is recorded, so the next check tries again.
 * The state lives in memory: a bot restart can repeat one DM.
 */

import { bi } from './i18n.js';
import type { SpaceDisk, SpaceReading, SpaceStatus } from './space-status.js';

export const SPACE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const SPACE_REMINDER_MS = 24 * 60 * 60 * 1000;
/** Points above the low threshold every disk needs before "back to normal". */
export const RECOVER_MARGIN_POINTS = 2;
/** Points above the critical line every disk needs before critical is left. */
export const CRITICAL_MARGIN_POINTS = 1;

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

type Lang = 'da' | 'en';

function diskLine(disk: SpaceDisk, lang: Lang): string {
  if (lang === 'da') {
    const jobs = disk.jobs.length > 0 ? ` Bruges af: ${disk.jobs.join(', ')}.` : '';
    return `${disk.mount} har ${pct(disk.freePercent)} fri (${gb(disk.freeBytes)}).${jobs}`;
  }
  const jobs = disk.jobs.length > 0 ? ` Used by: ${disk.jobs.join(', ')}.` : '';
  return `${disk.mount} has ${pct(disk.freePercent)} free (${gb(disk.freeBytes)}).${jobs}`;
}

function hoursSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 3_600_000));
}

function buildSpaceMessage(
  lang: Lang,
  kind: SpaceNoticeKind,
  state: SpaceState,
  status: SpaceStatus,
  now: number
): string {
  const da = lang === 'da';
  if (kind === 'recovered') {
    const lowest = [...status.disks].sort((a, b) => a.freePercent - b.freePercent)[0];
    const where = lowest
      ? da
        ? ` Den mest pressede disk, ${lowest.mount}, har ${pct(lowest.freePercent)} fri.`
        : ` The tightest disk, ${lowest.mount}, has ${pct(lowest.freePercent)} free.`
      : '';
    return da
      ? `Lagerpladsen på ${status.host} er tilbage til normalt.${where}`
      : `Storage space on ${status.host} is back to normal.${where}`;
  }
  const again = kind === 'reminder' ? (da ? ' (påmindelse)' : ' (reminder)') : '';
  if (state === 'stale') {
    const hours = hoursSince(status.checkedAt, now);
    return da
      ? `Tjekket af lagerpladsen på ${status.host} har ikke kørt i ${hours} timer` +
          `${again}. Det seneste tjek var ${status.checkedAt}. Bed Claude kigge på Pi'ens space-check timer.`
      : `The storage space check on ${status.host} has not run for ${hours} hours` +
          `${again}. The last check was at ${status.checkedAt}. Ask Claude to look at the Pi's space-check timer.`;
  }
  const bad = status.disks.filter(d => d.level !== 'ok');
  const lines = (bad.length > 0 ? bad : status.disks).map(d => diskLine(d, lang)).join('\n');
  if (state === 'critical') {
    return da
      ? `Lagerpladsen er KRITISK på ${status.host}${again}.\n${lines}\n` +
          'En backup, snapshot eller sync, der skal bruge mere plads end der er ledig, stopper. Frigør plads nu.'
      : `Storage space is CRITICAL on ${status.host}${again}.\n${lines}\n` +
          'A backup, snapshot or sync that needs more space than is free will stop. Free some space now.';
  }
  return da
    ? `Lagerpladsen er lav på ${status.host}${again} (under ${status.thresholdPercent}% fri).\n${lines}\n` +
        'Backups kører stadig, men frigør plads snart.'
    : `Storage space is low on ${status.host}${again} (under ${status.thresholdPercent}% free).\n${lines}\n` +
        'Backups still run, but free some space soon.';
}

/** The DM text, Danish then English; names the disk, the free space and the jobs it affects. */
export function spaceMessage(
  kind: SpaceNoticeKind,
  state: SpaceState,
  status: SpaceStatus,
  now: number
): string {
  return bi(
    buildSpaceMessage('da', kind, state, status, now),
    buildSpaceMessage('en', kind, state, status, now)
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

  /** Hold a low or critical state until the disks are clearly past the line (see the top). */
  private withHysteresis(next: SpaceState, status: SpaceStatus): SpaceState {
    if (next !== 'ok' && next !== 'low') return next;
    if (this.state !== 'low' && this.state !== 'critical') return next;
    if (status.disks.length === 0) return next;
    const minFree = Math.min(...status.disks.map(d => d.freePercent));
    if (this.state === 'critical' && minFree < status.criticalPercent + CRITICAL_MARGIN_POINTS) {
      return 'critical';
    }
    if (next === 'ok' && minFree < status.thresholdPercent + RECOVER_MARGIN_POINTS) return 'low';
    return next;
  }

  /** Look at one reading and send a DM when the rules say so. Returns what it sent, if anything. */
  async check(reading: SpaceReading): Promise<SpaceNoticeKind | null> {
    const raw = spaceStateOf(reading);
    if (raw === null || reading.state !== 'available') return null;
    const now = this.now();
    const status = reading.status;
    const next = this.withHysteresis(raw, status);

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

/** One member of a Discord team (discord.js TeamMember: `user`, and `id` as the user's id). */
export interface TeamMemberLike {
  id?: string;
  user?: { id?: string } | null;
}

/**
 * A Discord application's owner: a User (just `id`), or a Team. A Team's own `id` is a team id that
 * cannot be DMed, so only its owner user (`ownerId`, `owner`) or a member's user id is used.
 */
export interface ApplicationOwnerLike {
  id?: string;
  ownerId?: string | null;
  owner?: TeamMemberLike | null;
  members?: Iterable<TeamMemberLike> | { values(): Iterable<TeamMemberLike> } | null;
}

function isTeam(owner: ApplicationOwnerLike): boolean {
  return 'ownerId' in owner || 'owner' in owner || 'members' in owner;
}

function memberUserId(member: TeamMemberLike | null | undefined): string | null {
  return member?.user?.id ?? member?.id ?? null;
}

/**
 * The id to DM: the configured one, else the bot application's owner (for a team, the team's owner
 * user, else its first member). Null when no user id can be found.
 */
export function resolveOwnerId(
  configured: string | undefined,
  owner: ApplicationOwnerLike | null | undefined
): string | null {
  if (configured) return configured;
  if (!owner) return null;
  if (!isTeam(owner)) return owner.id ?? null;
  if (owner.ownerId) return owner.ownerId;
  const fromOwner = memberUserId(owner.owner);
  if (fromOwner) return fromOwner;
  const members = owner.members;
  if (members) {
    const list = 'values' in members ? members.values() : members;
    for (const member of list) {
      const id = memberUserId(member);
      if (id) return id;
    }
  }
  return null;
}

/** Lets an event be logged at most once per interval (a failed DM: once per 24 hours, not ever). */
export class LogThrottle {
  private lastAt: number | null = null;

  constructor(
    private readonly intervalMs: number = SPACE_REMINDER_MS,
    private readonly now: () => number = Date.now
  ) {}

  /** True when the caller should log now (and records it). */
  shouldLog(): boolean {
    const now = this.now();
    if (this.lastAt !== null && now - this.lastAt < this.intervalMs) return false;
    this.lastAt = now;
    return true;
  }

  reset(): void {
    this.lastAt = null;
  }
}
