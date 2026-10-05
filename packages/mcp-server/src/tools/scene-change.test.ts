/**
 * `plan-scene-change` and `play-playlist` (I-112): Foundry and the guarded-write service are
 * stubs; the tests check the request the module gets, the plan the service gets, what the result
 * carries and when it says `autoApply`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LIVE_PLAY_FEATURE_ID,
  SCENE_CHANGE_ACTIONS,
  SCENE_PLAN_QUERY,
  type GuardedOp,
  type SceneChangePlan,
} from '@gnuminator/shared';

import { SceneChangeTools } from './scene-change.js';

function logger(): any {
  const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  l.child = (): unknown => l;
  return l;
}

const OPS: GuardedOp[] = [
  {
    kind: 'create',
    documentName: 'Region',
    parentUuid: 'Scene.s1',
    data: { name: 'Circle Template' },
  },
];

function built(extra: Partial<SceneChangePlan> = {}): SceneChangePlan {
  return {
    summary: 'Place a 20 ft circle template on "Field"',
    ops: OPS,
    sceneId: 's1',
    tokensInside: [{ name: 'Orc 1', actorId: 'a1' }],
    ...extra,
  };
}

let query: ReturnType<typeof vi.fn>;
let createPlan: ReturnType<typeof vi.fn>;
let autoApplyEnabled: ReturnType<typeof vi.fn>;
let tools: SceneChangeTools;

beforeEach(() => {
  query = vi.fn(() => Promise.resolve(built()));
  createPlan = vi.fn((input: { feature: string; summary: string }) =>
    Promise.resolve({
      planId: 'plan-1',
      feature: input.feature,
      summary: input.summary,
      risk: 'write',
      requires: { confirm: true, confirmDestructive: false },
    })
  );
  autoApplyEnabled = vi.fn(() => Promise.resolve(false));
  tools = new SceneChangeTools({
    foundryClient: { query } as any,
    guardedWrites: { createPlan, autoApplyEnabled } as any,
    logger: logger(),
  });
});

describe('definitions', () => {
  it('serves plan-scene-change and play-playlist', () => {
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['plan-scene-change', 'play-playlist']);
    for (const d of defs) expect(d.inputSchema.type).toBe('object');
  });

  it('requires an action, with the shared action enum', () => {
    const def = tools.getToolDefinitions()[0];
    expect(def.inputSchema.required).toEqual(['action']);
    expect((def.inputSchema.properties.action as any).enum).toEqual([...SCENE_CHANGE_ACTIONS]);
    expect(SCENE_CHANGE_ACTIONS).toEqual([
      'template',
      'clear-templates',
      'mood',
      'note',
      'remove-note',
      'loot',
    ]);
  });

  it('tells the caller about autoApply, apply-planned-change, undo-change and Recent Changes', () => {
    const def = tools.getToolDefinitions()[0];
    expect(def.description).toContain('autoApply: true');
    expect(def.description).toContain('apply-planned-change');
    expect(def.description).toContain('undo-change');
    expect(def.description).toContain('Recent Changes');
  });

  it('play-playlist requires a name', () => {
    const def = tools.getToolDefinitions()[1];
    expect(def.inputSchema.required).toEqual(['playlistName']);
  });

  it('has no em dashes', () => {
    const text = JSON.stringify(tools.getToolDefinitions());
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});

describe('plan-scene-change', () => {
  it('asks the module and leaves out keys that were not given', async () => {
    await tools.handlePlanSceneChange({
      action: 'template',
      shape: 'circle',
      distance: 20,
      originTokenName: 'Orc 1',
      fillColor: undefined,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [method, request] = query.mock.calls[0];
    expect(method).toBe(`foundry-mcp-bridge.${SCENE_PLAN_QUERY}`);
    expect(method).toBe('foundry-mcp-bridge.planSceneChange');
    expect(request).toEqual({
      action: 'template',
      shape: 'circle',
      distance: 20,
      originTokenName: 'Orc 1',
    });
    expect(Object.values(request)).not.toContain(undefined);
  });

  it('forwards the fields of every action', async () => {
    const requests = [
      { action: 'clear-templates', templateId: 't1', all: false },
      { action: 'mood', darkness: 0.8, globalLight: true },
      {
        action: 'note',
        text: 'Trap',
        x: 1,
        y: 2,
        tokenName: 'Goblin',
        journalName: 'Lore',
        entryId: 'e1',
        icon: 'icons/svg/skull.svg',
        iconSize: 60,
      },
      { action: 'remove-note', noteId: 'n1', text: 'Trap' },
      {
        action: 'loot',
        targetCharacter: 'Thalindra',
        currency: { gp: 50, sp: 25 },
        itemUuids: ['Compendium.dnd5e.items.Item.abc123'],
        announce: false,
      },
    ];
    for (const request of requests) {
      query.mockClear();
      await tools.handlePlanSceneChange(request);
      expect(query.mock.calls[0][1]).toEqual(request);
    }
  });

  it('stores the module ops as a plan of the live-play feature', async () => {
    await tools.handlePlanSceneChange({
      action: 'template',
      shape: 'circle',
      distance: 20,
      x: 0,
      y: 0,
    });
    expect(createPlan).toHaveBeenCalledWith({
      feature: LIVE_PLAY_FEATURE_ID,
      summary: 'Place a 20 ft circle template on "Field"',
      ops: OPS,
    });
    expect(LIVE_PLAY_FEATURE_ID).toBe('live-play');
  });

  it('returns the plan with tokensInside and autoApply false by default', async () => {
    const result = await tools.handlePlanSceneChange({
      action: 'template',
      shape: 'circle',
      distance: 20,
      x: 0,
      y: 0,
    });
    expect(result).toMatchObject({
      planId: 'plan-1',
      feature: 'live-play',
      risk: 'write',
      tokensInside: [{ name: 'Orc 1', actorId: 'a1' }],
      autoApply: false,
    });
    expect(result).not.toHaveProperty('skippedItems');
    expect(autoApplyEnabled).toHaveBeenCalledWith('live-play');
  });

  it('returns skippedItems for loot', async () => {
    query.mockResolvedValueOnce({
      summary: 'Loot for Rogue: Longsword',
      ops: OPS,
      skippedItems: ['Compendium.gone'],
    });
    const result = await tools.handlePlanSceneChange({
      action: 'loot',
      targetCharacter: 'Rogue',
      itemUuids: ['Compendium.gone'],
    });
    expect(result.skippedItems).toEqual(['Compendium.gone']);
    expect(result).not.toHaveProperty('tokensInside');
  });

  it('says autoApply true when the plan is a write and the switch is on', async () => {
    autoApplyEnabled.mockResolvedValue(true);
    const result = await tools.handlePlanSceneChange({ action: 'mood', darkness: 0.5 });
    expect(result.autoApply).toBe(true);
  });

  it('never says autoApply for a destructive plan (a delete), and does not even ask', async () => {
    autoApplyEnabled.mockResolvedValue(true);
    createPlan.mockResolvedValueOnce({
      planId: 'plan-2',
      feature: 'live-play',
      summary: 'Clear a template on "Field"',
      risk: 'destructive',
      requires: { confirm: true, confirmDestructive: true },
    });
    query.mockResolvedValueOnce({
      summary: 'Clear a template on "Field"',
      ops: [{ kind: 'delete', uuid: 'Scene.s1.Region.r1' }],
      sceneId: 's1',
    });
    const result = await tools.handlePlanSceneChange({ action: 'clear-templates', all: true });
    expect(result.risk).toBe('destructive');
    expect(result.autoApply).toBe(false);
    expect(autoApplyEnabled).not.toHaveBeenCalled();
  });

  it('turns a module refusal into an error and plans nothing', async () => {
    query.mockResolvedValueOnce({ success: false, error: 'GM only' });
    await expect(tools.handlePlanSceneChange({ action: 'mood', darkness: 1 })).rejects.toThrow(
      'Could not plan the change: GM only'
    );
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('passes on an error the module throws and a plan failure', async () => {
    query.mockRejectedValueOnce(new Error('No templates to clear.'));
    await expect(
      tools.handlePlanSceneChange({ action: 'clear-templates', all: true })
    ).rejects.toThrow('No templates to clear.');
    createPlan.mockRejectedValueOnce(new Error('Live play is switched off'));
    await expect(tools.handlePlanSceneChange({ action: 'mood', darkness: 1 })).rejects.toThrow(
      'Live play is switched off'
    );
  });

  it('rejects a missing or unknown action, bad enums and bad numbers without asking Foundry', async () => {
    const bad: unknown[] = [
      {},
      { action: 'explode' },
      { action: 'template', shape: 'sphere', distance: 5 },
      { action: 'mood', darkness: 1.5 },
      { action: 'mood', darkness: -0.1 },
      { action: 'loot', currency: { gp: -50 } },
      { action: 'loot', currency: { sp: 1.5 } },
      { action: 'loot', announce: 'yes' },
      { action: 'loot', itemUuids: 'not-an-array' },
      undefined,
    ];
    for (const args of bad) {
      await expect(tools.handlePlanSceneChange(args), JSON.stringify(args)).rejects.toThrow();
    }
    expect(query).not.toHaveBeenCalled();
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('declares coins as whole numbers of 0 or more (P-060)', () => {
    const def = tools.getToolDefinitions()[0];
    expect((def.inputSchema.properties.currency as any).properties.gp).toMatchObject({
      type: 'integer',
      minimum: 0,
    });
  });
});

describe('play-playlist', () => {
  it('calls the module directly (nothing to plan) and returns its answer', async () => {
    const payload = { success: true, playlist: 'play "Tavern"' };
    query.mockResolvedValueOnce(payload);
    const result = await tools.handlePlayPlaylist({ playlistName: 'Tavern', action: 'play' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.playPlaylist', {
      playlistName: 'Tavern',
      action: 'play',
    });
    expect(result).toBe(payload);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('leaves the action out when it was not given', async () => {
    query.mockResolvedValueOnce({ success: true });
    await tools.handlePlayPlaylist({ playlistName: 'Battle' });
    expect(query.mock.calls[0][1]).toEqual({ playlistName: 'Battle' });
  });

  it('throws a module refusal and rejects a missing name or a bad action', async () => {
    query.mockResolvedValueOnce({ success: false, error: 'no GM' });
    await expect(tools.handlePlayPlaylist({ playlistName: 'x' })).rejects.toThrow(
      'Could not change the playlist: no GM'
    );
    query.mockClear();
    await expect(tools.handlePlayPlaylist({})).rejects.toThrow();
    await expect(
      tools.handlePlayPlaylist({ playlistName: 'x', action: 'pause' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
