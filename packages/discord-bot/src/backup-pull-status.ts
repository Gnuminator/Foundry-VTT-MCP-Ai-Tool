/**
 * The Pi's record of when this PC last copied its backups (PB-06, 2026-10-06), as the bot reads it.
 *
 * After each successful run, `pull-restic.ps1` and `pull-snapshot.ps1` on the PC call the Pi's
 * `/opt/foundry-ai-tool/backup/record-pull.sh restic|snapshot` (installed by stage 6), which writes
 * `/var/lib/foundry-backup-pulls/<kind>.json` with the Pi's own clock:
 *
 *   { "version": 1, "kind": "restic", "pulledAt": "2026-10-06T10:31:02Z" }
 *
 * The folder is root-owned and outside the foundry user's tree, so the bot (it runs as foundry)
 * only reads it.
 *
 * This file only reads and checks them. Nothing recorded at all (a dev PC, a fresh Pi where no pull
 * has run yet) is a typed "unavailable" result, never an exception, so it shows nothing and never
 * crashes. Once one kind is recorded, the other kind is judged too: a record that stays missing,
 * unreadable or invalid for longer than the limit counts as stale, so a broken or absent file can
 * never hide a copy that stopped.
 *
 * It has no imports from other packages and uses only `node:fs` and `node:path`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type BackupPullKind = 'restic' | 'snapshot';

export interface BackupPull {
  kind: BackupPullKind;
  /** ISO time of the last successful copy, by the Pi's clock. */
  pulledAt: string;
}

export type BackupPullUnavailableReason = 'missing' | 'unreadable' | 'invalid';

/** Why a kind has no usable record. */
export interface BackupPullProblem {
  reason: BackupPullUnavailableReason;
  detail: string;
}

/** One kind (restic or snapshot), judged on its own against the limit. */
export interface BackupPullStatus {
  kind: BackupPullKind;
  /** ISO time of the last successful copy; null when the record is missing, unreadable or invalid. */
  pulledAt: string | null;
  /** Null when the record is usable. */
  problem: BackupPullProblem | null;
  /**
   * Milliseconds since `pulledAt` (never below 0: a clock a little ahead counts as fresh); for a
   * kind with a problem, milliseconds since the reader first saw the problem.
   */
  ageMs: number;
  /** True when `ageMs` is over the limit the reader was made with. */
  stale: boolean;
}

export type BackupPullReading =
  | { state: 'unavailable'; reason: BackupPullUnavailableReason; detail: string }
  | {
      state: 'available';
      /** Both kinds, restic first, each judged on its own. */
      pulls: BackupPullStatus[];
      /** True when any kind is over the limit. */
      stale: boolean;
      /** The limit in days the reader was made with (for the message). */
      limitDays: number;
    };

export const BACKUP_PULL_KINDS: readonly BackupPullKind[] = ['restic', 'snapshot'];
export const DEFAULT_BACKUP_STALE_DAYS = 3;
export const DEFAULT_BACKUP_PULLS_DIR = '/var/lib/foundry-backup-pulls';

const DAY_MS = 24 * 60 * 60 * 1000;

export function backupPullsDir(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env['FOUNDRY_AI_BACKUP_PULLS'];
  return fromEnv ? fromEnv : DEFAULT_BACKUP_PULLS_DIR;
}

/** Days from a setting such as FOUNDRY_AI_BACKUP_STALE_DAYS; anything that is not a positive number gives the default. */
export function parseStaleDays(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_BACKUP_STALE_DAYS;
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 && n <= 3650 ? n : DEFAULT_BACKUP_STALE_DAYS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check the text of one record file. Returns the pull, or the reason it cannot be used. A time more
 * than a day ahead of `now` is invalid (a clock a little ahead is tolerated).
 */
export function parseBackupPull(
  kind: BackupPullKind,
  fileText: string,
  now: number = Date.now()
): { ok: true; pull: BackupPull } | { ok: false; detail: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    return { ok: false, detail: `${kind}.json is not valid JSON` };
  }
  if (!isRecord(raw)) return { ok: false, detail: `${kind}.json is not a JSON object` };
  if (raw['version'] !== 1) return { ok: false, detail: `${kind}.json has an unknown version` };
  if (raw['kind'] !== kind) return { ok: false, detail: `${kind}.json has the wrong kind` };
  const pulledAt = raw['pulledAt'];
  if (typeof pulledAt !== 'string' || Number.isNaN(Date.parse(pulledAt))) {
    return { ok: false, detail: `${kind}.json: pulledAt is missing or not a date` };
  }
  if (Date.parse(pulledAt) > now + DAY_MS) {
    return { ok: false, detail: `${kind}.json: pulledAt is more than a day in the future` };
  }
  return { ok: true, pull: { kind, pulledAt } };
}

