/**
 * Regions, their shapes and behaviors (v14 AoE templates are Regions).
 *
 * Foundry VTT 14.368 shapes. Trailing comments are source refs relative to the Foundry app
 * folder (`common/`, `client/`). Schema fields are declared in full; client methods only where
 * useful. Fields that v14 added are optional so v13 data still type-checks.
 */

declare global {
  /**
   * Region shapes (common/data/data.mjs, BaseShapeData.TYPES at :109). All coordinates are scene pixels.
   * `gridBased` converts the dimensions to grid units (size / grid.size * grid.distance).
   * (v13 note) v13 had only rectangle, circle, ellipse, polygon; v14 added emanation, cone, ring, line, token, grid.
   */
  interface FoundryRegionShapeBase {
    hole: boolean; // common/data/data.mjs:57
    /** Index in the parent `shapes` array (set on initialize). */
    readonly _index?: number; // common/data/data.mjs:69
  }

  interface FoundryRectangleShape extends FoundryRegionShapeBase {
    type: 'rectangle'; // common/data/data.mjs:214
    x: number; // common/data/data.mjs:226
    y: number; // common/data/data.mjs:227
    width: number; // common/data/data.mjs:228
    height: number; // common/data/data.mjs:229
    anchorX: number; // common/data/data.mjs:230
    anchorY: number; // common/data/data.mjs:231
    rotation: number; // common/data/data.mjs:232
    gridBased: boolean; // common/data/data.mjs:233
  }

  interface FoundryCircleShape extends FoundryRegionShapeBase {
    type: 'circle'; // common/data/data.mjs:250
    x: number; // common/data/data.mjs:262
    y: number; // common/data/data.mjs:263
    radius: number; // common/data/data.mjs:264
    gridBased: boolean; // common/data/data.mjs:265
  }

  interface FoundryEllipseShape extends FoundryRegionShapeBase {
    type: 'ellipse'; // common/data/data.mjs:284
    x: number;
    y: number;
    radiusX: number;
    radiusY: number;
    rotation: number;
    gridBased: boolean; // common/data/data.mjs:296-301
  }

  /** Emanation: a `base` shape grown by `radius` (cannot itself be emanation or ring). */
  interface FoundryEmanationShape extends FoundryRegionShapeBase {
    type: 'emanation'; // common/data/data.mjs:317
    base: Exclude<FoundryRegionShape, FoundryEmanationShape | FoundryRingShape>;
    radius: number;
    gridBased: boolean; // common/data/data.mjs:330-332
  }

  interface FoundryConeShape extends FoundryRegionShapeBase {
    type: 'cone'; // common/data/data.mjs:352
    x: number; // common/data/data.mjs:364
    y: number; // common/data/data.mjs:365
    radius: number; // common/data/data.mjs:366
    angle: number; // common/data/data.mjs:367
    rotation: number; // common/data/data.mjs:368
    /** "flat" caps the angle at 90, "semicircle" at 180; "round" has no cap. */
    curvature: 'round' | 'flat' | 'semicircle'; // common/data/data.mjs:369
    gridBased: boolean; // common/data/data.mjs:374
  }

  interface FoundryRingShape extends FoundryRegionShapeBase {
    type: 'ring'; // common/data/data.mjs:405
    x: number;
    y: number;
    radius: number;
    innerWidth: number;
    outerWidth: number;
    gridBased: boolean; // common/data/data.mjs:417-422
  }

  interface FoundryLineShape extends FoundryRegionShapeBase {
    type: 'line'; // common/data/data.mjs:441
    x: number; // common/data/data.mjs:453
    y: number; // common/data/data.mjs:454
    length: number; // common/data/data.mjs:455
    width: number; // common/data/data.mjs:456
    rotation: number; // common/data/data.mjs:457
    gridBased: boolean; // common/data/data.mjs:458
  }

  interface FoundryPolygonShape extends FoundryRegionShapeBase {
    type: 'polygon'; // common/data/data.mjs:474
    /** Flat [x0, y0, x1, y1, ...]; even length, at least 4. */
    points: number[]; // common/data/data.mjs:486
    origin: { x: number; y: number } | null; // common/data/data.mjs:490
  }

  /** v14 only: follows a token's footprint. */
  interface FoundryTokenFootprintShape extends FoundryRegionShapeBase {
    type: 'token'; // common/data/data.mjs:509
    x: number;
    y: number;
    width: number;
    height: number;
    shape: FoundryTokenShape; // common/data/data.mjs:521-525
  }

  /** v14 only: a set of grid cells. */
  interface FoundryGridShape extends FoundryRegionShapeBase {
    type: 'grid'; // common/data/data.mjs:543
    offsets: unknown; // GridOffsetsField; F common/data/data.mjs:555
    origin: { x: number; y: number } | null; // common/data/data.mjs:556
  }

  type FoundryRegionShape =
    | FoundryRectangleShape
    | FoundryCircleShape
    | FoundryEllipseShape
    | FoundryEmanationShape
    | FoundryConeShape
    | FoundryRingShape
    | FoundryLineShape
    | FoundryPolygonShape
    | FoundryTokenFootprintShape
    | FoundryGridShape;

  /**
   * RegionBehaviorDocument (common/documents/region-behavior.mjs:42-51), embedded in `RegionDocument#behaviors`.
   * The module never reads a behavior.
   */
  interface RegionBehaviorDocument extends FoundryDocument {
    name: string; // common/documents/region-behavior.mjs:45
    readonly type: string; // common/documents/region-behavior.mjs:46
    system: {}; // common/documents/region-behavior.mjs:47
    disabled: boolean; // common/documents/region-behavior.mjs:48
    readonly region: RegionDocument | null; // client/documents/region-behavior.mjs:27
    readonly active: boolean; // client/documents/region-behavior.mjs:48
  }

  /**
   * RegionDocument (common/documents/region.mjs:51-85, client/documents/region.mjs). v14 also holds AoE
   * "templates" (MeasuredTemplate was removed in 14.352). The module creates them in src/systems/regions.ts
   * and tells them apart by `flags['foundry-mcp-bridge'].template`.
   * `elevation` is an OBJECT here (range), not a number as on Token, Note and AmbientLight.
   */
  interface RegionDocument extends FoundryDocument {
    name: string; // common/documents/region.mjs:52
    /** CSS color string in source; a Color at runtime. */
    color: FoundryColor; // common/documents/region.mjs:53
    /** Shape list; discriminated by `type`. */
    shapes: FoundryRegionShape[]; // common/documents/region.mjs:55
    /** Vertical extent; null `bottom` = -Infinity, null `top` = +Infinity. */
    elevation: { bottom: number | null; top: number | null; topInclusive: boolean }; // common/documents/region.mjs:56
    /** v14 only (14.353+): Scene Level ids the region applies to (empty = every level). Set at runtime. */
    levels?: Set<string>; // common/documents/region.mjs:64
    restriction: {
      enabled: boolean;
      /** One of CONST.EDGE_RESTRICTION_TYPES: light, darkness, sight, sound, move. */
      type: 'light' | 'darkness' | 'sight' | 'sound' | 'move';
      priority: number;
    }; // common/documents/region.mjs:65
    /** v14: id of a token the region is attached to. */
    attachment: { token: string | null }; // common/documents/region.mjs:70
    readonly behaviors: FoundryCollection<RegionBehaviorDocument>; // common/documents/region.mjs:73
    /** CONST.REGION_VISIBILITY: LAYER 0, GAMEMASTER 1, ALWAYS 2, OBSERVER 3, LAYER_UNLOCKED 4. */
    visibility: 0 | 1 | 2 | 3 | 4; // common/documents/region.mjs:74
    highlightMode: 'shapes' | 'coverage'; // common/documents/region.mjs:77
    displayMeasurements: boolean; // common/documents/region.mjs:79
    hidden: boolean; // common/documents/region.mjs:80
    locked: boolean; // common/documents/region.mjs:81
    readonly ownership: Record<string, number>; // common/documents/region.mjs:82
    /** @internal cached shape constraints; never written by callers. */
    _shapeConstraints?: number[][] | null; // common/documents/region.mjs:85
    // client
    /** The tokens currently inside the region. */
    readonly tokens: ReadonlySet<TokenDocument>; // client/documents/region.mjs:152
    readonly isSingleShape: boolean; // client/documents/region.mjs:45
    readonly bounds: { x: number; y: number; width: number; height: number }; // client/documents/region.mjs:129
    readonly area: number; // client/documents/region.mjs:141
    testPoint(point: { x: number; y: number; elevation?: number }): boolean; // client/documents/region.mjs:228
    teleportToken?(token: TokenDocument, options?: Record<string, unknown>): Promise<unknown>; // client/documents/region.mjs:1371
    spawnTokens?(
      tokenData: Record<string, unknown>[],
      options?: Record<string, unknown>
    ): Promise<unknown>; // client/documents/region.mjs:1583
  }
}

export {};
