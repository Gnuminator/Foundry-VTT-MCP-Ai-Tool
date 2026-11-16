import { describe, expect, it } from 'vitest';

import type { ModuleError, SessionEvent } from './feed/types.js';
import { GameState } from './state.js';

const event = (id: string): SessionEvent =>
  ({
    id,
    timestampMs: 1,
    type: 'chat',
    timestamp: '2026-01-01T00:00:00Z',
  }) as unknown as SessionEvent;
const error = (id: string): ModuleError =>
  ({ id, timestampMs: 1, level: 'error', message: 'x' }) as unknown as ModuleError;

describe('GameState.reset', () => {
  it('forgets events, errors and combat, and accepts the same ids again', () => {
    const state = new GameState();
    state.addEvents([event('e1')]);
    state.addErrors([error('d1')]);
    state.setCombat({ active: true, round: 1, turn: 0, current: null, combatants: [] });

    state.reset();

    expect(state.recentEvents).toEqual([]);
    expect(state.recentErrors).toEqual([]);
    expect(state.combat).toBeNull();
    expect(state.addEvents([event('e1')])).toHaveLength(1);
    expect(state.addErrors([error('d1')])).toHaveLength(1);
  });
});
