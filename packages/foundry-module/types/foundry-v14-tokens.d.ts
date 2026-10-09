/**
 * Token documents, the Token placeable, the tokens layer and user targets.
 *
 * Foundry VTT 14.368 shapes. Trailing comments are source refs relative to the Foundry app
 * folder (`common/`, `client/`). Schema fields are declared in full; client methods only where
 * useful. Fields that v14 added are optional so v13 data still type-checks.
 */

declare global {
  /** `Color` (foundry.utils.Color): a Number subclass; `_source` holds the hex string. */
  interface FoundryColor {
    readonly css: string; // common/utils/color.mjs:28
    valueOf(): number; // common/utils/color.mjs
    toString(): string; // common/utils/color.mjs
  }

  /** CONST.TOKEN_DISPLAY_MODES values (common/constants.mjs:1111-1140). */
  type FoundryTokenDisplayMode = 0 | 10 | 20 | 30 | 40 | 50;
  /** CONST.TOKEN_DISPOSITIONS values (common/constants.mjs:1151-1171). */
  type FoundryTokenDisposition = -2 | -1 | 0 | 1;
  /** CONST.TOKEN_SHAPES values (common/constants.mjs:1196-1226): ELLIPSE_1..RECTANGLE_2. */
  type FoundryTokenShape = 0 | 1 | 2 | 3 | 4 | 5;

  /** TextureData (common/data/data.mjs:586-594): token, note, drawing and tile textures. */
  interface FoundryTextureData {
    src: string | null; // common/data/data.mjs:586
    anchorX: number; // common/data/data.mjs:588
    anchorY: number; // common/data/data.mjs:589
    fit: 'fill' | 'contain' | 'cover' | 'width' | 'height'; // common/data/data.mjs:590
    scaleX: number; // common/data/data.mjs:591
    scaleY: number; // common/data/data.mjs:592
    tint: FoundryColor; // common/data/data.mjs:593
    alphaThreshold: number; // common/data/data.mjs:594
  }

  /**
   * LightData (common/data/data.mjs:42-78): `TokenDocument#light` and `AmbientLightDocument#config`.
   * (v13 note) same keys; `priority`, `contrast`, `shadows`, `darkness.min/max` exist in v13 too.
   */
  interface FoundryLightData {
    negative: boolean; // common/data/data.mjs:45
    priority: number; // common/data/data.mjs:46
    alpha: number; // common/data/data.mjs:47
    angle: number; // common/data/data.mjs:48
    bright: number; // common/data/data.mjs:49
    color: FoundryColor | null; // common/data/data.mjs:50
    coloration: number; // common/data/data.mjs:51
    dim: number; // common/data/data.mjs:52
    attenuation: number; // common/data/data.mjs:53
    luminosity: number; // common/data/data.mjs:54
    saturation: number; // common/data/data.mjs:55
    contrast: number; // common/data/data.mjs:56
    shadows: number; // common/data/data.mjs:57
    animation: {
      type: string | null; // common/data/data.mjs:59
      speed: number; // common/data/data.mjs:60
      intensity: number; // common/data/data.mjs:62
      reverse: boolean; // common/data/data.mjs:64
    };
    darkness: { min: number; max: number }; // common/data/data.mjs:66
  }

  /** One entry of `TokenDocument#movementHistory` (token.mjs:134-156); @internal source field `_movementHistory`. */
  interface FoundryTokenMovementRecord {
    x: number;
    y: number;
    elevation: number;
    width: number;
    height: number;
    depth: number;
    shape: FoundryTokenShape;
    level: string; // common/documents/token.mjs:135 (movement fields, no initials)
    action: string;
    terrain?: Record<string, unknown> | null;
    snapped?: boolean;
    explicit?: boolean;
    checkpoint?: boolean;
    intermediate?: boolean;
    userId: string;
    movementId: string;
    subpathId: string;
    cost: number | null; // common/documents/token.mjs:155
  }

  /**
   * TokenDocument (common/documents/token.mjs defineSchema 53-159, client/documents/token.mjs).
   * Token documents embedded in `Scene#tokens`. Also what `Combatant#token` and `Actor#token` return.
   * The module mostly reads these through `scene.tokens` as `any`; this makes that typed.
   */
  interface TokenDocument extends FoundryDocument {
    // --- identity -------------------------------------------------------------
    name: string; // common/documents/token.mjs:57
    /** CONST.TOKEN_DISPLAY_MODES; who sees the nameplate. */
    displayName: FoundryTokenDisplayMode; // common/documents/token.mjs:58
    /** Id of the world Actor this token represents (idOnly foreign key; null when none). */
    actorId: string | null; // common/documents/token.mjs:62
    actorLink: boolean; // common/documents/token.mjs:63
    /** The ActorDelta embedded document of an unlinked token; null when linked or lazy. */
    readonly delta: (FoundryDocument & { readonly syntheticActor: Actor | null }) | null; // common/documents/token.mjs:64, syntheticActor client/documents/actor-delta.mjs:28

    // --- movement fields (token.mjs:170-185 #defineMovementFields; MOVEMENT_FIELDS at :203) ---
    x: number; // common/documents/token.mjs:172
    y: number; // common/documents/token.mjs:173
    /** Elevation in grid units. (v13 note) existed in v13. */
    elevation: number; // common/documents/token.mjs:174
    /** Width in grid spaces (positive, multiples of 0.5 after snapping). */
    width: number; // common/documents/token.mjs:175
    height: number; // common/documents/token.mjs:176
    /** v14 only: vertical size in elevation units (min 0, initial 1). */
    depth?: number; // common/documents/token.mjs:177
    /** CONST.TOKEN_SHAPES (hexagonal shape). (v13 note) `hexagonalShape` in v13; deprecated getter remains. */
    shape: FoundryTokenShape; // common/documents/token.mjs:178
    /** v14 only (14.353+): id of the Scene Level the token is on; required, default 'defaultLevel0000'. */
    level?: string; // common/documents/token.mjs:180

    // --- appearance and flags --------------------------------------------------
    texture: FoundryTextureData; // common/documents/token.mjs:66
    sort: number; // common/documents/token.mjs:68
    locked: boolean; // common/documents/token.mjs:69
    lockRotation: boolean; // common/documents/token.mjs:70
    rotation: number; // common/documents/token.mjs:71
    alpha: number; // common/documents/token.mjs:72
    hidden: boolean; // common/documents/token.mjs:73
    /** CONST.TOKEN_DISPOSITIONS: -2 secret, -1 hostile, 0 neutral, 1 friendly. */
    disposition: FoundryTokenDisposition; // common/documents/token.mjs:74
    /** CONST.TOKEN_DISPLAY_MODES; who sees the bars. */
    displayBars: FoundryTokenDisplayMode; // common/documents/token.mjs:78

    // --- resource bars ---------------------------------------------------------
    bar1: { attribute: string | null }; // common/documents/token.mjs:82
    bar2: { attribute: string | null }; // common/documents/token.mjs:86

    // --- light and vision ------------------------------------------------------
    light: FoundryLightData; // common/documents/token.mjs:90
    sight: {
      enabled: boolean; // common/documents/token.mjs:92
      range: number | null; // common/documents/token.mjs:93
      angle: number; // common/documents/token.mjs:94
      visionMode: string; // common/documents/token.mjs:95
      color: FoundryColor | null; // common/documents/token.mjs:96
      attenuation: number; // common/documents/token.mjs:97
      brightness: number; // common/documents/token.mjs:98
      saturation: number; // common/documents/token.mjs:99
      contrast: number; // common/documents/token.mjs:100
    };
    /** Keyed by detection mode id (TypedObjectField). */
    detectionModes: Record<string, { enabled: boolean; range: number | null }>; // common/documents/token.mjs:102
    occludable: { radius: number }; // common/documents/token.mjs:106
    /** Dynamic token ring. (v13 note) existed in v13 (since 12). */
    ring: {
      enabled: boolean;
      colors: { ring: FoundryColor | null; background: FoundryColor | null };
      effects: number;
      subject: { scale: number; texture: string | null };
    }; // common/documents/token.mjs:109-121
    /** Combat turn marker. (v13 note) existed in v13. */
    turnMarker: {
      mode: 0 | 1 | 2;
      animation: string | null;
      src: string | null;
      disposition: boolean;
    }; // common/documents/token.mjs:122-130

    // --- v14 movement system -------------------------------------------------
    /** v14 only: the movement action id (walk, fly, ...); null = default. */
    movementAction?: string | null; // common/documents/token.mjs:131
    /** @internal v14 only: recorded movement waypoints; read through `movementHistory`. */
    _movementHistory?: FoundryTokenMovementRecord[]; // common/documents/token.mjs:134
    /** @internal v14 only: ids of the Regions the token is in; read through `regions`. */
    _regions?: string[]; // common/documents/token.mjs:157

    // --- client getters (client/documents/token.mjs) ---------------------------
    /** Alias of `parent`. */
    readonly scene: Scene | null; // client/documents/token.mjs:105
    /** Current movement data (origin, destination, passed, pending, history). v14 only. */
    readonly movement?: Record<string, unknown>; // client/documents/token.mjs:116
    /** The Actor: the world actor when linked, else the synthetic actor from the delta (null before init). */
    readonly actor: Actor | null; // client/documents/token.mjs:250
    /** The world-level Actor this token represents. */
    readonly baseActor: Actor | null; // client/documents/token.mjs:262
    /** True when the unlinked ActorDelta has not been built yet. */
    readonly isLazyDelta: boolean; // client/documents/token.mjs:284
    readonly isLinked: boolean; // client/documents/token.mjs:330
    /** SECRET disposition and the viewer lacks OBSERVER. */
    readonly isSecret: boolean; // client/documents/token.mjs:341
    readonly combatant: Combatant | null; // client/documents/token.mjs:351
    readonly inCombat: boolean; // client/documents/token.mjs:361
    /** v14 only. */
    readonly movementHistory?: FoundryTokenMovementRecord[]; // client/documents/token.mjs:371
    readonly hasDistinctSubjectTexture: boolean; // client/documents/token.mjs:381
    /** v14: the Regions this token is currently in (null before documents are ready). */
    readonly regions: Set<RegionDocument> | null; // client/documents/token.mjs:392
    /** The placeable on the canvas, null when the scene is not drawn. */
    readonly object: Token | null; // client/documents/abstract/canvas-document.mjs:31
    readonly rendered: boolean; // client/documents/abstract/canvas-document.mjs:66
    /** Whether the current user can see it (GM always true). */
    readonly visible: boolean; // client/documents/abstract/canvas-document.mjs:73
    /** v14: included in the viewed Level. */
    readonly viewed?: boolean; // client/documents/abstract/canvas-document.mjs:86

    // --- methods --------------------------------------------------------------
    hasStatusEffect(statusId: string): boolean; // client/documents/token.mjs:596
    getBarAttribute(
      barName: 'bar1' | 'bar2',
      options?: { alternative?: string }
    ): {
      type: 'value' | 'bar';
      attribute: string;
      value: number;
      max?: number;
      editable: boolean;
    } | null; // client/documents/token.mjs:554
    /** v14 only: move through waypoints with Foundry's movement pipeline. */
    move?(
      waypoints: Record<string, unknown>[],
      options?: Record<string, unknown>
    ): Promise<boolean>; // client/documents/token.mjs:707
    resize?(
      dimensions: Record<string, number>,
      options?: Record<string, unknown>
    ): Promise<boolean>; // client/documents/token.mjs:749
    stopMovement?(): void; // client/documents/token.mjs:762
    clearMovementHistory?(): Promise<void>; // client/documents/token.mjs:3189
    toggleCombatant(options?: { active?: boolean }): Promise<Combatant[]>; // client/documents/token.mjs:1545
    updateVisionMode(visionMode: string, defaults?: boolean): Promise<this>; // client/documents/token.mjs:1613
    testInsideRegion?(region: RegionDocument, data?: Record<string, unknown>): boolean; // client/documents/token.mjs:3236
    getSnappedPosition(
      data?: Partial<{
        x: number;
        y: number;
        elevation: number;
        width: number;
        height: number;
        shape: number;
      }>
    ): { x: number; y: number; elevation: number }; // common/documents/token.mjs:286
    getSize(data?: Record<string, number>): { width: number; height: number }; // common/documents/token.mjs:481
    getCenterPoint(data?: Record<string, number>): { x: number; y: number; elevation?: number }; // common/documents/token.mjs:506
    /** @deprecated since v13, removed in v15: use `shape`. */
    readonly hexagonalShape?: FoundryTokenShape; // common/documents/token.mjs:988
    /** Current user's ownership level (the actor's, or OWNER for GMs/actor-less tokens). */
    getUserLevel(user?: User): number; // common/documents/token.mjs:940
  }

  interface TokenDocumentClass extends FoundryDocumentClass<TokenDocument> {
    /** v14: ["x","y","elevation","width","height","depth","shape","level"]. */
    readonly MOVEMENT_FIELDS?: readonly string[]; // common/documents/token.mjs:204
    readonly DEFAULT_ICON: string; // common/documents/token.mjs:224
  }

  /**
   * Prototype token on an Actor (`Actor#prototypeToken`): a DataModel (not a Document) holding
   * the subset below plus `randomImg`, `appendNumber`, `prependAdjective`.
   * F common/data/data.mjs:613-625
   * src/data-access/actor-creation.ts:413 (toObject)
   */
  interface FoundryPrototypeToken
    extends Pick<
      TokenDocument,
      | 'name'
      | 'displayName'
      | 'actorLink'
      | 'width'
      | 'height'
      | 'depth'
      | 'texture'
      | 'lockRotation'
      | 'rotation'
      | 'alpha'
      | 'disposition'
      | 'displayBars'
      | 'bar1'
      | 'bar2'
      | 'light'
      | 'sight'
      | 'detectionModes'
      | 'occludable'
      | 'ring'
      | 'turnMarker'
      | 'movementAction'
      | 'flags'
    > {
    randomImg: boolean; // common/data/data.mjs:622
    appendNumber: boolean; // common/data/data.mjs:623
    prependAdjective: boolean; // common/data/data.mjs:624
    readonly actor: Actor | null; // common/data/data.mjs:635
    toObject(source?: boolean): Record<string, any>; // DataModel
  }

  /** PIXI.Point / PIXI.Rectangle as far as the module could use them. */
  interface FoundryPoint {
    x: number;
    y: number;
  }
  interface FoundryRectangle {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  /**
   * The Token placeable (client/canvas/placeables/token.mjs, extends PlaceableObject extends PIXI.Container).
   * The module never touches the canvas tokens layer. The only placeables it sees are the entries of
   * `game.user.targets` (src/data-access/scenes-tokens.ts:397-407, src/data-access/actor-builder.ts:1548-1553),
   * and from those it reads only `id`, `name` and `actor`.
   * Caution: `x` and `y` on the placeable are the PIXI display position (they lag behind `document.x`/`document.y`
   * while a move animates); read `document.x`/`document.y` or `document._source` for the stored position.
   */
  interface Token {
    /** The embedded TokenDocument. */
    readonly document: TokenDocument; // client/canvas/placeables/placeable-object.mjs:40
    readonly scene: Scene; // client/canvas/placeables/placeable-object.mjs:34
    /** Alias of `document.id`. */
    readonly id: string; // client/canvas/placeables/placeable-object.mjs:224
    /** Alias of `document.name`. */
    readonly name: string; // client/canvas/placeables/token.mjs:410
    /** `document.actor`: world actor when linked, synthetic actor when not. */
    readonly actor: Actor | null; // client/canvas/placeables/token.mjs:390
    /** Current user has OBSERVER (or is GM). */
    readonly observer: boolean; // client/canvas/placeables/token.mjs:400
    /** PIXI position; see the caution above. */
    x: number; // PIXI.Container#x, set by token.mjs:1549 (_refreshPosition)
    y: number; // PIXI.Container#y, set by token.mjs:1549
    /** Pixel size from `document.getSize()`. */
    readonly w: number; // client/canvas/placeables/token.mjs:431
    readonly h: number; // client/canvas/placeables/token.mjs:441
    readonly bounds: FoundryRectangle; // client/canvas/placeables/token.mjs:419
    /** Center point in scene pixels. */
    readonly center: FoundryPoint; // client/canvas/placeables/token.mjs:448
    /** The PIXI `visible` flag; use `isVisible` for "can the current user see it". */
    visible: boolean; // PIXI.DisplayObject#visible
    readonly isVisible: boolean; // client/canvas/placeables/token.mjs:605
    /** Current user owns the token (GM always). */
    readonly isOwner: boolean; // client/canvas/placeables/placeable-object.mjs:136
    readonly controlled: boolean; // client/canvas/placeables/placeable-object.mjs:312
    hover: boolean; // client/canvas/placeables/placeable-object.mjs:324
    readonly layer: TokenLayer; // client/canvas/placeables/placeable-object.mjs:294
    /** Users that currently target this token. */
    readonly targeted: Set<User>; // client/canvas/placeables/token.mjs:180
    /** Whether the current user targets it. */
    readonly isTargeted: boolean; // client/canvas/placeables/token.mjs:570
    readonly inCombat: boolean; // client/canvas/placeables/token.mjs:550
    readonly combatant: Combatant | null; // client/canvas/placeables/token.mjs:560
    readonly hasSight: boolean; // client/canvas/placeables/token.mjs:685
    readonly emitsLight: boolean; // client/canvas/placeables/token.mjs:721
    /** Vision range in scene pixels. */
    readonly sightRange: number; // client/canvas/placeables/token.mjs:783
    /** Take control (select) the token; returns whether the control changed. */
    control(options?: { releaseOthers?: boolean; pan?: boolean }): boolean; // client/canvas/placeables/placeable-object.mjs:701
    release(options?: Record<string, unknown>): boolean; // client/canvas/placeables/placeable-object.mjs:759
    /** Target or untarget the token for the current user. */
    setTarget(targeted?: boolean, options?: { releaseOthers?: boolean }): void; // client/canvas/placeables/token.mjs:3843
    getCenterPoint(position?: FoundryPoint): FoundryPoint; // client/canvas/placeables/token.mjs:2849
    getSnappedPosition(position?: FoundryPoint): FoundryPoint; // client/canvas/placeables/token.mjs:2857
    /** Animate movement; v14 signature. */
    animate(to: Record<string, unknown>, options?: Record<string, unknown>): Promise<void>; // client/canvas/placeables/token.mjs:2097
    stopAnimation(options?: { reset?: boolean }): Promise<void>; // client/canvas/placeables/token.mjs:2481
    /** v14 only: collision test along a movement path. */
    checkCollision?(
      destination: FoundryPoint,
      options?: { origin?: FoundryPoint; type?: string; mode?: string }
    ): boolean | unknown; // client/canvas/placeables/token.mjs:2761
  }

  /**
   * `User#targets` (client/documents/user.mjs:45): a Set of the targeted Token placeables.
   * The existing d.ts has `Set<any>`.
   */
  interface FoundryUserTargets extends Set<Token> {
    /** Ids of the targeted tokens. */
    readonly ids: string[]; // client/canvas/placeables/tokens/targets.mjs:24
  }

  /**
   * `canvas.tokens` (client/canvas/layers/tokens.mjs + base/placeables-layer.mjs). Only exists while a scene is drawn.
   * Nothing in the module reads it (the scene's tokens are read from `scene.tokens`, documents, not placeables).
   */
  interface TokenLayer {
    /** Every Token placeable on the layer. */
    readonly placeables: Token[]; // client/canvas/layers/base/placeables-layer.mjs:147
    /** The controlled (selected) tokens. */
    readonly controlled: Token[]; // client/canvas/layers/base/placeables-layer.mjs:158
    readonly controlledObjects: Map<string, Token>; // client/canvas/layers/base/placeables-layer.mjs:182
    /** Placeable by id, undefined when absent or the canvas is blank. */
    get(objectId: string): Token | undefined; // client/canvas/layers/base/placeables-layer.mjs:446
    /** Tokens the current user owns. */
    readonly ownedTokens: Token[]; // client/canvas/layers/tokens.mjs:216
    controlAll(options?: Record<string, unknown>): Token[]; // client/canvas/layers/base/placeables-layer.mjs:457
    releaseAll(options?: Record<string, unknown>): number; // client/canvas/layers/base/placeables-layer.mjs:481
    setTargets(targetIds: string[], options?: { mode?: 'replace' | 'acquire' | 'release' }): void; // client/canvas/layers/tokens.mjs:341
  }
}

export {};
