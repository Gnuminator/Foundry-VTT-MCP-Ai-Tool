import { MODULE_ID, ERROR_MESSAGES } from '../constants.js';
import { permissionManager } from '../permissions.js';
import { transactionManager } from '../transaction-manager.js';
import * as shared from './shared.js';
import { currentLevelId } from '../systems/core.js';
import { CompendiumDataAccess } from './compendium.js';
import type {
  ActorCreationRequest,
  ActorCreationResult,
  CreatedActorInfo,
  CompendiumEntryFull,
  CompendiumSearchResult,
  SceneTokenPlacement,
  TokenPlacementResult,
} from './types.js';

/** Actor folder that all AI-created creatures are filed under. */
const CREATURES_FOLDER = 'Foundry MCP Creatures';

/**
 * Actor-creation domain — spawning actors from compendium content (by
 * creature-type search or by explicit pack/item id), authoring embedded items
 * onto an existing actor, and dropping actor prototype tokens onto the scene.
 *
 * The compendium domain is injected (creature-type search + full-document
 * fetch), so this domain never reaches into compendium internals directly.
 */
export class ActorCreationDataAccess {
  constructor(private compendium: CompendiumDataAccess) {}

  // ---- public API ----------------------------------------------------------

  /**
   * Create one or more actors by searching the compendium for a creature type,
   * cloning the best match, and (optionally) dropping them onto the scene.
   *
   * Wrapped in a rollback transaction: if more than half the requested actors
   * fail to create, the whole batch is rolled back and the call throws;
   * otherwise it commits and reports per-actor errors non-fatally.
   */
  async createActorFromCompendium(request: ActorCreationRequest): Promise<ActorCreationResult> {
    shared.validateFoundryState();

    const permissionCheck = permissionManager.checkWritePermission('createActor', {
      quantity: request.quantity || 1,
    });
    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    const maxActors = game.settings.get(MODULE_ID, 'maxActorsPerRequest') as number;
    const quantity = Math.min(request.quantity || 1, maxActors);

    const transactionId = transactionManager.startTransaction(
      `Create ${quantity} actor(s) from compendium: ${request.creatureType}`
    );

    try {
      const compendiumEntry = await this.findBestCompendiumMatch(
        request.creatureType,
        request.packPreference
      );
      if (!compendiumEntry) {
        throw new Error(`No compendium entry found for "${request.creatureType}"`);
      }

      const sourceDoc = await this.compendium.getCompendiumDocumentFull(
        compendiumEntry.pack,
        compendiumEntry.id
      );

      const createdActors: CreatedActorInfo[] = [];
      const errors: string[] = [];

      for (let i = 0; i < quantity; i++) {
        try {
          const customName =
            request.customNames?.[i] ||
            (quantity > 1 ? `${sourceDoc.name} ${i + 1}` : sourceDoc.name);

          const newActor = await this.createActorFromSource(sourceDoc, customName);

          transactionManager.addAction(
            transactionId,
            transactionManager.createActorCreationAction(newActor.id)
          );

          createdActors.push({
            id: newActor.id,
            name: newActor.name,
            originalName: sourceDoc.name,
            type: newActor.type,
            sourcePackId: compendiumEntry.pack,
            sourcePackLabel: compendiumEntry.packLabel,
            img: newActor.img,
          });
        } catch (error) {
          errors.push(`Failed to create actor ${i + 1}: ${this.errorMessage(error)}`);
        }
      }

      let tokensPlaced = 0;
      if (request.addToScene && createdActors.length > 0) {
        try {
          const scenePermissionCheck = permissionManager.checkWritePermission('modifyScene', {
            targetIds: createdActors.map(a => a.id),
          });
          if (!scenePermissionCheck.allowed) {
            errors.push(`Cannot add to scene: ${scenePermissionCheck.reason}`);
          } else {
            const tokenResult = await this.addActorsToScene(
              { actorIds: createdActors.map(a => a.id), placement: 'random', hidden: false },
              transactionId
            );
            tokensPlaced = tokenResult.tokensCreated;
          }
        } catch (error) {
          errors.push(`Failed to add actors to scene: ${this.errorMessage(error)}`);
        }
      }

      // Roll back the whole batch only when most of the request failed.
      if (
        errors.length > 0 &&
        createdActors.length < quantity &&
        createdActors.length < quantity / 2
      ) {
        console.warn(
          `[${MODULE_ID}] Rolling back due to significant failures (${createdActors.length}/${quantity} created)`
        );
        await transactionManager.rollbackTransaction(transactionId);
        throw new Error(`Actor creation failed: ${errors.join(', ')}`);
      }

      transactionManager.commitTransaction(transactionId);

      const result: ActorCreationResult = {
        success: createdActors.length > 0,
        actors: createdActors,
        ...(errors.length > 0 ? { errors } : {}),
        tokensPlaced,
        totalRequested: quantity,
        totalCreated: createdActors.length,
      };

      return result;
    } catch (error) {
      try {
        await transactionManager.rollbackTransaction(transactionId);
      } catch (rollbackError) {
        console.error(`[${MODULE_ID}] Failed to rollback transaction:`, rollbackError);
      }
      throw error;
    }
  }

