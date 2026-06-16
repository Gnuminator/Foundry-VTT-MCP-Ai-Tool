import * as shared from './shared.js';
import { ERROR_MESSAGES } from '../constants.js';
import type { SceneInfo, WorldInfo } from './types.js';

/** Basic world/scene/actor read domain — extracted from FoundryDataAccess. */
export class WorldReadsDataAccess {
  /**
   * List all actors with basic information
   */
  async listActors(): Promise<Array<{ id: string; name: string; type: string; img?: string }>> {
    return game.actors.map(actor => ({
      id: actor.id || '',
      name: actor.name || '',
      type: actor.type,
      ...(actor.img ? { img: actor.img } : {}),
    }));
  }

  /**
   * Get active scene information
   */
  async getActiveScene(): Promise<SceneInfo> {
    const scene = (game.scenes as any).current;
    if (!scene) {
      throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);
    }

    const sceneData: SceneInfo = {
      id: scene.id,
      name: scene.name,
      img: scene.img || undefined,
      background: scene._source?.background?.src || undefined,
      width: scene.width,
      height: scene.height,
      padding: scene.padding,
      active: scene.active,
      navigation: scene.navigation,
      tokens: scene.tokens.map((token: any) => ({
        id: token.id,
        name: token.name,
        x: token.x,
        y: token.y,
        width: token.width,
        height: token.height,
        actorId: token.actorId || undefined,
        img: token.texture?.src || '',
        hidden: token.hidden,
        disposition: shared.getTokenDisposition(token.disposition),
      })),
      walls: scene.walls.size,
      lights: scene.lights.size,
      sounds: scene.sounds.size,
      notes: scene.notes.map((note: any) => ({
        id: note.id,
        text: note.text || '',
        x: note.x,
        y: note.y,
      })),
    };

    return sceneData;
  }

  /**
   * Get world information
   */
  async getWorldInfo(): Promise<WorldInfo> {
    // World info doesn't require special permissions as it's basic metadata

    return {
      id: game.world.id,
      title: game.world.title,
      system: game.system.id,
      systemVersion: game.system.version,
      foundryVersion: game.version,
      users: game.users.map(user => ({
        id: user.id || '',
        name: user.name || '',
        active: user.active,
        isGM: user.isGM,
      })),
    };
  }

  /**
   * Get available compendium packs
   */
  async getAvailablePacks() {
    return Array.from(game.packs.values()).map(pack => ({
      id: pack.metadata.id,
      label: pack.metadata.label,
      type: pack.metadata.type,
      system: pack.metadata.system,
      private: pack.metadata.private,
    }));
  }
}
