import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayRecord } from '@gnuminator/shared';

import {
  GameEventHub,
  type PendingGameEvent,
  MAX_WAITERS,
  playRecordToGameEvent,
} from './game-event-hub.js';

let seq = 0;
function ev(
  ms: number,
  eventType = 'damage',
  actorName: string | null = 'Test Hero'
): PendingGameEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    timestamp: new Date(ms).toISOString(),
    timestampMs: ms,
    eventType,
    actorName,
    description: `${eventType} ${seq}`,
    details: {},
  };
}

function turnRecord(key: string, t: number, round: number, turn: number): PlayRecord {
  return {
    v: 2,
    key,
    t,
    seq: 1,
    kind: 'combat-turn',
    userId: null,
    sceneId: null,
    combat: { id: 'c1', round, turn },
    data: { combatantName: 'Wolf 1' },
  };
}

let hub: GameEventHub;
/** The backend clock the hub stamps events with; fixed, so stamps are T0, T0+1, ... */
const T0 = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  hub = new GameEventHub(() => T0);
  hub.setSources({ sessionEvents: true, playLog: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('GameEventHub.wait', () => {
  it('resolves on the first matching event and ignores other types', async () => {
    const p = hub.wait({ eventTypes: ['scene-change'], timeoutMs: 10_000 });
    hub.publishSessionEvents([ev(1000, 'damage')]);
    expect(hub.waiterCount).toBe(1);
    hub.publishSessionEvents([ev(2000, 'scene-change', null)]);
    const r = await p;
    expect(r.endedBy).toBe('event');
    expect(r.events.map(e => e.eventType)).toEqual(['scene-change']);
    // The empty-ring wait took the cursor T0, so the two events are stamped T0 + 1 and T0 + 2.
    expect(r.latestMs).toBe(T0 + 2);
    expect(hub.waiterCount).toBe(0);
  });

  it('times out with an empty list and clears the waiter and its timer', async () => {
    const p = hub.wait({ timeoutMs: 5000 });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    const r = await p;
    expect(r.endedBy).toBe('timeout');
    expect(r.events).toEqual([]);
    expect(hub.waiterCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns buffered events newer than sinceMs at once, without waiting', async () => {
    hub.publishSessionEvents([ev(1000), ev(2000), ev(3000)]);
    const r = await hub.wait({ sinceMs: T0, timeoutMs: 5000 });
    expect(r.events.map(e => e.timestampMs)).toEqual([2000, 3000]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not return buffered events when no cursor is given', async () => {
    hub.publishSessionEvents([ev(1000)]);
    const p = hub.wait({ timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.endedBy).toBe('timeout');
    expect(r.latestMs).toBe(T0);
  });

  it('filters by actor name (partial, case-insensitive)', async () => {
    const p = hub.wait({ actorName: 'wolf', timeoutMs: 5000 });
    hub.publishSessionEvents([ev(1000, 'damage', 'Test Hero'), ev(1100, 'damage', 'Wolf 2')]);
    const r = await p;
    expect(r.events.map(e => e.actorName)).toEqual(['Wolf 2']);
  });

  it('ends on abort and cleans up', async () => {
    const ac = new AbortController();
    const p = hub.wait({ timeoutMs: 5000, signal: ac.signal });
    ac.abort();
    const r = await p;
    expect(r.endedBy).toBe('cancelled');
    expect(hub.waiterCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is cancelled at once when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await hub.wait({ timeoutMs: 5000, signal: ac.signal });
    expect(r.endedBy).toBe('cancelled');
    expect(hub.waiterCount).toBe(0);
  });

  it('refuses more than the waiter cap', async () => {
    const open = Array.from({ length: MAX_WAITERS }, () => hub.wait({ timeoutMs: 5000 }));
    expect(() => hub.wait({ timeoutMs: 5000 })).toThrow(/Too many waits/);
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(open);
    expect(hub.waiterCount).toBe(0);
  });

  it('ignores an event it already has (the pump may repeat the boundary)', async () => {
    const e = ev(1000);
    hub.publishSessionEvents([e]);
    const p = hub.wait({ timeoutMs: 1000 });
    hub.publishSessionEvents([e]);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).endedBy).toBe('timeout');
  });

  it('caps the events returned and says so', async () => {
    const p = hub.wait({ timeoutMs: 5000 });
    hub.publishSessionEvents(Array.from({ length: 60 }, (_, i) => ev(1000 + i)));
    const r = await p;
    expect(r.events).toHaveLength(50);
    expect(r.truncated).toBe(true);
    expect(r.latestMs).toBe(T0 + 50);
    // The next call starts exactly at event 51.
    const next = await hub.wait({ sinceMs: r.latestMs ?? 0, timeoutMs: 1000 });
    expect(next.events).toHaveLength(10);
    expect(next.events[0].timestampMs).toBe(1050);
    expect(next.truncated).toBe(false);
  });

  it('keeps the cursor on the backend clock when event clocks disagree', async () => {
    hub.publishSessionEvents([ev(10_000, 'damage')]);
    const first = await hub.wait({ sinceMs: 0, timeoutMs: 1000 });
    const cursor = first.latestMs ?? 0;
    // A play-log turn stamped by the Foundry server clock, older than the session event.
    hub.publishPlayRecords([turnRecord('k9', 9000, 1, 0)]);
    const r = await hub.wait({ sinceMs: cursor, timeoutMs: 1000 });
    expect(r.events.map(e => e.eventType)).toEqual(['combat-turn']);
    expect(r.latestMs).toBeGreaterThan(cursor);
  });

  it('hands out a cursor on a timeout with an empty ring, so the next call misses nothing', async () => {
    const p = hub.wait({ timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    const first = await p;
    expect(first.latestMs).toBe(T0);
    hub.publishSessionEvents([ev(5, 'scene-change', null)]);
    const r = await hub.wait({ sinceMs: first.latestMs ?? 0, timeoutMs: 1000 });
    expect(r.events.map(e => e.eventType)).toEqual(['scene-change']);
  });

  it('refuses unknown event types and lists the known ones', () => {
    expect(() => hub.wait({ eventTypes: ['condition'], timeoutMs: 1000 })).toThrow(
      /Unknown event type "condition".*condition-applied/
    );
  });

  it('answers a cursor call at once even when all waiter slots are taken', async () => {
    hub.publishSessionEvents([ev(1000)]);
    const open = Array.from({ length: MAX_WAITERS }, () => hub.wait({ timeoutMs: 5000 }));
    const r = await hub.wait({ sinceMs: T0 - 1, timeoutMs: 5000 });
    expect(r.events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(open);
  });

  it('keeps a bounded ring', () => {
    hub.publishSessionEvents(Array.from({ length: 700 }, (_, i) => ev(i + 1)));
    return hub.wait({ sinceMs: T0 - 1, timeoutMs: 1000 }).then(r => {
      expect(r.events.length).toBe(50);
      expect(r.events[0].timestampMs).toBe(201);
    });
  });

  it('skips malformed events', async () => {
    const p = hub.wait({ timeoutMs: 1000 });
    hub.publishSessionEvents([
      null,
      { id: 'x' },
      { id: 'y', timestamp: 'nope', eventType: 'roll' },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).endedBy).toBe('timeout');
  });
});

describe('sources', () => {
  it('refuses a wait when the event log is off', () => {
    hub.setSources({ sessionEvents: false, playLog: true });
    expect(() => hub.wait({ timeoutMs: 1000 })).toThrow(/FOUNDRY_AI_EVENT_LOG/);
    expect(() => hub.wait({ eventTypes: ['roll'], timeoutMs: 1000 })).toThrow(/EVENT_LOG/);
  });

  it('refuses combat-turn when the play log is off, but not other types', () => {
    hub.setSources({ sessionEvents: true, playLog: false });
    expect(() => hub.wait({ eventTypes: ['combat-turn'], timeoutMs: 1000 })).toThrow(/PLAY_LOG/);
    const p = hub.wait({ eventTypes: ['roll'], timeoutMs: 10 });
    vi.advanceTimersByTime(10);
    return p;
  });

  it('turns a play-log combat-turn record into an event', async () => {
    const p = hub.wait({ eventTypes: ['combat-turn'], timeoutMs: 5000 });
    hub.publishPlayRecords([
      { ...turnRecord('k0', 500, 1, 0), kind: 'hp' },
      turnRecord('k1', 1000, 2, 1),
    ]);
    const r = await p;
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      id: 'k1',
      eventType: 'combat-turn',
      actorName: 'Wolf 1',
      description: 'Round 2, turn 2: Wolf 1',
    });
    expect(playRecordToGameEvent({ ...turnRecord('k2', 1, 1, 0), kind: 'roll' })).toBeNull();
  });
});
