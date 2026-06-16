import * as shared from './shared.js';
import { eventTracker } from '../session-events.js';

/** Session event log domain — extracted from FoundryDataAccess. */
export class SessionLogDataAccess {
  async getSessionLog(data: {
    limit?: number;
    eventType?: string;
    actorName?: string;
  }): Promise<any> {
    shared.validateFoundryState();

    const filters: { limit?: number; eventType?: string; actorName?: string } = {};
    if (data.limit !== undefined) filters.limit = data.limit;
    if (data.eventType !== undefined) filters.eventType = data.eventType;
    if (data.actorName !== undefined) filters.actorName = data.actorName;

    const events = eventTracker.getSessionLog(filters);
    return {
      success: true,
      count: events.length,
      events,
    };
  }

  /**
   * Low-latency "what happened since timestamp X" delta over the tracked events.
   * Returns `latestTimestamp` so a caller can poll incrementally by passing it
   * back as `sinceTimestamp` on the next call.
   */
  async getRecentEvents(data: {
    sinceTimestamp?: string;
    limit?: number;
    eventType?: string;
  }): Promise<any> {
    shared.validateFoundryState();

    const filters: { sinceTimestamp?: string; limit?: number; eventType?: string } = {};
    if (data.sinceTimestamp !== undefined) filters.sinceTimestamp = data.sinceTimestamp;
    if (data.limit !== undefined) filters.limit = data.limit;
    if (data.eventType !== undefined) filters.eventType = data.eventType;

    const events = eventTracker.getSessionLog(filters);
    const latestTimestamp =
      events.length > 0 ? events[events.length - 1]!.timestamp : (data.sinceTimestamp ?? null);

    return {
      success: true,
      count: events.length,
      events,
      latestTimestamp,
      serverTime: new Date().toISOString(),
    };
  }
}
