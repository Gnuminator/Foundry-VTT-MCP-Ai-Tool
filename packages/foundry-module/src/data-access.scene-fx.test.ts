/**
 * Characterization tests for the `scene-fx` domain of `FoundryDataAccess`:
 *   - placeMeasuredTemplate  (+ the private tokensInTemplate geometry)
 *   - setSceneMood
 *   - addMapNote
 *   - dropLoot
 *   - deleteMeasuredTemplate
 *   - deleteMapNote
 *
 * These pin the *current* behaviour so the Phase 9 from-scratch rewrite of
 * `scene-fx.ts` can be verified to parity. Despite the "needs canvas" note in the
 * coverage map, none of these methods actually require a live canvas: the AoE
 * geometry is pure math over `scene.grid`/`scene.tokens`, and template/note/item
 * creation goes through the document `createEmbeddedDocuments` surface the harness
 * already provides. (None of these methods gate on a write permission, either —
 * there is no ACCESS_DENIED path to pin.)
 *
 * Driven through the Phase 9 Foundry-mock harness (in-memory, no browser).
 *
 * Harness gaps worked around locally (never editing shared harness files):
 *   - `game.playlists` is empty; `setSceneMood` needs a playlist with
 *     `playAll`/`stopAll`, so one is pushed onto `world.playlists` with `vi.fn()`
 *     stubs.
 *   - `globalThis.fromUuid` returns null by default; the `dropLoot` item path is
 *     exercised by overriding it locally to return a doc with `toObject()`.
 *   - `game.version` is overridden to a pre-v13 value to pin the legacy
 *     darkness/globalLight schema branch in `setSceneMood`.
 *   - Grid is supplied via rest-spread (`grid: { size, distance }`) so the
 *     pixels-per-unit math is deterministic (px = size / distance).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from './constants.js';
import { createTestWorld, makeToken, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

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

/** Add a scene with a deterministic grid (px-per-unit = size / distance) + tokens. */
function sceneWith(tokens: any[], grid = { size: 100, distance: 5 }): any {
  const scene = world.addScene({ id: 'scene1', name: 'Field', active: true, tokens, grid });
  world.setActiveScene(scene.id);
  return scene;
}

// ===========================================================================
// placeMeasuredTemplate — origin resolution + result shape
// ===========================================================================

describe('FoundryDataAccess — placeMeasuredTemplate: origin + shape', () => {
  it('throws SCENE_NOT_FOUND when there is no active scene', async () => {
    await expect(
      da.placeMeasuredTemplate({ shape: 'circle', distance: 10, x: 0, y: 0 })
    ).rejects.toThrow(ERROR_MESSAGES.SCENE_NOT_FOUND);
  });

  it('places a template at explicit x/y and returns the result shape', async () => {
    const scene = sceneWith([]);

    const result = await da.placeMeasuredTemplate({
      shape: 'circle',
      distance: 15,
      x: 300,
      y: 400,
    });

    expect(result.success).toBe(true);
    expect(result.shape).toBe('circle');
    expect(result.origin).toEqual({ x: 300, y: 400 });
    expect(result.distance).toBe(15);
    expect(result.tokensInside).toEqual([]);
    // the template was created on the scene
    expect(scene.templates.size).toBe(1);
    expect(result.templateId).toBe(scene.templates.contents[0].id);
  });

  it('derives the origin from a named token (its center)', async () => {
    // token at (200,200), width/height 1, grid size 100 → center (250,250)
    sceneWith([makeToken({ id: 't1', name: 'Mage', x: 200, y: 200 })]);

    const result = await da.placeMeasuredTemplate({
      shape: 'circle',
      distance: 5,
      originTokenName: 'mage',
    });

    expect(result.origin).toEqual({ x: 250, y: 250 });
  });

  it('throws when neither x/y nor a resolvable origin token is given', async () => {
    sceneWith([]);

    await expect(
      da.placeMeasuredTemplate({ shape: 'circle', distance: 5, originTokenName: 'ghost' })
    ).rejects.toThrow('Provide x/y or a valid originTokenName.');
  });

  // NOTE: each default is checked on its own fresh scene with a single template.
  // The harness's `randomId('measuredtemplate')` uses a 16-char prefix, so the
  // counter digit is sliced off and repeated auto-ids collide — creating several
  // auto-id templates in one scene would overwrite all but the last.
  it('cone defaults its angle (CONFIG.MeasuredTemplate.defaults.angle fallback 53.13)', async () => {
    const scene = sceneWith([]);
    await da.placeMeasuredTemplate({ shape: 'cone', distance: 10, x: 0, y: 0 });
    expect(scene.templates.contents[0].angle).toBeCloseTo(53.13);
  });

  it('ray defaults its width to 5', async () => {
    const scene = sceneWith([]);
    await da.placeMeasuredTemplate({ shape: 'ray', distance: 10, x: 0, y: 0 });
    expect(scene.templates.contents[0].width).toBe(5);
  });

  it('rect defaults its direction to 45 when none is supplied', async () => {
    const scene = sceneWith([]);
    await da.placeMeasuredTemplate({ shape: 'rect', distance: 10, x: 0, y: 0 });
    expect(scene.templates.contents[0].direction).toBe(45);
  });
});

