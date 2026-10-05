/**
 * Unit tests for the scene dressing plans (I-112): `planSceneChange` turns one
 * `plan-scene-change` request into guarded ops. Nothing is written; these tests
 * pin the ops, the summaries, the AoE geometry (moved from the old direct
 * `placeMeasuredTemplate`) and that every error the old direct tools threw is
 * still thrown at plan time.
 *
 * Driven through the Foundry-mock harness (in-memory, no browser). Grid is
 * supplied via rest-spread (`grid: { size, distance }`) so the pixels-per-unit
 * math is deterministic (px = size / distance). Documents carry no uuid in the
 * harness, so scenes and actors are given one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR_MESSAGES } from './constants.js';
import { planSceneChange, SCENE_PLAN_QUERY } from './scene-plan.js';
import { SCENE_PLAN_QUERY as SHARED_QUERY } from '../../../shared/src/scene-change.js';
import { createTestWorld, makeToken, type TestWorld } from './test-support/foundry-mock/index.js';

let world: TestWorld;
let restore: () => void;

const g = globalThis as any;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

/** Add a scene with a deterministic grid (px-per-unit = size / distance) + tokens. */
function sceneWith(tokens: any[], extra: Record<string, any> = {}): any {
  const scene = world.addScene({
    id: 'scene1',
    name: 'Field',
    uuid: 'Scene.scene1',
    active: true,
    tokens,
    grid: { size: 100, distance: 5 },
    ...extra,
  });
  world.setActiveScene(scene.id);
  return scene;
}

/** Simulate Foundry 14: no MeasuredTemplate document, Region present (verified 14.352). */
function asFoundry14(): void {
  g.game.release = { generation: 14, build: 368 };
  g.foundry.documents = { BaseRegion: class {} };
}

it('pins the query name to the shared contract', () => {
  expect(SCENE_PLAN_QUERY).toBe(SHARED_QUERY);
  expect(SCENE_PLAN_QUERY).toBe('planSceneChange');
});

describe('planSceneChange: entry', () => {
  it('refuses an unknown action', async () => {
    await expect(planSceneChange({ action: 'explode' })).rejects.toThrow(
      'Unknown action "explode"'
    );
    await expect(planSceneChange(null)).rejects.toThrow('Unknown action');
  });

  it('throws SCENE_NOT_FOUND for every scene action when no scene is viewed', async () => {
    for (const request of [
      { action: 'template', shape: 'circle', distance: 10, x: 0, y: 0 },
      { action: 'clear-templates', all: true },
      { action: 'mood', darkness: 0.5 },
      { action: 'note', x: 1, y: 2 },
      { action: 'remove-note', noteId: 'n1' },
    ]) {
      await expect(planSceneChange(request), request.action).rejects.toThrow(
        ERROR_MESSAGES.SCENE_NOT_FOUND
      );
    }
  });
});

// ===========================================================================
// template (v13: MeasuredTemplate)
// ===========================================================================

