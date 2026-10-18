/**
 * Recordings left raw by a crash: a `raw/` folder with `.rec` tracks but no `convert-report.json`.
 * On startup the bot converts these (the same converter `/record stop` uses) and tells the owner.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
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
  /** The folder of a recording running right now. */
  skipDir?: string;
}

/** Session folders under `sessionsDir` that have raw tracks and were never converted. */
export function findOrphans(sessionsDir: string, opts: RecoverOptions = {}): string[] {
  const now = opts.now ?? Date.now();
  const minAge = opts.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  if (!existsSync(sessionsDir)) return [];
  const found: string[] = [];
  for (const name of readdirSync(sessionsDir).sort()) {
    const dir = join(sessionsDir, name);
    if (opts.skipDir && dir === opts.skipDir) continue;
    const raw = join(dir, 'raw');
    try {
      if (!statSync(dir).isDirectory() || !existsSync(raw)) continue;
      if (existsSync(join(raw, 'convert-report.json'))) continue;
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

/** Convert every orphan; one failing folder does not stop the others. */
export function recoverOrphans(
  sessionsDir: string,
  opts: RecoverOptions = {},
  convert: typeof convertSession = convertSession
): RecoverOutcome[] {
  return findOrphans(sessionsDir, opts).map(dir => {
    try {
      const result = convert(dir);
      return { dir, ok: true, tracks: result.tracks.length };
    } catch (err) {
      return { dir, ok: false, tracks: 0, error: (err as Error).message };
    }
  });
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
