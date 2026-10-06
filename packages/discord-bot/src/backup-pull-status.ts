/**
 * The Pi's record of when this PC last copied its backups (PB-06, 2026-10-06), as the bot reads it.
 *
 * After each successful run, `pull-restic.ps1` and `pull-snapshot.ps1` on the PC call the Pi's
 * `/opt/foundry-ai-tool/backup/record-pull.sh restic|snapshot` (installed by stage 6), which writes
 * `/var/lib/foundry-ai-tool/backup-pulls/<kind>.json` with the Pi's own clock:
 *
 *   { "version": 1, "kind": "restic", "pulledAt": "2026-10-06T10:31:02Z" }
 *
 * This file only reads and checks them. A missing, unreadable or invalid folder is a typed
 * "unavailable" result, never an exception, so a machine without the files (a dev PC, a fresh Pi
 * where no pull has run yet) shows nothing and never crashes.
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

export type BackupPullReading =
  | { state: 'unavailable'; reason: BackupPullUnavailableReason; detail: string }
  | {
      state: 'available';
      /** The kinds that have been recorded (one or two), newest first. */
      pulls: BackupPull[];
      /** The newest successful copy of either kind. */
      newestAt: string;
      /** Milliseconds since `newestAt`, never below 0 (a clock a little ahead counts as fresh). */
      ageMs: number;
      /** True when `ageMs` is over the limit the reader was made with. */
      stale: boolean;
      /** The limit in days the reader was made with (for the message). */
      limitDays: number;
    };

export const BACKUP_PULL_KINDS: readonly BackupPullKind[] = ['restic', 'snapshot'];
export const DEFAULT_BACKUP_STALE_DAYS = 3;
export const DEFAULT_BACKUP_PULLS_DIR = '/var/lib/foundry-ai-tool/backup-pulls';

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

/** Check the text of one record file. Returns the pull, or the reason it cannot be used. */
export function parseBackupPull(
  kind: BackupPullKind,
  fileText: string
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
 * Make a reader for the record files. Each call reads them again. If neither kind has been
 * recorded the result is "unavailable" (nothing to judge yet, so no notice); a kind that was never
 * recorded is simply left out while the other one counts. When no file is usable, a broken file
 * wins over a missing one, so the log names the real problem. Problems are logged once until the
 * files are usable again.
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

  const unavailable = (reason: BackupPullUnavailableReason, detail: string): BackupPullReading => {
    const key = `${reason}:${detail}`;
    if (key !== lastProblem) {
      lastProblem = key;
      options.log?.(`Backup copies: ${reason} (${detail}) in ${dir}`);
    }
    return { state: 'unavailable', reason, detail };
  };

  return () => {
    const pulls: BackupPull[] = [];
    let invalid: string | null = null;
    let unreadable: string | null = null;
    for (const kind of BACKUP_PULL_KINDS) {
      let fileText: string;
      try {
        fileText = read(join(dir, `${kind}.json`));
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') unreadable = code ?? 'read failed';
        continue;
      }
      const parsed = parseBackupPull(kind, fileText);
      if (parsed.ok) pulls.push(parsed.pull);
      else invalid = parsed.detail;
    }
    if (pulls.length === 0) {
      if (invalid !== null) return unavailable('invalid', invalid);
      if (unreadable !== null) return unavailable('unreadable', unreadable);
      return unavailable('missing', 'no copy has been recorded yet');
    }
    lastProblem = null;
    pulls.sort((a, b) => Date.parse(b.pulledAt) - Date.parse(a.pulledAt));
    const newest = pulls[0];
    const ageMs = Math.max(0, now() - Date.parse(newest.pulledAt));
    return {
      state: 'available',
      pulls,
      newestAt: newest.pulledAt,
      ageMs,
      stale: ageMs > staleMs,
      limitDays,
    };
  };
}