describe('planSceneChange: template', () => {
  it('plans one MeasuredTemplate create on the scene and writes nothing', async () => {
    const scene = sceneWith([]);

    const plan = await planSceneChange({
      action: 'template',
      shape: 'circle',
      distance: 15,
      x: 300,
      y: 400,
      fillColor: '#00ff00',
    });

    expect(plan.summary).toBe('Place a 15 ft circle template on "Field"');
    expect(plan.sceneId).toBe('scene1');
    expect(plan.tokensInside).toEqual([]);
    expect(plan.ops).toEqual([
      {
        kind: 'create',
        documentName: 'MeasuredTemplate',
        parentUuid: 'Scene.scene1',
        data: { t: 'circle', x: 300, y: 400, distance: 15, direction: 0, fillColor: '#00ff00' },
      },
    ]);
    expect(scene.templates.size).toBe(0);
  });

  it("derives the origin from a named token's center", async () => {
    // token at (200,200), width/height 1, grid size 100 -> center (250,250)
    sceneWith([makeToken({ id: 't1', name: 'Mage', x: 200, y: 200 })]);

    const plan = await planSceneChange({
      action: 'template',
      shape: 'circle',
      distance: 5,
      originTokenName: 'mage',
    });

    expect(plan.ops[0]).toMatchObject({ data: { x: 250, y: 250 } });
  });

  it('throws when neither x/y nor a resolvable origin token is given', async () => {
    sceneWith([]);
    await expect(
      planSceneChange({
        action: 'template',
        shape: 'circle',
        distance: 5,
        originTokenName: 'ghost',
      })
    ).rejects.toThrow('Provide x/y or a valid originTokenName.');
  });

  it('throws when shape or distance is missing', async () => {
    sceneWith([]);
    await expect(planSceneChange({ action: 'template', distance: 5, x: 0, y: 0 })).rejects.toThrow(
      'shape and distance are required'
    );
    await expect(
      planSceneChange({ action: 'template', shape: 'cone', x: 0, y: 0 })
    ).rejects.toThrow('shape and distance are required');
  });

  it('cone defaults its angle (CONFIG.MeasuredTemplate.defaults.angle fallback 53.13)', async () => {
    sceneWith([]);
    const plan = await planSceneChange({
      action: 'template',
      shape: 'cone',
      distance: 10,
      x: 0,
      y: 0,
    });
    expect((plan.ops[0] as any).data.angle).toBeCloseTo(53.13);
  });

  it('ray defaults its width to 5, rect its direction to 45', async () => {
    sceneWith([]);
    const ray = await planSceneChange({
      action: 'template',
      shape: 'ray',
      distance: 10,
      x: 0,
      y: 0,
    });
    expect((ray.ops[0] as any).data.width).toBe(5);
    const rect = await planSceneChange({
      action: 'template',
      shape: 'rect',
      distance: 10,
      x: 0,
      y: 0,
    });
    expect((rect.ops[0] as any).data.direction).toBe(45);
  });

  // The geometry below is px = size / distance = 20.
  it('circle: lists tokens within the radius, not those outside', async () => {
    sceneWith([
      makeToken({ id: 'near', name: 'Near', x: 150, y: 150, actorId: 'a1' }), // center (200,200)
      makeToken({ id: 'far', name: 'Far', x: 1000, y: 1000 }),
    ]);

    const plan = await planSceneChange({
      action: 'template',
      shape: 'circle',
      distance: 5,
      x: 200,
      y: 200,
    });

    expect(plan.tokensInside).toEqual([{ name: 'Near', actorId: 'a1' }]);
  });

  it('cone: lists tokens within the arc, not those outside it', async () => {
    sceneWith([
      makeToken({ id: 'front', name: 'Front', x: 250, y: 150 }), // center (300,200), ahead
      makeToken({ id: 'side', name: 'Side', x: 150, y: 350 }), // center (200,400), 90 degrees off
    ]);

    const plan = await planSceneChange({
      action: 'template',
      shape: 'cone',
      distance: 10,
      x: 200,
      y: 200,
      direction: 0,
      angle: 90,
    });

    expect(plan.tokensInside?.map(t => t.name)).toEqual(['Front']);
  });

  it('ray: lists tokens on the line within its width, not those beside it', async () => {
    sceneWith([
      makeToken({ id: 'on', name: 'OnRay', x: 350, y: 150 }), // center (400,200), on axis
      makeToken({ id: 'off', name: 'OffRay', x: 350, y: 250 }), // center (400,300), 5 units off
    ]);

    const plan = await planSceneChange({
      action: 'template',
      shape: 'ray',
      distance: 10,
      x: 200,
      y: 200,
      direction: 0,
      width: 5,
    });

    expect(plan.tokensInside?.map(t => t.name)).toEqual(['OnRay']);
  });

  it('rect: lists tokens within the diagonal box (default 45 degree direction)', async () => {
    sceneWith([
      makeToken({ id: 'in', name: 'InBox', x: 250, y: 250 }), // center (300,300)
      makeToken({ id: 'out', name: 'OutBox', x: 350, y: 350 }), // center (400,400)
    ]);

    const plan = await planSceneChange({
      action: 'template',
      shape: 'rect',
      distance: 10,
      x: 200,
      y: 200,
    });

    expect(plan.tokensInside?.map(t => t.name)).toEqual(['InBox']);
  });
});