export interface BackupPullReaderOptions {
  /** Default: env FOUNDRY_AI_BACKUP_PULLS, else the Pi's folder. */
  dir?: string;
  /** Older than this many days is stale. Default: env FOUNDRY_AI_BACKUP_STALE_DAYS, else 3. */
  staleDays?: number;
  /** Test clock (ms since the epoch). */
  now?: () => number;
  /** Called with a plain sentence the first time each problem shows up (and again after a recovery). */
  log?: (message: string) => void;
  /** Test hook for the file read. */
  readFile?: (path: string) => string;
}

/**
 * Make a reader for the record files. Each call reads them again.
 *
 * - Nothing recorded and nothing broken (every file missing): "unavailable", so no notice (a fresh
 *   install or a dev machine). Logged once.
 * - Otherwise the result is "available" with both kinds, each judged on its own. A recorded kind is
 *   stale when its copy is older than the limit. A kind with no usable record (missing while the
 *   other kind is recorded, unreadable or invalid) starts a clock when the reader first sees the
 *   problem and is stale once that has lasted longer than the limit; the clock lives in memory, so a
 *   restart starts it again. A kind that is missing while nothing else is recorded stays silent.
 * - Each problem is logged once per kind until that kind is usable again.
 */
export function createBackupPullReader(
  options: BackupPullReaderOptions = {}
): () => BackupPullReading {
  const dir = options.dir ?? backupPullsDir();
  const limitDays =
    options.staleDays ?? parseStaleDays(process.env['FOUNDRY_AI_BACKUP_STALE_DAYS']);
  const staleMs = limitDays * DAY_MS;
  const now = options.now ?? Date.now;
  const read = options.readFile ?? ((p: string): string => readFileSync(p, 'utf8'));
  let lastProblem: string | null = null;
  const problemSince = new Map<BackupPullKind, number>();
  const loggedProblem = new Map<BackupPullKind, string>();

  const unavailable = (reason: BackupPullUnavailableReason, detail: string): BackupPullReading => {
    const key = `${reason}:${detail}`;
    if (key !== lastProblem) {
      lastProblem = key;
      options.log?.(`Backup copies: ${reason} (${detail}) in ${dir}`);
    }
    return { state: 'unavailable', reason, detail };
  };

  return () => {
    const t = now();
    const recorded = new Map<BackupPullKind, BackupPull>();
    const problems = new Map<BackupPullKind, BackupPullProblem>();
    for (const kind of BACKUP_PULL_KINDS) {
      let fileText: string;
      try {
        fileText = read(join(dir, `${kind}.json`));
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          problems.set(kind, { reason: 'missing', detail: 'no copy has been recorded yet' });
        } else {
          problems.set(kind, { reason: 'unreadable', detail: code ?? 'read failed' });
        }
        continue;
      }
      const parsed = parseBackupPull(kind, fileText, t);
      if (parsed.ok) recorded.set(kind, parsed.pull);
      else problems.set(kind, { reason: 'invalid', detail: parsed.detail });
    }

    const anyBroken = [...problems.values()].some(p => p.reason !== 'missing');
    if (recorded.size === 0 && !anyBroken) {
      problemSince.clear();
      loggedProblem.clear();
      return unavailable('missing', 'no copy has been recorded yet');
    }
    lastProblem = null;

    const pulls: BackupPullStatus[] = BACKUP_PULL_KINDS.map(kind => {
      const pull = recorded.get(kind);
      if (pull) {
        problemSince.delete(kind);
        loggedProblem.delete(kind);
        const ageMs = Math.max(0, t - Date.parse(pull.pulledAt));
        return { kind, pulledAt: pull.pulledAt, problem: null, ageMs, stale: ageMs > staleMs };
      }
      const problem: BackupPullProblem = problems.get(kind) ?? {
        reason: 'missing',
        detail: 'not read',
      };
      if (problem.reason === 'missing' && recorded.size === 0) {
        // Never recorded and nothing else is recorded either: nothing to judge, so say nothing.
        problemSince.delete(kind);
        loggedProblem.delete(kind);
        return { kind, pulledAt: null, problem, ageMs: 0, stale: false };
      }
      const since = problemSince.get(kind) ?? t;
      problemSince.set(kind, since);
      const key = `${problem.reason}:${problem.detail}`;
      if (loggedProblem.get(kind) !== key) {
        loggedProblem.set(kind, key);
        options.log?.(`Backup copies: ${kind} ${problem.reason} (${problem.detail}) in ${dir}`);
      }
      const ageMs = Math.max(0, t - since);
      return { kind, pulledAt: null, problem, ageMs, stale: ageMs > staleMs };
    });
    return { state: 'available', pulls, stale: pulls.some(p => p.stale), limitDays };
  };
}
