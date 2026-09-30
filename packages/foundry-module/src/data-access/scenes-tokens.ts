import { ERROR_MESSAGES } from '../constants.js';
import { permissionManager } from '../permissions.js';
import * as shared from './shared.js';
import { sceneBackgroundSrc } from '../systems/core.js';
import { findStatusEffect } from '../systems/dnd5e/status-effects.js';

/** Normalize a thrown value to a message string for wrapped error reporting. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** How long `switchScene` waits for the GM client's view to follow an activation. */
const SCENE_VIEW_WAIT_MS = 2000;

/** A normalized hit-point block as surfaced to tool callers. */
interface HpSnapshot {
  value: any;
  max: any;
}

/**
 * Scenes and tokens domain — listing/switching scenes and reading or mutating
 * the tokens placed on them.
 *
 * Two error conventions live side by side here, and both are part of the
 * contract:
 *
 *   - The token *write* methods (move/update/delete/toggleCondition) and
 *     `getTokenDetails` wrap their failures as `Failed to <verb>: <reason>` and
 *     surface a missing scene as `No active scene found`.
 *   - The tactical reads/writes added for the co-GM tooling (`getTokenPositions`,
 *     `measureDistance`, `getTargets`, `setTokenVisionLight`) let their errors
 *     propagate raw and report a missing scene as `ERROR_MESSAGES.SCENE_NOT_FOUND`.
 *
 * Write methods run their permission gate *before* the try/catch so an
 * `ACCESS_DENIED` is never reshaped into a `Failed to …` wrapper.
 */
export class ScenesTokensDataAccess {
  // --- Shared internals ------------------------------------------------------

  /** The scene currently on the canvas, or throw `message` when there is none. */
  private requireCurrentScene(message: string): any {
    const scene = (game.scenes as any)?.current;
    if (!scene) {
      throw new Error(message);
    }
    return scene;
  }

  /** Look up a token in `scene` by id, or throw the standard not-found error. */
  private requireToken(scene: any, tokenId: string): any {
    const token = scene.tokens.get(tokenId);
    if (!token) {
      throw new Error(`Token ${tokenId} not found in current scene`);
    }
    return token;
  }

