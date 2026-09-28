/**
 * The module mirrors the runtime values of the player-view contract (the
 * browser cannot resolve `@gnuminator/shared`). This pins the copies to the
 * shared contract so the two cannot drift.
 */
import { describe, expect, it } from 'vitest';
import {
  PLAYER_VIEW_QUERIES as MODULE_QUERIES,
  UNKNOWN_CREATURE as MODULE_UNKNOWN_CREATURE,
  UNKNOWN_SCENE as MODULE_UNKNOWN_SCENE,
} from './player-visibility.js';
import {
  PLAYER_VIEW_QUERIES as SHARED_QUERIES,
  UNKNOWN_CREATURE as SHARED_UNKNOWN_CREATURE,
  UNKNOWN_SCENE as SHARED_UNKNOWN_SCENE,
} from '../../../shared/src/player-view.js';

describe('player-view wire contract', () => {
  it('module and shared agree on the query names', () => {
    expect(MODULE_QUERIES).toEqual(SHARED_QUERIES);
  });

  it('module and shared agree on the player-facing fallback labels', () => {
    expect(MODULE_UNKNOWN_CREATURE).toBe(SHARED_UNKNOWN_CREATURE);
    expect(MODULE_UNKNOWN_SCENE).toBe(SHARED_UNKNOWN_SCENE);
  });
});
