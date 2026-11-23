import { describe, expect, it } from 'vitest';

import type { SessionEvent } from './feed/types.js';
import { GameState } from './state.js';
import { speakingOf } from './recording-health.js';

function ev(
  id: string,
  eventType: string,
  actorName: string | null,
  subject: 'pc' | 'npc' | null
): SessionEvent {
  return {
    id,
    timestamp: '2026-11-18T19:00:00.000Z',
    timestampMs: 0,
    eventType,
    actorName,
    actorId: actorName,
    description: '',
    details: {},
    visibility: { subject, tokenVisible: true, playerName: actorName },
  };
}

describe('SpotlightTally', () => {
  it('counts actions of player characters only, once per event', () => {
    const state = new GameState(2);
    state.addEvents([
      ev('1', 'roll', 'Ebbe', 'pc'),
      ev('2', 'item-use', 'Ebbe', 'pc'),
      ev('3', 'roll', 'Strahd', 'npc'),
      ev('4', 'healing', 'Mira', 'pc'),
      ev('5', 'gm-roll', 'Mira', 'pc'),
    ]);
    state.addEvents([ev('1', 'roll', 'Ebbe', 'pc')]);
    // The window kept only 2 events, the tally kept counting.
    expect(state.spotlight.snapshot().players).toEqual([
      { name: 'Ebbe', actions: 2 },
      { name: 'Mira', actions: 1 },
    ]);
  });

  it('starts again for a new world', () => {
    const state = new GameState();
    state.addEvents([ev('1', 'roll', 'Ebbe', 'pc')]);
    state.reset();
    expect(state.spotlight.snapshot().players).toEqual([]);
  });
});

describe('SpotlightTally per play session', () => {
  const at = (id: string, ms: number, name: string): SessionEvent => ({
    ...ev(id, 'roll', name, 'pc'),
    timestampMs: ms,
  });

  it('counts from the session start and starts over for a new session', () => {
    const state = new GameState();
    state.addEvents([at('1', 100, 'Ebbe'), at('2', 200, 'Ebbe'), at('3', 300, 'Mira')]);
    expect(state.spotlight.snapshot().session).toBe(false);
    expect(state.spotlight.setSessionStart(150)).toBe(true);
    expect(state.spotlight.snapshot()).toEqual({
      players: [
        { name: 'Ebbe', actions: 1 },
        { name: 'Mira', actions: 1 },
      ],
      session: true,
    });
    // A newer session: the earlier one's actions are gone from the card.
    state.spotlight.setSessionStart(250);
    expect(state.spotlight.snapshot().players).toEqual([{ name: 'Mira', actions: 1 }]);
    expect(state.spotlight.setSessionStart(250)).toBe(false);
  });

  it('a restart mid-session counts the same events again, no more and no fewer', () => {
    const log = [at('1', 50, 'Ebbe'), at('2', 120, 'Ebbe'), at('3', 130, 'Mira')];
    const before = new GameState();
    before.spotlight.setSessionStart(100);
    before.addEvents(log);
    const restarted = new GameState();
    // The log is read again before the session marker is: the order does not matter.
    restarted.addEvents(log);
    restarted.spotlight.setSessionStart(100);
    expect(restarted.spotlight.snapshot()).toEqual(before.spotlight.snapshot());
    expect(restarted.spotlight.snapshot().players).toEqual([
      { name: 'Ebbe', actions: 1 },
      { name: 'Mira', actions: 1 },
    ]);
  });

  it('forgets the session on a new world', () => {
    const state = new GameState();
    state.spotlight.setSessionStart(100);
    state.reset();
    expect(state.spotlight.snapshot().session).toBe(false);
  });
});

describe('speakingOf', () => {
  it('reads times only while recording and drops bad entries', () => {
    const answer = {
      recording: true,
      problems: [],
      speaking: [{ name: 'Ebbe', ms: 1234.4 }, { name: 5, ms: 1 }, null, { name: 'x', ms: 0 }],
    };
    // Whole seconds, so the page is not redrawn for every 20 ms of speech.
    expect(speakingOf(answer)).toEqual([{ name: 'Ebbe', ms: 1000 }]);
    expect(speakingOf({ ...answer, recording: false })).toEqual([]);
    expect(speakingOf(null)).toEqual([]);
  });
});
