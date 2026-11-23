// @ts-check
/**
 * The merge runner's single-instance lock (~/.foundry-ai-tool/merge-runner.lock holds the holder's
 * pid). Split from scripts/merge-runner.mjs to keep that file under the line limit; the runner
 * re-exports both functions for its tests.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pidAlive } from '../heavy-lock.mjs';

/**
 * Is `pid` a live merge runner? A logoff leaves the lock behind and Windows reuses pids at the next
 * logon, so a live pid alone is not enough: its command line must name merge-runner.mjs. When the
 * command line cannot be read, the pid counts as a runner (never two runners).
 * @param {number} pid
 */
export function isRunnerProcess(pid) {
  if (!pidAlive(pid)) return false;
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`,
      ],
      { encoding: 'utf8', timeout: 60_000, windowsHide: true }
    );
    const line = (r.stdout ?? '').trim();
    // An unreadable command line (empty answer) counts as a runner: never two runners.
    if (r.status !== 0 || !line) return true;
    return /merge-runner\.mjs/.test(line);
  }
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('merge-runner.mjs');
  } catch {
    return true;
  }
}

/**
 * Take the runner lock: `wx` create with our pid. A lock whose holder is not a live runner is taken
 * over.
 * @param {string} file @param {number} [pid] @param {(pid: number) => boolean} [isRunner]
 * @returns {{ ok: true, release: () => void } | { ok: false, holder: number }}
 */
export function takeRunnerLock(file, pid = process.pid, isRunner = isRunnerProcess) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(file, `${pid}\n`, { flag: 'wx' });
      // Two starters that read the same stale holder can both have removed it: a later starter's
      // removal may have deleted this file, so the pid read back must still be ours.
      if (fs.readFileSync(file, 'utf8').trim() !== String(pid)) return { ok: false, holder: 0 };
      return {
        ok: true,
        release: () => {
          try {
            if (fs.readFileSync(file, 'utf8').trim() === String(pid)) fs.unlinkSync(file);
          } catch {
            // already gone
          }
        },
      };
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
      const holder = Number(fs.readFileSync(file, 'utf8').trim());
      // A lock older than the last boot is stale whatever its pid is now (a killed runner leaves
      // it behind, and the pid may belong to a service whose command line cannot be read).
      const bootMs = Date.now() - os.uptime() * 1000;
      let stale = false;
      try {
        stale = fs.statSync(file).mtimeMs < bootMs - 60_000;
      } catch {
        // the lock vanished between read and stat; the forced rm below is harmless
      }
      if (!stale && Number.isInteger(holder) && holder > 0 && holder !== pid && isRunner(holder)) {
        return { ok: false, holder };
      }
      fs.rmSync(file, { force: true });
    }
  }
  return { ok: false, holder: 0 };
}