// ===========================================================================
// placeMeasuredTemplate — tokensInTemplate geometry (px = size/distance = 20)
// ===========================================================================

describe('FoundryDataAccess — placeMeasuredTemplate: geometry', () => {
  it('circle: includes tokens within the radius, excludes those outside', async () => {
    sceneWith([
      makeToken({ id: 'near', name: 'Near', x: 150, y: 150 }), // center (200,200)
      makeToken({ id: 'far', name: 'Far', x: 1000, y: 1000 }), // center (1050,1050)
    ]);

    const result = await da.placeMeasuredTemplate({
      shape: 'circle',
      distance: 5,
      x: 200,
      y: 200,
    });

    expect(result.tokensInside.map((t: any) => t.name)).toEqual(['Near']);
  });

  it('cone: includes tokens within the arc, excludes those outside it', async () => {
    sceneWith([
      makeToken({ id: 'front', name: 'Front', x: 250, y: 150 }), // center (300,200) — ahead
      makeToken({ id: 'side', name: 'Side', x: 150, y: 350 }), // center (200,400) — 90° off
    ]);

    const result = await da.placeMeasuredTemplate({
      shape: 'cone',
      distance: 10,
      x: 200,
      y: 200,
      direction: 0,
      angle: 90,
    });

    expect(result.tokensInside.map((t: any) => t.name)).toEqual(['Front']);
  });

  it('ray: includes tokens on the line within its width, excludes those beside it', async () => {
    sceneWith([
      makeToken({ id: 'on', name: 'OnRay', x: 350, y: 150 }), // center (400,200) — on axis
      makeToken({ id: 'off', name: 'OffRay', x: 350, y: 250 }), // center (400,300) — 5 units off
    ]);

    const result = await da.placeMeasuredTemplate({
      shape: 'ray',
      distance: 10,
      x: 200,
      y: 200,
      direction: 0,
      width: 5,
    });

    expect(result.tokensInside.map((t: any) => t.name)).toEqual(['OnRay']);
  });

  it('rect: includes tokens within the diagonal box (default 45° direction)', async () => {
    sceneWith([
      makeToken({ id: 'in', name: 'InBox', x: 250, y: 250 }), // center (300,300)
      makeToken({ id: 'out', name: 'OutBox', x: 350, y: 350 }), // center (400,400)
    ]);

    const result = await da.placeMeasuredTemplate({ shape: 'rect', distance: 10, x: 200, y: 200 });

    expect(result.tokensInside.map((t: any) => t.name)).toEqual(['InBox']);
  });
});

// ===========================================================================
// setSceneMood
// ===========================================================================

