import { ERROR_MESSAGES } from '../constants.js';
import { permissionManager } from '../permissions.js';
import * as shared from './shared.js';

/** Scenes and token manipulation domain — extracted from FoundryDataAccess. */
export class ScenesTokensDataAccess {
  async listScenes(
    options: { filter?: string; include_active_only?: boolean } = {}
  ): Promise<any[]> {
    shared.validateFoundryState();

    try {
      let scenes = game.scenes?.contents || [];

      // Filter by active only if requested
      if (options.include_active_only) {
        scenes = scenes.filter((scene: any) => scene.active);
      }

      // Filter by name if provided
      if (options.filter) {
        const filterLower = options.filter.toLowerCase();
        scenes = scenes.filter((scene: any) => scene.name.toLowerCase().includes(filterLower));
      }

      // Map to consistent format
      return scenes.map((scene: any) => ({
        id: scene.id,
        name: scene.name,
        active: scene.active,
        dimensions: {
          width: scene.dimensions?.width || (scene as any).width || 0,
          height: scene.dimensions?.height || (scene as any).height || 0,
        },
        gridSize: scene.grid?.size || 100,
        background: scene._source?.background?.src || scene.img || '',
        walls: scene.walls?.size || 0,
        tokens: scene.tokens?.size || 0,
        lighting: scene.lights?.size || 0,
        sounds: scene.sounds?.size || 0,
        navigation: scene.navigation || false,
      }));
    } catch (error) {
      throw new Error(
        `Failed to list scenes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Switch to a different scene
   */
  async switchScene(options: { scene_identifier: string; optimize_view?: boolean }): Promise<any> {
    shared.validateFoundryState();

    try {
      // Find the target scene by ID or name
      const scenes = game.scenes?.contents || [];
      const targetScene = scenes.find(
        (scene: any) =>
          scene.id === options.scene_identifier ||
          scene.name.toLowerCase() === options.scene_identifier.toLowerCase()
      );

      if (!targetScene) {
        throw new Error(`Scene not found: "${options.scene_identifier}"`);
      }

      // Activate the scene
      await targetScene.activate();

      // Optimize view if requested (default true)
      if (options.optimize_view !== false && typeof canvas !== 'undefined' && canvas?.scene) {
        const dimensions = targetScene.dimensions || {
          width: (targetScene as any).width || 0,
          height: (targetScene as any).height || 0,
        };
        const width = (dimensions as any).width || 0;
        const height = (dimensions as any).height || 0;

        if (width && height) {
          // Center the view on the scene
          await canvas.pan({
            x: width / 2,
            y: height / 2,
            scale: Math.min(
              (canvas as any).screenDimensions?.[0] / width || 1,
              (canvas as any).screenDimensions?.[1] / height || 1,
              1
            ),
          });
        }
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
      throw new Error(
        `Failed to switch scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Move a token to a new position on the scene
   */
  async moveToken(data: {
    tokenId: string;
    x: number;
    y: number;
    animate?: boolean;
  }): Promise<any> {
    shared.validateFoundryState();

    // Use permission system
    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: [data.tokenId],
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    try {
      const scene = (game.scenes as any).current;
      if (!scene) {
        throw new Error('No active scene found');
      }

      const token = scene.tokens.get(data.tokenId);
      if (!token) {
        throw new Error(`Token ${data.tokenId} not found in current scene`);
      }

      // Update token position
      await token.update(
        {
          x: data.x,
          y: data.y,
        },
        { animate: data.animate !== false }
      );

      shared.auditLog('moveToken', data, 'success');

      return {
        success: true,
        tokenId: token.id,
        tokenName: token.name,
        newPosition: { x: data.x, y: data.y },
        animated: data.animate !== false,
      };
    } catch (error) {
      shared.auditLog(
        'moveToken',
        data,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new Error(
        `Failed to move token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Update token properties
   */
  async updateToken(data: { tokenId: string; updates: Record<string, any> }): Promise<any> {
    shared.validateFoundryState();

    // Use permission system
    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: [data.tokenId],
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    try {
      const scene = (game.scenes as any).current;
      if (!scene) {
        throw new Error('No active scene found');
      }

      const token = scene.tokens.get(data.tokenId);
      if (!token) {
        throw new Error(`Token ${data.tokenId} not found in current scene`);
      }

      // Filter out undefined values
      const cleanUpdates = Object.fromEntries(
        Object.entries(data.updates).filter(([_, v]) => v !== undefined)
      );

      // Apply updates
      await token.update(cleanUpdates);

      shared.auditLog('updateToken', { tokenId: data.tokenId, updates: cleanUpdates }, 'success');

      return {
        success: true,
        tokenId: token.id,
        tokenName: token.name,
        updatedProperties: Object.keys(cleanUpdates),
      };
    } catch (error) {
      shared.auditLog(
        'updateToken',
        data,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new Error(
        `Failed to update token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Delete one or more tokens from the scene
   */
  async deleteTokens(data: { tokenIds: string[] }): Promise<any> {
    shared.validateFoundryState();

    // Use permission system
    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: data.tokenIds,
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    try {
      const scene = (game.scenes as any).current;
      if (!scene) {
        throw new Error('No active scene found');
      }

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
        } catch (error) {
          failedTokens.push(tokenId);
        }
      }

      shared.auditLog(
        'deleteTokens',
        { tokenIds: data.tokenIds, deletedCount: deletedTokens.length },
        'success'
      );

      return {
        success: true,
        deletedCount: deletedTokens.length,
        deletedTokens,
        failedTokens: failedTokens.length > 0 ? failedTokens : undefined,
      };
    } catch (error) {
      shared.auditLog(
        'deleteTokens',
        data,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new Error(
        `Failed to delete tokens: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get detailed information about a token
   */
  async getTokenDetails(data: { tokenId: string }): Promise<any> {
    shared.validateFoundryState();

    try {
      const scene = (game.scenes as any).current;
      if (!scene) {
        throw new Error('No active scene found');
      }

      const token = scene.tokens.get(data.tokenId);
      if (!token) {
        throw new Error(`Token ${data.tokenId} not found in current scene`);
      }

      // Return flat structure that matches MCP server expectations
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
      throw new Error(
        `Failed to get token details: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Toggle a status condition on a token
   */
  async toggleTokenCondition(data: {
    tokenId: string;
    conditionId: string;
    active: boolean;
  }): Promise<any> {
    shared.validateFoundryState();

    // Use permission system
    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: [data.tokenId],
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    try {
      const scene = (game.scenes as any).current;
      if (!scene) {
        throw new Error('No active scene found');
      }

      const token = scene.tokens.get(data.tokenId);
      if (!token) {
        throw new Error(`Token ${data.tokenId} not found in current scene`);
      }

      const actor = token.actor;
      if (!actor) {
        throw new Error(`Token ${data.tokenId} has no associated actor`);
      }

      // Get the condition configuration for the game system
      const conditions = (CONFIG as any).statusEffects || [];
      const condition = conditions.find(
        (c: any) =>
          c.id === data.conditionId || c.name?.toLowerCase() === data.conditionId.toLowerCase()
      );

      if (!condition) {
        throw new Error(`Condition not found: ${data.conditionId}`);
      }

      if (data.active) {
        // Add the condition
        const effectData: any = {
          name: condition.name || condition.label || condition.id,
          icon: condition.icon || condition.img,
        };

        if (condition.id) {
          effectData.statuses = [condition.id];
        }

        await actor.createEmbeddedDocuments('ActiveEffect', [effectData]);
      } else {
        // Remove the condition
        const effects = actor.effects?.contents || [];
        const effectsToRemove = effects.filter((effect: any) => {
          // Check by status
          if (effect.statuses?.has(data.conditionId)) {
            return true;
          }
          // Check by name (fallback)
          if (effect.name?.toLowerCase() === data.conditionId.toLowerCase()) {
            return true;
          }
          // Check by label (some systems use label instead of name)
          if (effect.label?.toLowerCase() === data.conditionId.toLowerCase()) {
            return true;
          }
          return false;
        });

        if (effectsToRemove.length > 0) {
          await actor.deleteEmbeddedDocuments(
            'ActiveEffect',
            effectsToRemove.map((e: any) => e.id)
          );
        }
      }

      shared.auditLog('toggleTokenCondition', data, 'success');

      return {
        success: true,
        tokenId: token.id,
        tokenName: token.name,
        conditionId: data.conditionId,
        conditionName: condition.name || condition.label || condition.id,
        isActive: data.active,
        active: data.active,
        message: data.active
          ? `Applied ${data.conditionId} to ${token.name}`
          : `Removed ${data.conditionId} from ${token.name}`,
      };
    } catch (error) {
      shared.auditLog(
        'toggleTokenCondition',
        data,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new Error(
        `Failed to toggle token condition: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getTokenPositions(data: { sceneId?: string }): Promise<any> {
    shared.validateFoundryState();

    const scene: any = data.sceneId ? game.scenes?.get(data.sceneId) : (game.scenes as any).current;
    if (!scene) throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);

    const grid = scene.grid || {};
    const gridSize = grid.size || 100;

    const tokens = scene.tokens.map((t: any) => {
      const actor = t.actor;
      const hp = actor?.system?.attributes?.hp;
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
        hp: hp ? { value: hp.value ?? null, max: hp.max ?? null } : null,
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

  async measureDistance(data: { fromTokenName: string; toTokenName: string }): Promise<any> {
    shared.validateFoundryState();

    const scene: any = (game.scenes as any).current;
    if (!scene) throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);

    const grid = scene.grid || {};
    const gridSize = grid.size || 100;
    const gridDistance = grid.distance ?? 5;
    const units = grid.units || 'ft';

    const findToken = (name: string): any =>
      scene.tokens.find((t: any) => t.name?.toLowerCase() === name.toLowerCase()) ||
      scene.tokens.find((t: any) => t.name?.toLowerCase().includes(name.toLowerCase()));

    const from = findToken(data.fromTokenName);
    if (!from) throw new Error(`Token not found: ${data.fromTokenName}`);
    const to = findToken(data.toTokenName);
    if (!to) throw new Error(`Token not found: ${data.toTokenName}`);

    const center = (t: any) => ({
      x: t.x + ((t.width ?? 1) * gridSize) / 2,
      y: t.y + ((t.height ?? 1) * gridSize) / 2,
    });
    const fromCenter = center(from);
    const toCenter = center(to);

    let distance: number | null = null;
    let approximate = false;

    // Prefer Foundry's grid measurement when the scene is the one on the canvas
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
      // Square grid (type 1) and gridless (0): D&D 5e uses Chebyshev distance.
      if (grid.type === 1 || grid.type === 0 || grid.type == null) {
        distance = Math.max(dx, dy) * unitsPerPixel;
      } else {
        // Hex (types 2-5): a Euclidean approximation. True hex distance needs
        // Foundry's grid math, which is only available for the on-canvas scene.
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
   * Return the tokens the GM currently has targeted (game.user.targets), with
   * AC and HP — used to resolve attack targets without passing coordinates/AC.
   */
  async getTargets(): Promise<any> {
    shared.validateFoundryState();

    const targets = Array.from((game.user as any)?.targets ?? []);
    return {
      success: true,
      count: targets.length,
      targets: targets.map((t: any) => {
        const hp = t.actor?.system?.attributes?.hp;
        return {
          tokenId: t.id,
          name: t.name,
          actorId: t.actor?.id ?? null,
          ac: t.actor?.system?.attributes?.ac?.value ?? null,
          hp: hp ? { value: hp.value ?? null, max: hp.max ?? null } : null,
        };
      }),
    };
  }

  /**
   * Set a token's vision and/or light (e.g. give it a torch, or toggle sight for
   * a blinded creature) on the active scene.
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

    const scene: any = (game.scenes as any)?.current;
    if (!scene) throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);
    const token = scene.tokens.find(
      (t: any) => t.id === data.tokenName || t.name?.toLowerCase() === data.tokenName.toLowerCase()
    );
    if (!token) throw new Error(`Token not found: ${data.tokenName}`);

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

    shared.auditLog('setTokenVisionLight', { tokenId: token.id, updates: update }, 'success');
    return {
      success: true,
      tokenId: token.id,
      tokenName: token.name,
      updated: Object.keys(update),
    };
  }
}
