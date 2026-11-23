import type { SessionEvent } from './feed/types.js';

/**
 * Spotlight balance (I-177): how many things each player character did, counted from the session
 * events the dashboard already reads from the play log. GM only: it goes out on the GM stream
 * (`spotlight`), never on the player stream or `/player`. Speaking time comes from the Discord
 * recorder's status (recording-health.ts) and is joined by the page.
 *
 * The count is for the play session: it starts at the session's start (`mark-play-session`), so a
 * dashboard restart mid-session counts the same events again and a new session starts from zero.
 * With no session known it counts from when the dashboard started or a different world opened.
 * It is not stored.
 */

/** Event types that count as a character acting: a roll, a whispered roll, damage, an item used. */
const ACTION_TYPES: ReadonlySet<string> = new Set(['roll', 'gm-roll', 'damage-roll', 'item-use']);

interface SpotlightPlayer {
  name: string;
  actions: number;
  /** The actor's id when the log names one; the page matches the party roster on it (PR 1166 L2). */
  actorId?: string;
}

interface SpotlightSnapshot {
  players: SpotlightPlayer[];
  /** True when the counts are for a play session, false when they run from the dashboard start. */
  session: boolean;
}

interface Counted {
  name: string;
  actorId: string | null;
  at: number;
}

export class SpotlightTally {
  /** Every action seen (a small tuple each), so a session start can recount without a re-read. */
  private counted: Counted[] = [];
  /** Event ids already seen: the same events come again on a reconnect. */
  private readonly seen = new Set<string>();
  /** The session's start (ms); earlier events do not count. Null: no session known yet. */
  private since: number | null = null;

  /** Counts the new events; returns true when a number changed. */
  add(events: readonly SessionEvent[]): boolean {
    let changed = false;
    for (const e of events) {
      if (this.seen.has(e.id)) continue;
      this.seen.add(e.id);
      if (!ACTION_TYPES.has(e.eventType)) continue;
      if (e.visibility?.subject !== 'pc' || !e.actorName) continue;
      this.counted.push({ name: e.actorName, actorId: e.actorId || null, at: e.timestampMs });
      if (this.since === null || e.timestampMs >= this.since) changed = true;
    }
    return changed;
  }

  /** A play session started at `startedAtMs`: count only from then. True when the snapshot changed. */
  setSessionStart(startedAtMs: number): boolean {
    if (this.since === startedAtMs) return false;
    const before = JSON.stringify(this.snapshot());
    this.since = startedAtMs;
    return JSON.stringify(this.snapshot()) !== before;
  }

  reset(): void {
    this.counted = [];
    this.seen.clear();
    this.since = null;
  }

  snapshot(): SpotlightSnapshot {
    // One entry per actor id (or per name when the log has no id), under the name first seen.
    const counts = new Map<string, SpotlightPlayer>();
    for (const c of this.counted) {
      if (this.since !== null && c.at < this.since) continue;
      const key = c.actorId ? `id:${c.actorId}` : `name:${c.name}`;
      const entry = counts.get(key);
      if (entry) entry.actions += 1;
      else
        counts.set(key, { name: c.name, actions: 1, ...(c.actorId ? { actorId: c.actorId } : {}) });
    }
    return {
      players: [...counts.values()].sort(
        (a, b) => b.actions - a.actions || a.name.localeCompare(b.name)
      ),
      session: this.since !== null,
    };
  }
}
