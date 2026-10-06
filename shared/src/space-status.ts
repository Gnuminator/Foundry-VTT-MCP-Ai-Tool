/**
 * The storage space check's status file (2026-10-06), as the bot and the dashboard read it.
 *
 * The Pi writes `/var/lib/foundry-ai-tool/space/status.json` (version 1: scripts/pi); this file only
 * reads and checks it. A missing, unreadable or invalid file is a typed "unavailable" result, never
 * an exception, so a PC without the file (a dev machine) shows nothing and never crashes.
 *
 * The recorder bot is deployed alone on the Pi, without the shared package, so it keeps an
 * identical copy of this file at packages/discord-bot/src/space-status.ts. After an edit here,
 * copy the file over; a test in the bot fails while the two differ.
 *
 * It has no imports from other packages and uses only `node:fs`: do not import it from the
 * Foundry module (the module runs in the browser).
 */

import { readFileSync } from 'node:fs';

export type SpaceLevel = 'ok' | 'low' | 'critical';

export interface SpaceDisk {
  mount: string;
  paths: string[];
  jobs: string[];
  totalBytes: number;
  freeBytes: number;
  freePercent: number;
  level: SpaceLevel;
}

export interface SpaceLastJob {
  name: string;
  at: string;
  level: SpaceLevel;
  ran: boolean;
}

export interface SpaceStatus {
  version: 1;
  checkedAt: string;
  host: string;
  thresholdPercent: number;
  criticalPercent: number;
  /** The worst disk's level (never lower than the worst entry in `disks`). */
  level: SpaceLevel;
  disks: SpaceDisk[];
  lastJob?: SpaceLastJob;
}

export type SpaceUnavailableReason = 'missing' | 'unreadable' | 'invalid';

export type SpaceReading =
  | { state: 'unavailable'; reason: SpaceUnavailableReason; detail: string }
  | { state: 'available'; status: SpaceStatus; stale: boolean; ageMs: number };

/** A check older than this is stale (the Pi checks every hour). */
export const SPACE_STALE_MS = 3 * 60 * 60 * 1000;
export const DEFAULT_SPACE_STATUS_PATH = '/var/lib/foundry-ai-tool/space/status.json';

const LEVEL_RANK: Record<SpaceLevel, number> = { ok: 0, low: 1, critical: 2 };
const MAX_DISKS = 32;
const MAX_LIST = 32;
const MAX_TEXT = 200;

export function spaceStatusPath(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env['FOUNDRY_AI_SPACE_STATUS'];
  return fromEnv ? fromEnv : DEFAULT_SPACE_STATUS_PATH;
}

export function worseSpaceLevel(a: SpaceLevel, b: SpaceLevel): SpaceLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export function spaceLevelRank(level: SpaceLevel): number {
  return LEVEL_RANK[level];
}

function isLevel(value: unknown): value is SpaceLevel {
  return value === 'ok' || value === 'low' || value === 'critical';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_TEXT) : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value.slice(0, MAX_LIST)) {
    const t = text(item);
    if (t === null) return null;
    out.push(t);
  }
  return out;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseDisk(raw: unknown): SpaceDisk | null {
  if (!isRecord(raw)) return null;
  const mount = text(raw['mount']);
  const paths = stringList(raw['paths']);
  const jobs = stringList(raw['jobs']);
  const totalBytes = finiteNumber(raw['totalBytes']);
  const freeBytes = finiteNumber(raw['freeBytes']);
  const freePercent = finiteNumber(raw['freePercent']);
  const level = raw['level'];
  if (mount === null || paths === null || jobs === null) return null;
  if (totalBytes === null || freeBytes === null || freePercent === null) return null;
  if (!isLevel(level)) return null;
  return { mount, paths, jobs, totalBytes, freeBytes, freePercent, level };
}

/** Check the text of a status file. Returns the status, or the reason it cannot be used. */
export function parseSpaceStatus(
  fileText: string
): { ok: true; status: SpaceStatus } | { ok: false; detail: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    return { ok: false, detail: 'not valid JSON' };
  }
  if (!isRecord(raw)) return { ok: false, detail: 'not a JSON object' };
  if (raw['version'] !== 1) return { ok: false, detail: 'unknown version' };
  const checkedAt = text(raw['checkedAt']);
  if (checkedAt === null || Number.isNaN(Date.parse(checkedAt))) {
    return { ok: false, detail: 'checkedAt is missing or not a date' };
  }
  const level = raw['level'];
  if (!isLevel(level)) return { ok: false, detail: 'level is missing or unknown' };
  if (!Array.isArray(raw['disks'])) return { ok: false, detail: 'disks is not a list' };
  const disks: SpaceDisk[] = [];
  for (const entry of raw['disks'].slice(0, MAX_DISKS)) {
    const disk = parseDisk(entry);
    if (!disk) return { ok: false, detail: 'a disk entry is incomplete' };
    disks.push(disk);
  }
  let overall: SpaceLevel = level;
  for (const disk of disks) overall = worseSpaceLevel(overall, disk.level);
  const status: SpaceStatus = {
    version: 1,
    checkedAt,
    host: text(raw['host']) ?? 'unknown',
    thresholdPercent: finiteNumber(raw['thresholdPercent']) ?? 20,
    criticalPercent: finiteNumber(raw['criticalPercent']) ?? 5,
    level: overall,
    disks,
  };
  const job = raw['lastJob'];
  if (isRecord(job)) {
    const name = text(job['name']);
    const at = text(job['at']);
    const jobLevel = job['level'];
    if (name !== null && at !== null && isLevel(jobLevel)) {
      status.lastJob = { name, at, level: jobLevel, ran: job['ran'] !== false };
    }
  }
  return { ok: true, status };
}

export interface SpaceReaderOptions {
  /** Default: env FOUNDRY_AI_SPACE_STATUS, else the Pi's path. */
  path?: string;
  /** Test clock (ms since the epoch). */
  now?: () => number;
  /** Called with a plain sentence the first time each problem shows up (and again after a recovery). */
  log?: (message: string) => void;
  /** Test hook for the file read. */
  readFile?: (path: string) => string;
}

/**
 * Make a reader for the status file. Each call reads the file again. A missing, unreadable or
 * invalid file gives an "unavailable" result and is logged once until the file is usable again.
 */
export function createSpaceStatusReader(options: SpaceReaderOptions = {}): () => SpaceReading {
  const path = options.path ?? spaceStatusPath();
  const now = options.now ?? Date.now;
  const read = options.readFile ?? ((p: string): string => readFileSync(p, 'utf8'));
  let lastProblem: string | null = null;

  const unavailable = (reason: SpaceUnavailableReason, detail: string): SpaceReading => {
    const key = `${reason}:${detail}`;
    if (key !== lastProblem) {
      lastProblem = key;
      options.log?.(`Space check: ${reason} (${detail}) at ${path}`);
    }
    return { state: 'unavailable', reason, detail };
  };

  return () => {
    let fileText: string;
    try {
      fileText = read(path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      return code === 'ENOENT' || code === 'ENOTDIR'
        ? unavailable('missing', 'no status file')
        : unavailable('unreadable', code ?? 'read failed');
    }
    const parsed = parseSpaceStatus(fileText);
    if (!parsed.ok) return unavailable('invalid', parsed.detail);
    lastProblem = null;
    const ageMs = now() - Date.parse(parsed.status.checkedAt);
    return { state: 'available', status: parsed.status, stale: ageMs > SPACE_STALE_MS, ageMs };
  };
}