// ===========================================================================
// template on Foundry 14 (Region-backed)
// ===========================================================================

// MeasuredTemplate documents were removed in Foundry 14.352 (#13089); templates are
// flagged Regions there (`systems/regions.ts`).
describe('planSceneChange: template on Foundry 14', () => {
  beforeEach(asFoundry14);

  it('plans a flagged Region create, not a MeasuredTemplate', async () => {
    const scene = sceneWith([]);

    const plan = await planSceneChange({
      action: 'template',
      shape: 'circle',
      distance: 15,
      x: 300,
      y: 400,
    });

    expect(plan.ops).toHaveLength(1);
    const op = plan.ops[0] as any;
    expect(op).toMatchObject({
      kind: 'create',
      documentName: 'Region',
      parentUuid: 'Scene.scene1',
    });
    // px-per-unit = grid.size / grid.distance = 100 / 5 = 20.
    expect(op.data.shapes).toEqual([{ type: 'circle', x: 300, y: 400, radius: 300 }]);
    expect(op.data.flags['foundry-mcp-bridge'].template).toEqual({
      shape: 'circle',
      distance: 15,
      direction: 0,
    });
    // CONST.REGION_VISIBILITY isn't in the harness's CONST fixture; the code falls back to the
    // real value (common/constants.mjs REGION_VISIBILITY.ALWAYS = 2).
    expect(op.data.visibility).toBe(2);
    expect(scene.regions?.size ?? 0).toBe(0);
  });

  it('maps cone/ray/rect to cone/line/rectangle Region shapes', async () => {
    sceneWith([]);
    const shapeOf = async (request: Record<string, unknown>): Promise<any> =>
      ((await planSceneChange({ action: 'template', x: 0, y: 0, ...request })).ops[0] as any).data
        .shapes[0];

    expect(await shapeOf({ shape: 'cone', distance: 10, angle: 90, direction: 30 })).toMatchObject({
      type: 'cone',
      radius: 200,
      angle: 90,
      rotation: 30,
      curvature: 'round',
    });
    expect(await shapeOf({ shape: 'ray', distance: 10 })).toMatchObject({
      type: 'line',
      length: 200,
      width: 100, // default ray width 5 * px 20
      rotation: 0,
    });
    expect(await shapeOf({ shape: 'rect', distance: 10 })).toMatchObject({
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

    const plan = await planSceneChange({
      action: 'template',
      shape: 'circle',
      distance: 5,
      x: 200,
      y: 200,
    });

    expect(plan.tokensInside?.map(t => t.name)).toEqual(['Near']);
  });

  it('Scene Levels: sets Region#levels to the current level', async () => {
    sceneWith([], { levels: { contents: [{ id: 'lvl1' }] }, initialLevel: 'lvl1' });

    const plan = await planSceneChange({
      action: 'template',
      shape: 'circle',
      distance: 5,
      x: 0,
      y: 0,
    });

    expect((plan.ops[0] as any).data.levels).toEqual(['lvl1']);
  });
});

// ===========================================================================
// clear-templates
// ===========================================================================

describe('planSceneChange: clear-templates', () => {
  it('plans a delete of one template by id', async () => {
    const scene = sceneWith([]);
    scene.templates.add({ id: 'tpl1' } as any);
    scene.templates.add({ id: 'tpl2' } as any);

    const plan = await planSceneChange({ action: 'clear-templates', templateId: 'tpl1' });

    expect(plan.summary).toBe('Clear a template on "Field"');
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Scene.scene1.MeasuredTemplate.tpl1' }]);
    expect(scene.templates.size).toBe(2); // nothing deleted at plan time
  });

  it('plans one delete per template when all=true', async () => {
    const scene = sceneWith([]);
    scene.templates.add({ id: 'tpl1' } as any);
    scene.templates.add({ id: 'tpl2' } as any);

    const plan = await planSceneChange({ action: 'clear-templates', all: true });

    expect(plan.summary).toBe('Clear 2 templates on "Field"');
    expect(plan.ops.map(o => (o as any).uuid).sort()).toEqual([
      'Scene.scene1.MeasuredTemplate.tpl1',
      'Scene.scene1.MeasuredTemplate.tpl2',
    ]);
  });

  it('throws when neither templateId nor all is provided, or the id is unknown', async () => {
    sceneWith([]);
    await expect(planSceneChange({ action: 'clear-templates' })).rejects.toThrow(
      'Provide templateId or set all=true.'
    );
    await expect(planSceneChange({ action: 'clear-templates', templateId: 'zzz' })).rejects.toThrow(
      'Template not found: zzz'
    );
  });

  it('says so when there is nothing to clear', async () => {
    sceneWith([]);
    await expect(planSceneChange({ action: 'clear-templates', all: true })).rejects.toThrow(
      'No templates to clear.'
    );
  });

  it("on Foundry 14 all=true takes only this tool's flagged Regions, never a hand-made GM region", async () => {
    asFoundry14();
    const scene = sceneWith([]);
    await scene.createEmbeddedDocuments('Region', [
      {
        id: 'ours',
        flags: { 'foundry-mcp-bridge': { template: { shape: 'circle', distance: 5 } } },
      },
      { id: 'gm-made', name: 'Lair of the Beast', flags: {} },
    ]);

    const plan = await planSceneChange({ action: 'clear-templates', all: true });

    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Scene.scene1.Region.ours' }]);
  });

  it('on Foundry 14 a templateId may name any Region of the scene', async () => {
    asFoundry14();
    const scene = sceneWith([]);
    await scene.createEmbeddedDocuments('Region', [{ id: 'r1' }]);

    const plan = await planSceneChange({ action: 'clear-templates', templateId: 'r1' });

    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Scene.scene1.Region.r1' }]);
  });
});

// ===========================================================================
// mood
// ===========================================================================

describe('planSceneChange: mood', () => {
  it('plans one environment.* update on the scene, clamping darkness to [0,1]', async () => {
    const scene = sceneWith([]);

    const plan = await planSceneChange({ action: 'mood', darkness: 2, globalLight: true });

    expect(plan.summary).toBe('Set darkness 1 and global light enabled on "Field"');
    expect(plan.sceneId).toBe('scene1');
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Scene.scene1',
        changes: { 'environment.darknessLevel': 1, 'environment.globalLight.enabled': true },
      },
    ]);
    expect(scene.environment).toBeUndefined(); // nothing written at plan time
  });

  it('light only: no darkness path', async () => {
    sceneWith([]);
    const plan = await planSceneChange({ action: 'mood', globalLight: false });
    expect(plan.summary).toBe('Set global light disabled on "Field"');
    expect((plan.ops[0] as any).changes).toEqual({ 'environment.globalLight.enabled': false });
  });

  it('v14.368 #14718: resends the current darknessLock alongside a darkness change', async () => {
    const scene = sceneWith([]);
    await scene.update({ 'environment.darknessLock': true });

    const plan = await planSceneChange({ action: 'mood', darkness: 0.7 });

    expect((plan.ops[0] as any).changes).toEqual({
      'environment.darknessLevel': 0.7,
      'environment.darknessLock': true,
    });
  });

  it('does not send darknessLock when the scene is not locked', async () => {
    sceneWith([]);
    const plan = await planSceneChange({ action: 'mood', darkness: 0.4 });
    expect((plan.ops[0] as any).changes).toEqual({ 'environment.darknessLevel': 0.4 });
  });

  it('throws when neither darkness nor globalLight is given', async () => {
    sceneWith([]);
    await expect(planSceneChange({ action: 'mood' })).rejects.toThrow(
      'Give darkness and/or globalLight.'
    );
  });
});

