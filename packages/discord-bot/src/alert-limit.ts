/**
 * A rate limit for a repeating alert (item recorder-heartbeat-polish): `allow(now)` is true at most
 * once per window, so a rejection thrown in a loop posts once to #gm-bot and the rest only reach
 * the log.
 */
export function createAlertLimit(windowMs: number): (now: number) => boolean {
  let last: number | null = null;
  return now => {
    if (last !== null && now - last < windowMs) return false;
    last = now;
    return true;
  };
}
