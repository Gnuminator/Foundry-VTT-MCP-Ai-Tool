/**
 * A marker file that exists while the bot runs (item recorder-heartbeat). A clean shutdown removes
 * it; one still there at the next start means the last run ended without shutting down (a crash, a
 * power cut, a forced close), and the bot says so in #gm-bot instead of coming back silently.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function markerPath(sessionsDir: string): string {
  return join(sessionsDir, '.bot-running');
}

/**
 * Write the marker for this run. Returns the start time (ISO) that the previous run wrote and never
 * removed, or null after a clean stop or on the first run.
 */
export function claimRunMarker(path: string, now: Date = new Date()): string | null {
  let previous: string | null = null;
  try {
    if (existsSync(path)) previous = readFileSync(path, 'utf8').trim() || 'an unknown time';
  } catch {
    // an unreadable marker counts as "there was one"
    previous = 'an unknown time';
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${now.toISOString()}\n`);
  } catch {
    // no marker is not worth stopping the bot for
  }
  return previous;
}

export function clearRunMarker(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // nothing to do
  }
}

/** The #gm-bot line for a start that found the previous run's marker. */
export function restartAfterCrashMessage(previousStart: string): string {
  return `Recorder bot restarted after an unclean stop (the previous run started ${previousStart} and never shut down cleanly). If a recording was running, it was not resumed: check the session folder and start /record again.`;
}
