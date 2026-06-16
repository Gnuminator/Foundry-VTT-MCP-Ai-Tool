/**
 * Characterization tests for `getChatLog` in `FoundryDataAccess` (delegated to
 * `ChatDataAccess`).
 *
 * These pin the *current* (upstream-derived) behaviour so a from-scratch
 * reimplementation in Phase 9 can be verified to parity.
 *
 * The method's own logic is:
 *   1. Call `shared.validateFoundryState()` (game.ready must be true).
 *   2. Build a `filters` object that includes ONLY the keys whose incoming
 *      `data` value is not `undefined`.
 *   3. Delegate to `eventTracker.getChatLog(filters)`.
 *   4. Return `{ success: true, count: messages.length, messages }`.
 *
 * `eventTracker` is the singleton exported from `./session-events.js`.  We spy
 * on it so that we exercise only the data-access layer's own logic — the
 * EventTracker's filter implementation is tested separately.
 *
 * Harness: Phase 9 Foundry-mock (`src/test-support/foundry-mock/index.ts`).
 * The `createTestWorld` + `world.install()` call sets `game.ready = true` so
 * `validateFoundryState()` passes.
 *
 * Harness gaps worked around locally (shared harness files never touched):
 *   - `eventTracker.getChatLog` is mocked via `vi.spyOn` — the EventTracker's
 *     real implementation would need a populated chat buffer; we bypass that
 *     entirely and return controlled fixture data from the mock.
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
// Return-shape tests
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getChatLog: return shape', () => {
  it('returns success:true, count:0, and messages:[] when the tracker returns an empty array', async () => {
    vi.spyOn(eventTracker, 'getChatLog').mockReturnValue([]);

    const result = await da.getChatLog({});

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.messages).toEqual([]);
  });

  it('returns success:true, the correct count, and the messages array verbatim', async () => {
    const fixture = [
      {
        id: 'msg-1',
        timestamp: '2026-06-16T10:00:00.000Z',
        timestampMs: 1750072800000,
        speakerName: 'Gandalf',
        actorId: 'actor-1',
        messageType: 'ic',
        isRoll: false,
        content: 'You shall not pass!',
        flavor: null,
        roll: null,
        damage: null,
        whisperTo: [],
      },
      {
        id: 'msg-2',
        timestamp: '2026-06-16T10:00:05.000Z',
        timestampMs: 1750072805000,
        speakerName: 'Frodo',
        actorId: 'actor-2',
        messageType: 'ooc',
        isRoll: false,
        content: 'Thank you, Gandalf.',
        flavor: null,
        roll: null,
        damage: null,
        whisperTo: [],
      },
    ] as any[];

    vi.spyOn(eventTracker, 'getChatLog').mockReturnValue(fixture);

    const result = await da.getChatLog({});

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.messages).toBe(fixture); // exact reference — no copy made
  });

  it('count matches messages.length for a single-element return', async () => {
    const single = [
      {
        id: 'msg-3',
        timestamp: '2026-06-16T11:00:00.000Z',
        timestampMs: 1750076400000,
        speakerName: 'Aragorn',
        actorId: null,
        messageType: 'ic',
        isRoll: false,
        content: 'For Gondor!',
        flavor: null,
        roll: null,
        damage: null,
        whisperTo: [],
      },
    ] as any[];

    vi.spyOn(eventTracker, 'getChatLog').mockReturnValue(single);

    const result = await da.getChatLog({ limit: 5, speakerName: 'Aragorn' });

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.messages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Filter-omission tests — the data-access layer must NOT forward `undefined`
// keys to eventTracker.getChatLog.
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getChatLog: filter key omission', () => {
  it('passes an empty object to eventTracker when called with {}', async () => {
    const spy = vi.spyOn(eventTracker, 'getChatLog').mockReturnValue([]);

    await da.getChatLog({});

    expect(spy).toHaveBeenCalledWith({});
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual([]);
  });

  it('passes only limit when only limit is provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getChatLog').mockReturnValue([]);

    await da.getChatLog({ limit: 10 });

    expect(spy).toHaveBeenCalledWith({ limit: 10 });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual(['limit']);
  });

  it('passes only speakerName when only speakerName is provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getChatLog').mockReturnValue([]);

    await da.getChatLog({ speakerName: 'Gandalf' });

    expect(spy).toHaveBeenCalledWith({ speakerName: 'Gandalf' });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual(['speakerName']);
  });

  it('passes only messageType when only messageType is provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getChatLog').mockReturnValue([]);

    await da.getChatLog({ messageType: 'roll' });

    expect(spy).toHaveBeenCalledWith({ messageType: 'roll' });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual(['messageType']);
  });

  it('passes only sinceTimestamp when only sinceTimestamp is provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getChatLog').mockReturnValue([]);

    await da.getChatLog({ sinceTimestamp: '2026-06-16T00:00:00.000Z' });

    expect(spy).toHaveBeenCalledWith({ sinceTimestamp: '2026-06-16T00:00:00.000Z' });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received)).toEqual(['sinceTimestamp']);
  });

  it('passes limit and speakerName (not messageType/sinceTimestamp) when those two are provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getChatLog').mockReturnValue([]);

    await da.getChatLog({ limit: 10, speakerName: 'Gandalf' });

    expect(spy).toHaveBeenCalledWith({ limit: 10, speakerName: 'Gandalf' });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received).sort()).toEqual(['limit', 'speakerName']);
    expect('messageType' in received).toBe(false);
    expect('sinceTimestamp' in received).toBe(false);
  });

  it('passes all four keys when all four are provided', async () => {
    const spy = vi.spyOn(eventTracker, 'getChatLog').mockReturnValue([]);

    await da.getChatLog({
      limit: 20,
      speakerName: 'Frodo',
      messageType: 'ic',
      sinceTimestamp: '2026-06-16T09:00:00.000Z',
    });

    expect(spy).toHaveBeenCalledWith({
      limit: 20,
      speakerName: 'Frodo',
      messageType: 'ic',
      sinceTimestamp: '2026-06-16T09:00:00.000Z',
    });
    const received = spy.mock.calls[0][0];
    expect(Object.keys(received).sort()).toEqual([
      'limit',
      'messageType',
      'sinceTimestamp',
      'speakerName',
    ]);
  });

  it('does not include messageType or sinceTimestamp when they are explicitly undefined', async () => {
    const spy = vi.spyOn(eventTracker, 'getChatLog').mockReturnValue([]);

    await da.getChatLog({
      limit: 5,
      speakerName: 'Legolas',
      messageType: undefined,
      sinceTimestamp: undefined,
    });

    const received = spy.mock.calls[0][0];
    expect('messageType' in received).toBe(false);
    expect('sinceTimestamp' in received).toBe(false);
    expect(received).toEqual({ limit: 5, speakerName: 'Legolas' });
  });
});
