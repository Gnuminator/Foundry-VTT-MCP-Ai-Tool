import { MODULE_ID, ERROR_MESSAGES } from '../constants.js';
import { permissionManager } from '../permissions.js';
import { transactionManager } from '../transaction-manager.js';
import * as shared from './shared.js';
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

/** Actor-creation domain — extracted from FoundryDataAccess. */
export class ActorCreationDataAccess {
  constructor(private compendium: CompendiumDataAccess) {}

  /**
   * Create actors from compendium entries with custom names
   */
  async createActorFromCompendium(request: ActorCreationRequest): Promise<ActorCreationResult> {
    shared.validateFoundryState();

    // Use new permission system
    const permissionCheck = permissionManager.checkWritePermission('createActor', {
      quantity: request.quantity || 1,
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    // Audit the permission check
    permissionManager.auditPermissionCheck('createActor', permissionCheck, request);

    const maxActors = game.settings.get(MODULE_ID, 'maxActorsPerRequest') as number;
    const quantity = Math.min(request.quantity || 1, maxActors);

    // Start transaction for rollback capability
    const transactionId = transactionManager.startTransaction(
      `Create ${quantity} actor(s) from compendium: ${request.creatureType}`
    );

    try {
      // Find matching compendium entry
      const compendiumEntry = await this.findBestCompendiumMatch(
        request.creatureType,
        request.packPreference
      );
      if (!compendiumEntry) {
        throw new Error(`No compendium entry found for "${request.creatureType}"`);
      }

      // Get full compendium document
      const sourceDoc = await this.compendium.getCompendiumDocumentFull(
        compendiumEntry.pack,
        compendiumEntry.id
      );

      const createdActors: CreatedActorInfo[] = [];
      const errors: string[] = [];

      // Create actors with custom names
      for (let i = 0; i < quantity; i++) {
        try {
          const customName =
            request.customNames?.[i] ||
            (quantity > 1 ? `${sourceDoc.name} ${i + 1}` : sourceDoc.name);

          const newActor = await this.createActorFromSource(sourceDoc, customName);

          // Track actor creation for rollback
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
          errors.push(
            `Failed to create actor ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      let tokensPlaced = 0;

      // Add to scene if requested and permission allows
      if (request.addToScene && createdActors.length > 0) {
        try {
          const scenePermissionCheck = permissionManager.checkWritePermission('modifyScene', {
            targetIds: createdActors.map(a => a.id),
          });

          if (!scenePermissionCheck.allowed) {
            errors.push(`Cannot add to scene: ${scenePermissionCheck.reason}`);
          } else {
            const tokenResult = await this.addActorsToScene(
              {
                actorIds: createdActors.map(a => a.id),
                placement: 'random',
                hidden: false,
              },
              transactionId
            );
            tokensPlaced = tokenResult.tokensCreated;
          }
        } catch (error) {
          errors.push(
            `Failed to add actors to scene: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // If we had partial failure, decide whether to rollback
      if (errors.length > 0 && createdActors.length < quantity) {
        // Rollback if we failed to create more than half the requested actors
        if (createdActors.length < quantity / 2) {
          console.warn(
            `[${MODULE_ID}] Rolling back due to significant failures (${createdActors.length}/${quantity} created)`
          );
          await transactionManager.rollbackTransaction(transactionId);
          throw new Error(`Actor creation failed: ${errors.join(', ')}`);
        }
      }

      // Commit transaction
      transactionManager.commitTransaction(transactionId);

      const result: ActorCreationResult = {
        success: createdActors.length > 0,
        actors: createdActors,
        ...(errors.length > 0 ? { errors } : {}),
        tokensPlaced,
        totalRequested: quantity,
        totalCreated: createdActors.length,
      };

      shared.auditLog('createActorFromCompendium', request, 'success');
      return result;
    } catch (error) {
      // Rollback on complete failure
      try {
        await transactionManager.rollbackTransaction(transactionId);
      } catch (rollbackError) {
        console.error(`[${MODULE_ID}] Failed to rollback transaction:`, rollbackError);
      }

      shared.auditLog(
        'createActorFromCompendium',
        request,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Create actor from specific compendium entry using pack/item IDs
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

    try {
      const { packId, itemId, customNames, quantity = 1, addToScene = false, placement } = request;

      // Validate inputs
      if (!packId || !itemId) {
        throw new Error('Both packId and itemId are required');
      }

      // Get the pack
      const pack = game.packs.get(packId);
      if (!pack) {
        throw new Error(`Compendium pack "${packId}" not found`);
      }

      // Get the specific document
      const sourceDocument = await pack.getDocument(itemId);
      if (!sourceDocument) {
        throw new Error(`Document "${itemId}" not found in pack "${packId}"`);
      }

      // Validate that the document is an Actor (supports character, npc, creature, etc.)
      if (sourceDocument.documentName !== 'Actor') {
        throw new Error(
          `Document "${itemId}" is not an Actor (documentName: ${sourceDocument.documentName}, type: ${sourceDocument.type})`
        );
      }

      // Validate actor type - support D&D 5e actor types
      const validActorTypes = ['character', 'npc'];
      if (!validActorTypes.includes(sourceDocument.type)) {
        throw new Error(
          `Document "${itemId}" has unsupported actor type: ${sourceDocument.type}. Supported types: ${validActorTypes.join(', ')}`
        );
      }

      const sourceActor = sourceDocument as Actor;

      // Prepare custom names
      const names = customNames.length > 0 ? customNames : [`${sourceActor.name} Copy`];
      const finalQuantity = Math.min(quantity, names.length);

      const createdActors: any[] = [];
      const errors: string[] = [];

      // Create actors
      for (let i = 0; i < finalQuantity; i++) {
        try {
          const customName = names[i] || `${sourceActor.name} ${i + 1}`;

          // Create actor data with full system, items, and effects
          const sourceData = sourceActor.toObject() as any;
          const actorData = {
            name: customName,
            type: sourceData.type,
            img: sourceData.img,
            system: sourceData.system || sourceData.data || {},
            items: sourceData.items || [],
            effects: sourceData.effects || [],
            folder: null, // Don't inherit folder
            prototypeToken: sourceData.prototypeToken, // Include prototype token
          };

          // Fix remote image URLs - normalize to local paths
          if (actorData.prototypeToken?.texture?.src?.startsWith('http')) {
            actorData.prototypeToken.texture.src = null; // Clear remote URL
          }

          // Organize created actors in a folder - use "Foundry MCP Creatures" for generic monsters
          const folderId = await shared.getOrCreateFolder('Foundry MCP Creatures', 'Actor');
          if (folderId) {
            (actorData as any).folder = folderId;
          }

          // Create the actor
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
          const errorMsg = `Failed to create actor ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          console.error(`[${MODULE_ID}] ${errorMsg}`, error);
        }
      }

      // Add to scene if requested
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
          errors.push(
            `Failed to add actors to scene: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      const result: ActorCreationResult = {
        success: createdActors.length > 0,
        totalCreated: createdActors.length,
        totalRequested: finalQuantity,
        actors: createdActors,
        tokensPlaced,
        errors: errors.length > 0 ? errors : undefined,
      };

      shared.auditLog('createActorFromCompendiumEntry', request, 'success');
      return result;
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to create actor from compendium entry`, error);
      shared.auditLog(
        'createActorFromCompendiumEntry',
        request,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Add one or more freshly-authored Item documents to an existing Actor.
   *
   * Unlike `createActorFromCompendium*`, the items here are constructed from
   * caller-supplied data — no compendium lookup. This is the path used to
   * push planner-authored content (talents, actions, powers, custom gear)
   * onto a PC or NPC sheet.
   *
   * Validation is intentionally light: name + type are required, and the
   * type is checked against the active system's declared Item document
   * types when available. Everything else (system schema validation,
   * required sub-fields) is delegated to Foundry's DataModel layer, which
   * will fill defaults or throw a meaningful error.
   */
  async addActorItems(params: {
    actorIdentifier: string;
    items: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, any>;
    }>;
  }): Promise<{
    actorId: string;
    actorName: string;
    created: Array<{ id: string; name: string; type: string }>;
  }> {
    shared.validateFoundryState();

    const { actorIdentifier, items } = params;

    if (!actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items array is required and must contain at least one entry');
    }

    const actor = shared.findActorByIdentifier(actorIdentifier);
    if (!actor) {
      throw new Error(`Actor not found: ${actorIdentifier}`);
    }

    // Discover the active system's declared Item types so we can give a
    // useful error before sending the doc to Foundry's DataModel layer.
    const itemDocTypes = (game as any).system?.documentTypes?.Item;
    const validTypes: string[] | null =
      itemDocTypes && typeof itemDocTypes === 'object' ? Object.keys(itemDocTypes) : null;

    const payload = items.map((it, idx) => {
      if (!it || typeof it.name !== 'string' || it.name.trim().length === 0) {
        throw new Error(`items[${idx}]: "name" is required and must be a non-empty string`);
      }
      if (typeof it.type !== 'string' || it.type.trim().length === 0) {
        throw new Error(`items[${idx}] ("${it.name}"): "type" is required`);
      }
      if (validTypes && !validTypes.includes(it.type)) {
        throw new Error(
          `items[${idx}] ("${it.name}"): unknown type "${it.type}" for system "${(game.system as any)?.id}". ` +
            `Valid Item types: ${validTypes.join(', ')}`
        );
      }

      const doc: Record<string, any> = { name: it.name, type: it.type };
      if (it.img) doc.img = it.img;
      if (it.system && typeof it.system === 'object') doc.system = it.system;
      return doc;
    });

    try {
      const created = await actor.createEmbeddedDocuments('Item', payload);

      const result = {
        actorId: actor.id,
        actorName: actor.name,
        created: (created || []).map((doc: any) => ({
          id: doc.id,
          name: doc.name,
          type: doc.type,
        })),
      };

      shared.auditLog(
        'addActorItems',
        { actorIdentifier, actorId: actor.id, count: payload.length },
        'success'
      );
      return result;
    } catch (error) {
      shared.auditLog(
        'addActorItems',
        { actorIdentifier, actorId: actor.id, count: payload.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Add actors to the current scene as tokens
   */
  async addActorsToScene(
    placement: SceneTokenPlacement,
    transactionId?: string
  ): Promise<TokenPlacementResult> {
    shared.validateFoundryState();

    // Use new permission system
    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: placement.actorIds,
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    // Audit the permission check
    permissionManager.auditPermissionCheck('modifyScene', permissionCheck, placement);

    const scene = (game.scenes as any).current;
    if (!scene) {
      throw new Error('No active scene found');
    }

    shared.auditLog('addActorsToScene', placement, 'success');

    try {
      const tokenData: any[] = [];
      const errors: string[] = [];

      for (const actorId of placement.actorIds) {
        try {
          const actor = game.actors.get(actorId);
          if (!actor) {
            errors.push(`Actor ${actorId} not found`);
            continue;
          }

          const tokenDoc = (actor as any).prototypeToken.toObject();
          const position = this.calculateTokenPosition(
            placement.placement,
            scene,
            tokenData.length,
            placement.coordinates
          );

          // Fix token texture if it's still a remote URL (Foundry may have overridden our actor creation fix)
          if (tokenDoc.texture?.src?.startsWith('http')) {
            console.error(
              `[${MODULE_ID}] Token texture still has remote URL, clearing: ${tokenDoc.texture.src}`
            );
            tokenDoc.texture.src = null; // Use Foundry's fallback
          } else {
          }

          tokenData.push({
            ...tokenDoc,
            x: position.x,
            y: position.y,
            actorId: actorId,
            hidden: placement.hidden,
          });
        } catch (error) {
          errors.push(
            `Failed to prepare token for actor ${actorId}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      const createdTokens = await scene.createEmbeddedDocuments('Token', tokenData);

      // Track token creation for rollback if transaction is active
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
        tokenIds: createdTokens.map((token: any) => token.id),
        ...(errors.length > 0 ? { errors } : {}),
      };

      shared.auditLog('addActorsToScene', placement, 'success');
      return result;
    } catch (error) {
      shared.auditLog(
        'addActorsToScene',
        placement,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Find best matching compendium entry for creature type
   */
  private async findBestCompendiumMatch(
    creatureType: string,
    packPreference?: string
  ): Promise<CompendiumSearchResult | null> {
    // First try exact search
    const exactResults = await this.compendium.searchCompendium(creatureType, 'Actor');

    // Look for exact name match first
    const exactMatch = exactResults.find(
      result => result.name.toLowerCase() === creatureType.toLowerCase()
    );
    if (exactMatch) return exactMatch;

    // Look for partial matches, preferring specified pack
    if (packPreference) {
      const packMatch = exactResults.find(result => result.pack === packPreference);
      if (packMatch) return packMatch;
    }

    // Return best fuzzy match
    return exactResults.length > 0 ? exactResults[0] : null;
  }

  /**
   * Create actor from source document with custom name
   */
  private async createActorFromSource(
    sourceDoc: CompendiumEntryFull,
    customName: string
  ): Promise<any> {
    try {
      // Clone the source data
      const actorData = foundry.utils.deepClone(sourceDoc.fullData) as any;

      // Apply customizations
      actorData.name = customName;

      // Fix only token texture - leave portrait (actor.img) alone
      if (actorData.prototypeToken?.texture?.src?.startsWith('http')) {
        console.error(
          `[${MODULE_ID}] Removing remote token texture URL: ${actorData.prototypeToken.texture.src}`
        );
        actorData.prototypeToken.texture.src = null; // Let Foundry use fallback
      }

      // Remove source-specific identifiers
      delete actorData._id;
      delete actorData.folder;
      delete actorData.sort;

      // Ensure required fields are present
      if (!actorData.name) actorData.name = customName;
      if (!actorData.type) actorData.type = sourceDoc.type || 'npc';

      // Organize created actors in a folder - use "Foundry MCP Creatures" for generic monsters
      const folderId = await shared.getOrCreateFolder('Foundry MCP Creatures', 'Actor');
      if (folderId) {
        (actorData as any).folder = folderId;
      }

      // Create the new actor
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
   * Calculate token position based on placement strategy
   */
  private calculateTokenPosition(
    placement: 'random' | 'grid' | 'center' | 'coordinates',
    scene: any,
    index: number,
    coordinates?: { x: number; y: number }[]
  ): { x: number; y: number } {
    const gridSize = scene.grid?.size || 100;

    switch (placement) {
      case 'coordinates':
        if (coordinates && coordinates[index]) {
          return coordinates[index];
        }
        // Fallback to grid if coordinates not provided or insufficient
        const fallbackCols = Math.ceil(Math.sqrt(index + 1));
        const fallbackRow = Math.floor(index / fallbackCols);
        const fallbackCol = index % fallbackCols;
        return {
          x: gridSize + fallbackCol * gridSize * 2,
          y: gridSize + fallbackRow * gridSize * 2,
        };

      case 'center':
        return {
          x: scene.width / 2 + index * gridSize,
          y: scene.height / 2,
        };

      case 'grid':
        const cols = Math.ceil(Math.sqrt(index + 1));
        const row = Math.floor(index / cols);
        const col = index % cols;
        return {
          x: gridSize + col * gridSize * 2,
          y: gridSize + row * gridSize * 2,
        };

      case 'random':
      default:
        return {
          x: Math.random() * (scene.width - gridSize),
          y: Math.random() * (scene.height - gridSize),
        };
    }
  }
}
