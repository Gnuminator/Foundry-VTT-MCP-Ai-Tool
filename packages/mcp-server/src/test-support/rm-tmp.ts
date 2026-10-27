import { promises as fsp } from 'fs';

/**
 * Removes a temp folder tree for a test teardown. On Windows under load an
 * antivirus scan or the indexer can hold a file for a moment, so rmdir fails
 * with ENOTEMPTY or EBUSY; the retries ride that out.
 */
export function rmTmp(dir: string): Promise<void> {
  return fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
