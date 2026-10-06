/**
 * AoE "template" regions on Foundry v14 (plan step M3, table 2.4:
 * `scene-plan.ts` `plan-scene-change` actions `template` / `clear-templates`).
 *
 * MeasuredTemplate documents were removed from `common/` in 14.352 (#13089);
 * templates now live as Region documents with a `shapes` array
 * (`common/documents/region.mjs:23-90`, verified). `common/data/data.mjs:200-461`
 * defines the shape data models this file targets: `RectangleShapeData`
 * (x,y,width,height,anchorX,anchorY,rotation), `CircleShapeData` (x,y,radius),
 * `ConeShapeData` (x,y,radius,angle,rotation,curvature — default "round",
 * `common/data/data.mjs:369`), `LineShapeData` (x,y,length,width,rotation). All
 * coordinates/sizes are in pixels, same as a MeasuredTemplate.
 *
 * The circle/cone/ray/rect -> circle/cone/line mapping below mirrors Foundry's
 * own conversion, `BaseRegion._migrateMeasuredTemplateData`
 * (`common/documents/region.mjs:173-240`, verified; also used live by the
 * deprecated `MeasuredTemplateDocument.createDocuments` compatibility shim at
 * `client/documents/measured-template.mjs:223-249`) for circle/cone/line, using
 * the non-grid-based conversion (`distancePixels = grid.size / grid.distance`,
 * matching this module's own `tokensInTemplate` math). The rect mapping is
 * simplified to a `distance`-side square rotated by `direction` (anchored at
 * the origin) rather than replicating Foundry's grid-translated-point algorithm
 * exactly: it reproduces the same "diagonal box from the origin" area
 * `tokensInTemplate`'s rect branch already tests for, without a live grid class.
 *
 * dnd5e 6.0.5's own template placement (`dnd5e.mjs:16237-16405`, `TemplatePlacement`,
 * verified) creates Regions the same way: `visibility: CONST.REGION_VISIBILITY.ALWAYS`,
 * `highlightMode: "coverage"`. It also sets `restriction.enabled: true` (move-blocking)
 * for spell templates; this tool's freeform AoE marker instead defaults
 * `restriction.enabled: false` — matching the old MeasuredTemplate's visual-only,
 * non-obstructing behavior, since a GM using this tool is marking an area, not
 * necessarily physically obstructing it.
 *
 * Region `levels` (`common/documents/region.mjs:64`) and Note `levels`
 * (`common/documents/note.mjs:50`) are both `SceneLevelsSetField()` (verified):
 * set explicitly via `systems/core.ts`'s `currentLevelId`/`sceneHasLevels` so a
 * placeable lands on the level the GM is looking at (empty/omitted = every level).
 */

import { MODULE_ID } from '../constants.js';

export type TemplateShapeKind = 'circle' | 'cone' | 'ray' | 'rect';

/** The shape parameters a `template` plan accepts. */
export interface TemplateParams {
  shape: TemplateShapeKind;
  distance: number;
  x: number;
  y: number;
  direction?: number;
  angle?: number;
  width?: number;
}

/** This tool's marker on a template Region, so `all=true` deletes only its own. */
export interface ToolTemplateFlag {
  shape: TemplateShapeKind;
  distance: number;
  direction?: number;
  angle?: number;
  width?: number;
}

/** Whether Region documents exist on this Foundry core (added well before v14; always true today). */
export function supportsRegionDocuments(): boolean {
  return typeof foundry?.documents?.BaseRegion === 'function';
}

/**
 * One Region `shapes[]` entry for an AoE template, mapped from this tool's
 * circle/cone/ray/rect vocabulary to the v14 Region shape types. `pixelsPerUnit`
 * is `grid.size / grid.distance` (the same conversion `tokensInTemplate` uses).
 */
export function templateToRegionShape(
  params: TemplateParams,
  pixelsPerUnit: number
): Record<string, unknown> {
  const direction = params.direction ?? 0;
  const radius = params.distance * pixelsPerUnit;
  switch (params.shape) {
    case 'circle':
      return { type: 'circle', x: params.x, y: params.y, radius };
    case 'cone':
      return {
        type: 'cone',
        x: params.x,
        y: params.y,
        radius,
        angle: params.angle ?? 53.13,
        rotation: direction,
        // "round" has no angle cap (unlike "flat" <=90 / "semicircle" <=180,
        // common/data/data.mjs:378-388), so it is safe for any configured angle.
        curvature: 'round',
      };
    case 'ray':
      return {
        type: 'line',
        x: params.x,
        y: params.y,
        length: radius,
        width: (params.width ?? 5) * pixelsPerUnit,
        rotation: direction,
      };
    case 'rect':
      // Simplified: a `distance`-side square anchored at the origin, rotated by
      // `direction` — see the file-level comment.
      return {
        type: 'rectangle',
        x: params.x,
        y: params.y,
        width: radius,
        height: radius,
        anchorX: 0,
        anchorY: 0,
        rotation: direction,
      };
    default: {
      const exhaustive: never = params.shape;
      throw new Error(`Unknown template shape: ${String(exhaustive)}`);
    }
  }
}

/**
 * Full `createEmbeddedDocuments('Region', ...)` payload for one AoE template,
 * flagged so {@link isToolTemplateRegion} (and a `clear-templates` plan's
 * `all=true`) can find only regions this tool created — never a hand-made GM
 * region.
 */
export function buildTemplateRegionData(
  params: TemplateParams,
  opts: { pixelsPerUnit: number; levels?: string[]; color?: string }
): Record<string, unknown> {
  const shape = templateToRegionShape(params, opts.pixelsPerUnit);
  const flag: ToolTemplateFlag = { shape: params.shape, distance: params.distance };
  if (params.direction != null) flag.direction = params.direction;
  if (params.angle != null) flag.angle = params.angle;
  if (params.width != null) flag.width = params.width;

  const data: Record<string, unknown> = {
    name: `${params.shape[0].toUpperCase()}${params.shape.slice(1)} Template`,
    color: opts.color ?? '#ff0000',
    shapes: [shape],
    elevation: { bottom: 0, top: null },
    restriction: { enabled: false, type: 'move', priority: 0 },
    // ALWAYS matches Foundry's own MeasuredTemplate->Region migration and
    // dnd5e's template placement (both verified above); template regions are
    // visual markers, not GM-only fog like a hand-drawn Region typically is.
    visibility:
      (CONST as { REGION_VISIBILITY?: { ALWAYS?: number } }).REGION_VISIBILITY?.ALWAYS ?? 2,
    highlightMode: 'coverage',
    displayMeasurements: true,
    hidden: false,
    locked: false,
    flags: { [MODULE_ID]: { template: flag } },
  };
  if (opts.levels) data.levels = opts.levels;
  return data;
}

/** A Region document (or its raw data) shaped enough to read this tool's flag. */
interface FlaggedRegion {
  id?: string;
  flags?: Record<string, unknown>;
}

/** This tool's template marker off a Region's flags, or undefined for any other region. */
export function toolTemplateFlag(
  region: FlaggedRegion | null | undefined
): ToolTemplateFlag | undefined {
  const moduleFlags = region?.flags?.[MODULE_ID] as { template?: unknown } | undefined;
  const flag = moduleFlags?.template;
  return flag && typeof flag === 'object' ? (flag as ToolTemplateFlag) : undefined;
}

/** Whether `region` is a template this tool created (never a hand-made GM region). */
export function isToolTemplateRegion(region: FlaggedRegion | null | undefined): boolean {
  return toolTemplateFlag(region) !== undefined;
}
