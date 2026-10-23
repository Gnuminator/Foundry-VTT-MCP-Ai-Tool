import type { SessionEvent } from './feed/types.js';

/** One private roll request or result as the target player reads it on /me. */
export interface PrivateRollLine {
  id: string;
  timestampMs: number;
  kind: 'request' | 'result';
  text: string;
}

/** How many lines /me shows. */
export const PRIVATE_ROLL_LIMIT = 10;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The private roll requests made to this Foundry user and their results, newest first. Only an
 * event whose `whisperTo` (set by the module from the chat message's whisper list) names the user
 * counts: a public request, a blind roll, a GM's own roll and another player's roll never do. The
 * result line is the module's player-safe one (no DC or outcome unless dnd5e shows them).
 */
export function privateRollsFor(
  userId: string,
  events: readonly SessionEvent[],
  limit = PRIVATE_ROLL_LIMIT
): PrivateRollLine[] {
  const lines: PrivateRollLine[] = [];
  for (const e of events) {
    if (e.eventType !== 'roll-request' && e.eventType !== 'gm-roll') continue;
    const details = isRecord(e.details) ? e.details : {};
    const to = details['whisperTo'];
    if (!Array.isArray(to) || !to.includes(userId)) continue;
    if (e.eventType === 'roll-request') {
      if (details['isPublic'] === true) continue;
      lines.push({ id: e.id, timestampMs: e.timestampMs, kind: 'request', text: e.description });
    } else {
      const text = details['playerLine'];
      if (typeof text !== 'string' || text === '') continue;
      lines.push({ id: e.id, timestampMs: e.timestampMs, kind: 'result', text });
    }
  }
  return lines.sort((a, b) => b.timestampMs - a.timestampMs).slice(0, limit);
}
