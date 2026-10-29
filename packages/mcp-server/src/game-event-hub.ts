/**
 * Game event hub (I-001): the in-memory meeting point between the event pumps and the
 * `wait-for-game-event` tool.
 *
 * The pumps (`event-pump.ts`, `play-log-pump.ts`) already poll the Foundry module on their own
 * timer. They hand every new event to `publish*`, which keeps the newest ones in a small ring
 * and wakes the waiters whose filter matches. A waiter is one promise, one timer and one entry
 * in a set: there is no polling loop, so waiting costs nothing while nothing happens (PB-11
 * measured the pumps themselves as cheap). A wait ends on the first match, on its timeout, or
 * when its signal aborts; every path removes the waiter and clears the timer.
 *
 * Latency is the pump interval (5 s by default), not the wait.
 */
import type { PlayRecord } from '@gnuminator/shared';

export const DEFAULT_WAIT_MS = 25_000;
/** The MCP client's default request timeout is 60 s; stay well under it. */
export const MAX_WAIT_MS = 45_000;
export const MAX_WAITERS = 4;
/** Session event types the module emits, plus `combat-turn` from the play log. */
export const KNOWN_EVENT_TYPES: readonly string[] = [
  'scene-change',
  'journal-created',
  'journal-updated',
  'item-use',
  'roll',
  'damage-roll',
  'gm-roll',
  'combat-start',
  'combat-end',
  'combat-turn',
  'damage',
  'healing',
  'death',
  'stabilize',
  'resource-spent',
  'condition-applied',
  'condition-removed',
];
const RING_SIZE = 500;
const MAX_RETURNED = 50;

export interface PendingGameEvent {
  id: string;
  timestamp: string;
  timestampMs: number;
  eventType: string;
  actorName: string | null;
  description: string;
  details: Record<string, unknown>;
}

export interface GameEvent extends PendingGameEvent {
  /** Backend receive stamp (ms), strictly increasing; the cursor clock. Set by the hub at publish. */
  receivedMs: number;
}

export interface WaitRequest {
  /** Event types to wait for; empty or absent = any. */
  eventTypes?: readonly string[];
  /** Case-insensitive partial match on the actor name. */
  actorName?: string;
  /** Also return matching events newer than this (ms); absent = only events published from now on. */
  sinceMs?: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface WaitResult {
  events: GameEvent[];
  truncated: boolean;
  /** `timeout` and `cancelled` carry no events. */
  endedBy: 'event' | 'timeout' | 'cancelled';
  /** Newest timestamp (ms) to pass back as the next `since`; null when nothing is known yet. */
  latestMs: number | null;
}

export interface HubSources {
  /** The session event pump (FOUNDRY_AI_EVENT_LOG) is running. */
  sessionEvents: boolean;
  /** The play log pump (FOUNDRY_AI_PLAY_LOG) is running; it carries `combat-turn`. */
  playLog: boolean;
}

interface Waiter {
  matches: (event: GameEvent) => boolean;
  finish: (result: WaitResult) => void;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** A session event as the module's buffer hands it out, or null when it is malformed. */
export function toGameEvent(raw: unknown): PendingGameEvent | null {
  const e = raw as Record<string, unknown> | null;
  if (!e || typeof e !== 'object') return null;
  const id = str(e.id);
  const timestamp = str(e.timestamp);
  const eventType = str(e.eventType);
  if (!id || !timestamp || !eventType) return null;
  const timestampMs =
    typeof e.timestampMs === 'number' && Number.isFinite(e.timestampMs)
      ? e.timestampMs
      : Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return null;
  return {
    id,
    timestamp,
    timestampMs,
    eventType,
    actorName: str(e.actorName),
    description: typeof e.description === 'string' ? e.description : '',
    details:
      e.details && typeof e.details === 'object' ? (e.details as Record<string, unknown>) : {},
  };
}

/** The play log's `combat-turn` record as a game event; other record kinds are not events here. */
export function playRecordToGameEvent(record: PlayRecord): PendingGameEvent | null {
  if (record.kind !== 'combat-turn' || !record.combat) return null;
  const data = record.data;
  const name = str(data?.combatantName);
  const { round, turn } = record.combat;
  return {
    id: record.key,
    timestamp: new Date(record.t).toISOString(),
    timestampMs: record.t,
    eventType: 'combat-turn',
    actorName: name,
    description: `Round ${round}, turn ${turn + 1}: ${name ?? 'unknown combatant'}`,
    details: { round, turn, combatId: record.combat.id, hiddenFromPlayers: data?.hidden === true },
  };
}

export class GameEventHub {
  private readonly ring: GameEvent[] = [];
  private readonly ids = new Set<string>();
  private readonly waiters = new Set<Waiter>();
  private sources: HubSources = { sessionEvents: false, playLog: false };
  private lastReceivedMs = 0;

  /** `now` is injectable for tests. */
  constructor(private readonly now: () => number = Date.now) {}

  setSources(sources: HubSources): void {
    this.sources = sources;
  }

  getSources(): HubSources {
    return this.sources;
  }

  get waiterCount(): number {
    return this.waiters.size;
  }