// ===========================================================================
// note / remove-note
// ===========================================================================

describe('planSceneChange: note', () => {
  it('plans a Note create at explicit x/y with the default icon and size', async () => {
    const scene = sceneWith([]);

    const plan = await planSceneChange({ action: 'note', x: 120, y: 240, text: 'Trap!' });

    expect(plan.summary).toBe('Add map note "Trap!" on "Field"');
    expect(plan.ops).toEqual([
      {
        kind: 'create',
        documentName: 'Note',
        parentUuid: 'Scene.scene1',
        data: {
          x: 120,
          y: 240,
          iconSize: 40,
          fontSize: 24,
          textAnchor: 1,
          texture: { src: 'icons/svg/book.svg' },
          text: 'Trap!',
        },
      },
    ]);
    expect(scene.notes.size).toBe(0);
  });

  it("uses a named token's position (x/y, not center)", async () => {
    sceneWith([makeToken({ id: 't1', name: 'Captain', x: 333, y: 444 })]);

    const plan = await planSceneChange({ action: 'note', tokenName: 'captain', text: 'Here' });

    expect((plan.ops[0] as any).data).toMatchObject({ x: 333, y: 444 });
  });

  it('throws when neither x/y nor a resolvable token is given', async () => {
    sceneWith([]);
    await expect(
      planSceneChange({ action: 'note', tokenName: 'ghost', text: 'x' })
    ).rejects.toThrow('Provide x/y or a valid tokenName.');
  });

  it('resolves entryId from a journal name', async () => {
    sceneWith([]);
    world.addJournal({ id: 'j1', name: 'The Lore' });

    const plan = await planSceneChange({ action: 'note', x: 0, y: 0, journalName: 'the lore' });

    expect((plan.ops[0] as any).data.entryId).toBe('j1');
    expect(plan.summary).toBe('Add a map note on "Field"');
  });

  it('v14 Scene Levels: lands the note on the current level (Note#levels)', async () => {
    sceneWith([], { levels: { contents: [{ id: 'lvl1' }] }, initialLevel: 'lvl1' });
    const plan = await planSceneChange({ action: 'note', x: 0, y: 0, text: 'Pin' });
    expect((plan.ops[0] as any).data.levels).toEqual(['lvl1']);
  });

  it('v13 (no Scene Levels): does not set Note#levels', async () => {
    sceneWith([]);
    const plan = await planSceneChange({ action: 'note', x: 0, y: 0, text: 'Pin' });
    expect((plan.ops[0] as any).data.levels).toBeUndefined();
  });
});

