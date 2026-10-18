/**
 * Recordings left raw by a crash: a `raw/` folder with `.rec` tracks but no `convert-report.json`.
 * On startup the bot converts these (the same converter `/record stop` uses) and tells the owner.
 */

import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertSession } from '../convert/convert.js';

/** A folder touched more recently than this may still belong to a recording in progress. */
export const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;

export interface RecoverOutcome {
  dir: string;
  ok: boolean;
  tracks: number;
  error?: string;
}

export interface RecoverOptions {
  now?: number;
  minAgeMs?: number;
  /** True for the folder of a recording running right now (asked again before each folder). */
  isActive?: (dir: string) => boolean;
}

/** Written into `raw/` when conversion failed, so a restart does not retry (and DM) forever. */
export const FAILED_MARKER = 'convert-failed.json';

/** Session folders under `sessionsDir` that have raw tracks and were never converted. */
export function findOrphans(sessionsDir: string, opts: RecoverOptions = {}): string[] {
  const now = opts.now ?? Date.now();
  const minAge = opts.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  if (!existsSync(sessionsDir)) return [];
  const found: string[] = [];
  for (const name of readdirSync(sessionsDir).sort()) {
    const dir = join(sessionsDir, name);
    if (opts.isActive?.(dir)) continue;
    const raw = join(dir, 'raw');
    try {
      if (!statSync(dir).isDirectory() || !existsSync(raw)) continue;
      if (existsSync(join(raw, 'convert-report.json'))) continue;
      if (existsSync(join(raw, FAILED_MARKER))) continue; // already tried and reported
      const files = readdirSync(raw);
      if (!files.some(f => f.endsWith('.rec'))) continue;
      const newest = Math.max(...files.map(f => statSync(join(raw, f)).mtimeMs));
      if (now - newest < minAge) continue;
      found.push(dir);
    } catch {
      // unreadable folder: leave it alone
    }
  }
  return found;
}

/**
 * Convert every orphan; one failing folder does not stop the others. The converter is
 * synchronous, so the loop yields to the event loop between folders (gateway heartbeats, a
 * `/record start`), and a folder that became the active recording meanwhile is left alone.
 */
export async function recoverOrphans(
  sessionsDir: string,
  opts: RecoverOptions = {},
  convert: typeof convertSession = convertSession
): Promise<RecoverOutcome[]> {
  const outcomes: RecoverOutcome[] = [];
  for (const dir of findOrphans(sessionsDir, opts)) {
    await new Promise<void>(resolve => setImmediate(resolve));
    if (opts.isActive?.(dir)) continue;
    try {
      const result = convert(dir);
      outcomes.push({ dir, ok: true, tracks: result.tracks.length });
    } catch (err) {
      const error = (err as Error).message;
      try {
        writeFileSync(
          join(dir, 'raw', FAILED_MARKER),
          `${JSON.stringify({ at: new Date().toISOString(), error })}\n`
        );
      } catch {
        // the report goes out anyway; a restart may try (and report) again
      }
      outcomes.push({ dir, ok: false, tracks: 0, error });
    }
  }
  return outcomes;
}

/** One message for the owner, or undefined when nothing was found. */
export function recoverMessage(outcomes: RecoverOutcome[]): string | undefined {
  if (outcomes.length === 0) return undefined;
  const lines = outcomes.map(o =>
    o.ok
      ? `${o.dir}: converted ${o.tracks} track(s)`
      : `${o.dir}: could not convert (${o.error ?? 'unknown error'}), raw files kept`
  );
  return `The recorder found ${outcomes.length} recording(s) from a stopped or crashed run and handled them on startup:\n${lines.join('\n')}`;
}