describe('FoundryDataAccess — setSceneMood', () => {
  it('throws SCENE_NOT_FOUND when there is no active scene', async () => {
    await expect(da.setSceneMood({ darkness: 0.5 })).rejects.toThrow(
      ERROR_MESSAGES.SCENE_NOT_FOUND
    );
  });

  it('v13+: writes environment.* keys, clamps darkness to [0,1], echoes raw input', async () => {
    const scene = sceneWith([]); // harness version 13.331 → v13+
    const result = await da.setSceneMood({ darkness: 2, globalLight: true });

    // clamped to 1 on the document, but the response echoes the raw requested value
    expect(scene.environment.darknessLevel).toBe(1);
    expect(scene.environment.globalLight.enabled).toBe(true);
    expect(result).toEqual({
      success: true,
      sceneId: 'scene1',
      darkness: 2,
      globalLight: true,
      playlist: null,
    });
  });

  it('pre-v13: writes the legacy flat darkness/globalLight keys', async () => {
    const scene = sceneWith([]);
    // coreGeneration() prefers game.release.generation over game.version, so
    // simulate pre-v13 the same way the v14 tests below simulate v14.
    (globalThis as any).game.release = { generation: 12, build: 331 };
    (globalThis as any).game.version = '12.331';

    await da.setSceneMood({ darkness: 0.3, globalLight: false });

    expect(scene.darkness).toBe(0.3);
    expect(scene.globalLight).toBe(false);
    expect(scene.environment).toBeUndefined();
  });

  it('v14.368 #14718: resends the current darknessLock alongside a darkness change so it is not dropped', async () => {
    const scene = sceneWith([]);
    await scene.update({ 'environment.darknessLock': true });

    await da.setSceneMood({ darkness: 0.7 });

    expect(scene.environment.darknessLevel).toBe(0.7);
    expect(scene.environment.darknessLock).toBe(true);
  });

  it('does not send darknessLock when the scene is not locked', async () => {
    const scene = sceneWith([]);

    await da.setSceneMood({ darkness: 0.4 });

    expect(scene.environment.darknessLevel).toBe(0.4);
    expect(scene.environment.darknessLock).toBeUndefined();
  });

  it('plays a named playlist and reports the action', async () => {
    sceneWith([]);
    const playAll = vi.fn(() => Promise.resolve());
    const stopAll = vi.fn(() => Promise.resolve());
    world.playlists.add({ id: 'pl1', name: 'Tavern', playAll, stopAll } as any);

    const result = await da.setSceneMood({ playlistName: 'tavern' });

    expect(playAll).toHaveBeenCalledTimes(1);
    expect(stopAll).not.toHaveBeenCalled();
    expect(result.playlist).toBe('play "Tavern"');
  });

  it('stops a named playlist when playlistAction is stop', async () => {
    sceneWith([]);
    const playAll = vi.fn(() => Promise.resolve());
    const stopAll = vi.fn(() => Promise.resolve());
    world.playlists.add({ id: 'pl1', name: 'Battle', playAll, stopAll } as any);

    const result = await da.setSceneMood({ playlistName: 'Battle', playlistAction: 'stop' });

    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(result.playlist).toBe('stop "Battle"');
  });

  it('reports a not-found playlist without throwing', async () => {
    sceneWith([]);
    const result = await da.setSceneMood({ playlistName: 'Nonexistent' });

    expect(result.playlist).toBe('Playlist not found: Nonexistent');
  });
});

// ===========================================================================
// addMapNote
// ===========================================================================

