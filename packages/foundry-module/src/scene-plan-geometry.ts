/**
 * Helpers of the scene plans (`scene-plan.ts`, I-112): the viewed scene, token
 * lookup and the AoE geometry. Read only; moved here from the old direct
 * scene-dressing code (`data-access/scene-fx.ts`) with the verified Foundry 14
 * notes kept.
 */
import { ERROR_MESSAGES } from './constants.js';
import { supportsMeasuredTemplates, UnsupportedOnThisFoundryError } from './systems/core.js';
import { supportsRegionDocuments } from './systems/regions.js';

/** A Foundry document as these helpers read it (a scene, token or actor). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SceneDoc = any;

/** The shape parameters the template geometry reads. */
export interface TemplateGeometry {
  t: 'circle' | 'cone' | 'ray' | 'rect';
  x: number;
  y: number;
  distance: number;
  direction?: number;
  angle?: number;
  width?: number;
}

/** The viewed scene (`game.scenes.current`), or throw `SCENE_NOT_FOUND` when there is none. */
export function requireCurrentScene(): SceneDoc {
  const scene = (game.scenes as SceneDoc)?.current;
  if (!scene) {
    throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);
  }
  return scene;
}

/**
 * Which document type an AoE "template" is stored as on this Foundry core:
 * MeasuredTemplate document on v13 (`supportsMeasuredTemplates()`), Region
 * document on v14 (MeasuredTemplate was removed 14.352, #13089; templates
 * are Regions with a `shapes` array, see `systems/regions.ts`). Throws only
 * when neither document type exists (not expected on any supported core).
 */
export function templateDocumentType(): 'MeasuredTemplate' | 'Region' {
  if (supportsMeasuredTemplates()) return 'MeasuredTemplate';
  if (supportsRegionDocuments()) return 'Region';
  throw new UnsupportedOnThisFoundryError(
    'Measured templates',
    'Neither MeasuredTemplate nor Region documents exist on this Foundry version.'
  );
}

/** Find a token on `scene` by (case-insensitive) name or by id. */
export function findToken(scene: SceneDoc, nameOrId: string): SceneDoc {
  const lowered = nameOrId.toLowerCase();
  return scene.tokens.find((t: SceneDoc) => t.name?.toLowerCase() === lowered || t.id === nameOrId);
}

/** The center of a token in pixels (its x/y is the top-left corner). */
export function tokenCenter(scene: SceneDoc, token: SceneDoc): { x: number; y: number } {
  const size = scene.grid?.size || 100;
  return {
    x: token.x + ((token.width ?? 1) * size) / 2,
    y: token.y + ((token.height ?? 1) * size) / 2,
  };
}

/**
 * Which tokens a measured template covers: a pure geometric test over the
 * scene grid (pixels-per-unit = gridSize / gridDistance), so it works for any
 * scene without a live canvas. Supports circle / ray / cone / rect.
 */
export function tokensInTemplate(scene: SceneDoc, tpl: TemplateGeometry): SceneDoc[] {
  const grid = scene.grid || {};
  const size = grid.size || 100;
  const px = size / (grid.distance || 5); // pixels per distance unit
  const cx = tpl.x;
  const cy = tpl.y;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  return scene.tokens.filter((td: SceneDoc) => {
    const tx = td.x + ((td.width ?? 1) * size) / 2;
    const ty = td.y + ((td.height ?? 1) * size) / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    const distUnits = Math.hypot(dx, dy) / px;
    if (tpl.t === 'circle') return distUnits <= tpl.distance;
    if (tpl.t === 'ray') {
      const a = toRad(tpl.direction ?? 0);
      const lx = (dx * Math.cos(a) + dy * Math.sin(a)) / px;
      const ly = (-dx * Math.sin(a) + dy * Math.cos(a)) / px;
      return lx >= 0 && lx <= tpl.distance && Math.abs(ly) <= (tpl.width ?? 5) / 2;
    }
    if (tpl.t === 'cone') {
      if (distUnits > tpl.distance) return false;
      let ang = (Math.atan2(dy, dx) * 180) / Math.PI - (tpl.direction ?? 0);
      ang = ((ang + 540) % 360) - 180;
      return Math.abs(ang) <= (tpl.angle ?? 53.13) / 2;
    }
    if (tpl.t === 'rect') {
      const a = toRad(tpl.direction ?? 0);
      const ex = cx + Math.cos(a) * tpl.distance * px;
      const ey = cy + Math.sin(a) * tpl.distance * px;
      return (
        tx >= Math.min(cx, ex) &&
        tx <= Math.max(cx, ex) &&
        ty >= Math.min(cy, ey) &&
        ty <= Math.max(cy, ey)
      );
    }
    return false;
  });
}
