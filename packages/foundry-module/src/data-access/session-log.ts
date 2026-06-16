import * as shared from './shared.js';
import { eventTracker } from '../session-events.js';

/**
 * Session event log domain for `FoundryDataAccess`.
 *
 * Delegates all event retrieval to the `eventTracker` singleton, which owns the
 * in-memory ring of session events recorded during the active Foundry session.
 * The two public methods differ only in their filter signatures and their return
 * envelopes: `getSessionLog` is a simple filtered list; `getRecentEvents` layers
 * on `latestTimestamp` and `serverTime` so callers can poll incrementally.
 *
 * Filter objects are built with only the keys that are *defined* — undefined
 * values are never forwarded to the tracker, so the tracker's own defaults
 * (e.g. "no limit") apply naturally.
 */
export class SessionLogDataAccess {
  /**
   * Return a filtered slice of the session event log.
   *
   * All filter fields are optional; omitting them returns the full tracked log
   * (up to the tracker's internal cap). Only keys with defined values are
   * included in the filters object passed to the tracker.
   */
  async getSessionLog(data: {
    limit?: number;
    eventType?: string;
    actorName?: string;
  }): Promise<any> {
    shared.validateFoundryState();

    const filters = buildFilters({
      limit: data.limit,
      eventType: data.eventType,
      actorName: data.actorName,
    });

    const events = eventTracker.getSessionLog(filters);
    return {
      success: true,
      count: events.length,
      events,
    };
  }

  /**
   * Low-latency delta query: return events since a given timestamp (or all
   * events), plus a `latestTimestamp` the caller can echo back as
   * `sinceTimestamp` on the next poll to receive only newer events.
   *
   * `latestTimestamp` resolution:
   *   - Non-empty result → last event's `.timestamp` (tracker returns events in
   *     chronological order, so the tail is the most recent).
   *   - Empty result, `sinceTimestamp` supplied → echo `sinceTimestamp` back so
   *     the caller's cursor doesn't regress.
   *   - Empty result, no `sinceTimestamp` → `null` (no cursor yet established).
   *
   * `serverTime` is always `new Date().toISOString()` so callers can detect
   * clock skew without a separate round-trip.
   */
  async getRecentEvents(data: {
    sinceTimestamp?: string;
    limit?: number;
    eventType?: string;
  }): Promise<any> {
    shared.validateFoundryState();

    const filters = buildFilters({
      sinceTimestamp: data.sinceTimestamp,
      limit: data.limit,
      eventType: data.eventType,
    });

    const events = eventTracker.getSessionLog(filters);
    const lastEvent = events[events.length - 1];
    const latestTimestamp =
      events.length > 0 && lastEvent ? lastEvent.timestamp : (data.sinceTimestamp ?? null);

    return {
      success: true,
      count: events.length,
      events,
      latestTimestamp,
      serverTime: new Date().toISOString(),
    };
  }
}

/**
 * Build a filters object from a bag of optional values, omitting any key whose
 * value is `undefined`. This keeps the object passed to `eventTracker` clean —
 * the tracker inspects `key in filters` in some code paths, so a present-but-
 * undefined key would be misread as an explicit override.
 */
function buildFilters<T extends Record<string, unknown>>(bag: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(bag) as Array<keyof T>) {
    if (bag[key] !== undefined) {
      result[key] = bag[key];
    }
  }
  return result;
}