describe('FoundryDataAccess — addMapNote', () => {
  it('throws SCENE_NOT_FOUND when there is no active scene', async () => {
    await expect(da.addMapNote({ x: 10, y: 20 })).rejects.toThrow(ERROR_MESSAGES.SCENE_NOT_FOUND);
  });

  it('creates a note at explicit x/y with default icon/size and the expected result shape', async () => {
    const scene = sceneWith([]);

    const result = await da.addMapNote({ x: 120, y: 240, text: 'Trap!' });

    expect(result).toEqual({
      success: true,
      noteId: scene.notes.contents[0].id,
      x: 120,
      y: 240,
      entryId: null,
      text: 'Trap!',
    });
    const note = scene.notes.contents[0];
    expect(note.iconSize).toBe(40);
    expect(note.texture).toEqual({ src: 'icons/svg/book.svg' });
  });

  it("uses a named token's position (x/y, not center)", async () => {
    sceneWith([makeToken({ id: 't1', name: 'Captain', x: 333, y: 444 })]);

    const result = await da.addMapNote({ tokenName: 'captain', text: 'Here' });

    expect(result.x).toBe(333);
    expect(result.y).toBe(444);
  });

  it('throws when neither x/y nor a resolvable token is given', async () => {
    sceneWith([]);
    await expect(da.addMapNote({ tokenName: 'ghost', text: 'x' })).rejects.toThrow(
      'Provide x/y or a valid tokenName.'
    );
  });

  it('resolves entryId from a journal name', async () => {
    sceneWith([]);
    world.addJournal({ id: 'j1', name: 'The Lore' });

    const result = await da.addMapNote({ x: 0, y: 0, journalName: 'the lore' });

    expect(result.entryId).toBe('j1');
  });

  it('v14 Scene Levels: lands the note on the current level (Note#levels)', async () => {
    const scene = sceneWith([]);
    scene.levels = { contents: [{ id: 'lvl1' }] };
    scene.initialLevel = 'lvl1';

    await da.addMapNote({ x: 0, y: 0, text: 'Pin' });

    expect(scene.notes.contents[0].levels).toEqual(['lvl1']);
  });

  it('v13 (no Scene Levels): does not set Note#levels', async () => {
    const scene = sceneWith([]);

    await da.addMapNote({ x: 0, y: 0, text: 'Pin' });

    expect(scene.notes.contents[0].levels).toBeUndefined();
  });
});

// ===========================================================================
// dropLoot
// ===========================================================================

describe('FoundryDataAccess — dropLoot', () => {
  it('throws when a named target cannot be resolved', async () => {
    await expect(da.dropLoot({ targetCharacter: 'ghost' })).rejects.toThrow(
      'Target not found: ghost'
    );
  });

  it('adds currency to the target (additive over existing) and builds the summary', async () => {
    const actor = world.addActor({
      id: 'a1',
      name: 'Rogue',
      system: { currency: { gp: 10, sp: 0 } },
    });

    const result = await da.dropLoot({
      targetCharacter: 'Rogue',
      currency: { gp: 5, sp: 3 },
      announce: false,
    });

    expect(actor.system.currency.gp).toBe(15); // 10 + 5
    expect(actor.system.currency.sp).toBe(3); // 0 + 3
    expect(result.target).toBe('Rogue');
    expect(result.summary).toBe('5 gp, 3 sp');
  });

  it('adds items resolved via fromUuid and lists them in itemsAdded', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Fighter', system: { currency: {} } });
    (globalThis as any).fromUuid = async () => ({
      toObject: () => ({ _id: 'orig', name: 'Longsword', type: 'weapon' }),
    });

    const result = await da.dropLoot({
      targetCharacter: 'Fighter',
      itemUuids: ['Compendium.x.y'],
      announce: false,
    });

    expect(result.itemsAdded).toEqual(['Longsword']);
    expect(actor.items.size).toBe(1);
    expect(actor.items.contents[0].name).toBe('Longsword');
  });

  it('announces the loot in chat by default', async () => {
    world.addActor({ id: 'a1', name: 'Cleric', system: { currency: {} } });
    const before = world.messages.size;

    await da.dropLoot({ targetCharacter: 'Cleric', currency: { gp: 100 } });

    expect(world.messages.size).toBe(before + 1);
  });

  it('suppresses the chat announcement when announce is false', async () => {
    world.addActor({ id: 'a1', name: 'Bard', system: { currency: {} } });
    const before = world.messages.size;

    await da.dropLoot({ targetCharacter: 'Bard', currency: { gp: 1 }, announce: false });

    expect(world.messages.size).toBe(before);
  });

  it('works with no target (announce-only) — target null', async () => {
    const result = await da.dropLoot({ currency: { gp: 50 }, announce: false });

    expect(result.target).toBeNull();
    expect(result.summary).toBe('50 gp');
  });
});

// ===========================================================================
// deleteMeasuredTemplate
// ===========================================================================

