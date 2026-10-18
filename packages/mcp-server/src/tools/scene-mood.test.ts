/**
 * `plan-scene-mood` and `list-scene-moods` (I-034, I-129): Foundry and the guarded-write service
 * are stubs; the tests check the switch check, the request the module gets and the plan stored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SCENE_MOOD_FEATURE_ID, type GuardedOp } from '@gnuminator/shared';

import { SceneMoodTools } from './scene-mood.js';

function logger(): any {
  const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  l.child = (): unknown => l;
  return l;
}

const OPS: GuardedOp[] = [{ kind: 'update', uuid: 'Scene.s1', changes: { weather: 'rain' } }];

let enabled: boolean;
let query: ReturnType<typeof vi.fn>;
let createPlan: ReturnType<typeof vi.fn>;
let tools: SceneMoodTools;

beforeEach(() => {
  enabled = true;
  query = vi.fn((method: string) => {
    if (method === 'foundry-mcp-bridge.listGuardedFeatures') {
      return Promise.resolve([{ id: SCENE_MOOD_FEATURE_ID, enabled }]);
    }
    if (method === 'foundry-mcp-bridge.planSceneMood') {
      return Promise.resolve({ summary: 'Set rain', ops: OPS, sceneId: 's1' });
    }
    return Promise.resolve({ sceneId: 's1', presets: [], playlists: [] });
  });
  createPlan = vi.fn((input: { feature: string; summary: string }) =>
    Promise.resolve({ planId: 'p1', feature: input.feature, summary: input.summary, risk: 'write' })
  );
  tools = new SceneMoodTools({
    foundryClient: { query },
    guardedWrites: { createPlan },
    logger: logger(),
  });
});

describe('plan-scene-mood', () => {
  it('sends only the given fields and stores the plan under the scene-mood feature', async () => {
    const result: any = await tools.handleToolCall('plan-scene-mood', {
      action: 'set',
      weather: 'rain',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.planSceneMood', {
      action: 'set',
      weather: 'rain',
    });
    expect(createPlan).toHaveBeenCalledWith({
      feature: SCENE_MOOD_FEATURE_ID,
      summary: 'Set rain',
      ops: OPS,
    });
    expect(result).toMatchObject({ planId: 'p1', autoApply: false });
  });

  it('says how to switch it on while it is off, and plans nothing', async () => {
    enabled = false;
    await expect(tools.handleToolCall('plan-scene-mood', { action: 'set' })).rejects.toThrow(
      /switched off.*Scene mood and music/
    );
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('rejects darkness outside 0 to 1', async () => {
    await expect(
      tools.handleToolCall('plan-scene-mood', { action: 'set', darkness: 2 })
    ).rejects.toThrow();
  });
});

describe('list-scene-moods', () => {
  it('reads without needing the switch', async () => {
    enabled = false;
    await expect(tools.handleToolCall('list-scene-moods', {})).resolves.toMatchObject({
      sceneId: 's1',
    });
  });
});
