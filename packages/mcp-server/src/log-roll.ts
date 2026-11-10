import * as fs from 'fs';

/** Past this size the wrapper log rolls to `<file>.1`. */
export const LOG_ROLL_BYTES = 5 * 1024 * 1024;

/** A `.1` younger than this was just rolled by another connector: do not roll over it. */
export const RECENT_ROLL_MS = 60_000;

/**
 * Roll `file` to `file.1` when it is over `maxBytes`. Several Claude Desktop connectors write the
 * same wrapper log, so two can see the big file at once. The first one rolls it; the second would
 * then roll the fresh, nearly empty log over the rolled file and lose it. So a `.1` written within
 * the last minute means someone just rolled, and the roll is skipped. Never throws.
 */
export function rollLogIfLarge(
  file: string,
  maxBytes: number = LOG_ROLL_BYTES,
  now: number = Date.now()
): void {
  try {
    if (fs.statSync(file).size <= maxBytes) return;
    const rolled = `${file}.1`;
    try {
      if (now - fs.statSync(rolled).mtimeMs < RECENT_ROLL_MS) return;
    } catch {
      // no .1 yet
    }
    fs.renameSync(file, rolled);
  } catch {}
}
