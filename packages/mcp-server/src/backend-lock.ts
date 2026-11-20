import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DEFAULT_CONTROL_PORT } from '@gnuminator/shared';

import { evaluateLockFile } from './lock.js';

// Lock file is port-scoped for non-default ports so an alternate-port standalone
// instance never fights the live default-port backend's lock. The default port keeps the
// original lock name for exact backward compatibility.
export function lockFileFor(port: number): string {
  return path.join(
    os.tmpdir(),
    port === DEFAULT_CONTROL_PORT ? 'foundry-mcp-backend.lock' : `foundry-mcp-backend-${port}.lock`
  );
}

// Set by acquireLock(port) from the caller's post-dotenv control port, and reused by releaseLock().
let LOCK_FILE = lockFileFor(DEFAULT_CONTROL_PORT);

let lockFd: number | null = null;

export function acquireLock(port: number): boolean {
  LOCK_FILE = lockFileFor(port);
  try {
    try {
      lockFd = fs.openSync(LOCK_FILE, 'wx');
    } catch (err: unknown) {
      if ((err as { code?: unknown } | null | undefined)?.code === 'EEXIST') {
        try {
          const lockData = fs.readFileSync(LOCK_FILE, 'utf8');

          const lockPid = parseInt(lockData.trim(), 10);

          try {
            process.kill(lockPid, 0);

            // A process with this PID is alive. Validate it is actually our
            // backend (node.exe / node) and that the lock file is not stale.
            // PID reuse by unrelated OS processes (e.g. GameInputRedistService
            // on Windows) would otherwise cause a false "already running" exit.
            if (evaluateLockFile(lockPid, LOCK_FILE) === 'orphaned') {
              console.error(
                `Removing orphaned backend lock for PID ${lockPid} ` +
                  `(process is not node.exe or lock file is stale)`
              );
              try {
                fs.unlinkSync(LOCK_FILE);
              } catch {}
              lockFd = fs.openSync(LOCK_FILE, 'wx');
            } else {
              // Backend is genuinely running: exit gracefully
              return false;
            }
          } catch {
            console.error(`Removing stale backend lock for PID ${lockPid}`);

            try {
              fs.unlinkSync(LOCK_FILE);
            } catch {}

            lockFd = fs.openSync(LOCK_FILE, 'wx');
          }
        } catch (readErr) {
          console.error('Corrupt backend lock file, removing:', readErr);

          try {
            fs.unlinkSync(LOCK_FILE);
          } catch {}

          lockFd = fs.openSync(LOCK_FILE, 'wx');
        }
      } else {
        console.error('Failed to open backend lock file:', err);

        return false;
      }
    }

    if (lockFd === null) return false;

    fs.writeFileSync(lockFd, String(process.pid));

    try {
      fs.fsyncSync(lockFd);
    } catch {}

    console.error(`Acquired backend lock with PID ${process.pid}`);

    return true;
  } catch (error) {
    console.error('Failed to acquire backend lock:', error);

    return false;
  }
}

export function releaseLock(): void {
  try {
    if (lockFd !== null) {
      try {
        fs.closeSync(lockFd);
      } catch {}
      lockFd = null;
    }

    if (fs.existsSync(LOCK_FILE)) {
      try {
        fs.unlinkSync(LOCK_FILE);
      } catch {}
    }
  } catch (error) {
    console.error('Failed to release backend lock:', error);
  }
}
