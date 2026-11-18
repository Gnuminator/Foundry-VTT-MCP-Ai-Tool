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

describe('speakingOf', () => {
  it('reads times only while recording and drops bad entries', () => {
    const answer = {
      recording: true,
      problems: [],
      speaking: [{ name: 'Ebbe', ms: 1234.4 }, { name: 5, ms: 1 }, null, { name: 'x', ms: 0 }],
    };
    expect(speakingOf(answer)).toEqual([{ name: 'Ebbe', ms: 1234 }]);
    expect(speakingOf({ ...answer, recording: false })).toEqual([]);
    expect(speakingOf(null)).toEqual([]);
  });
});