describe('planSceneChange: remove-note', () => {
  const notes = [
    { id: 'n1', text: 'Secret Door' },
    { id: 'n2', text: 'Other' },
    { id: 'n3', text: 'secret door' },
  ];

  it('plans a delete of a note by id', async () => {
    const scene = sceneWith([], { notes });

    const plan = await planSceneChange({ action: 'remove-note', noteId: 'n2' });

    expect(plan.summary).toBe('Remove map note "Other" from "Field"');
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Scene.scene1.Note.n2' }]);
    expect(scene.notes.has('n2')).toBe(true); // nothing deleted at plan time
  });

  it('plans one delete per note with matching label text (exact, case-insensitive)', async () => {
    sceneWith([], { notes });

    const plan = await planSceneChange({ action: 'remove-note', text: 'SECRET DOOR' });

    expect(plan.summary).toBe('Remove 2 map notes from "Field"');
    expect(plan.ops).toEqual([
      { kind: 'delete', uuid: 'Scene.scene1.Note.n1' },
      { kind: 'delete', uuid: 'Scene.scene1.Note.n3' },
    ]);
  });

  it('throws when text or id matches no note, or neither is given', async () => {
    sceneWith([], { notes });
    await expect(planSceneChange({ action: 'remove-note', text: 'nothing' })).rejects.toThrow(
      'No map note found with text "nothing".'
    );
    await expect(planSceneChange({ action: 'remove-note', noteId: 'zzz' })).rejects.toThrow(
      'No map note found with id "zzz".'
    );
    await expect(planSceneChange({ action: 'remove-note' })).rejects.toThrow(
      'Provide noteId or text.'
    );
  });
});

// ===========================================================================
// loot
// ===========================================================================