  /**
   * Create actors from a specific compendium document (explicit pack + item id),
   * copying its system/items/effects/prototype-token. No compendium search —
   * the caller already knows exactly which document to clone. No rollback
   * transaction; per-actor failures are reported non-fatally.
   */
  async createActorFromCompendiumEntry(request: {
    packId: string;
    itemId: string;
    customNames: string[];
    quantity?: number;
    addToScene?: boolean;
    placement?: {
      type: 'random' | 'grid' | 'center' | 'coordinates';
      coordinates?: { x: number; y: number }[];
    };
  }): Promise<ActorCreationResult> {
    shared.validateFoundryState();

    // P-036: the same gate as createActorFromCompendium (it creates at most one actor per name).
    const requested = Math.min(
      request.quantity ?? 1,
      Math.max(request.customNames?.length ?? 0, 1)
    );
    const permissionCheck = permissionManager.checkWritePermission('createActor', {
      quantity: requested,
    });
    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    try {
      const { packId, itemId, customNames, quantity = 1, addToScene = false, placement } = request;

      if (!packId || !itemId) {
        throw new Error('Both packId and itemId are required');
      }

      const pack = game.packs.get(packId);
      if (!pack) {
        throw new Error(`Compendium pack "${packId}" not found`);
      }

      const sourceDocument = (await pack.getDocument(itemId)) as Actor | null | undefined;
      if (!sourceDocument) {
        throw new Error(`Document "${itemId}" not found in pack "${packId}"`);
      }
      if (sourceDocument.documentName !== 'Actor') {
        throw new Error(
          `Document "${itemId}" is not an Actor (documentName: ${sourceDocument.documentName}, type: ${sourceDocument.type})`
        );
      }

      const validActorTypes = ['character', 'npc'];
      if (!validActorTypes.includes(sourceDocument.type)) {
        throw new Error(
          `Document "${itemId}" has unsupported actor type: ${sourceDocument.type}. Supported types: ${validActorTypes.join(', ')}`
        );
      }

      const sourceActor = sourceDocument;

      // Default to one "<name> Copy"; otherwise cap quantity at the names given.
      const names = customNames.length > 0 ? customNames : [`${sourceActor.name} Copy`];
      const finalQuantity = Math.min(quantity, names.length);

      const createdActors: Array<
        Pick<CreatedActorInfo, 'id' | 'name' | 'originalName' | 'sourcePackLabel'>
      > = [];
      const errors: string[] = [];

      for (let i = 0; i < finalQuantity; i++) {
        try {
          const customName = names[i] || `${sourceActor.name} ${i + 1}`;
          const sourceData: Record<string, unknown> = sourceActor.toObject();

          const actorData = {
            name: customName,
            type: sourceData.type,
            img: sourceData.img,
            system: sourceData.system || sourceData.data || {},
            items: sourceData.items || [],
            effects: sourceData.effects || [],
            folder: null as string | null, // Don't inherit the source folder.
            prototypeToken: sourceData.prototypeToken,
          };

          this.prepareTokenCopy(actorData.prototypeToken, customName);

          const folderId = await this.creaturesFolderId();
          if (folderId) {
            actorData.folder = folderId;
          }

          const newActor = await Actor.create(actorData);
          if (!newActor) {
            throw new Error(`Failed to create actor "${customName}"`);
          }

          createdActors.push({
            id: newActor.id,
            name: newActor.name,
            originalName: sourceActor.name,
            sourcePackLabel: pack.metadata.label,
          });
        } catch (error) {
          const errorMsg = `Failed to create actor ${i + 1}: ${this.errorMessage(error)}`;
          errors.push(errorMsg);
          console.error(`[${MODULE_ID}] ${errorMsg}`, error);
        }
      }

      let tokensPlaced = 0;
      if (addToScene && createdActors.length > 0) {
        try {
          const sceneResult = await this.addActorsToScene({
            actorIds: createdActors.map(a => a.id),
            placement: placement?.type || 'grid',
            hidden: false,
            ...(placement?.coordinates && { coordinates: placement.coordinates }),
          });
          tokensPlaced = sceneResult.success ? sceneResult.tokensCreated : 0;
        } catch (error) {
          errors.push(`Failed to add actors to scene: ${this.errorMessage(error)}`);
        }
      }

      const result: ActorCreationResult = {
        success: createdActors.length > 0,
        totalCreated: createdActors.length,
        totalRequested: finalQuantity,
        // The compendium-entry path has never reported `type` or `sourcePackId`; the cast keeps that.
        actors: createdActors as CreatedActorInfo[],
        tokensPlaced,
        errors: errors.length > 0 ? errors : undefined,
      };

      return result;
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to create actor from compendium entry`, error);
      throw error;
    }
  }

  /**
   * Add one or more freshly-authored Item documents to an existing Actor.
   *
   * Unlike the `createActorFromCompendium*` paths, the items here are built from
   * caller-supplied data — no compendium lookup. This is how planner-authored
   * content (talents, actions, powers, custom gear) is pushed onto a sheet.
   *
   * Validation is intentionally light: name + type are required, and the type is
   * checked against the active system's declared Item document types when those
   * are available. Everything else (schema validation, sub-field defaults) is
   * left to Foundry's DataModel layer.
   */
  async addActorItems(params: {
    actorIdentifier: string;
    items: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, unknown>;
    }>;
  }): Promise<{
    actorId: string;
    actorName: string;
    created: Array<{ id: string; name: string; type: string }>;
  }> {
    shared.validateFoundryState();

    // P-036: adding items changes the actor, like creating one.
    const permissionCheck = permissionManager.checkWritePermission('createActor');
    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    const { actorIdentifier, items } = params;

    if (!actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items array is required and must contain at least one entry');
    }

    const actor = shared.findActorByIdentifier(actorIdentifier) as Actor | undefined;
    if (!actor) {
      throw new Error(`Actor not found: ${actorIdentifier}`);
    }

    // The active system's declared Item types, for a useful pre-flight error.
    const itemDocTypes: unknown = game.system?.documentTypes?.Item;
    const validTypes: string[] | null =
      itemDocTypes && typeof itemDocTypes === 'object' ? Object.keys(itemDocTypes) : null;

    const payload = items.map((it, idx) => this.buildItemPayload(it, idx, validTypes));

    const created = (await actor.createEmbeddedDocuments('Item', payload)) as Item[];

    const result = {
      actorId: actor.id,
      actorName: actor.name,
      created: (created || []).map(doc => ({
        id: doc.id,
        name: doc.name,
        type: doc.type,
      })),
    };

    return result;
  }

  /**
   * Add actors to the current scene as tokens. Each actor's prototype token is
   * cloned, positioned per the placement strategy, and created on the scene.
   * Per-actor failures (unknown id, bad prototype) are recorded and skipped; a
   * `transactionId` (when supplied) ties the created tokens to a rollback ledger.
   */
  async addActorsToScene(
    placement: SceneTokenPlacement,
    transactionId?: string
  ): Promise<TokenPlacementResult> {
    shared.validateFoundryState();

    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: placement.actorIds,
    });
    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    const scene = game.scenes.current;
    if (!scene) {
      throw new Error('No active scene found');
    }

    // v14 Scene Levels: a Token's `level` field is required + non-nullable and
    // defaults to the scene's *initial* level when omitted — not necessarily the
    // level the GM is currently viewing — so a token dropped while looking at a
    // different level would silently land on the wrong one. `currentLevelId`
    // returns `undefined` on a v13 scene (no `levels`), which is a no-op spread
    // below (matches dnd5e 6's own token-placement code, which also sets it
    // explicitly). verified: common/documents/token.mjs:180 (`level: new
    // DocumentIdField({required: true, nullable: false, ...})`), :234
    // (`data.level ??= this.parent?.initialLevel?.id` — the fallback this avoids).
    const level = currentLevelId(scene);

    const tokenData: Record<string, unknown>[] = [];
    const errors: string[] = [];

    for (const actorId of placement.actorIds) {
      try {
        const actor = game.actors.get(actorId);
        if (!actor) {
          errors.push(`Actor ${actorId} not found`);
          continue;
        }

        const tokenDoc: Record<string, unknown> = actor.prototypeToken.toObject();
        const position = this.calculateTokenPosition(
          placement.placement,
          scene,
          tokenData.length,
          placement.coordinates
        );
        this.prepareTokenCopy(tokenDoc);

        tokenData.push({
          ...tokenDoc,
          x: position.x,
          y: position.y,
          ...(level !== undefined ? { level } : {}),
          actorId,
          hidden: placement.hidden,
        });
      } catch (error) {
        errors.push(`Failed to prepare token for actor ${actorId}: ${this.errorMessage(error)}`);
      }
    }

    const createdTokens = await scene.createEmbeddedDocuments('Token', tokenData);

    if (transactionId && createdTokens.length > 0) {
      for (const token of createdTokens) {
        transactionManager.addAction(
          transactionId,
          transactionManager.createTokenCreationAction(token.id)
        );
      }
    }

    const result: TokenPlacementResult = {
      success: createdTokens.length > 0,
      tokensCreated: createdTokens.length,
      tokenIds: createdTokens.map(token => token.id),
      ...(errors.length > 0 ? { errors } : {}),
    };

    return result;
  }

  // ---- private helpers ------------------------------------------------------

  /** Extract a human-readable message from an unknown thrown value. */
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  /** Resolve, find-or-create, the shared "Foundry MCP Creatures" Actor folder. */
  private async creaturesFolderId(): Promise<string | null> {
    return shared.getOrCreateFolder(CREATURES_FOLDER, 'Actor');
  }

  /** Null out a token / prototype-token texture src that is still a remote http(s) URL. */
  /**
   * Prepare a copied token: drop a remote (http) texture, and give it the
   * copy's own name (a renamed actor otherwise kept the source's token name,
   * e.g. three "Wolf" tokens for "Grey Wolf" and "Pack Leader").
   */
  private prepareTokenCopy(holder: unknown, name?: string): void {
    if (!holder || typeof holder !== 'object') return;
    const token = holder as { name?: unknown; texture?: { src?: unknown } | null };
    if (typeof token.texture?.src === 'string' && token.texture.src.startsWith('http')) {
      token.texture.src = null;
    }
    if (name !== undefined) token.name = name;
  }

  /** Validate + shape one caller-supplied item into a Foundry create payload. */
  private buildItemPayload(
    it: { name: string; type: string; img?: string; system?: Record<string, unknown> },
    idx: number,
    validTypes: string[] | null
  ): Record<string, unknown> {
    if (!it || typeof it.name !== 'string' || it.name.trim().length === 0) {
      throw new Error(`items[${idx}]: "name" is required and must be a non-empty string`);
    }
    if (typeof it.type !== 'string' || it.type.trim().length === 0) {
      throw new Error(`items[${idx}] ("${it.name}"): "type" is required`);
    }
    if (validTypes && !validTypes.includes(it.type)) {
      throw new Error(
        `items[${idx}] ("${it.name}"): unknown type "${it.type}" for system "${game.system?.id}". ` +
          `Valid Item types: ${validTypes.join(', ')}`
      );
    }

    const doc: Record<string, unknown> = { name: it.name, type: it.type };
    if (it.img) doc.img = it.img;
    if (it.system && typeof it.system === 'object') doc.system = it.system;
    return doc;
  }

  /**
   * Resolve the best compendium match for a creature type: an exact
   * (case-insensitive) name match wins; otherwise a result from the preferred
   * pack; otherwise the first (fuzzy) result, or null when nothing matches.
   */
  private async findBestCompendiumMatch(
    creatureType: string,
    packPreference?: string
  ): Promise<CompendiumSearchResult | null> {
    const results = await this.compendium.searchCompendium(creatureType, 'Actor');

    const exactMatch = results.find(r => r.name.toLowerCase() === creatureType.toLowerCase());
    if (exactMatch) return exactMatch;

    if (packPreference) {
      const packMatch = results.find(r => r.pack === packPreference);
      if (packMatch) return packMatch;
    }

    return results.length > 0 ? results[0] : null;
  }

  /**
   * Clone a full compendium document into a new world Actor with a custom name,
   * stripping source identifiers, clearing remote token textures, and filing it
   * under the creatures folder.
   */
  private async createActorFromSource(
    sourceDoc: CompendiumEntryFull,
    customName: string
  ): Promise<Actor> {
    try {
      const actorData = foundry.utils.deepClone(sourceDoc.fullData);

      actorData.name = customName;
      this.prepareTokenCopy(actorData.prototypeToken, customName);

      // Drop source-specific identifiers so Foundry assigns fresh ones.
      delete actorData._id;
      delete actorData.folder;
      delete actorData.sort;

      if (!actorData.name) actorData.name = customName;
      if (!actorData.type) actorData.type = sourceDoc.type || 'npc';

      const folderId = await this.creaturesFolderId();
      if (folderId) {
        actorData.folder = folderId;
      }

      const createdDocs = await Actor.createDocuments([actorData]);
      if (!createdDocs || createdDocs.length === 0) {
        throw new Error('Failed to create actor document');
      }
      return createdDocs[0];
    } catch (error) {
      console.error(`[${MODULE_ID}] Actor creation failed:`, error);
      throw error;
    }
  }

  /**
   * Compute a token position for the given placement strategy. `coordinates`
   * uses the per-index point (falling back to a grid layout when absent);
   * `center` fans out along the scene midline; `grid` (and the default) lay out
   * a square grid; `random` scatters within scene bounds.
   */
  private calculateTokenPosition(
    placement: 'random' | 'grid' | 'center' | 'coordinates',
    scene: Scene,
    index: number,
    coordinates?: { x: number; y: number }[]
  ): { x: number; y: number } {
    const gridSize = scene.grid?.size || 100;

    switch (placement) {
      case 'coordinates': {
        if (coordinates?.[index]) {
          return coordinates[index];
        }
        // No coordinate for this index → fall back to a grid layout.
        const fallbackCols = Math.ceil(Math.sqrt(index + 1));
        const fallbackRow = Math.floor(index / fallbackCols);
        const fallbackCol = index % fallbackCols;
        return {
          x: gridSize + fallbackCol * gridSize * 2,
          y: gridSize + fallbackRow * gridSize * 2,
        };
      }

      case 'center':
        return {
          x: scene.width / 2 + index * gridSize,
          y: scene.height / 2,
        };

      case 'grid': {
        const cols = Math.ceil(Math.sqrt(index + 1));
        const row = Math.floor(index / cols);
        const col = index % cols;
        return {
          x: gridSize + col * gridSize * 2,
          y: gridSize + row * gridSize * 2,
        };
      }

      case 'random':
      default:
        return {
          x: Math.random() * (scene.width - gridSize),
          y: Math.random() * (scene.height - gridSize),
        };
    }
  }
}
