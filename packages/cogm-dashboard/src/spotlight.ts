import type { SessionEvent } from './feed/types.js';

/**
 * Spotlight balance (I-177): how many things each player character did, counted from the session
 * events the dashboard already reads from the play log. GM only: it goes out on the GM stream
 * (`spotlight`), never on the player stream or `/player`. Speaking time comes from the Discord
 * recorder's status (recording-health.ts) and is joined by the page.
 *
 * The count starts when the dashboard starts or a different world opens; it is not stored.
 */

/** Event types that count as a character acting: a roll, a whispered roll, damage, an item used. */
const ACTION_TYPES: ReadonlySet<string> = new Set(['roll', 'gm-roll', 'damage-roll', 'item-use']);

interface SpotlightPlayer {
  name: string;
  actions: number;
}

interface SpotlightSnapshot {
  players: SpotlightPlayer[];
}

export class SpotlightTally {
  private readonly counts = new Map<string, number>();
  /** Event ids already counted: the same events come again on a reconnect. */
  private readonly seen = new Set<string>();

  /** Counts the new events; returns true when a number changed. */
  add(events: readonly SessionEvent[]): boolean {
    let changed = false;
    for (const e of events) {
      if (this.seen.has(e.id)) continue;
      this.seen.add(e.id);
      if (!ACTION_TYPES.has(e.eventType)) continue;
      if (e.visibility?.subject !== 'pc' || !e.actorName) continue;
      this.counts.set(e.actorName, (this.counts.get(e.actorName) ?? 0) + 1);
      changed = true;
    }
    return changed;
  }

  reset(): void {
    this.counts.clear();
    this.seen.clear();
  }

  snapshot(): SpotlightSnapshot {
    return {
      players: [...this.counts.entries()]
        .map(([name, actions]) => ({ name, actions }))
        .sort((a, b) => b.actions - a.actions || a.name.localeCompare(b.name)),
    };
  }
}
