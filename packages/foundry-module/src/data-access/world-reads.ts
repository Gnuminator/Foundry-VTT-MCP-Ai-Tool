import * as shared from './shared.js';
import { ERROR_MESSAGES } from '../constants.js';
import type { SceneInfo, SceneToken, WorldInfo } from './types.js';

/**
 * Read-only world and scene domain for `FoundryDataAccess`.
 *
 * Backs the tools that give an AI model a quick orientation to the live game:
 * who's in the world, what scene is active, what actors exist, and which
 * compendium packs are available. All four methods are read-only — no writes,
 * no permission gates, no audit trail. Everything here is metadata that helps
 * the model decide what follow-up queries to make.
 *
 * Foundry's globals are duck-typed throughout. We read defensively with
 * `|| ''`-style fallbacks because partially-populated documents appear in the
 * wild, and we want concise tool output rather than `null`-polluted objects.
 */
export class WorldReadsDataAccess {
  // ===== PUBLIC READS =====

  /**
   * List every world actor with lightweight identity metadata.
   *
   * The `img` key is omitted entirely when the actor has no image — the model
   * should not have to filter `undefined` image values from its roster view.
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
   * Describe the currently active scene, including its token roster, map-note
   * labels, and embedded-object counts (walls/lights/sounds).
   *
   * Throws `SCENE_NOT_FOUND` when no scene is active so callers get a clear
   * error rather than a null-reference explosion. Token dispositions are
   * normalized through `shared.getTokenDisposition` to guarantee a number.
   */
  async getActiveScene(): Promise<SceneInfo> {
    const scene = (game.scenes as any).current;
    if (!scene) {
      throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);
    }

    return {
      id: scene.id,
      name: scene.name,
      img: scene.img || undefined,
      background: scene._source?.background?.src || undefined,
      width: scene.width,
      height: scene.height,
      padding: scene.padding,
      active: scene.active,
      navigation: scene.navigation,
      tokens: scene.tokens.map((token: any) => this.summarizeToken(token)),
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
  }

  /**
   * Report world/system/engine version metadata and the current user roster.
   *
   * No permission gate — this is basic orientation data the model needs to
   * know which system rules apply and who's online.
   */
  async getWorldInfo(): Promise<WorldInfo> {
    return {
      id: game.world.id,
      title: game.world.title,
      system: game.system.id,
      systemVersion: game.system.version,
      foundryVersion: game.version,
      users: game.users.map(user => this.summarizeUser(user)),
    };
  }

  /**
   * List available compendium packs with their identity metadata.
   *
   * The model uses this to know which packs to search when looking up
   * creatures, spells, or items. `private` distinguishes packs the GM has
   * hidden from players — relevant when deciding what to surface.
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

  // ===== PRIVATE HELPERS =====

  /**
   * Flatten a Foundry token document to the wire shape the scene tool exposes.
   *
   * `actorId` is omitted when absent — a token without an actor link (e.g. a
   * decorative prop) should not carry a spurious `undefined` key. Disposition
   * is coerced to a number through `shared.getTokenDisposition` in case the
   * document carries an unexpected non-numeric value.
   */
  private summarizeToken(token: any): SceneToken {
    return {
      id: token.id,
      name: token.name,
      x: token.x,
      y: token.y,
      width: token.width,
      height: token.height,
      ...(token.actorId ? { actorId: token.actorId } : {}),
      img: token.texture?.src || '',
      hidden: token.hidden,
      disposition: shared.getTokenDisposition(token.disposition),
    };
  }

  /** Map a Foundry user document to the lightweight roster entry. */
  private summarizeUser(user: any): { id: string; name: string; active: boolean; isGM: boolean } {
    return {
      id: user.id || '',
      name: user.name || '',
      active: user.active,
      isGM: user.isGM,
    };
  }
}