describe('planSceneChange: loot', () => {
  const addActor = (id: string, name: string, currency: Record<string, number> = {}): any =>
    world.addActor({ id, name, uuid: `Actor.${id}`, system: { currency } });

  it('throws when a named target cannot be resolved', async () => {
    await expect(planSceneChange({ action: 'loot', targetCharacter: 'ghost' })).rejects.toThrow(
      'Target not found: ghost'
    );
  });

  it('writes the new absolute currency values (current + added) and announces', async () => {
    const actor = addActor('a1', 'Rogue', { gp: 10, sp: 0 });

    const plan = await planSceneChange({
      action: 'loot',
      targetCharacter: 'Rogue',
      currency: { gp: 5, sp: 3 },
    });

    expect(plan.summary).toBe('Loot for Rogue: 5 gp, 3 sp');
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Actor.a1',
        changes: { 'system.currency.gp': 15, 'system.currency.sp': 3 },
      },
      {
        kind: 'create',
        documentName: 'ChatMessage',
        data: {
          content: '<b>Loot for Rogue:</b> 5 gp, 3 sp',
          speaker: { scene: null, actor: null, token: null, alias: 'Loot' },
        },
      },
    ]);
    expect(actor.system.currency.gp).toBe(10); // nothing written at plan time
  });

  it('plans an Item create per resolvable UUID (toObject minus _id) and lists the rest as skipped', async () => {
    addActor('a1', 'Fighter');
    g.fromUuid = async (uuid: string) =>
      uuid === 'Compendium.x.y'
        ? { toObject: () => ({ _id: 'orig', name: 'Longsword', type: 'weapon' }) }
        : uuid === 'Compendium.boom'
          ? Promise.reject(new Error('bad uuid'))
          : null;

    const plan = await planSceneChange({
      action: 'loot',
      targetCharacter: 'Fighter',
      itemUuids: ['Compendium.x.y', 'Compendium.gone', 'Compendium.boom'],
      announce: false,
    });

    expect(plan.summary).toBe('Loot for Fighter: Longsword');
    expect(plan.ops).toEqual([
      {
        kind: 'create',
        documentName: 'Item',
        parentUuid: 'Actor.a1',
        data: { name: 'Longsword', type: 'weapon' },
      },
    ]);
    expect(plan.skippedItems).toEqual(['Compendium.gone', 'Compendium.boom']);
  });

  it('combines coins and items in the line: "5 gp + Longsword"', async () => {
    addActor('a1', 'Fighter');
    g.fromUuid = async () => ({ toObject: () => ({ _id: 'orig', name: 'Longsword' }) });

    const plan = await planSceneChange({
      action: 'loot',
      targetCharacter: 'Fighter',
      currency: { gp: 5 },
      itemUuids: ['Compendium.x.y'],
      announce: false,
    });

    expect(plan.summary).toBe('Loot for Fighter: 5 gp + Longsword');
    expect(plan.ops.map(o => o.kind)).toEqual(['update', 'create']);
  });

  it('suppresses the chat card when announce is false', async () => {
    addActor('a1', 'Bard');
    const plan = await planSceneChange({
      action: 'loot',
      targetCharacter: 'Bard',
      currency: { gp: 1 },
      announce: false,
    });
    expect(plan.ops.map(o => o.kind)).toEqual(['update']);
  });

  it('with no target it only announces', async () => {
    const plan = await planSceneChange({ action: 'loot', currency: { gp: 50 } });
    expect(plan.summary).toBe('Loot: 50 gp');
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({ kind: 'create', documentName: 'ChatMessage' });
  });

  it('throws when there is nothing to do at all', async () => {
    await expect(planSceneChange({ action: 'loot', announce: false })).rejects.toThrow(
      'Nothing to give'
    );
    addActor('a1', 'Monk');
    await expect(
      planSceneChange({ action: 'loot', targetCharacter: 'Monk', announce: false })
    ).rejects.toThrow('Nothing to give');
  });

  it('refuses a currency amount that is not a number', async () => {
    addActor('a1', 'Monk');
    await expect(
      planSceneChange({ action: 'loot', targetCharacter: 'Monk', currency: { gp: 'lots' } })
    ).rejects.toThrow('The gp amount must be a number.');
  });
});
