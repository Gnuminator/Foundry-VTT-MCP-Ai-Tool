/**
 * Atomic file writes for the Obsidian exporter (docs/design/OBSIDIAN-PLAN.md, O2 item
 * 2): a dot-prefixed temp file in the same directory (Obsidian ignores
 * dotfiles) is written, then renamed over the target. On Windows the rename
 * can fail briefly with EPERM/EBUSY/EACCES while a virus scanner or indexer
 * holds the file; retried the same way `vault/store.ts` retries its own
 * writes.
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DEFAULT_RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400];

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface AtomicWriteOptions {
  /** Rename used for the atomic swap (tests inject failures). */
  rename?: (from: string, to: string) => Promise<void>;
  /** Waits between rename retries; the number of entries is the retry count. */
  retryDelaysMs?: number[];
}

/** Write `text` to `full` atomically via a dot-prefixed temp file plus rename. */
export async function writeFileAtomic(
  full: string,
  text: string,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const dir = path.dirname(full);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(full)}.${process.pid}.tmp`);
  await fsp.writeFile(tmp, text, 'utf8');
  const rename =
    options.rename ?? ((from: string, to: string): Promise<void> => fsp.rename(from, to));
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  try {
    await renameWithRetry(tmp, full, rename, delays);
  } catch (error) {
    await fsp.unlink(tmp).catch(() => undefined);
    throw error;
  }
}

async function renameWithRetry(
  from: string,
  to: string,
  rename: (from: string, to: string) => Promise<void>,
  delays: number[]
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = errorCode(error);
      if (!code || !RETRYABLE.has(code) || attempt >= delays.length) throw error;
      await sleep(delays[attempt] ?? 0);
    }
  }
}