// M3: MeasuredTemplate documents were removed in Foundry 14.352 (#13089);
// templates are Regions there (`systems/regions.ts`). Simulated the same way
// the rest of this codebase simulates v14: no `foundry.documents.BaseMeasuredTemplate`
// (supportsMeasuredTemplates() false), but `foundry.documents.BaseRegion` present
// (Region has existed since 14.352, verified `common/documents/region.mjs`).
describe('FoundryDataAccess — AoE templates on Foundry 14 (Region-backed)', () => {
  beforeEach(() => {
    (globalThis as any).game.release = { generation: 14, build: 368 };
    (globalThis as any).foundry.documents = { BaseRegion: class {} };
  });

  it('placeMeasuredTemplate creates a flagged Region, not a MeasuredTemplate', async () => {
    const scene = sceneWith([]);

    const result = await da.placeMeasuredTemplate({
      shape: 'circle',
      distance: 15,
      x: 300,
      y: 400,
    });

    expect(result.success).toBe(true);
    expect(scene.templates.size).toBe(0);
    expect(scene.regions.size).toBe(1);
    const region = scene.regions.contents[0];
    expect(result.templateId).toBe(region.id);
    expect(result.regionId).toBe(region.id);
    // px-per-unit = grid.size / grid.distance = 100 / 5 = 20 (sceneWith default).
    expect(region.shapes).toEqual([{ type: 'circle', x: 300, y: 400, radius: 300 }]);
    expect(region.flags['foundry-mcp-bridge'].template).toEqual({
      shape: 'circle',
      distance: 15,
      direction: 0,
    });
    // CONST.REGION_VISIBILITY isn't in the harness's CONST fixture; the code
    // falls back to the real value (common/constants.mjs REGION_VISIBILITY.ALWAYS = 2).
    expect(region.visibility).toBe(2);
  });

  it('maps cone/ray/rect to cone/line/rectangle Region shapes', async () => {
    const scene = sceneWith([]);

    await da.placeMeasuredTemplate({
      shape: 'cone',
      distance: 10,
      x: 0,
      y: 0,
      angle: 90,
      direction: 30,
    });
    expect(scene.regions.contents[0].shapes[0]).toMatchObject({
      type: 'cone',
      radius: 200,
      angle: 90,
      rotation: 30,
      curvature: 'round',
    });

    await da.placeMeasuredTemplate({ shape: 'ray', distance: 10, x: 0, y: 0 });
    expect(scene.regions.contents[1].shapes[0]).toMatchObject({
      type: 'line',
      length: 200,
      width: 100, // default ray width 5 * px 20
      rotation: 0,
    });

    await da.placeMeasuredTemplate({ shape: 'rect', distance: 10, x: 0, y: 0 });
    expect(scene.regions.contents[2].shapes[0]).toMatchObject({
      type: 'rectangle',
      width: 200,
      height: 200,
      anchorX: 0,
      anchorY: 0,
      rotation: 45, // rect's default direction, unchanged from the v13 path
    });
  });

  it('still computes token coverage from the request geometry (not the Region shape)', async () => {
    sceneWith([
      makeToken({ id: 'near', name: 'Near', x: 150, y: 150 }), // center (200,200)
      makeToken({ id: 'far', name: 'Far', x: 1000, y: 1000 }),
    ]);

    const result = await da.placeMeasuredTemplate({ shape: 'circle', distance: 5, x: 200, y: 200 });

    expect(result.tokensInside.map((t: any) => t.name)).toEqual(['Near']);
  });

  it('v14 Scene Levels: sets Region#levels to the current level', async () => {
    const scene = sceneWith([]);
    scene.levels = { contents: [{ id: 'lvl1' }] };
    scene.initialLevel = 'lvl1';

    await da.placeMeasuredTemplate({ shape: 'circle', distance: 5, x: 0, y: 0 });

    expect(scene.regions.contents[0].levels).toEqual(['lvl1']);
  });

  it('deleteMeasuredTemplate by id deletes the Region', async () => {
    const scene = sceneWith([]);
    await scene.createEmbeddedDocuments('Region', [{ id: 'r1' }, { id: 'r2' }]);

    const result = await da.deleteMeasuredTemplate({ templateId: 'r1' });

    expect(result).toEqual({ success: true, deletedCount: 1, templateIds: ['r1'] });
    expect(scene.regions.has('r1')).toBe(false);
    expect(scene.regions.has('r2')).toBe(true);
  });

  it("deleteMeasuredTemplate all=true removes only this tool's flagged Regions, never a hand-made GM region", async () => {
    const scene = sceneWith([]);
    await scene.createEmbeddedDocuments('Region', [
      {
        id: 'ours',
        flags: { 'foundry-mcp-bridge': { template: { shape: 'circle', distance: 5 } } },
      },
      { id: 'gm-made', name: 'Lair of the Beast', flags: {} },
    ]);

    const result = await da.deleteMeasuredTemplate({ all: true });

    expect(result).toEqual({ success: true, deletedCount: 1, templateIds: ['ours'] });
    expect(scene.regions.has('ours')).toBe(false);
    expect(scene.regions.has('gm-made')).toBe(true);
  });
});