  /** Gate a scene-mutating operation behind a write permission (`modifyScene` by default). */
  private requireScenePermission(
    targetIds: string[],
    operation: 'modifyScene' | 'deleteData' = 'modifyScene'
  ): void {
    const permissionCheck = permissionManager.checkWritePermission(operation, { targetIds });
    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }
  }

  /** Normalize a dnd5e `hp` block to `{ value, max }` (nulls for gaps), or null. */
  private hpSnapshot(hp: any): HpSnapshot | null {
    return hp ? { value: hp.value ?? null, max: hp.max ?? null } : null;
  }

  // --- Scene reads / control -------------------------------------------------

  /**
   * List scenes as flat summaries, optionally narrowed to the active scene
   * and/or filtered by a case-insensitive substring of the scene name.
   *
   * Filters compose in order: active-only is applied first, then the name
   * filter, so `{ include_active_only: true, filter }` returns the active
   * scenes whose name also matches.
   */
  async listScenes(
    options: { filter?: string; include_active_only?: boolean } = {}
  ): Promise<any[]> {
    shared.validateFoundryState();

    try {
      let scenes = game.scenes?.contents || [];

      if (options.include_active_only) {
        scenes = scenes.filter((scene: any) => scene.active);
      }

      if (options.filter) {
        const filterLower = options.filter.toLowerCase();
        scenes = scenes.filter((scene: any) => scene.name.toLowerCase().includes(filterLower));
      }

      return scenes.map((scene: any) => ({
        id: scene.id,
        name: scene.name,
        active: scene.active,
        // `dimensions` is the computed canvas size; fall back to the stored
        // width/height when the scene isn't the one on the canvas.
        dimensions: {
          width: scene.dimensions?.width || scene.width || 0,
          height: scene.dimensions?.height || scene.height || 0,
        },
        gridSize: scene.grid?.size || 100,
        // Prefer the resolved background (`sceneBackgroundSrc`: the current Scene
        // Level's background on v14, `_source.background.src` on v13);
        // `scene.img` is the legacy field.
        background: (sceneBackgroundSrc(scene as Scene) ?? '') || scene.img || '',
        walls: scene.walls?.size || 0,
        tokens: scene.tokens?.size || 0,
        lighting: scene.lights?.size || 0,
        sounds: scene.sounds?.size || 0,
        navigation: scene.navigation || false,
      }));
    } catch (error) {
      throw new Error(`Failed to list scenes: ${errorMessage(error)}`);
    }
  }

  /**
   * Activate a scene by id or (case-insensitive) name. When `optimize_view` is
   * not explicitly `false` and a canvas is available, pan/zoom the canvas to fit
   * the newly active scene.
   */
  async switchScene(options: { scene_identifier: string; optimize_view?: boolean }): Promise<any> {
    shared.validateFoundryState();

    try {
      const scenes = game.scenes?.contents || [];
      const targetScene = scenes.find(
        (scene: any) =>
          scene.id === options.scene_identifier ||
          scene.name.toLowerCase() === options.scene_identifier.toLowerCase()
      );

      if (!targetScene) {
        throw new Error(`Scene not found: "${options.scene_identifier}"`);
      }

      await targetScene.activate();
      await this.followView(targetScene);

      if (options.optimize_view !== false) {
        await this.panCanvasToScene(targetScene);
      }

      return {
        success: true,
        sceneId: targetScene.id,
        sceneName: targetScene.name,
        dimensions: {
          width: (targetScene.dimensions as any)?.width || (targetScene as any).width || 0,
          height: (targetScene.dimensions as any)?.height || (targetScene as any).height || 0,
        },
      };
    } catch (error) {
      throw new Error(`Failed to switch scene: ${errorMessage(error)}`);
    }
  }

  /**
   * Make this GM client view `scene`. Activation normally pulls every client to the new
   * scene, but `activate()` is a no-op when the scene is already active, and a quick switch
   * back can leave the GM client viewing the previous scene (seen in the live write sweep,
   * I-016). The tools act on the viewed scene, so wait briefly for the view to follow and
   * view the scene ourselves when it does not.
   */
  private async followView(scene: any, waitMs = SCENE_VIEW_WAIT_MS): Promise<void> {
    // Headless callers (tests) have no canvas and nothing to view.
    if (typeof canvas === 'undefined' || !canvas) return;
    const viewedId = (): string | undefined => (game.scenes as any)?.viewed?.id;
    const deadline = Date.now() + waitMs;
    while (viewedId() !== scene.id && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (viewedId() !== scene.id && typeof scene.view === 'function') {
      await scene.view();
    }
  }

  /**
   * Center and zoom the canvas to fit `scene`. No-op unless a canvas is mounted
   * (so it's safe to call headless — e.g. the test harness has no canvas).
   */
  private async panCanvasToScene(scene: any): Promise<void> {
    // `typeof` guard: headless callers (tests) may have no `canvas` global at all.
    const cv = typeof canvas === 'undefined' ? undefined : canvas;
    if (!cv?.scene) {
      return;
    }

    const dimensions = scene.dimensions || {
      width: scene.width || 0,
      height: scene.height || 0,
    };
    const width = dimensions.width || 0;
    const height = dimensions.height || 0;
    if (!width || !height) {
      return;
    }

    await cv.pan({
      x: width / 2,
      y: height / 2,
      // Fit the whole scene on screen without ever zooming past 1:1.
      scale: Math.min(
        (cv.screenDimensions?.[0] ?? 0) / width || 1,
        (cv.screenDimensions?.[1] ?? 0) / height || 1,
        1
      ),
    });
  }

  // --- Token reads -----------------------------------------------------------

  /**
   * Detailed, flat view of a single token on the active scene — geometry,
   * appearance, and a small snapshot of its linked actor (or null when
   * unlinked). The flat shape matches what the MCP server's token tools expect.
   */
  async getTokenDetails(data: { tokenId: string }): Promise<any> {
    shared.validateFoundryState();

    try {
      const scene = this.requireCurrentScene('No active scene found');
      const token = this.requireToken(scene, data.tokenId);

      return {
        success: true,
        id: token.id,
        name: token.name,
        x: token.x,
        y: token.y,
        width: token.width,
        height: token.height,
        rotation: token.rotation,
        scale: token.texture?.scaleX || 1,
        alpha: token.alpha,
        hidden: token.hidden,
        disposition: token.disposition,
        elevation: token.elevation,
        lockRotation: token.lockRotation,
        img: token.texture?.src,
        actorId: token.actor?.id,
        actorData: token.actor
          ? {
              name: token.actor.name,
              type: token.actor.type,
              img: token.actor.img,
            }
          : null,
        actorLink: token.actorLink,
      };
    } catch (error) {
      throw new Error(`Failed to get token details: ${errorMessage(error)}`);
    }
  }

  /**
   * Positions of every token on a scene (the active one, or `sceneId` if given),
   * in both pixels and grid coordinates, with category (pc / enemy / npc), HP,
   * and active conditions — the tactical snapshot the co-GM map view consumes.
   */
  async getTokenPositions(data: { sceneId?: string }): Promise<any> {
    shared.validateFoundryState();

    const scene: any = data.sceneId ? game.scenes?.get(data.sceneId) : (game.scenes as any).current;
    if (!scene) {
      throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);
    }

    const grid = scene.grid || {};
    const gridSize = grid.size || 100;

    const tokens = scene.tokens.map((t: any) => {
      const actor = t.actor;
      const isPC = !!actor?.hasPlayerOwner && actor?.type === 'character';
      return {
        tokenId: t.id,
        name: t.name,
        actorId: t.actorId || actor?.id || null,
        x: t.x,
        y: t.y,
        gridX: Math.floor(t.x / gridSize),
        gridY: Math.floor(t.y / gridSize),
        elevation: t.elevation ?? 0,
        category: isPC ? 'pc' : t.disposition === -1 ? 'enemy' : 'npc',
        hidden: t.hidden ?? false,
        hp: this.hpSnapshot(actor?.system?.attributes?.hp),
        conditions: shared.actorConditionNames(actor),
      };
    });

    return {
      success: true,
      sceneId: scene.id,
      sceneName: scene.name,
      gridSize,
      gridDistance: grid.distance ?? null,
      gridUnits: grid.units ?? 'ft',
      tokenCount: tokens.length,
      tokens,
    };
  }

  /**
   * Distance between two named tokens on the active scene. Token lookup prefers
   * an exact (case-insensitive) name match, then a substring match.
   *
   * Measurement uses Foundry's own grid math when the scene is the one on the
   * canvas; otherwise it falls back to a manual calculation: Chebyshev (D&D 5e
   * "every square is one step") for square/gridless grids, and a Euclidean
   * approximation — flagged `approximate: true` — for hex grids, whose true
   * distance needs the on-canvas grid.
   */
  async measureDistance(data: { fromTokenName: string; toTokenName: string }): Promise<any> {
    shared.validateFoundryState();

    const scene: any = (game.scenes as any).current;
    if (!scene) {
      throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);
    }

    const grid = scene.grid || {};
    const gridSize = grid.size || 100;
    const gridDistance = grid.distance ?? 5;
    const units = grid.units || 'ft';

    const findToken = (name: string): any =>
      scene.tokens.find((t: any) => t.name?.toLowerCase() === name.toLowerCase()) ||
      scene.tokens.find((t: any) => t.name?.toLowerCase().includes(name.toLowerCase()));

    const from = findToken(data.fromTokenName);
    if (!from) {
      throw new Error(`Token not found: ${data.fromTokenName}`);
    }
    const to = findToken(data.toTokenName);
    if (!to) {
      throw new Error(`Token not found: ${data.toTokenName}`);
    }

    const center = (t: any) => ({
      x: t.x + ((t.width ?? 1) * gridSize) / 2,
      y: t.y + ((t.height ?? 1) * gridSize) / 2,
    });
    const fromCenter = center(from);
    const toCenter = center(to);

    let distance: number | null = null;
    let approximate = false;

    // Prefer Foundry's grid measurement when this scene is the one on the canvas.
    try {
      const canvasAny = (globalThis as any).canvas;
      if (
        canvasAny?.ready &&
        canvasAny.scene?.id === scene.id &&
        typeof canvasAny.grid?.measurePath === 'function'
      ) {
        const result = canvasAny.grid.measurePath([fromCenter, toCenter]);
        distance = result?.distance ?? null;
      }
    } catch {
      // fall through to manual calculation
    }

    if (distance == null) {
      const dx = Math.abs(toCenter.x - fromCenter.x);
      const dy = Math.abs(toCenter.y - fromCenter.y);
      const unitsPerPixel = gridDistance / gridSize;
      if (grid.type === 1 || grid.type === 0 || grid.type == null) {
        // Square (1) or gridless (0): Chebyshev distance.
        distance = Math.max(dx, dy) * unitsPerPixel;
      } else {
        // Hex (2-5): Euclidean approximation; true hex distance needs the canvas.
        distance = Math.hypot(dx, dy) * unitsPerPixel;
        approximate = true;
      }
      distance = Math.round(distance);
    }

    return {
      success: true,
      from: from.name,
      to: to.name,
      distance,
      units,
      ...(approximate ? { approximate: true } : {}),
    };
  }

  /**
   * The tokens the acting GM currently has targeted (`game.user.targets`), each
   * with AC and HP — used to resolve attack targets without the caller passing
   * coordinates or stat blocks.
   */
  async getTargets(): Promise<any> {
    shared.validateFoundryState();

    const targets = Array.from((game.user as any)?.targets ?? []);
    return {
      success: true,
      count: targets.length,
      targets: targets.map((t: any) => ({
        tokenId: t.id,
        name: t.name,
        actorId: t.actor?.id ?? null,
        ac: t.actor?.system?.attributes?.ac?.value ?? null,
        hp: this.hpSnapshot(t.actor?.system?.attributes?.hp),
      })),
    };
  }

  // --- Token writes ----------------------------------------------------------

  /** Move a token to a new (x, y) on the active scene, optionally animating. */
  async moveToken(data: {
    tokenId: string;
    x: number;
    y: number;
    animate?: boolean;
  }): Promise<any> {
    shared.validateFoundryState();
    this.requireScenePermission([data.tokenId]);

    try {
      const scene = this.requireCurrentScene('No active scene found');
      const token = this.requireToken(scene, data.tokenId);

      const animated = data.animate !== false;
      await token.update({ x: data.x, y: data.y }, { animate: animated });

      return {
        success: true,
        tokenId: token.id,
        tokenName: token.name,
        newPosition: { x: data.x, y: data.y },
        animated,
      };
    } catch (error) {
      throw new Error(`Failed to move token: ${errorMessage(error)}`);
    }
  }

  /**
   * Update arbitrary token properties on the active scene. Undefined values are
   * dropped before the update, and only the surviving keys are reported back.
   */
  async updateToken(data: { tokenId: string; updates: Record<string, any> }): Promise<any> {
    shared.validateFoundryState();
    this.requireScenePermission([data.tokenId]);

    try {
      const scene = this.requireCurrentScene('No active scene found');
      const token = this.requireToken(scene, data.tokenId);

      const cleanUpdates = Object.fromEntries(
        Object.entries(data.updates).filter(([, v]) => v !== undefined)
      );

      await token.update(cleanUpdates);

      return {
        success: true,
        tokenId: token.id,
        tokenName: token.name,
        updatedProperties: Object.keys(cleanUpdates),
      };
    } catch (error) {
      throw new Error(`Failed to update token: ${errorMessage(error)}`);
    }
  }

  /**
   * Delete one or more tokens from the active scene. Missing ids (and any that
   * fail to delete) are collected into `failedTokens` rather than aborting; the
   * call still resolves successfully. `failedTokens` is omitted when empty.
   */
  async deleteTokens(data: { tokenIds: string[] }): Promise<any> {
    shared.validateFoundryState();
    this.requireScenePermission(data.tokenIds, 'deleteData');

    try {
      const scene = this.requireCurrentScene('No active scene found');

      const deletedTokens: string[] = [];
      const failedTokens: string[] = [];

      for (const tokenId of data.tokenIds) {
        try {
          const token = scene.tokens.get(tokenId);
          if (token) {
            await token.delete();
            deletedTokens.push(tokenId);
          } else {
            failedTokens.push(tokenId);
          }
        } catch {
          failedTokens.push(tokenId);
        }
      }

      return {
        success: true,
        deletedCount: deletedTokens.length,
        deletedTokens,
        failedTokens: failedTokens.length > 0 ? failedTokens : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to delete tokens: ${errorMessage(error)}`);
    }
  }

  /**
   * Apply or remove a status condition on a token's actor. The condition is
   * resolved from `CONFIG.statusEffects` by id or (case-insensitive) name
   * (via {@link findStatusEffect}, which handles both the array (core/dnd5e
   * 5.x) and id-keyed-object (dnd5e 6.0) storage shapes).
   *
   * Applying/removing is delegated to `actor.toggleStatusEffect(id, {active})`
   * (verified `client/documents/actor.mjs:547`, unchanged since well before
   * v13/v14) instead of building a raw `{name, icon, statuses}` ActiveEffect:
   * dnd5e 6.0's override (`dnd5e.mjs:46035` `Actor5e#toggleStatusEffect`)
   * creates the typed `condition` effect (`system.type`/`system.level`) and
   * handles exhaustion-style leveled conditions
   * (`ConditionData._applyDelta`/`hasLevels`, `dnd5e.mjs:7092-7256`) that a raw
   * effect document can't represent; core's own implementation (both
   * versions) does the equivalent for non-leveled conditions.
   */
  async toggleTokenCondition(data: {
    tokenId: string;
    conditionId: string;
    active: boolean;
  }): Promise<any> {
    shared.validateFoundryState();
    this.requireScenePermission([data.tokenId]);

    try {
      const scene = this.requireCurrentScene('No active scene found');
      const token = this.requireToken(scene, data.tokenId);

      const actor = token.actor;
      if (!actor) {
        throw new Error(`Token ${data.tokenId} has no associated actor`);
      }

      const condition = findStatusEffect(data.conditionId);
      if (!condition) {
        throw new Error(`Condition not found: ${data.conditionId}`);
      }

      await actor.toggleStatusEffect(condition.id, { active: data.active });

      const conditionName = condition.name || condition.label || condition.id;
      return {
        success: true,
        tokenId: token.id,
        tokenName: token.name,
        conditionId: data.conditionId,
        conditionName,
        isActive: data.active,
        active: data.active,
        message: data.active
          ? `Applied ${data.conditionId} to ${token.name}`
          : `Removed ${data.conditionId} from ${token.name}`,
      };
    } catch (error) {
      throw new Error(`Failed to toggle token condition: ${errorMessage(error)}`);
    }
  }

  /**
   * Set a token's vision and/or light on the active scene (e.g. hand it a torch,
   * or toggle sight for a blinded creature). Only the provided fields are
   * written; numeric/boolean fields are applied even when falsy (`0` / `false`),
   * while empty string values are ignored. Throws if nothing was provided.
   */
  async setTokenVisionLight(data: {
    tokenName: string;
    sightEnabled?: boolean;
    sightRange?: number;
    visionMode?: string;
    lightDim?: number;
    lightBright?: number;
    lightColor?: string;
    lightAnimation?: string;
  }): Promise<any> {
    shared.validateFoundryState();
    this.requireScenePermission([data.tokenName]); // P-036

    const scene: any = (game.scenes as any)?.current;
    if (!scene) {
      throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);
    }

    const token = scene.tokens.find(
      (t: any) => t.id === data.tokenName || t.name?.toLowerCase() === data.tokenName.toLowerCase()
    );
    if (!token) {
      throw new Error(`Token not found: ${data.tokenName}`);
    }

    const update: any = {};
    if (data.sightEnabled != null) update['sight.enabled'] = data.sightEnabled;
    if (data.sightRange != null) update['sight.range'] = data.sightRange;
    if (data.visionMode) update['sight.visionMode'] = data.visionMode;
    if (data.lightDim != null) update['light.dim'] = data.lightDim;
    if (data.lightBright != null) update['light.bright'] = data.lightBright;
    if (data.lightColor) update['light.color'] = data.lightColor;
    if (data.lightAnimation) update['light.animation.type'] = data.lightAnimation;

    if (Object.keys(update).length === 0) {
      throw new Error('No vision/light fields provided.');
    }

    await token.update(update);

    return {
      success: true,
      tokenId: token.id,
      tokenName: token.name,
      updated: Object.keys(update),
    };
  }
}
