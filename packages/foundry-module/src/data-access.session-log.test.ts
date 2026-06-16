/**
 * Characterization tests for `getSessionLog` and `getRecentEvents` in
 * `FoundryDataAccess`.
 *
 * These pin the *current* (upstream-derived) behaviour of the `session-log`
 * domain so a from-scratch reimplementation in Phase 9 can be verified to
 * parity.
 *
 * Strategy: spy on the `eventTracker` singleton's `getSessionLog` method and
 * assert that the data-access methods (a) pass exactly the right `filters`
 * object (no extra undefined-keyed properties) and (b) return the expected
 * envelope shape, including `latestTimestamp` edge-cases for `getRecentEvents`.
 *
 * Harness gaps worked around locally:
 *   - `eventTracker` is a module-level singleton imported from
 *     `'./session-events.js'`.  We spy on it with `vi.spyOn` after
 *     `world.install()` so the Foundry globals are available for
 *     `validateFoundryState()`.  No shared harness files are touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';
import { eventTracker } from './session-events.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(timestamp: string, eventType = 'combat-start', actorName: string | null = null) {
  return {
    id: `evt-${timestamp}`,
    timestamp,
    timestampMs: Date.parse(timestamp),
    eventType,
    actorName,
    actorId: null,
    description: `Event at ${timestamp}`,
    details: {},
  };
}

// ---------------------------------------------------------------------------
// getSessionLog — filters forwarded to eventTracker
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getSessionLog: filters forwarded', () => {
  it('passes an empty filters object when called with no fields', async () => {
    const spy = vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    await da.getSessionLog({});

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({});
    // confirm no spurious keys were added
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toHaveLength(0);
  });

  it('passes only limit when only limit is provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    await da.getSessionLog({ limit: 5 });

    expect(spy).toHaveBeenCalledWith({ limit: 5 });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual(['limit']);
  });

  it('passes only eventType when only eventType is provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    await da.getSessionLog({ eventType: 'hp-change' });

    expect(spy).toHaveBeenCalledWith({ eventType: 'hp-change' });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual(['eventType']);
  });

  it('passes only actorName when only actorName is provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    await da.getSessionLog({ actorName: 'Baldur' });

    expect(spy).toHaveBeenCalledWith({ actorName: 'Baldur' });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual(['actorName']);
  });

  it('passes all three filter keys when all are provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    await da.getSessionLog({ limit: 10, eventType: 'death', actorName: 'Varis' });

    expect(spy).toHaveBeenCalledWith({ limit: 10, eventType: 'death', actorName: 'Varis' });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received).sort()).toEqual(['actorName', 'eventType', 'limit']);
  });
});

// ---------------------------------------------------------------------------
// getSessionLog — return shape
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getSessionLog: return shape', () => {
  it('returns { success: true, count, events } where events is the spy return value', async () => {
    const events = [makeEvent('2026-01-01T10:00:00.000Z'), makeEvent('2026-01-01T10:01:00.000Z')];
    vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue(events as any);

    const result = await da.getSessionLog({});

    expect(result).toEqual({ success: true, count: 2, events });
  });

  it('returns count 0 and empty events array when the tracker returns nothing', async () => {
    vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    const result = await da.getSessionLog({});

    expect(result).toEqual({ success: true, count: 0, events: [] });
  });

  it('count matches the exact length of the events array returned by the tracker', async () => {
    const events = [
      makeEvent('2026-01-01T10:00:00.000Z'),
      makeEvent('2026-01-01T10:01:00.000Z'),
      makeEvent('2026-01-01T10:02:00.000Z'),
    ];
    vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue(events as any);

    const result = await da.getSessionLog({ limit: 3 });

    expect(result.count).toBe(3);
    expect(result.events).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// getRecentEvents — filters forwarded to eventTracker
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getRecentEvents: filters forwarded', () => {
  it('passes an empty filters object when called with no fields', async () => {
    const spy = vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    await da.getRecentEvents({});

    expect(spy).toHaveBeenCalledTimes(1);
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toHaveLength(0);
  });

  it('passes only sinceTimestamp when only sinceTimestamp is provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);
    const ts = '2026-01-01T09:00:00.000Z';

    await da.getRecentEvents({ sinceTimestamp: ts });

    expect(spy).toHaveBeenCalledWith({ sinceTimestamp: ts });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual(['sinceTimestamp']);
  });

  it('passes only limit when only limit is provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    await da.getRecentEvents({ limit: 20 });

    expect(spy).toHaveBeenCalledWith({ limit: 20 });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual(['limit']);
  });

  it('passes only eventType when only eventType is provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    await da.getRecentEvents({ eventType: 'condition-applied' });

    expect(spy).toHaveBeenCalledWith({ eventType: 'condition-applied' });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual(['eventType']);
  });

  it('passes all three filter keys when all are provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);
    const ts = '2026-01-01T08:00:00.000Z';

    await da.getRecentEvents({ sinceTimestamp: ts, limit: 15, eventType: 'scene-change' });

    expect(spy).toHaveBeenCalledWith({ sinceTimestamp: ts, limit: 15, eventType: 'scene-change' });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received).sort()).toEqual(['eventType', 'limit', 'sinceTimestamp']);
  });
});

// ---------------------------------------------------------------------------
// getRecentEvents — return shape and latestTimestamp logic
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getRecentEvents: return shape', () => {
  it('returns the standard envelope fields: success, count, events, latestTimestamp, serverTime', async () => {
    const events = [makeEvent('2026-01-01T10:00:00.000Z')];
    vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue(events as any);

    const result = await da.getRecentEvents({});

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.events).toBe(events);
    expect(typeof result.serverTime).toBe('string');
    // Validate it looks like an ISO timestamp string
    expect(() => new Date(result.serverTime)).not.toThrow();
  });

  it('serverTime is a non-empty ISO string (does not assert exact value)', async () => {
    vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    const before = Date.now();
    const result = await da.getRecentEvents({});
    const after = Date.now();

    expect(typeof result.serverTime).toBe('string');
    expect(result.serverTime.length).toBeGreaterThan(0);
    // The serverTime should be approximately now
    const parsed = Date.parse(result.serverTime);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after + 5); // tolerate tiny async gap
  });
});

describe('FoundryDataAccess — getRecentEvents: latestTimestamp', () => {
  it('returns the timestamp of the LAST event when events are non-empty', async () => {
    const events = [
      makeEvent('2026-01-01T10:00:00.000Z'),
      makeEvent('2026-01-01T10:05:00.000Z'),
      makeEvent('2026-01-01T10:10:00.000Z'),
    ];
    vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue(events as any);

    const result = await da.getRecentEvents({});

    expect(result.latestTimestamp).toBe('2026-01-01T10:10:00.000Z');
  });

  it('returns latestTimestamp from the last element even with a single event', async () => {
    const events = [makeEvent('2026-06-16T08:30:00.000Z')];
    vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue(events as any);

    const result = await da.getRecentEvents({});

    expect(result.latestTimestamp).toBe('2026-06-16T08:30:00.000Z');
  });

  it('returns sinceTimestamp when events are empty and sinceTimestamp was supplied', async () => {
    vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);
    const ts = '2026-01-01T09:00:00.000Z';

    const result = await da.getRecentEvents({ sinceTimestamp: ts });

    expect(result.latestTimestamp).toBe(ts);
  });

  it('returns null when events are empty and no sinceTimestamp was supplied', async () => {
    vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue([]);

    const result = await da.getRecentEvents({});

    expect(result.latestTimestamp).toBeNull();
  });

  it('count matches the number of events returned by the tracker', async () => {
    const events = [makeEvent('2026-01-01T10:00:00.000Z'), makeEvent('2026-01-01T10:01:00.000Z')];
    vi.spyOn(eventTracker, 'getSessionLog').mockReturnValue(events as any);

    const result = await da.getRecentEvents({ limit: 2 });

    expect(result.count).toBe(2);
  });
});
