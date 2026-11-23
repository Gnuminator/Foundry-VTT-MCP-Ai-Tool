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
}

interface SpotlightSnapshot {
  players: SpotlightPlayer[];
  /** True when the counts are for a play session, false when they run from the dashboard start. */
  session: boolean;
}

interface Counted {
  name: string;
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
      this.counted.push({ name: e.actorName, at: e.timestampMs });
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
    const counts = new Map<string, number>();
    for (const c of this.counted) {
      if (this.since !== null && c.at < this.since) continue;
      counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    }
    return {
      players: [...counts.entries()]
        .map(([name, actions]) => ({ name, actions }))
        .sort((a, b) => b.actions - a.actions || a.name.localeCompare(b.name)),
      session: this.since !== null,
    };
  }
}