  /** Session events from the event pump. */
  publishSessionEvents(raw: readonly unknown[]): void {
    this.publish(raw.map(toGameEvent).filter((e): e is PendingGameEvent => e !== null));
  }

  /** Records from the play log pump; only `combat-turn` becomes an event. */
  publishPlayRecords(records: readonly PlayRecord[]): void {
    this.publish(
      records.map(playRecordToGameEvent).filter((e): e is PendingGameEvent => e !== null)
    );
  }

  private publish(events: PendingGameEvent[]): void {
    const pending = events.filter(e => !this.ids.has(e.id));
    if (pending.length === 0) return;
    // Session events carry the browser clock and play-log records the Foundry server clock, so
    // the cursor runs on one backend stamp instead: strictly increasing, in publish order.
    const fresh: GameEvent[] = pending.map(e => {
      this.lastReceivedMs = Math.max(this.now(), this.lastReceivedMs + 1);
      return { ...e, receivedMs: this.lastReceivedMs };
    });
    for (const event of fresh) {
      this.ring.push(event);
      this.ids.add(event.id);
    }
    while (this.ring.length > RING_SIZE) {
      const dropped = this.ring.shift();
      if (dropped) this.ids.delete(dropped.id);
    }
    for (const waiter of [...this.waiters]) {
      const hits = fresh.filter(waiter.matches);
      if (hits.length > 0) waiter.finish(this.result(hits));
    }
  }

  private result(hits: GameEvent[]): WaitResult {
    const sorted = [...hits].sort((a, b) => a.receivedMs - b.receivedMs);
    const kept = sorted.slice(0, MAX_RETURNED);
    return {
      events: kept,
      truncated: sorted.length > kept.length,
      endedBy: 'event',
      latestMs: kept[kept.length - 1].receivedMs,
    };
  }

  private newestMs(): number | null {
    return this.ring.length > 0 ? this.lastReceivedMs : null;
  }

  /**
   * Resolve on the first matching event. Throws when the wait cannot work (a needed pump is off)
   * or too many waits are open.
   */
  wait(request: WaitRequest): Promise<WaitResult> {
    const types = (request.eventTypes ?? []).map(t => t.trim()).filter(Boolean);
    const unknown = types.filter(t => !KNOWN_EVENT_TYPES.includes(t));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown event type${unknown.length > 1 ? 's' : ''} ${unknown.map(t => `"${t}"`).join(', ')}. Known types: ${KNOWN_EVENT_TYPES.join(', ')}.`
      );
    }
    this.assertSources(types);
    const actor = request.actorName?.trim().toLowerCase() ?? '';
    const typeSet = new Set(types);
    const matches = (e: GameEvent): boolean =>
      (typeSet.size === 0 || typeSet.has(e.eventType)) &&
      (actor === '' || (e.actorName ?? '').toLowerCase().includes(actor));

    // Events the pump already published since the caller's last cursor.
    if (request.sinceMs !== undefined) {
      const since = request.sinceMs;
      const hits = this.ring.filter(e => e.receivedMs > since && matches(e));
      if (hits.length > 0) return Promise.resolve(this.result(hits));
    }

    // A call that would answer at once never counts against the cap; only a real wait does.
    if (this.waiters.size >= MAX_WAITERS) {
      throw new Error(
        `Too many waits open (${MAX_WAITERS}); let one finish or time out, then try again.`
      );
    }

    // Always hand out a backend stamp, even on an empty ring, so a timed-out call still returns
    // a cursor and nothing published before the next call is missed.
    if (request.sinceMs === undefined && this.ring.length === 0) {
      this.lastReceivedMs = Math.max(this.lastReceivedMs, this.now());
    }
    const fallbackMs = request.sinceMs ?? this.lastReceivedMs;
    return new Promise<WaitResult>(resolve => {
      const empty = (endedBy: 'timeout' | 'cancelled'): WaitResult => ({
        events: [],
        truncated: false,
        endedBy,
        latestMs: fallbackMs,
      });
      if (request.signal?.aborted) return resolve(empty('cancelled'));
      const waiter: Waiter = {
        matches,
        finish: result => {
          clearTimeout(timer);
          request.signal?.removeEventListener('abort', onAbort);
          this.waiters.delete(waiter);
          resolve(result);
        },
      };
      const onAbort = (): void => waiter.finish(empty('cancelled'));
      this.waiters.add(waiter);
      request.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => waiter.finish(empty('timeout')), request.timeoutMs);
    });
  }

  private assertSources(types: readonly string[]): void {
    const needsPlayLog = types.length === 0 || types.includes('combat-turn');
    const needsEvents = types.length === 0 || types.some(t => t !== 'combat-turn');
    if (needsEvents && !this.sources.sessionEvents) {
      throw new Error(
        'The session event log is off (FOUNDRY_AI_EVENT_LOG=off) or the Foundry link is disabled, so there is nothing to wait on. Use get-recent-events instead.'
      );
    }
    if (needsPlayLog && types.length > 0 && !this.sources.playLog) {
      throw new Error(
        'combat-turn comes from the play log, which is off (FOUNDRY_AI_PLAY_LOG=off). Use get-combat-state instead.'
      );
    }
  }
}
