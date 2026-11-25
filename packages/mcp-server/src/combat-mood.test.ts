/**
 * Combat mood (idea 1.14): the service reads combat-start and combat-end session events, applies
 * the scene's "Combat" preset while the feature is on and restores the look when the fight ends.
 * Foundry and the guarded-write service are stubs.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { COMBAT_MOOD_FEATURE_ID, type GuardedOp } from '@gnuminator/shared';

import { CombatMoodService } from './combat-mood.js';
import { makeLogger } from './test-support/make-tool-harness.js';

const NOW = 1_000_000;
const OPS: GuardedOp[] = [{ kind: 'update', uuid: 'Scene.s1', changes: { weather: 'fog' } }];

let enabled: boolean;
let viewedScene: string;
let presetMissing: boolean;
let query: Mock;
let createPlan: Mock;
let applyPlan: Mock;
let undo: Mock;
let service: CombatMoodService;
let seq: number;

const logger = makeLogger();

function event(type: 'combat-start' | 'combat-end', over: Record<string, unknown> = {}): unknown {
  seq += 1;
  return {
    id: `e${seq}`,
    eventType: type,
    timestampMs: NOW - 1000,
    details: { combatId: 'c1', sceneId: 's1' },
    ...over,
  };
}

beforeEach(() => {
  enabled = true;
  viewedScene = 's1';
  presetMissing = false;
  seq = 0;
  query = vi.fn((method: string, request?: { action?: string }) => {
    if (method === 'foundry-mcp-bridge.listGuardedFeatures') {
      return Promise.resolve([{ id: COMBAT_MOOD_FEATURE_ID, enabled }]);
    }
    if (method === 'foundry-mcp-bridge.getSceneMoods') {
      return Promise.resolve({
        sceneId: viewedScene,
        sceneName: 'Crypt',
        presets: [],
        current: { darkness: 0.2, globalLight: false, weather: '' },
        playlists: [{ name: 'Tavern', sounds: 2, playing: true }],
      });
    }
    if (method === 'foundry-mcp-bridge.planSceneMood') {
      if (request?.action === 'apply' && presetMissing) {
        return Promise.reject(new Error('No mood preset "Combat"'));
      }
      return Promise.resolve({ summary: `plan ${request?.action}`, ops: OPS, sceneId: 's1' });
    }
    return Promise.resolve(null);
  });
  createPlan = vi.fn(
    (input: { summary: string }): Promise<unknown> =>
      Promise.resolve({ planId: `p${createPlan.mock.calls.length}`, summary: input.summary })
  );
  applyPlan = vi.fn((): Promise<unknown> => Promise.resolve({ changeId: 'chg1' }));
  undo = vi.fn((): Promise<unknown> => Promise.resolve({ changeId: 'undo1' }));
  service = new CombatMoodService({
    foundryClient: { query },
    guardedWrites: { createPlan, applyPlan, undo },
    logger,
    now: (): number => NOW,
  });
});

describe('combat mood', () => {
  it('applies the Combat preset on start and undoes it on end', async () => {
    service.onEvents([event('combat-start')]);
    await service.idle();
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.planSceneMood', {
      action: 'apply',
      preset: 'Combat',
    });
    expect(createPlan).toHaveBeenCalledWith({
      feature: COMBAT_MOOD_FEATURE_ID,
      summary: 'Combat started: plan apply',
      ops: OPS,
    });
    expect(applyPlan).toHaveBeenCalledWith('p1', { confirm: true }, 'Combat mood');

    service.onEvents([event('combat-end')]);
    await service.idle();
    expect(undo).toHaveBeenCalledWith('chg1', { confirm: true }, 'Combat mood');
  });

  it('does nothing while the switch is off', async () => {
    enabled = false;
    service.onEvents([event('combat-start')]);
    await service.idle();
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('leaves a scene without a Combat preset alone, and its end does nothing', async () => {
    presetMissing = true;
    service.onEvents([event('combat-start')]);
    await service.idle();
    service.onEvents([event('combat-end')]);
    await service.idle();
    expect(createPlan).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it('ignores a fight on a scene that is not in view', async () => {
    viewedScene = 's2';
    service.onEvents([event('combat-start')]);
    await service.idle();
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('ignores an old event (a replay) and a repeated one', async () => {
    const old = event('combat-start', { timestampMs: NOW - 10 * 60 * 1000 });
    const fresh = event('combat-start');
    service.onEvents([old, fresh, fresh]);
    await service.idle();
    expect(applyPlan).toHaveBeenCalledTimes(1);
  });

  it('still restores when the end event arrives late', async () => {
    service.onEvents([event('combat-start')]);
    service.onEvents([event('combat-end', { timestampMs: NOW - 60 * 60 * 1000 })]);
    await service.idle();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('only restores for the fight it started', async () => {
    service.onEvents([event('combat-start')]);
    service.onEvents([event('combat-end', { details: { combatId: 'other', sceneId: 's1' } })]);
    await service.idle();
    expect(undo).not.toHaveBeenCalled();
  });

  it('sets the earlier look back when the Undo conflicts', async () => {
    undo.mockRejectedValueOnce(new Error('Conflict, nothing was written'));
    service.onEvents([event('combat-start')]);
    service.onEvents([event('combat-end')]);
    await service.idle();
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.planSceneMood', {
      action: 'set',
      darkness: 0.2,
      globalLight: false,
      weather: 'none',
      playlist: 'Tavern',
    });
    expect(createPlan).toHaveBeenLastCalledWith({
      feature: COMBAT_MOOD_FEATURE_ID,
      summary: 'Combat ended: plan set',
      ops: OPS,
    });
    expect(applyPlan).toHaveBeenCalledTimes(2);
  });

  it('does not set a look on another scene when the Undo conflicts', async () => {
    undo.mockRejectedValueOnce(new Error('Conflict'));
    service.onEvents([event('combat-start')]);
    await service.idle();
    viewedScene = 's2';
    service.onEvents([event('combat-end')]);
    await service.idle();
    expect(applyPlan).toHaveBeenCalledTimes(1);
  });

  it('never throws on bad input', async () => {
    service.onEvents([null, 'x', {}, { eventType: 'combat-start', id: 'z' }]);
    await service.idle();
    expect(createPlan).not.toHaveBeenCalled();
  });
});
