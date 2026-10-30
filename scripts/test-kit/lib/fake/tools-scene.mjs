/**
 * The fake's scene and token reads the canvas probe (`canvas-tools-headless`) calls, plus the two
 * plan tools it plans with: measure-distance, get-targets, get-token-details, get-party,
 * open-in-foundry, plan-party-change and plan-scene-change. All read-only or plan-only; result
 * shapes follow the real handlers (only the fields the kit reads). The fake has no canvas, so
 * nothing here can need one.
 */
import { ToolFailure } from './state.mjs';
import { createPlan } from './tools-guarded.mjs';

/** @typedef {import('./state.mjs').World} World */

/** The scene the tools work on: the active one. @param {World} w */
function activeScene(w) {
  const scene = w.scenes.get(w.activeSceneId ?? '');
  if (!scene) throw new ToolFailure('No active scene found');
  return scene;
}

/** A token of the active scene by name, exact first, then a substring. @param {World} w @param {string} name */
function tokenNamed(w, name) {
  const want = name.toLowerCase();
  const onScene = [...w.tokens.values()].filter(t => t.sceneId === w.activeSceneId);
  const found =
    onScene.find(t => t.name.toLowerCase() === want) ??
    onScene.find(t => t.name.toLowerCase().includes(want));
  if (!found) throw new ToolFailure(`Failed to measure distance: Token not found: ${name}`);
  return found;
}

/** @type {Record<string, (w: World, args: any) => any>} */
export const SCENE_TOOLS = {
  'measure-distance': (w, args) => {
    activeScene(w);
    const from = tokenNamed(w, String(args.fromTokenName ?? ''));
    const to = tokenNamed(w, String(args.toTokenName ?? ''));
    // Square grid, every square 5 ft, Chebyshev like the module's manual calculation.
    const squares = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    return { success: true, from: from.name, to: to.name, distance: squares * 5, units: 'ft' };
  },

  'get-targets': () => ({ success: true, count: 0, targets: [], selected: [] }),

  'get-token-details': (w, args) => {
    const scene = activeScene(w);
    const token = w.tokens.get(String(args.tokenId ?? ''));
    if (!token || token.sceneId !== scene.id) {
      throw new ToolFailure(
        `Failed to get token details: Token ${args.tokenId} not found in current scene`
      );
    }
    const actor = w.actors.get(token.actorId);
    return {
      success: true,
      id: token.id,
      name: token.name,
      x: token.x * scene.grid,
      y: token.y * scene.grid,
      width: 1,
      height: 1,
      rotation: 0,
      scale: 1,
      alpha: 1,
      hidden: token.hidden,
      disposition: actor?.type === 'character' ? 1 : -1,
      elevation: 0,
      lockRotation: false,
      img: '',
      actorId: token.actorId,
      actorData: actor ? { name: actor.name, type: actor.type, img: '' } : null,
      actorLink: actor?.type === 'character',
    };
  },

  // The fake has no group actors: the probe takes its "no party" skip path.
  'get-party': w => ({
    groups: [],
    paceOptions: [],
    scene: w.activeSceneId ? { sceneId: w.activeSceneId, name: activeScene(w).name } : null,
    encounter: null,
    warnings: [],
  }),

  'open-in-foundry': (w, args) => {
    const uuid = String(args.uuid ?? '');
    const m = /^Scene\.([^.]+)$/.exec(uuid);
    const scene = m ? w.scenes.get(m[1]) : undefined;
    if (!scene)
      throw new ToolFailure(`Failed to open the document in Foundry: Document not found: ${uuid}`);
    return { opened: true, documentName: 'Scene', name: scene.name, userId: 'fakeGmUser00001' };
  },

  'plan-party-change': () => {
    throw new ToolFailure(
      'There is no party: create a Group actor in Foundry and add the characters to it'
    );
  },

  'plan-scene-change': (w, args) => {
    if (args.action !== 'template') {
      throw new ToolFailure(`The fake plans only templates, not "${args.action}"`);
    }
    if (!args.shape || !(Number(args.distance) > 0)) {
      throw new ToolFailure('Parameter error: a template needs shape and distance');
    }
    const scene = activeScene(w);
    const at = args.originTokenName ? tokenNamed(w, String(args.originTokenName)).name : 'a point';
    const plan = createPlan(
      w,
      `Add a ${args.shape} template of ${args.distance} ft at ${at} on "${scene.name}"`,
      'write',
      [],
      [{ kind: 'template' }],
      []
    );
    return { ...plan, tokensInside: [] };
  },
};