describe('FoundryDataAccess — deleteMeasuredTemplate', () => {
  it('throws SCENE_NOT_FOUND when there is no active scene', async () => {
    await expect(da.deleteMeasuredTemplate({ templateId: 't1' })).rejects.toThrow(
      ERROR_MESSAGES.SCENE_NOT_FOUND
    );
  });

  it('deletes a single template by id', async () => {
    const scene = sceneWith([]);
    scene.templates.add({ id: 'tpl1' } as any);
    scene.templates.add({ id: 'tpl2' } as any);

    const result = await da.deleteMeasuredTemplate({ templateId: 'tpl1' });

    expect(result).toEqual({ success: true, deletedCount: 1, templateIds: ['tpl1'] });
    expect(scene.templates.has('tpl1')).toBe(false);
    expect(scene.templates.has('tpl2')).toBe(true);
  });

  it('clears all templates when all=true', async () => {
    const scene = sceneWith([]);
    scene.templates.add({ id: 'tpl1' } as any);
    scene.templates.add({ id: 'tpl2' } as any);

    const result = await da.deleteMeasuredTemplate({ all: true });

    expect(result.deletedCount).toBe(2);
    expect(result.templateIds.sort()).toEqual(['tpl1', 'tpl2']);
    expect(scene.templates.size).toBe(0);
  });

  it('throws when neither templateId nor all is provided', async () => {
    sceneWith([]);
    await expect(da.deleteMeasuredTemplate({})).rejects.toThrow(
      'Provide templateId or set all=true.'
    );
  });
});

// ===========================================================================
// deleteMapNote
// ===========================================================================

describe('FoundryDataAccess — deleteMapNote', () => {
  it('throws SCENE_NOT_FOUND when there is no active scene', async () => {
    await expect(da.deleteMapNote({ noteId: 'n1' })).rejects.toThrow(
      ERROR_MESSAGES.SCENE_NOT_FOUND
    );
  });

  it('deletes a note by id', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Map',
      active: true,
      notes: [{ id: 'n1', text: 'Pin' } as any],
    });
    world.setActiveScene(scene.id);

    const result = await da.deleteMapNote({ noteId: 'n1' });

    expect(result).toEqual({ success: true, deletedCount: 1, noteIds: ['n1'] });
    expect(scene.notes.has('n1')).toBe(false);
  });

  it('deletes notes by matching label text (case-insensitive)', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Map',
      active: true,
      notes: [{ id: 'n1', text: 'Secret Door' } as any, { id: 'n2', text: 'Other' } as any],
    });
    world.setActiveScene(scene.id);

    const result = await da.deleteMapNote({ text: 'secret door' });

    expect(result.noteIds).toEqual(['n1']);
    expect(scene.notes.has('n1')).toBe(false);
    expect(scene.notes.has('n2')).toBe(true);
  });

  it('throws when text matches no note', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Map',
      active: true,
      notes: [{ id: 'n1', text: 'Pin' } as any],
    });
    world.setActiveScene(scene.id);

    await expect(da.deleteMapNote({ text: 'nothing' })).rejects.toThrow(
      'No map note found with text "nothing".'
    );
  });

  it('throws when neither noteId nor text is provided', async () => {
    sceneWith([]);
    await expect(da.deleteMapNote({})).rejects.toThrow('Provide noteId or text.');
  });
});
