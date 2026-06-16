import { MODULE_ID, ERROR_MESSAGES } from './constants.js';
import { permissionManager } from './permissions.js';
import { transactionManager } from './transaction-manager.js';
import { PersistentCreatureIndex } from './data-access/creature-index.js';
import * as shared from './data-access/shared.js';
import { ModulesDataAccess } from './data-access/modules.js';
import { SessionLogDataAccess } from './data-access/session-log.js';
import { WorldReadsDataAccess } from './data-access/world-reads.js';
import { JournalDataAccess } from './data-access/journals.js';
import { WorldItemsDataAccess } from './data-access/world-items.js';
import { ChatDataAccess } from './data-access/chat.js';
import { OwnershipPlayersDataAccess } from './data-access/ownership-players.js';
import { ResourcesEffectsDataAccess } from './data-access/resources-effects.js';
import { CharacterDataAccess } from './data-access/characters.js';
import { ScenesTokensDataAccess } from './data-access/scenes-tokens.js';
import { SceneFxDataAccess } from './data-access/scene-fx.js';
import { CompendiumDataAccess } from './data-access/compendium.js';
import { CombatDataAccess } from './data-access/combat.js';
import {
  slugify,
  NPC_DAMAGE_CANONICAL,
  NPC_CONDITION_CANONICAL,
  NPC_SIZE_MAP,
  npcNormalizeCR,
  npcFormatCR,
  npcBuildSkillsBlock,
  ATTACK_DAMAGE_CANONICAL,
  ATTACK_PROPERTY_CANONICAL,
  AURA_DAMAGE_CANONICAL,
  ATTACK_WITH_SAVE_DAMAGE_CANONICAL,
  FULL_CASTER_SLOTS,
  HALF_CASTER_SLOTS,
  ARTIFICER_SLOTS,
  WARLOCK_PACT_TABLE,
} from './data-access/dnd5e-tables.js';
import type {
  CharacterInfo,
  CompendiumSearchResult,
  SceneInfo,
  WorldInfo,
  ActorCreationRequest,
  ActorCreationResult,
  CreatedActorInfo,
  CompendiumEntryFull,
  SceneTokenPlacement,
  TokenPlacementResult,
} from './data-access/types.js';

export class FoundryDataAccess {
  private moduleId: string = MODULE_ID;
  private persistentIndex: PersistentCreatureIndex = new PersistentCreatureIndex();
  private modules = new ModulesDataAccess();
  private sessionLog = new SessionLogDataAccess();
  private worldReads = new WorldReadsDataAccess();
  private journals = new JournalDataAccess();
  private worldItems = new WorldItemsDataAccess();
  private chat = new ChatDataAccess();
  private ownership = new OwnershipPlayersDataAccess();
  private resources = new ResourcesEffectsDataAccess();
  private characters = new CharacterDataAccess();
  private scenesTokens = new ScenesTokensDataAccess();
  private sceneFx = new SceneFxDataAccess();
  private compendium = new CompendiumDataAccess(this.persistentIndex);
  private combat = new CombatDataAccess();

  constructor() {}

  /**
   * Force rebuild of enhanced creature index
   */
  async rebuildEnhancedCreatureIndex(): Promise<{
    success: boolean;
    totalCreatures: number;
    message: string;
  }> {
    try {
      const creatures = await this.persistentIndex.rebuildIndex();
      return {
        success: true,
        totalCreatures: creatures.length,
        message: `Enhanced creature index rebuilt: ${creatures.length} creatures indexed from all packs`,
      };
    } catch (error) {
      console.error(`[${this.moduleId}] Failed to rebuild enhanced creature index:`, error);
      return {
        success: false,
        totalCreatures: 0,
        message: `Failed to rebuild index: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async getCharacterInfo(identifier: string): Promise<CharacterInfo> {
    return this.characters.getCharacterInfo(identifier);
  }

  async searchCharacterItems(params: {
    characterIdentifier: string;
    query?: string | undefined;
    type?: string | undefined;
    category?: string | undefined;
    limit?: number | undefined;
  }): Promise<{
    characterId: string;
    characterName: string;
    query?: string;
    type?: string;
    category?: string;
    matches: Array<{
      id: string;
      name: string;
      type: string;
      description?: string;
      level?: number;
      prepared?: boolean;
      expended?: boolean;
      range?: string;
      target?: string;
      area?: string;
      actionCost?: string;
      traits?: string[];
      quantity?: number;
      equipped?: boolean;
      invested?: boolean;
      actionType?: string;
    }>;
    totalMatches: number;
  }> {
    return this.characters.searchCharacterItems(params);
  }

  async searchCompendium(
    query: string,
    packType?: string,
    filters?: {
      challengeRating?: number | { min?: number; max?: number };
      creatureType?: string;
      size?: string;
      alignment?: string;
      hasLegendaryActions?: boolean;
      spellcaster?: boolean;
    }
  ): Promise<CompendiumSearchResult[]> {
    return this.compendium.searchCompendium(query, packType, filters);
  }

  async listCreaturesByCriteria(criteria: {
    challengeRating?: number | { min?: number; max?: number };
    creatureType?: string;
    size?: string;
    hasSpells?: boolean;
    hasLegendaryActions?: boolean;
    limit?: number;
  }): Promise<{ creatures: any[]; searchSummary: any }> {
    return this.compendium.listCreaturesByCriteria(criteria);
  }

  async listActors(): Promise<Array<{ id: string; name: string; type: string; img?: string }>> {
    return this.worldReads.listActors();
  }

  async getActiveScene(): Promise<SceneInfo> {
    return this.worldReads.getActiveScene();
  }

  async getWorldInfo(): Promise<WorldInfo> {
    return this.worldReads.getWorldInfo();
  }

  async getAvailablePacks() {
    return this.worldReads.getAvailablePacks();
  }

  /** Assert Foundry is ready with an active world + user (delegates to shared core). */
  validateFoundryState(): void {
    shared.validateFoundryState();
  }

  /** Resolve an actor by id, exact name, or partial name (delegates to shared core). */
  private findActorByIdentifier(identifier: string): any {
    return shared.findActorByIdentifier(identifier);
  }

  /** Append an audit record for a write operation (delegates to shared core). */
  private auditLog(
    operation: string,
    data: any,
    result: 'success' | 'failure',
    error?: string
  ): void {
    shared.auditLog(operation, data, result, error);
  }

  // ===== PHASE 2 & 3: WRITE OPERATIONS =====

  async createJournalEntry(request: {
    name: string;
    content: string;
    folderName?: string;
    additionalPages?: Array<{ name: string; content: string }>;
  }): Promise<{ id: string; name: string; pageCount: number }> {
    return this.journals.createJournalEntry(request);
  }

  async listJournals(): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      pageCount: number;
      pages: Array<{ id: string; name: string; type: string }>;
    }>
  > {
    return this.journals.listJournals();
  }

  async getJournalContent(journalId: string): Promise<{
    content: string;
    currentPage?: { id: string; name: string } | undefined;
    allPages: Array<{ id: string; name: string; type: string }>;
    pageCount: number;
    note?: string | undefined;
  } | null> {
    return this.journals.getJournalContent(journalId);
  }

  async getJournalPageContent(
    journalId: string,
    pageId: string
  ): Promise<{ id: string; name: string; type: string; content: string } | null> {
    return this.journals.getJournalPageContent(journalId, pageId);
  }

  async updateJournalContent(request: {
    journalId: string;
    content: string;
    pageId?: string | undefined;
    newPageName?: string | undefined;
  }): Promise<{ success: boolean; pageId?: string | undefined; pageName?: string | undefined }> {
    return this.journals.updateJournalContent(request);
  }

  /**
   * Create actors from compendium entries with custom names
   */
  async createActorFromCompendium(request: ActorCreationRequest): Promise<ActorCreationResult> {
    this.validateFoundryState();

    // Use new permission system
    const permissionCheck = permissionManager.checkWritePermission('createActor', {
      quantity: request.quantity || 1,
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    // Audit the permission check
    permissionManager.auditPermissionCheck('createActor', permissionCheck, request);

    const maxActors = game.settings.get(this.moduleId, 'maxActorsPerRequest') as number;
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
      const sourceDoc = await this.getCompendiumDocumentFull(
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
            `[${this.moduleId}] Rolling back due to significant failures (${createdActors.length}/${quantity} created)`
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

      this.auditLog('createActorFromCompendium', request, 'success');
      return result;
    } catch (error) {
      // Rollback on complete failure
      try {
        await transactionManager.rollbackTransaction(transactionId);
      } catch (rollbackError) {
        console.error(`[${this.moduleId}] Failed to rollback transaction:`, rollbackError);
      }

      this.auditLog(
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
    this.validateFoundryState();

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
          const folderId = await this.getOrCreateFolder('Foundry MCP Creatures', 'Actor');
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

      this.auditLog('createActorFromCompendiumEntry', request, 'success');
      return result;
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to create actor from compendium entry`, error);
      this.auditLog(
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
    this.validateFoundryState();

    const { actorIdentifier, items } = params;

    if (!actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items array is required and must contain at least one entry');
    }

    const actor = this.findActorByIdentifier(actorIdentifier);
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

      this.auditLog(
        'addActorItems',
        { actorIdentifier, actorId: actor.id, count: payload.length },
        'success'
      );
      return result;
    } catch (error) {
      this.auditLog(
        'addActorItems',
        { actorIdentifier, actorId: actor.id, count: payload.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  async listWorldItems(params: { type?: string; folder?: string; nameFilter?: string }): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      img?: string;
      folderId: string | null;
      folderName: string | null;
    }>
  > {
    return this.worldItems.listWorldItems(params);
  }

  async updateWorldItems(params: {
    updates: Array<{
      id: string;
      name?: string;
      img?: string;
      system?: Record<string, any>;
      folder?: string;
    }>;
  }): Promise<{
    updated: Array<{ id: string; name: string; type: string }>;
  }> {
    return this.worldItems.updateWorldItems(params);
  }

  async createWorldItems(params: {
    items: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, any>;
    }>;
    folder?: string;
  }): Promise<{
    folderId: string | null;
    folderName: string | null;
    created: Array<{ id: string; name: string; type: string }>;
  }> {
    return this.worldItems.createWorldItems(params);
  }

  async getCompendiumDocumentFull(
    packId: string,
    documentId: string
  ): Promise<CompendiumEntryFull> {
    return this.compendium.getCompendiumDocumentFull(packId, documentId);
  }

  /**
   * Add actors to the current scene as tokens
   */
  async addActorsToScene(
    placement: SceneTokenPlacement,
    transactionId?: string
  ): Promise<TokenPlacementResult> {
    this.validateFoundryState();

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

    this.auditLog('addActorsToScene', placement, 'success');

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
              `[${this.moduleId}] Token texture still has remote URL, clearing: ${tokenDoc.texture.src}`
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

      this.auditLog('addActorsToScene', placement, 'success');
      return result;
    } catch (error) {
      this.auditLog(
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
    const exactResults = await this.searchCompendium(creatureType, 'Actor');

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
          `[${this.moduleId}] Removing remote token texture URL: ${actorData.prototypeToken.texture.src}`
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
      const folderId = await this.getOrCreateFolder('Foundry MCP Creatures', 'Actor');
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
      console.error(`[${this.moduleId}] Actor creation failed:`, error);
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

  /**
   * Validate write operation permissions
   */
  async validateWritePermissions(operation: 'createActor' | 'modifyScene'): Promise<{
    allowed: boolean;
    reason?: string;
    requiresConfirmation?: boolean;
    warnings?: string[];
  }> {
    this.validateFoundryState();

    const permissionCheck = permissionManager.checkWritePermission(operation);

    // Audit the permission check
    permissionManager.auditPermissionCheck(operation, permissionCheck);

    return {
      allowed: permissionCheck.allowed,
      ...(permissionCheck.reason ? { reason: permissionCheck.reason } : {}),
      ...(permissionCheck.requiresConfirmation
        ? { requiresConfirmation: permissionCheck.requiresConfirmation }
        : {}),
      ...(permissionCheck.warnings ? { warnings: permissionCheck.warnings } : {}),
    };
  }

  /**
   * Request player rolls - creates interactive roll buttons in chat
   */
  async requestPlayerRolls(data: {
    rollType: string;
    rollTarget: string;
    targetPlayer: string;
    isPublic: boolean;
    rollModifier: string;
    flavor: string;
  }): Promise<{ success: boolean; message: string; error?: string }> {
    this.validateFoundryState();

    try {
      // Resolve target player from character name or player name with enhanced error handling
      const playerInfo = this.resolveTargetPlayer(data.targetPlayer);
      if (!playerInfo.found) {
        // Provide structured error message for MCP that Claude Desktop can understand
        const errorMessage =
          playerInfo.errorMessage || `Could not find player or character: ${data.targetPlayer}`;

        return {
          success: false,
          message: '',
          error: errorMessage,
        };
      }

      // Build roll formula based on type and target
      const rollFormula = this.buildRollFormula(
        data.rollType,
        data.rollTarget,
        data.rollModifier,
        playerInfo.character
      );

      // Generate roll button HTML
      const buttonId = foundry.utils.randomID();
      const buttonLabel = this.buildRollButtonLabel(data.rollType, data.rollTarget, data.isPublic);

      // Check if this type of roll was already performed (optional: could check for duplicate recent rolls)
      // For now, we'll just create the button and let the rendering logic handle the state restoration

      const rollButtonHtml = `
        <div class="mcp-roll-request" style="margin: 12px 0; padding: 12px; border: 1px solid #ccc; border-radius: 8px; background: #f9f9f9;">
          <p><strong>Roll Request:</strong> ${buttonLabel}</p>
          <p><strong>Target:</strong> ${playerInfo.targetName} ${playerInfo.character ? `(${playerInfo.character.name})` : ''}</p>
          ${data.flavor ? `<p><strong>Context:</strong> ${data.flavor}</p>` : ''}
          
          <div style="text-align: center; margin-top: 8px;">
            <!-- Single Roll Button (clickable by both character owner and GM) -->
            <button class="mcp-roll-button mcp-button-active" 
                    data-button-id="${buttonId}"
                    data-roll-formula="${rollFormula}"
                    data-roll-label="${buttonLabel}"
                    data-is-public="${data.isPublic}"
                    data-character-id="${playerInfo.character?.id || ''}"
                    data-target-user-id="${playerInfo.user?.id || ''}">
              🎲 ${buttonLabel}
            </button>
          </div>
        </div>
      `;

      // Create chat message with roll button
      // For PUBLIC rolls: both roll request and results visible to all players
      // For PRIVATE rolls: both roll request and results visible to target player + GM only
      const whisperTargets: string[] = [];

      if (!data.isPublic) {
        // Private roll request: whisper to target player + GM only

        // Always whisper to the character owner if they exist
        if (playerInfo.user?.id) {
          whisperTargets.push(playerInfo.user.id);
        }

        // Also send to GM (GMs can see all whispered messages anyway, but this ensures they see it)
        const gmUsers = game.users?.filter((u: User) => u.isGM && u.active);
        if (gmUsers) {
          for (const gm of gmUsers) {
            if (gm.id && !whisperTargets.includes(gm.id)) {
              whisperTargets.push(gm.id);
            }
          }
        }
      } else {
        // Public roll request: visible to all players (empty whisperTargets array)
      }

      const messageData = {
        content: rollButtonHtml,
        speaker: ChatMessage.getSpeaker({ actor: game.user }),
        style: (CONST as any).CHAT_MESSAGE_STYLES?.OTHER || 0, // Use style instead of deprecated type
        whisper: whisperTargets,
        flags: {
          [MODULE_ID]: {
            rollButtons: {
              [buttonId]: {
                rolled: false,
                rollFormula: rollFormula,
                rollLabel: buttonLabel,
                isPublic: data.isPublic,
                characterId: playerInfo.character?.id || '',
                targetUserId: playerInfo.user?.id || '',
              },
            },
          },
        },
      };

      const chatMessage = await ChatMessage.create(messageData);

      // Store message ID for later updates
      this.saveRollButtonMessageId(buttonId, chatMessage.id);

      // Note: Click handlers are attached globally via renderChatMessageHTML hook in main.ts
      // This ensures all users get the handlers when they see the message

      return {
        success: true,
        message: `Roll request sent to ${playerInfo.targetName}. ${data.isPublic ? 'Public roll' : 'Private roll'} button created in chat.`,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Error creating roll request:`, error);
      return {
        success: false,
        message: '',
        error: error instanceof Error ? error.message : 'Unknown error creating roll request',
      };
    }
  }

  /**
   * Enhanced player resolution with offline/non-existent player detection
   * Supports partial matching and provides structured error messages for MCP
   */
  private resolveTargetPlayer(targetPlayer: string): {
    found: boolean;
    user?: User;
    character?: Actor;
    targetName: string;
    errorType?: 'PLAYER_OFFLINE' | 'PLAYER_NOT_FOUND' | 'CHARACTER_NOT_FOUND';
    errorMessage?: string;
  } {
    const searchTerm = targetPlayer.toLowerCase().trim();

    // FIRST: Check all registered users (both active and inactive) for player name match
    const allUsers = Array.from(game.users?.values() || []);

    // Try exact player name match first (active and inactive users)
    let user = allUsers.find((u: User) => u.name?.toLowerCase() === searchTerm);

    if (user) {
      const isActive = user.active;

      if (!isActive) {
        // Player exists but is offline
        return {
          found: false,
          user,
          targetName: user.name || 'Unknown Player',
          errorType: 'PLAYER_OFFLINE',
          errorMessage: `Player "${user.name}" is registered but not currently logged in. They need to be online to receive roll requests.`,
        };
      }

      // Find the player's character for roll calculations
      const playerCharacter = game.actors?.find((actor: Actor) => {
        if (!user) return false;
        return actor.testUserPermission(user, 'OWNER') && !user.isGM;
      });

      return {
        found: true,
        user,
        ...(playerCharacter && { character: playerCharacter }), // Include character only if found
        targetName: user.name || 'Unknown Player',
      };
    }

    // Try partial player name match (active and inactive users)
    if (!user) {
      user = allUsers.find((u: User) => {
        return Boolean(u.name && u.name.toLowerCase().includes(searchTerm));
      });

      if (user) {
        const isActive = user.active;

        if (!isActive) {
          // Player exists but is offline
          return {
            found: false,
            user,
            targetName: user.name || 'Unknown Player',
            errorType: 'PLAYER_OFFLINE',
            errorMessage: `Player "${user.name}" is registered but not currently logged in. They need to be online to receive roll requests.`,
          };
        }

        // Find the player's character for roll calculations
        const playerCharacter = game.actors?.find((actor: Actor) => {
          if (!user) return false;
          return actor.testUserPermission(user, 'OWNER') && !user.isGM;
        });

        return {
          found: true,
          user,
          ...(playerCharacter && { character: playerCharacter }), // Include character only if found
          targetName: user.name || 'Unknown Player',
        };
      }
    }

    // SECOND: Try to find by character name (exact match, then partial match)
    let character = game.actors?.find(
      (actor: Actor) => actor.name?.toLowerCase() === searchTerm && actor.hasPlayerOwner
    );

    if (character) {
    }

    // If no exact character match, try partial match
    if (!character) {
      character = game.actors?.find((actor: Actor) => {
        return Boolean(
          actor.name && actor.name.toLowerCase().includes(searchTerm) && actor.hasPlayerOwner
        );
      });

      if (character) {
      }
    }

    if (character) {
      // Find the actual player owner (not GM) of this character
      const ownerUser = allUsers.find(
        (u: User) => character.testUserPermission(u, 'OWNER') && !u.isGM
      );

      if (ownerUser) {
        const isOwnerActive = ownerUser.active;

        if (!isOwnerActive) {
          // Character owner exists but is offline
          return {
            found: false,
            user: ownerUser,
            character,
            targetName: ownerUser.name || 'Unknown Player',
            errorType: 'PLAYER_OFFLINE',
            errorMessage: `Player "${ownerUser.name}" (owner of character "${character.name}") is registered but not currently logged in. They need to be online to receive roll requests.`,
          };
        }

        return {
          found: true,
          user: ownerUser,
          character,
          targetName: ownerUser.name || 'Unknown Player',
        };
      } else {
        // No player owner found - character is GM-only controlled
        // Still return found=true but without user, GM can still roll for it
        return {
          found: true,
          character,
          targetName: character.name || 'Unknown Character',
          // user is omitted (undefined) for GM-only characters
        };
      }
    }

    // THIRD: Check if the search term might be a character that exists but has no player owner
    const anyCharacter = game.actors?.find((actor: Actor) => {
      if (!actor.name) return false;
      return (
        actor.name.toLowerCase() === searchTerm || actor.name.toLowerCase().includes(searchTerm)
      );
    });

    if (anyCharacter && !anyCharacter.hasPlayerOwner) {
      return {
        found: true,
        character: anyCharacter,
        targetName: anyCharacter.name || 'Unknown Character',
        // No user for GM-controlled characters
      };
    }

    // No player or character found at all

    return {
      found: false,
      targetName: targetPlayer,
      errorType: 'PLAYER_NOT_FOUND',
      errorMessage: `No player or character named "${targetPlayer}" found. Available players: ${
        allUsers
          .filter(u => !u.isGM)
          .map(u => u.name)
          .join(', ') || 'none'
      }`,
    };
  }

  /**
   * Build roll formula based on roll type and target using Foundry's roll data system
   */
  private buildRollFormula(
    rollType: string,
    rollTarget: string,
    rollModifier: string,
    character?: Actor
  ): string {
    let baseFormula = '1d20';

    // Coerce a roll-data field to a finite number. In dnd5e v5 some fields that
    // were plain numbers are now objects (e.g. abilities.<x>.save), so a naive
    // `1d20+${field}` produced "1d20+[object Object]" and broke Roll parsing.
    const toMod = (v: any): number => {
      if (v == null) return 0;
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      if (typeof v === 'object') {
        const inner = v.value ?? v.total ?? v.mod ?? v.bonus;
        const n = Number(inner);
        return Number.isFinite(n) ? n : 0;
      }
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    // Format a modifier with an explicit sign so negatives don't produce "+-2".
    const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n}`;

    if (character) {
      // Use Foundry's getRollData() to get calculated modifiers including active effects
      const rollData = character.getRollData() as any; // Type assertion for Foundry's dynamic roll data

      switch (rollType) {
        case 'ability': {
          const abilityMod = toMod(rollData.abilities?.[rollTarget]?.mod);
          baseFormula = `1d20${signed(abilityMod)}`;
          break;
        }

        case 'skill': {
          // Map skill name to skill code (D&D 5e uses 3-letter codes)
          const skillCode = this.getSkillCode(rollTarget);
          const skillMod = toMod(rollData.skills?.[skillCode]?.total);
          baseFormula = `1d20${signed(skillMod)}`;
          break;
        }

        case 'save': {
          // dnd5e v5: abilities.<x>.save is an object (not a flat bonus), so we
          // compute the save modifier from ability mod + proficiency rather than
          // reading `.save` directly (which omitted save proficiency, e.g. a
          // creature's DEX save came out +2 instead of +7).
          const ability = rollData.abilities?.[rollTarget] ?? {};
          const mod = toMod(ability.mod);
          const prof = toMod(rollData.attributes?.prof ?? rollData.prof);
          const proficient = toMod(ability.proficient); // 0 / 0.5 / 1 / 2
          const computed = mod + Math.round(proficient * prof);
          // Prefer a directly-exposed numeric save total if it's larger (covers
          // misc save bonuses); otherwise use the computed value.
          const saveMod = Math.max(computed, toMod(ability.save));
          baseFormula = `1d20${signed(saveMod)}`;
          break;
        }

        case 'initiative': {
          const initMod = toMod(rollData.attributes?.init?.mod ?? rollData.abilities?.dex?.mod);
          baseFormula = `1d20${signed(initMod)}`;
          break;
        }

        case 'custom':
          baseFormula = rollTarget; // Use rollTarget as the formula directly
          break;

        default:
          baseFormula = '1d20';
      }
    } else {
      console.warn(`[${MODULE_ID}] No character provided for roll formula, using base 1d20`);
    }

    // Add modifier if provided
    if (rollModifier && rollModifier.trim()) {
      const modifier =
        rollModifier.startsWith('+') || rollModifier.startsWith('-')
          ? rollModifier
          : `+${rollModifier}`;
      baseFormula += modifier;
    }

    return baseFormula;
  }

  /**
   * Map skill names to D&D 5e skill codes
   */
  private getSkillCode(skillName: string): string {
    const skillMap: { [key: string]: string } = {
      acrobatics: 'acr',
      'animal handling': 'ani',
      animalhandling: 'ani',
      arcana: 'arc',
      athletics: 'ath',
      deception: 'dec',
      history: 'his',
      insight: 'ins',
      intimidation: 'itm',
      investigation: 'inv',
      medicine: 'med',
      nature: 'nat',
      perception: 'prc',
      performance: 'prf',
      persuasion: 'per',
      religion: 'rel',
      'sleight of hand': 'slt',
      sleightofhand: 'slt',
      stealth: 'ste',
      survival: 'sur',
    };

    const normalizedName = skillName.toLowerCase().replace(/\s+/g, '');
    const skillCode =
      skillMap[normalizedName] || skillMap[skillName.toLowerCase()] || skillName.toLowerCase();

    return skillCode;
  }

  /**
   * Build roll button label
   */
  private buildRollButtonLabel(rollType: string, rollTarget: string, isPublic: boolean): string {
    const visibility = isPublic ? 'Public' : 'Private';

    switch (rollType) {
      case 'ability':
        return `${rollTarget.toUpperCase()} Ability Check (${visibility})`;
      case 'skill':
        return `${rollTarget.charAt(0).toUpperCase() + rollTarget.slice(1)} Skill Check (${visibility})`;
      case 'save':
        return `${rollTarget.toUpperCase()} Saving Throw (${visibility})`;
      case 'attack':
        return `${rollTarget} Attack (${visibility})`;
      case 'initiative':
        return `Initiative Roll (${visibility})`;
      case 'custom':
        return `Custom Roll (${visibility})`;
      default:
        return `Roll (${visibility})`;
    }
  }

  /**
   * Restore roll button states from persistent storage
   * Called when chat messages are rendered to maintain state across sessions
   */

  /**
   * Attach click handlers to roll buttons and handle visibility
   * Called by global renderChatMessageHTML hook in main.ts
   */
  public attachRollButtonHandlers(html: JQuery): void {
    const currentUserId = game.user?.id;
    const isGM = game.user?.isGM;

    // Diagnostic: confirms the render hook reached us and how many buttons it saw.
    // If a player clicks and nothing happens, check the console for this line:
    // absent => the renderChatMessageHTML hook never attached handlers on their client.
    console.debug(
      `[${MODULE_ID}] attachRollButtonHandlers: ${html.find('.mcp-roll-button').length} button(s) for user "${game.user?.name}" (GM=${isGM})`
    );

    // Note: Roll state restoration now handled by ChatMessage content, not DOM manipulation

    // Handle button visibility and styling based on permissions and public/private status
    // IMPORTANT: Skip styling for buttons that are already in rolled state
    html.find('.mcp-roll-button').each((_index, element) => {
      const button = $(element);
      const targetUserId = button.data('target-user-id');
      const isPublicRollRaw = button.data('is-public');
      const isPublicRoll = isPublicRollRaw === true || isPublicRollRaw === 'true';

      // Note: No need to check for rolled state - ChatMessage.update() replaces buttons with completion status

      // Determine if user can interact with this button
      const canClickButton = isGM || (targetUserId && targetUserId === currentUserId);

      if (isPublicRoll) {
        // Public roll: show to all players, but style differently for non-clickable users
        if (canClickButton) {
          // Can click: normal active button
          button.css({
            background: '#4CAF50',
            cursor: 'pointer',
            opacity: '1',
          });
        } else {
          // Cannot click: disabled/informational style
          button.css({
            background: '#9E9E9E',
            cursor: 'not-allowed',
            opacity: '0.7',
          });
          button.prop('disabled', true);
        }
      } else {
        // Private roll: only show to target user and GM
        if (canClickButton) {
          button.show();
        } else {
          button.hide();
        }
      }
    });

    // Attach click handlers to roll buttons
    html.find('.mcp-roll-button').on('click', async event => {
      const button = $(event.currentTarget);

      // Ignore clicks on disabled buttons
      if (button.prop('disabled')) {
        return;
      }

      // Prevent double-clicks by immediately disabling the button
      button.prop('disabled', true);
      const originalText = button.text();
      button.text('🎲 Rolling...');

      // Check if this button is already being processed by another user
      const buttonId = button.data('button-id');
      if (buttonId && this.isRollButtonProcessing(buttonId)) {
        button.text('🎲 Processing...');
        return;
      }

      // Mark this button as being processed
      if (buttonId) {
        this.setRollButtonProcessing(buttonId, true);
      }

      // Validate button has required data
      if (!buttonId) {
        console.warn(`[${MODULE_ID}] Button missing button-id data attribute`);
        button.prop('disabled', false);
        button.text(originalText);
        return;
      }

      // Read via attr() to avoid jQuery .data() coercion (it JSON-parses values
      // that look like numbers/arrays/objects, which can mangle a roll formula).
      const rollFormula = button.attr('data-roll-formula') ?? button.data('roll-formula');
      const rollLabel = button.attr('data-roll-label') ?? button.data('roll-label');
      const isPublicRaw = button.data('is-public');
      const isPublic = isPublicRaw === true || isPublicRaw === 'true'; // Convert to proper boolean
      const characterId = button.data('character-id');
      const targetUserId = button.data('target-user-id');
      const isGmRoll = game.user?.isGM || false; // Determine if this is a GM executing the roll

      // Check if user has permission to execute this roll
      // Allow GM to roll for any character, or allow character owner to roll for their character
      const canExecuteRoll = game.user?.isGM || (targetUserId && targetUserId === game.user?.id);

      if (!canExecuteRoll) {
        console.warn(`[${MODULE_ID}] Permission denied for roll execution`);
        ui.notifications?.warn('You do not have permission to execute this roll');
        return;
      }

      try {
        // Diagnostic: surface the exact formula before parsing (helps catch
        // malformed formulas like "1d20+[object Object]").
        console.log(`[${MODULE_ID}] Executing roll with formula:`, rollFormula);

        // Create and evaluate the roll, validating first for a clear error.
        const RollCls: any = Roll;
        if (typeof RollCls.validate === 'function' && !RollCls.validate(rollFormula)) {
          throw new Error(`Invalid roll formula: "${rollFormula}"`);
        }
        const roll = new RollCls(rollFormula);
        await roll.evaluate();

        // Get the character for speaker info
        const character = characterId ? game.actors?.get(characterId) : null;

        // Use the modern Foundry v13 approach with roll.toMessage()
        const rollMode = isPublic ? 'publicroll' : 'whisper';
        const whisperTargets: string[] = [];

        if (!isPublic) {
          // For private rolls: whisper to target + GM
          if (targetUserId) {
            whisperTargets.push(targetUserId);
          }
          // Add all active GMs
          const gmUsers = game.users?.filter((u: User) => u.isGM && u.active);
          if (gmUsers) {
            for (const gm of gmUsers) {
              if (gm.id && !whisperTargets.includes(gm.id)) {
                whisperTargets.push(gm.id);
              }
            }
          }
        }

        const messageData: any = {
          speaker: ChatMessage.getSpeaker({ actor: character }),
          flavor: `${rollLabel} ${isGmRoll ? '(GM Override)' : ''}`,
          ...(whisperTargets.length > 0 ? { whisper: whisperTargets } : {}),
        };

        // Use roll.toMessage() with proper rollMode
        await roll.toMessage(messageData, {
          create: true,
          rollMode: rollMode,
        });

        // Update the ChatMessage to reflect rolled state
        const buttonId = button.data('button-id');
        if (buttonId && game.user?.id) {
          try {
            await this.updateRollButtonMessage(buttonId, game.user.id, rollLabel);
          } catch (updateError) {
            console.error(`[${MODULE_ID}] Failed to update chat message:`, updateError);
            console.error(
              `[${MODULE_ID}] Error details:`,
              updateError instanceof Error ? updateError.stack : updateError
            );
            // Fall back to DOM manipulation if message update fails
            button.prop('disabled', true).text('✓ Rolled');
          }
        } else {
          console.warn(`[${MODULE_ID}] Cannot update ChatMessage - missing buttonId or userId:`, {
            buttonId,
            userId: game.user?.id,
          });
        }
      } catch (error) {
        console.error(`[${MODULE_ID}] Error executing roll:`, error);
        ui.notifications?.error('Failed to execute roll');

        // Re-enable button on error so user can try again
        button.prop('disabled', false);
        button.text(originalText);
      } finally {
        // Clear processing state
        if (buttonId) {
          this.setRollButtonProcessing(buttonId, false);
        }
      }
    });
  }

  /**
   * Get enhanced creature index for campaign analysis
   */
  async getEnhancedCreatureIndex(): Promise<any[]> {
    this.validateFoundryState();

    // Get the enhanced creature index (builds if needed)
    const enhancedCreatures = await this.persistentIndex.getEnhancedIndex();

    return enhancedCreatures || [];
  }

  /**
   * Save roll button state to persistent storage
   */
  async saveRollState(buttonId: string, userId: string): Promise<void> {
    // LEGACY METHOD - Redirecting to new ChatMessage.update() system

    try {
      // Use the new ChatMessage.update() approach instead
      const rollLabel = 'Legacy Roll'; // We don't have the label here, use generic
      await this.updateRollButtonMessage(buttonId, userId, rollLabel);
    } catch (error) {
      console.error(`[${MODULE_ID}] Legacy saveRollState redirect failed:`, error);
      // Don't throw - we don't want to break the old system completely
    }
  }

  /**
   * Get roll button state from persistent storage
   */
  getRollState(
    buttonId: string
  ): { rolled: boolean; rolledBy?: string; rolledByName?: string; timestamp?: number } | null {
    this.validateFoundryState();

    try {
      const rollStates = game.settings.get(MODULE_ID, 'rollStates') || {};
      return rollStates[buttonId] || null;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting roll state:`, error);
      return null;
    }
  }

  /**
   * Save button ID to message ID mapping for ChatMessage updates
   */
  saveRollButtonMessageId(buttonId: string, messageId: string): void {
    try {
      const buttonMessageMap = game.settings.get(MODULE_ID, 'buttonMessageMap') || {};
      buttonMessageMap[buttonId] = messageId;
      game.settings.set(MODULE_ID, 'buttonMessageMap', buttonMessageMap);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error saving button-message mapping:`, error);
    }
  }

  /**
   * Get message ID for a roll button
   */
  getRollButtonMessageId(buttonId: string): string | null {
    try {
      const buttonMessageMap = game.settings.get(MODULE_ID, 'buttonMessageMap') || {};
      return buttonMessageMap[buttonId] || null;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting button-message mapping:`, error);
      return null;
    }
  }

  /**
   * Get roll button state from ChatMessage flags
   */
  getRollStateFromMessage(chatMessage: any, buttonId: string): any {
    try {
      const rollButtons = chatMessage.getFlag(MODULE_ID, 'rollButtons');
      return rollButtons?.[buttonId] || null;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting roll state from message:`, error);
      return null;
    }
  }

  /**
   * Update the ChatMessage to replace button with rolled state
   */
  async updateRollButtonMessage(
    buttonId: string,
    userId: string,
    rollLabel: string
  ): Promise<void> {
    try {
      // Get the message ID for this button
      const messageId = this.getRollButtonMessageId(buttonId);

      if (!messageId) {
        throw new Error(`No message ID found for button ${buttonId}`);
      }

      // Get the chat message
      const chatMessage = game.messages?.get(messageId);

      if (!chatMessage) {
        throw new Error(`ChatMessage ${messageId} not found`);
      }

      const rolledByName = game.users?.get(userId)?.name || 'Unknown';
      const timestamp = new Date().toLocaleString();

      // Check permissions before attempting update
      const canUpdate = chatMessage.canUserModify(game.user, 'update');

      if (!canUpdate && !game.user?.isGM) {
        // Non-GM user cannot update message - request GM to do it via socket

        // Find online GM
        const onlineGM = game.users?.find(u => u.isGM && u.active);
        if (!onlineGM) {
          throw new Error('No Game Master is online to update the chat message');
        }

        // Send socket request to GM
        if (game.socket) {
          game.socket.emit('module.foundry-mcp-bridge', {
            type: 'requestMessageUpdate',
            buttonId: buttonId,
            userId: userId,
            rollLabel: rollLabel,
            messageId: messageId,
            fromUserId: game.user.id,
            targetGM: onlineGM.id,
          });
          return; // Exit early - GM will handle the update
        } else {
          throw new Error('Socket not available for GM communication');
        }
      }

      // Update the message flags to mark button as rolled
      const currentFlags = chatMessage.flags || {};
      const moduleFlags = currentFlags[MODULE_ID] || {};
      const rollButtons = moduleFlags.rollButtons || {};

      rollButtons[buttonId] = {
        ...rollButtons[buttonId],
        rolled: true,
        rolledBy: userId,
        rolledByName: rolledByName,
        timestamp: Date.now(),
      };

      // Create the rolled state HTML
      const rolledHtml = `
        <div class="mcp-roll-request" style="margin: 10px 0; padding: 10px; border: 1px solid #ccc; border-radius: 5px; background: #f9f9f9;">
          <p><strong>Roll Request:</strong> ${rollLabel}</p>
          <p><strong>Status:</strong> ✅ <strong>Completed by ${rolledByName}</strong> at ${timestamp}</p>
        </div>
      `;

      // Update the message content and flags
      await chatMessage.update({
        content: rolledHtml,
        flags: {
          ...currentFlags,
          [MODULE_ID]: {
            ...moduleFlags,
            rollButtons: rollButtons,
          },
        },
      });
    } catch (error) {
      console.error(`[${MODULE_ID}] Error updating roll button message:`, error);
      console.error(`[${MODULE_ID}] Error stack:`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Request GM to save roll state (for non-GM users who can't write to world settings)
   */
  requestRollStateSave(buttonId: string, userId: string): void {
    // LEGACY METHOD - Redirecting to new ChatMessage.update() system

    try {
      // Use the new ChatMessage.update() approach instead
      const rollLabel = 'Legacy Roll'; // We don't have the label here, use generic
      this.updateRollButtonMessage(buttonId, userId, rollLabel)
        .then(() => {})
        .catch(error => {
          console.error(`[${MODULE_ID}] Legacy requestRollStateSave redirect failed:`, error);
          // If the new system fails, just log it - don't use the old socket system
        });
    } catch (error) {
      console.error(`[${MODULE_ID}] Error in legacy requestRollStateSave redirect:`, error);
    }
  }

  /**
   * Broadcast roll state change to all connected users for real-time sync
   */
  broadcastRollState(_buttonId: string, _rollState: any): void {
    // LEGACY METHOD - No longer needed with ChatMessage.update() system
    // ChatMessage.update() automatically broadcasts to all clients, so this method is no longer needed
  }

  /**
   * Clean up old roll states (optional maintenance)
   * Removes roll states older than 30 days to prevent storage bloat
   */
  async cleanOldRollStates(): Promise<number> {
    this.validateFoundryState();

    try {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const rollStates = game.settings.get(MODULE_ID, 'rollStates') || {};
      let cleanedCount = 0;

      // Remove old roll states
      for (const [buttonId, rollState] of Object.entries(rollStates)) {
        if (rollState && typeof rollState === 'object' && 'timestamp' in rollState) {
          const timestamp = (rollState as any).timestamp;
          if (typeof timestamp === 'number' && timestamp < thirtyDaysAgo) {
            delete rollStates[buttonId];
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        await game.settings.set(MODULE_ID, 'rollStates', rollStates);
      }

      return cleanedCount;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error cleaning old roll states:`, error);
      return 0;
    }
  }

  async setActorOwnership(data: {
    actorId: string;
    userId: string;
    permission: number;
  }): Promise<{ success: boolean; message: string; error?: string }> {
    return this.ownership.setActorOwnership(data);
  }

  async getActorOwnership(data: {
    actorIdentifier?: string;
    playerIdentifier?: string;
  }): Promise<any> {
    return this.ownership.getActorOwnership(data);
  }

  async getFriendlyNPCs(): Promise<Array<{ id: string; name: string }>> {
    return this.ownership.getFriendlyNPCs();
  }

  async getPartyCharacters(): Promise<Array<{ id: string; name: string }>> {
    return this.ownership.getPartyCharacters();
  }

  async getConnectedPlayers(): Promise<Array<{ id: string; name: string }>> {
    return this.ownership.getConnectedPlayers();
  }

  async findPlayers(data: {
    identifier: string;
    allowPartialMatch?: boolean;
    includeCharacterOwners?: boolean;
  }): Promise<Array<{ id: string; name: string }>> {
    return this.ownership.findPlayers(data);
  }

  async findActor(data: { identifier: string }): Promise<{ id: string; name: string } | null> {
    return this.ownership.findActor(data);
  }

  // Private storage for tracking roll button processing states
  private rollButtonProcessingStates: Map<string, boolean> = new Map();

  /**
   * Check if a roll button is currently being processed
   */
  private isRollButtonProcessing(buttonId: string): boolean {
    return this.rollButtonProcessingStates.get(buttonId) || false;
  }

  /**
   * Set roll button processing state
   */
  private setRollButtonProcessing(buttonId: string, processing: boolean): void {
    if (processing) {
      this.rollButtonProcessingStates.set(buttonId, true);
    } else {
      this.rollButtonProcessingStates.delete(buttonId);
    }
  }

  /** Find or create an MCP content folder (delegates to shared core). */
  private getOrCreateFolder(
    folderName: string,
    type: 'Actor' | 'JournalEntry'
  ): Promise<string | null> {
    return shared.getOrCreateFolder(folderName, type);
  }

  async listScenes(
    options: { filter?: string; include_active_only?: boolean } = {}
  ): Promise<any[]> {
    return this.scenesTokens.listScenes(options);
  }

  async switchScene(options: { scene_identifier: string; optimize_view?: boolean }): Promise<any> {
    return this.scenesTokens.switchScene(options);
  }

  // ===== PHASE 7: CHARACTER ENTITY AND TOKEN MANIPULATION METHODS =====

  async getCharacterEntity(data: {
    characterIdentifier: string;
    entityIdentifier: string;
  }): Promise<any> {
    return this.characters.getCharacterEntity(data);
  }

  async moveToken(data: {
    tokenId: string;
    x: number;
    y: number;
    animate?: boolean;
  }): Promise<any> {
    return this.scenesTokens.moveToken(data);
  }

  async updateToken(data: { tokenId: string; updates: Record<string, any> }): Promise<any> {
    return this.scenesTokens.updateToken(data);
  }

  async deleteTokens(data: { tokenIds: string[] }): Promise<any> {
    return this.scenesTokens.deleteTokens(data);
  }

  async getTokenDetails(data: { tokenId: string }): Promise<any> {
    return this.scenesTokens.getTokenDetails(data);
  }

  async toggleTokenCondition(data: {
    tokenId: string;
    conditionId: string;
    active: boolean;
  }): Promise<any> {
    return this.scenesTokens.toggleTokenCondition(data);
  }

  async getAvailableConditions(): Promise<any> {
    return this.resources.getAvailableConditions();
  }

  /**
   * Move a token to a new position
   */

  /**
   * Use an item on a character (cast spell, use ability, consume item, etc.)
   * This triggers the item's default use behavior in Foundry VTT
   */
  async useItem(params: {
    actorIdentifier: string;
    itemIdentifier: string;
    targets?: string[] | undefined; // Target character/token names or IDs. "self" targets the caster.
    options?:
      | {
          consume?: boolean | undefined; // Whether to consume charges/uses
          configureDialog?: boolean | undefined; // Whether to show configuration dialog
          skipDialog?: boolean | undefined; // Skip confirmation dialogs (default: true for MCP)
          spellLevel?: number | undefined; // For spells: cast at higher level
          versatile?: boolean | undefined; // For versatile weapons: use versatile damage
        }
      | undefined;
  }): Promise<{
    success: boolean;
    status?: string;
    message: string;
    itemName?: string;
    actorName?: string;
    targets?: string[];
    requiresGMInteraction?: boolean;
  }> {
    this.validateFoundryState();

    const { actorIdentifier, itemIdentifier, targets, options = {} } = params;

    // Find the actor
    const actor = this.findActorByIdentifier(actorIdentifier);
    if (!actor) {
      throw new Error(`Actor not found: ${actorIdentifier}`);
    }

    // Find the item on the actor
    const item = actor.items.find(
      (i: any) => i.id === itemIdentifier || i.name.toLowerCase() === itemIdentifier.toLowerCase()
    );

    if (!item) {
      throw new Error(`Item "${itemIdentifier}" not found on actor "${actor.name}"`);
    }

    const itemAny = item as any;
    const systemId = (game.system as any).id;

    // Handle targeting if targets are specified
    const resolvedTargetNames: string[] = [];
    if (targets && targets.length > 0) {
      // Get all tokens on the current scene
      const scene = (game.scenes as any)?.active;
      if (!scene) {
        throw new Error('No active scene to find targets on');
      }

      const sceneTokens = scene.tokens;
      const tokenIds: string[] = [];

      for (const targetIdentifier of targets) {
        // Handle "self" - target the caster's token
        if (targetIdentifier.toLowerCase() === 'self') {
          // Find token for the caster actor
          const selfToken = sceneTokens.find(
            (t: any) => t.actor?.id === actor.id || t.actorId === actor.id
          );
          if (selfToken) {
            tokenIds.push(selfToken.id);
            resolvedTargetNames.push(actor.name);
          } else {
            console.warn(
              `[foundry-mcp-bridge] No token found on scene for actor "${actor.name}" (self)`
            );
          }
          continue;
        }

        // Find token by name or ID
        const targetToken = sceneTokens.find(
          (t: any) =>
            t.id === targetIdentifier ||
            t.name?.toLowerCase() === targetIdentifier.toLowerCase() ||
            t.actor?.name?.toLowerCase() === targetIdentifier.toLowerCase()
        );

        if (targetToken) {
          tokenIds.push(targetToken.id);
          resolvedTargetNames.push(targetToken.name || targetToken.actor?.name || targetIdentifier);
        } else {
          console.warn(`[foundry-mcp-bridge] Target not found: "${targetIdentifier}"`);
        }
      }

      // Set targets using Foundry's targeting system
      if (tokenIds.length > 0 && game.user) {
        await (game.user as any).updateTokenTargets(tokenIds);
        console.log(`[foundry-mcp-bridge] Set targets: ${resolvedTargetNames.join(', ')}`);
      }
    }

    try {
      // For items that may show dialogs (spells with choices, etc.),
      // we fire-and-forget to avoid timeout issues. The GM will interact
      // with the dialog in Foundry, and the result appears in chat.

      // Check if item has a use() method (D&D 5e)
      if (typeof itemAny.use === 'function') {
        // D&D 5e and similar systems
        // Only pass options that D&D 5e's item.use() expects
        const useOptions: Record<string, any> = {
          createMessage: true,
        };

        // D&D 5e specific options
        if (systemId === 'dnd5e') {
          useOptions.consumeResource = options.consume ?? true;
          useOptions.consumeSpellSlot = options.consume ?? true;
          useOptions.consumeUsage = options.consume ?? true;
          // Always show dialog so GM can make choices
          useOptions.configureDialog = true;
        }

        // Spell level for upcasting
        if (options.spellLevel !== undefined) {
          useOptions.slotLevel = options.spellLevel; // D&D 5e
          useOptions.level = options.spellLevel; // generic
        }

        // Fire and forget - don't await, as dialogs block the promise
        itemAny.use(useOptions).catch((err: Error) => {
          console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
        });
      } else if (typeof itemAny.toChat === 'function') {
        if (typeof itemAny.toMessage === 'function') {
          itemAny.toMessage(undefined, { create: true }).catch((err: Error) => {
            console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
          });
        } else {
          itemAny.toChat().catch((err: Error) => {
            console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
          });
        }
      } else if (typeof itemAny.roll === 'function') {
        // Some items have a roll method
        itemAny.roll().catch((err: Error) => {
          console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
        });
      } else {
        // Generic fallback: create a chat message
        const chatData = {
          user: game.user?.id,
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<h3>${item.name}</h3><p>${actor.name} uses ${item.name}.</p>`,
        };
        ChatMessage.create(chatData);
      }

      this.auditLog(
        'useItem',
        {
          actorId: actor.id,
          itemId: item.id,
          itemName: item.name,
          targets: resolvedTargetNames,
        },
        'success'
      );

      const targetInfo =
        resolvedTargetNames.length > 0 ? ` targeting ${resolvedTargetNames.join(', ')}` : '';

      const result: {
        success: boolean;
        status?: string;
        message: string;
        itemName?: string;
        actorName?: string;
        targets?: string[];
        requiresGMInteraction?: boolean;
      } = {
        success: true,
        status: 'initiated',
        message: `Item use initiated for ${actor.name} using ${item.name}${targetInfo}. If a dialog appeared in Foundry VTT, the GM should select options and confirm. The result will appear in chat.`,
        itemName: item.name,
        actorName: actor.name,
        requiresGMInteraction: true,
      };

      if (resolvedTargetNames.length > 0) {
        result.targets = resolvedTargetNames;
      }

      return result;
    } catch (error) {
      this.auditLog(
        'useItem',
        {
          actorId: actor.id,
          itemId: item.id,
        },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );

      throw new Error(
        `Failed to use item "${item.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // ===== D&D 5E FEATURE CREATION =====

  /**
   * Add a save-attack feature (feat) to an existing D&D 5e actor.
   * Creates a single save Activity with damage and an optional area template.
   */
  async addSaveFeatureToActor(data: {
    actorIdentifier: string;
    featureName: string;
    description: string;
    activationType: string;
    saveAbility: string;
    saveDC: number;
    damageParts: Array<{ number: number; denomination: number; type: string }>;
    halfOnSave: boolean;
    areaType: string;
    areaSize?: number;
    areaUnits: string;
    affectsType: string;
  }): Promise<any> {
    this.validateFoundryState();

    try {
      // 1. Lookup actor
      const actor = this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. System guard
      if ((game.system as any).id !== 'dnd5e') {
        throw new Error(
          `addSaveFeatureToActor requires D&D 5e. ` +
            `Current system: "${(game.system as any).id}".`
        );
      }

      // 3. Duplicate check (by name only, regardless of item type)
      const existing = actor.items.find((i: any) => i.name === data.featureName);
      if (existing) {
        throw new Error(
          `Feature "${data.featureName}" already exists on actor "${actor.name}" ` +
            `(id: ${existing.id}). Use a different name or remove the existing feature first.`
        );
      }

      // 4. Generate activity ID
      const activityId: string = (foundry.utils as any).randomID(16);

      // 5. Slug identifier
      const identifier = slugify(data.featureName);

      // 5a. Map emanation → radius (Foundry uses "radius" for radial emanations)
      const mappedAreaType: string = data.areaType === 'emanation' ? 'radius' : data.areaType;

      // 6. Build item data — schema verified against dnd5e 5.1.8 real output
      const itemData = {
        name: data.featureName,
        type: 'feat',
        img: 'systems/dnd5e/icons/svg/items/feature.svg',
        system: {
          description: { value: data.description, chat: '' },
          identifier,
          source: { revision: 1, rules: '2024' },
          type: { value: 'monster', subtype: '' },
          uses: { spent: 0, recovery: [], max: '' },
          advancement: [],
          crewed: false,
          enchant: {},
          prerequisites: { items: [], repeatable: false, level: null },
          properties: [],
          requirements: '',
          activities: {
            [activityId]: {
              _id: activityId,
              type: 'save',
              sort: 0,
              name: '',
              activation: {
                type: data.activationType,
                override: false,
              },
              consumption: {
                scaling: { allowed: false },
                spellSlot: true,
                targets: [],
              },
              description: {},
              duration: { units: 'inst', concentration: false, override: false },
              effects: [],
              range: { units: 'self', override: false },
              uses: { spent: 0, recovery: [] },
              target: {
                template: {
                  contiguous: false,
                  units: data.areaUnits,
                  count: '',
                  type: mappedAreaType,
                  size: mappedAreaType ? String(data.areaSize) : '',
                },
                affects: {
                  choice: false,
                  count: '',
                  type: data.affectsType,
                  special: '',
                },
                override: false,
                prompt: true,
              },
              damage: {
                onSave: data.halfOnSave ? 'half' : 'none',
                parts: data.damageParts.map(p => ({
                  custom: { enabled: false, formula: '' },
                  number: p.number,
                  denomination: p.denomination,
                  bonus: '',
                  types: [p.type],
                  scaling: { mode: '', number: 1 },
                })),
              },
              save: {
                ability: [data.saveAbility],
                dc: {
                  calculation: '',
                  formula: String(data.saveDC),
                },
              },
            },
          },
        },
        effects: [],
      };

      // 7. Create embedded item
      const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as any[];

      this.auditLog(
        'addSaveFeatureToActor',
        { actorId: actor.id, featureName: data.featureName },
        'success'
      );

      // 8. Return structured result
      return {
        success: true,
        item: { id: created.id, name: created.name },
        actor: { id: actor.id, name: actor.name },
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add save feature to actor`, error);
      this.auditLog(
        'addSaveFeatureToActor',
        { actorIdentifier: data.actorIdentifier, featureName: data.featureName },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ===== CREATE NPC ACTOR (D&D 5e) =====

  async createNpcActor(data: {
    name: string;
    creatureType: string;
    creatureSubtype: string;
    size: string;
    alignment: string;
    cr: string | number;
    hpAverage: number;
    hpFormula: string;
    acMode: string;
    acValue?: number;
    abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
    savingThrows: string[];
    walkSpeed: number;
    flySpeed: number;
    swimSpeed: number;
    climbSpeed: number;
    burrowSpeed: number;
    hover: boolean;
    darkvision: number;
    blindsight: number;
    tremorsense: number;
    truesight: number;
    specialSenses: string;
    skills: Array<{ skill: string; proficiency: string }>;
    damageImmunities: string[];
    damageResistances: string[];
    damageVulnerabilities: string[];
    conditionImmunities: string[];
    languages: string[];
    languagesCustom: string;
    biography: string;
    sourceBook: string;
    sourcePage: string;
    sourceRules: string;
  }): Promise<any> {
    this.validateFoundryState();

    try {
      // 1. System guard
      if ((game.system as any).id !== 'dnd5e') {
        throw new Error(
          `createNpcActor requires D&D 5e. ` + `Current system: "${(game.system as any).id}".`
        );
      }

      // 2. Duplicate check by name — only against other NPCs, so a player
      //    character sharing the name does not block NPC creation.
      const existingActor = game.actors?.find((a: any) => a.name === data.name && a.type === 'npc');
      if (existingActor) {
        throw new Error(
          `NPC "${data.name}" already exists (id: ${existingActor.id}). ` +
            `Use a different name or remove the existing NPC first.`
        );
      }

      // 3. Soft validation — collect warnings, do NOT block creation
      const warnings: string[] = [];
      const allDamageValues: Array<{ field: string; value: string }> = [
        ...data.damageImmunities.map(v => ({ field: 'damageImmunities', value: v })),
        ...data.damageResistances.map(v => ({ field: 'damageResistances', value: v })),
        ...data.damageVulnerabilities.map(v => ({ field: 'damageVulnerabilities', value: v })),
      ];
      for (const { field, value } of allDamageValues) {
        if (!NPC_DAMAGE_CANONICAL.has(value)) {
          const msg = `Unknown damage type "${value}" in ${field} — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }
      for (const value of data.conditionImmunities) {
        if (!NPC_CONDITION_CANONICAL.has(value)) {
          const msg = `Unknown condition "${value}" in conditionImmunities — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Normalize CR to float
      const normalizedCR = npcNormalizeCR(data.cr);

      // 5. Folder
      const folderId = await this.getOrCreateFolder('Foundry MCP Creatures', 'Actor');

      // 6. Ability scores with saving throw proficiency flags
      const savingThrowSet = new Set(data.savingThrows);
      const abilities = {
        str: { value: data.abilities.str, proficient: savingThrowSet.has('str') ? 1 : 0 },
        dex: { value: data.abilities.dex, proficient: savingThrowSet.has('dex') ? 1 : 0 },
        con: { value: data.abilities.con, proficient: savingThrowSet.has('con') ? 1 : 0 },
        int: { value: data.abilities.int, proficient: savingThrowSet.has('int') ? 1 : 0 },
        wis: { value: data.abilities.wis, proficient: savingThrowSet.has('wis') ? 1 : 0 },
        cha: { value: data.abilities.cha, proficient: savingThrowSet.has('cha') ? 1 : 0 },
      };

      // 7. AC block — omit flat when mode is "default"
      const acBlock =
        data.acMode === 'flat' ? { calc: 'flat', flat: data.acValue } : { calc: 'default' };

      // 8. Build full actor data
      const actorData: any = {
        name: data.name,
        type: 'npc',
        system: {
          abilities,
          attributes: {
            ac: acBlock,
            hp: {
              value: data.hpAverage,
              max: data.hpAverage,
              temp: 0,
              tempmax: 0,
              formula: data.hpFormula,
            },
            movement: {
              walk: data.walkSpeed,
              fly: data.flySpeed,
              swim: data.swimSpeed,
              climb: data.climbSpeed,
              burrow: data.burrowSpeed,
              units: 'ft',
              hover: data.hover,
              special: '',
            },
            senses: {
              darkvision: data.darkvision,
              blindsight: data.blindsight,
              tremorsense: data.tremorsense,
              truesight: data.truesight,
              units: 'ft',
              special: data.specialSenses,
            },
          },
          details: {
            cr: normalizedCR,
            type: {
              value: data.creatureType,
              subtype: data.creatureSubtype,
            },
            alignment: data.alignment,
            biography: {
              value: data.biography,
              public: '',
            },
            source: {
              revision: 1,
              rules: data.sourceRules,
              book: data.sourceBook,
              page: data.sourcePage,
              custom: '',
              license: '',
            },
          },
          traits: {
            size: NPC_SIZE_MAP[data.size] ?? 'med',
            di: { value: data.damageImmunities, custom: '', bypasses: [] },
            dr: { value: data.damageResistances, custom: '', bypasses: [] },
            dv: { value: data.damageVulnerabilities, custom: '', bypasses: [] },
            ci: { value: data.conditionImmunities, custom: '' },
            languages: {
              value: data.languages,
              custom: data.languagesCustom,
              communication: {},
            },
          },
          skills: npcBuildSkillsBlock(data.skills),
        },
      };

      // 9. Assign folder if available
      if (folderId) {
        actorData.folder = folderId;
      }

      // 10. Create actor
      const actor = await Actor.create(actorData);
      if (!actor) {
        throw new Error(`Failed to create NPC actor "${data.name}"`);
      }

      this.auditLog('createNpcActor', { name: data.name, cr: normalizedCR }, 'success');

      // 11. Return structured result
      return {
        success: true,
        actor: {
          id: actor.id,
          name: actor.name,
          cr: npcFormatCR(normalizedCR),
          folder: folderId ?? null,
        },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to create NPC actor`, error);
      this.auditLog(
        'createNpcActor',
        { name: data.name },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add weapon attack to an existing actor (dnd5e-add-attack-feature)
  // ---------------------------------------------------------------------------

  async addAttackToActor(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addAttackToActor requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = await this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check
      const existing = actor.items.find(
        (i: any) => i.name.toLowerCase() === data.featureName.toLowerCase()
      );
      if (existing) {
        throw new Error(
          `An item named "${data.featureName}" already exists on actor "${actor.name}". ` +
            `Remove or rename it first.`
        );
      }

      // 3. Soft validation — collect warnings, never block
      const warnings: string[] = [];

      for (const part of data.damageParts as Array<{
        number: number;
        denomination: number;
        type: string;
      }>) {
        if (!ATTACK_DAMAGE_CANONICAL.has(part.type)) {
          const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }
      for (const prop of data.properties as string[]) {
        if (!ATTACK_PROPERTY_CANONICAL.has(prop)) {
          const msg = `Unknown weapon property "${prop}" — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Generate activity ID
      const activityId: string = (foundry.utils as any).randomID(16);

      // 5. Damage parts for the activity (all except the first — which is system.damage.base)
      const activityDamageParts = (
        data.damageParts as Array<{ number: number; denomination: number; type: string }>
      )
        .slice(1)
        .map(p => ({
          types: [p.type],
          number: p.number,
          denomination: p.denomination,
          bonus: '',
          scaling: { mode: '', number: 1 },
          custom: { enabled: false },
        }));

      // 6. Range object (system-level — holds the real range/reach)
      const rangeObj =
        data.attackType === 'melee'
          ? { value: data.reachFt ?? 5, long: null, units: 'ft' }
          : { value: data.rangeFt, long: data.longRangeFt ?? null, units: 'ft' };

      // 7. Conditional 2024-only fields
      const sourceRules: string = data.sourceRules ?? '2014';
      const masteryField = sourceRules === '2024' ? { mastery: '' } : {};
      const abilityField = sourceRules === '2024' ? { ability: data.effectiveAbility } : {};
      const classification = sourceRules === '2014' ? 'weapon' : '';

      // 8. Build item data
      const itemData: Record<string, any> = {
        name: data.featureName,
        type: 'weapon',
        system: {
          description: {
            value: data.description ?? '',
            chat: '',
            unidentified: '',
          },
          source: {
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
            rules: sourceRules,
          },
          quantity: 1,
          weight: { value: 0, units: 'lb' },
          price: { value: 0, denomination: 'gp' },
          attunement: '',
          equipped: data.equipped !== false,
          rarity: '',
          identified: true,
          activation: {
            type: data.activationType ?? 'action',
            value: 1,
            condition: '',
            override: false,
          },
          duration: { value: '', units: '' },
          cover: null,
          target: {
            template: {
              count: '',
              contiguous: false,
              type: '',
              size: '',
              width: '',
              height: '',
              units: '',
            },
            affects: { count: '', type: '', choice: false, special: '' },
            prompt: true,
            override: false,
          },
          range: rangeObj,
          uses: { value: null, max: '', recovery: [], prompt: true },
          damage: {
            base: {
              types: [(data.damageParts as any[])[0].type],
              number: (data.damageParts as any[])[0].number,
              denomination: (data.damageParts as any[])[0].denomination,
              bonus: '',
              scaling: { mode: '', number: 1 },
              custom: { enabled: false },
            },
          },
          type: { value: data.weaponClass ?? 'natural', baseItem: '' },
          properties: data.properties as string[],
          proficient: 1,
          magicalBonus: null,
          ...masteryField,
          activities: {
            [activityId]: {
              _id: activityId,
              type: 'attack',
              name: '',
              img: '',
              sort: 0,
              description: {},
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                condition: '',
                override: false,
              },
              duration: { units: '', value: '', override: false },
              target: {
                template: {
                  count: '',
                  contiguous: false,
                  type: '',
                  size: '',
                  width: '',
                  height: '',
                  units: '',
                },
                affects: { count: '', type: '', choice: false, special: '' },
                prompt: true,
                override: false,
              },
              range: { units: 'self', override: false },
              uses: { spent: 0, max: '', recovery: [] },
              consumption: {
                targets: [],
                scaling: { allowed: false, max: '' },
                spellSlot: true,
              },
              attack: {
                ability: '',
                bonus: data.attackBonus > 0 ? String(data.attackBonus) : '',
                critical: { threshold: null },
                flat: false,
                type: {
                  value: data.attackType ?? 'melee',
                  classification: classification,
                },
                ...abilityField,
              },
              damage: {
                critical: { bonus: '' },
                includeBase: true,
                parts: activityDamageParts,
              },
              effects: [],
              save: { ability: '', dc: { formula: '', calculation: '' } },
            },
          },
        },
      };

      // 9. Create the item on the actor
      const created = (await actor.createEmbeddedDocuments('Item', [itemData]))[0];
      if (!created) {
        throw new Error(
          `Failed to create attack item "${data.featureName}" on actor "${actor.name}"`
        );
      }

      this.auditLog(
        'addAttackToActor',
        { actorId: actor.id, featureName: data.featureName },
        'success'
      );

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'weapon' },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add attack to actor`, error);
      this.auditLog(
        'addAttackToActor',
        { actorIdentifier: data.actorIdentifier, featureName: data.featureName },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add automatic-damage aura/emanation feature to an existing actor
  // (dnd5e-add-aura-feature)
  // ---------------------------------------------------------------------------

  async addAuraToActor(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addAuraToActor requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = await this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check (case-insensitive name match)
      const existing = actor.items.find(
        (i: any) => i.name.toLowerCase() === data.featureName.toLowerCase()
      );
      if (existing) {
        throw new Error(
          `An item named "${data.featureName}" already exists on actor "${actor.name}". ` +
            `Remove or rename it first.`
        );
      }

      // 3. Soft validation — collect warnings, never block
      const warnings: string[] = [];

      for (const part of data.damageParts as Array<{
        number: number;
        denomination: number;
        type: string;
      }>) {
        if (!AURA_DAMAGE_CANONICAL.has(part.type)) {
          const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Map areaType: Foundry uses "radius" internally for what 5e 2024 calls "emanation"
      //    <option value="radius">Emanation</option> — no "emanation" value exists in the dropdown
      const mappedAreaType: string = data.areaType === 'emanation' ? 'radius' : data.areaType;

      // 5. Generate activity ID
      const activityId: string = (foundry.utils as any).randomID(16);

      // 6. Slug identifier
      const identifier = slugify(data.featureName as string);

      // 7. Build item data — schema verified against dnd5e 5.1.8 Banshee Wail
      const itemData = {
        name: data.featureName,
        type: 'feat',
        img: 'systems/dnd5e/icons/svg/items/feature.svg',
        system: {
          description: { value: data.description ?? '', chat: '' },
          identifier,
          source: {
            revision: 1,
            rules: data.sourceRules ?? '2014',
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
          },
          type: { value: 'monster', subtype: '' },
          uses: { spent: 0, recovery: [], max: '' },
          advancement: [],
          crewed: false,
          enchant: {},
          prerequisites: { items: [], repeatable: false, level: null },
          properties: [],
          requirements: '',
          activities: {
            [activityId]: {
              _id: activityId,
              type: 'damage', // activity type: damage — no attack roll, no save
              name: '',
              sort: 0,
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                override: false,
                // NO condition — not present in real dnd5e 5.1.8 schema
              },
              consumption: {
                scaling: { allowed: false },
                spellSlot: true, // confirmed: true in real Banshee Wail schema
                targets: [], // no uses management in V1
              },
              description: {}, // empty object — confirmed from real schema
              duration: {
                units: 'inst',
                concentration: false,
                override: false,
              },
              effects: [],
              range: { units: 'self', override: false }, // NO value, NO special
              uses: { spent: 0, recovery: [] }, // NO max field
              target: {
                template: {
                  contiguous: false,
                  units: data.areaUnits ?? 'ft',
                  count: '',
                  type: mappedAreaType,
                  size: String(data.areaSize),
                  width: '',
                  height: '',
                },
                affects: {
                  count: '',
                  type: data.affectsType ?? 'creature',
                  choice: false,
                  special: '',
                },
                override: false,
                prompt: true,
              },
              damage: {
                critical: { allow: false }, // only this key — no bonus, no dice
                parts: (
                  data.damageParts as Array<{ number: number; denomination: number; type: string }>
                ).map(p => ({
                  types: [p.type],
                  number: p.number,
                  denomination: p.denomination,
                  bonus: '',
                  scaling: { mode: '', number: 1 }, // mode: '' required — from real schema
                  custom: { enabled: false }, // NO formula field
                })),
                // NO onSave — damage activity has no save concept
              },
              // NO save block
              // NO attack block
            },
          },
        },
        effects: [],
      };

      // 7. Create embedded item
      const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as any[];
      if (!created) {
        throw new Error(
          `Failed to create aura item "${data.featureName}" on actor "${actor.name}"`
        );
      }

      this.auditLog(
        'addAuraToActor',
        { actorId: actor.id, featureName: data.featureName },
        'success'
      );

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'feat' },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add aura to actor`, error);
      this.auditLog(
        'addAuraToActor',
        { actorIdentifier: data.actorIdentifier, featureName: data.featureName },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add passive/descriptive feature to an existing actor (dnd5e-add-passive-feature)
  // No activities, no mechanics — pure description displayed on the sheet.
  // ---------------------------------------------------------------------------

  async addPassiveFeatureToActor(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addPassiveFeatureToActor requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = await this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check (case-insensitive)
      const existing = actor.items.find(
        (i: any) => i.name.toLowerCase() === data.featureName.toLowerCase()
      );
      if (existing) {
        throw new Error(
          `An item named "${data.featureName}" already exists on actor "${actor.name}". ` +
            `Remove or rename it first.`
        );
      }

      // 3. Slug identifier
      const identifier = slugify(data.featureName as string);

      // 4. Build item data — no activities, no activityId needed
      const itemData = {
        name: data.featureName,
        type: 'feat',
        img: 'systems/dnd5e/icons/svg/items/feature.svg',
        system: {
          description: { value: data.description ?? '', chat: '' },
          identifier,
          source: {
            revision: 1,
            rules: data.sourceRules ?? '2014',
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
          },
          type: { value: 'monster', subtype: '' },
          uses: { spent: 0, recovery: [], max: '' },
          advancement: [],
          crewed: false,
          enchant: {},
          prerequisites: { items: [], repeatable: false, level: null },
          properties: [],
          requirements: '',
          activities: {}, // empty — passive feature has no mechanical activity
        },
        effects: [],
      };

      // 5. Create embedded item
      const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as any[];
      if (!created) {
        throw new Error(
          `Failed to create passive feature "${data.featureName}" on actor "${actor.name}"`
        );
      }

      this.auditLog(
        'addPassiveFeatureToActor',
        { actorId: actor.id, featureName: data.featureName },
        'success'
      );

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'feat' },
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add passive feature to actor`, error);
      this.auditLog(
        'addPassiveFeatureToActor',
        { actorIdentifier: data.actorIdentifier, featureName: data.featureName },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add weapon attack + save effect to an existing actor
  // (dnd5e-add-attack-with-save) — Tipo B
  // Two activities: attack (sort:0) + save (sort:1)
  // ---------------------------------------------------------------------------

  async addAttackWithSaveToActor(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addAttackWithSaveToActor requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = await this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check
      const existing = actor.items.find(
        (i: any) => i.name.toLowerCase() === data.featureName.toLowerCase()
      );
      if (existing) {
        throw new Error(
          `An item named "${data.featureName}" already exists on actor "${actor.name}". ` +
            `Remove or rename it first.`
        );
      }

      // 3. Soft validation — both damage groups unified
      const warnings: string[] = [];
      const allParts = [
        ...(data.damageParts as Array<{ type: string }>),
        ...(data.saveDamageParts as Array<{ type: string }>),
      ];
      for (const part of allParts) {
        if (!ATTACK_WITH_SAVE_DAMAGE_CANONICAL.has(part.type)) {
          const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
          if (!warnings.includes(msg)) warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Generate two distinct activity IDs
      const attackActivityId: string = (foundry.utils as any).randomID(16);
      const saveActivityId: string = (foundry.utils as any).randomID(16);

      // 5. Attack activity damage parts: damageParts[1+] (base is in system.damage.base)
      const activityDamageParts = (
        data.damageParts as Array<{ number: number; denomination: number; type: string }>
      )
        .slice(1)
        .map(p => ({
          types: [p.type],
          number: p.number,
          denomination: p.denomination,
          bonus: '',
          scaling: { mode: '', number: 1 },
          custom: { enabled: false },
        }));

      // 6. Save activity damage parts: ALL saveDamageParts (no base — independent)
      const saveActivityDamageParts = (
        data.saveDamageParts as Array<{ number: number; denomination: number; type: string }>
      ).map(p => ({
        types: [p.type],
        number: p.number,
        denomination: p.denomination,
        bonus: '',
        scaling: { mode: '', number: 1 },
        custom: { enabled: false },
      }));

      // 7. System-level range (real reach/range — activity range is always 'self')
      const rangeObj =
        data.attackType === 'melee'
          ? { value: data.reachFt ?? 5, long: null, units: 'ft' }
          : { value: data.rangeFt, long: data.longRangeFt ?? null, units: 'ft' };

      // 8. Conditional 2024-only fields (same rules as Tipo A)
      const sourceRules: string = data.sourceRules ?? '2014';
      const masteryField = sourceRules === '2024' ? { mastery: '' } : {};
      const abilityField = sourceRules === '2024' ? { ability: data.effectiveAbility } : {};
      const classification = sourceRules === '2014' ? 'weapon' : '';

      // 9. Build item data
      const itemData: Record<string, any> = {
        name: data.featureName,
        type: 'weapon',
        system: {
          description: {
            value: data.description ?? '',
            chat: '',
            unidentified: '',
          },
          source: {
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
            rules: sourceRules,
          },
          quantity: 1,
          weight: { value: 0, units: 'lb' },
          price: { value: 0, denomination: 'gp' },
          attunement: '',
          equipped: data.equipped !== false,
          rarity: '',
          identified: true,
          activation: {
            type: data.activationType ?? 'action',
            value: 1,
            condition: '',
            override: false,
          },
          duration: { value: '', units: '' },
          cover: null,
          target: {
            template: {
              count: '',
              contiguous: false,
              type: '',
              size: '',
              width: '',
              height: '',
              units: '',
            },
            affects: { count: '', type: '', choice: false, special: '' },
            prompt: true,
            override: false,
          },
          range: rangeObj,
          uses: { value: null, max: '', recovery: [], prompt: true },
          damage: {
            base: {
              types: [(data.damageParts as any[])[0].type],
              number: (data.damageParts as any[])[0].number,
              denomination: (data.damageParts as any[])[0].denomination,
              bonus: '',
              scaling: { mode: '', number: 1 },
              custom: { enabled: false },
            },
          },
          type: { value: data.weaponClass ?? 'natural', baseItem: '' },
          properties: data.properties as string[],
          proficient: 1,
          magicalBonus: null,
          ...masteryField,
          activities: {
            // ── Activity 1: attack (sort 0) ───────────────────────────────
            [attackActivityId]: {
              _id: attackActivityId,
              type: 'attack',
              name: '',
              img: '',
              sort: 0,
              description: {},
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                condition: '',
                override: false,
              },
              duration: { units: '', value: '', override: false },
              target: {
                template: {
                  count: '',
                  contiguous: false,
                  type: '',
                  size: '',
                  width: '',
                  height: '',
                  units: '',
                },
                affects: { count: '', type: '', choice: false, special: '' },
                prompt: true,
                override: false,
              },
              range: { units: 'self', override: false },
              uses: { spent: 0, max: '', recovery: [] },
              consumption: { targets: [], scaling: { allowed: false, max: '' }, spellSlot: true },
              attack: {
                ability: '',
                bonus: data.attackBonus > 0 ? String(data.attackBonus) : '',
                critical: { threshold: null },
                flat: false,
                type: { value: data.attackType ?? 'melee', classification },
                ...abilityField,
              },
              damage: {
                critical: { bonus: '' },
                includeBase: true,
                parts: activityDamageParts,
              },
              effects: [],
              save: { ability: '', dc: { formula: '', calculation: '' } },
            },

            // ── Activity 2: save (sort 1) ─────────────────────────────────
            [saveActivityId]: {
              _id: saveActivityId,
              type: 'save',
              name: '',
              sort: 1,
              description: {}, // {} — not { chatFlavor: '' } (real schema confirmed)
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                override: false,
                // NO condition — per real schema
              },
              duration: { units: 'inst', concentration: false, override: false },
              effects: [],
              range: { units: 'self', override: false },
              uses: { spent: 0, recovery: [] }, // NO max
              consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] },
              target: {
                template: {
                  count: '',
                  contiguous: false,
                  type: '',
                  size: '',
                  width: '',
                  height: '',
                  units: '',
                },
                affects: { count: '1', type: 'creature', choice: false, special: '' },
                override: false,
                prompt: true,
              },
              damage: {
                onSave: data.saveOnSave ?? 'none',
                parts: saveActivityDamageParts,
                // NO includeBase — save damage is independent from weapon base damage
              },
              save: {
                ability: [data.saveAbility],
                dc: { calculation: '', formula: String(data.saveDC) },
              },
            },
          },
        },
      };

      // 10. Create the item on the actor
      const created = (await actor.createEmbeddedDocuments('Item', [itemData]))[0];
      if (!created) {
        throw new Error(
          `Failed to create attack+save item "${data.featureName}" on actor "${actor.name}"`
        );
      }

      this.auditLog(
        'addAttackWithSaveToActor',
        { actorId: actor.id, featureName: data.featureName },
        'success'
      );

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'weapon' },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add attack+save to actor`, error);
      this.auditLog(
        'addAttackWithSaveToActor',
        { actorIdentifier: data.actorIdentifier, featureName: data.featureName },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Set actor spellcasting (ability + slot counts)
  // ---------------------------------------------------------------------------

  async setActorSpellcasting(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('setActorSpellcasting requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      const cls = data.spellcastingClass as string;
      const lvl = data.spellcastingLevel as number;
      const ability = data.effectiveAbility as string;
      const idx = lvl - 1; // 0-based index into slot tables
      const warnings: string[] = [];

      // 2. Build flat updates object for a single actor.update() call
      const updates: Record<string, unknown> = {};

      // Spellcasting ability
      updates['system.attributes.spellcasting'] = ability;

      if (cls === 'warlock') {
        // ── Pact Magic ────────────────────────────────────────────────────────
        // All regular slots set to 0; pact slots from table
        for (let i = 1; i <= 9; i++) {
          updates[`system.spells.spell${i}.max`] = 0;
          updates[`system.spells.spell${i}.value`] = 0;
        }
        const pact = WARLOCK_PACT_TABLE[idx];
        updates['system.spells.pact.max'] = pact.max;
        updates['system.spells.pact.value'] = pact.max;
        updates['system.spells.pact.level'] = pact.level;
      } else {
        // ── Regular spell slots ───────────────────────────────────────────────
        let slotRow: number[];

        if (cls === 'artificer') {
          slotRow = ARTIFICER_SLOTS[idx];
        } else if (cls === 'paladin' || cls === 'ranger') {
          slotRow = HALF_CASTER_SLOTS[idx];
          if (lvl === 1) {
            warnings.push(
              `${cls} level 1 has no spell slots — use level 2+ to unlock spellcasting`
            );
          }
        } else {
          // Full casters: wizard, cleric, druid, sorcerer, bard
          slotRow = FULL_CASTER_SLOTS[idx];
        }

        for (let i = 1; i <= 9; i++) {
          const n = slotRow[i - 1];
          updates[`system.spells.spell${i}.max`] = n;
          updates[`system.spells.spell${i}.value`] = n;
        }
      }

      // 3. Single update call
      await actor.update(updates);

      // 4. Build response
      const slots: Record<string, unknown> = {};
      if (cls === 'warlock') {
        const pact = WARLOCK_PACT_TABLE[idx];
        slots['pact'] = { max: pact.max, level: pact.level };
      } else {
        const slotRow =
          cls === 'artificer'
            ? ARTIFICER_SLOTS[idx]
            : cls === 'paladin' || cls === 'ranger'
              ? HALF_CASTER_SLOTS[idx]
              : FULL_CASTER_SLOTS[idx];

        for (let i = 1; i <= 9; i++) {
          (slots as Record<string, number>)[`spell${i}`] = slotRow[i - 1];
        }
      }

      this.auditLog('setActorSpellcasting', { actorId: actor.id, cls, lvl, ability }, 'success');

      return {
        actor: { id: actor.id, name: actor.name },
        spellcasting: { ability, slots },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to set actor spellcasting`, error);
      this.auditLog(
        'setActorSpellcasting',
        { actorIdentifier: data.actorIdentifier, spellcastingClass: data.spellcastingClass },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add spells from compendium packs to an actor
  // ---------------------------------------------------------------------------

  async addSpellsToActor(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addSpellsToActor requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      const spellNames: string[] = data.spellNames;
      const compendiumPacks: string[] = data.compendiumPacks ?? ['dnd5e.spells'];
      const warnings: string[] = [];

      // ── Phase A: deduplicate input (case-insensitive) ─────────────────────
      const seen = new Set<string>();
      const unique: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];

      for (const name of spellNames) {
        const key = name.toLowerCase();
        if (seen.has(key)) {
          skipped.push({ name, reason: 'duplicate in input' });
        } else {
          seen.add(key);
          unique.push(name);
        }
      }

      // ── Phase B: build pack index maps (once per pack) ────────────────────
      interface PackMap {
        packId: string;
        packLabel: string;
        nameMap: Map<string, string>; // lowercase name → _id
      }
      const packMaps: PackMap[] = [];

      for (const packId of compendiumPacks) {
        const pack = game.packs.get(packId);
        if (!pack) {
          warnings.push(`Compendium pack "${packId}" not found — skipped`);
          continue;
        }

        // Q6: type guard — Item packs only
        if (pack.metadata.type !== 'Item') {
          warnings.push(
            `Pack "${packId}" has type "${pack.metadata.type}", expected "Item" — skipped`
          );
          continue;
        }

        if (!pack.indexed) {
          await pack.getIndex({});
        }

        const nameMap = new Map<string, string>();
        for (const entry of pack.index.values() as IterableIterator<any>) {
          if (entry.name) {
            nameMap.set((entry.name as string).toLowerCase(), entry._id as string);
          }
        }

        packMaps.push({ packId, packLabel: pack.metadata.label as string, nameMap });
      }

      if (packMaps.length === 0) {
        throw new Error(
          'No valid compendium packs available — check the compendiumPacks parameter. ' +
            'Valid pack IDs for D&D 5e: "dnd5e.spells" (2014) or "dnd5e.spells24" (2024).'
        );
      }

      // ── Phase C: per-spell search + import ───────────────────────────────
      const added: Array<{ name: string; packId: string; packLabel: string; itemId: string }> = [];
      const notFound: string[] = [];
      const failed: Array<{ name: string; error: string }> = [];

      for (const name of unique) {
        const normalizedName = name.toLowerCase();

        // 1. Duplicate check on actor (only items of type 'spell')
        const existing = (actor.items as any[]).find(
          (i: any) => i.type === 'spell' && i.name?.toLowerCase() === normalizedName
        );
        if (existing) {
          skipped.push({ name, reason: 'already on actor' });
          continue;
        }

        // 2. Lookup across packs — first-pack-wins
        let found: { packId: string; packLabel: string; entryId: string } | null = null;
        for (const pm of packMaps) {
          const entryId = pm.nameMap.get(normalizedName);
          if (entryId) {
            found = { packId: pm.packId, packLabel: pm.packLabel, entryId };
            break;
          }
        }

        if (!found) {
          notFound.push(name);
          continue;
        }

        // 3. Fetch full document from compendium
        const pack = game.packs.get(found.packId);
        const document = await (pack as any).getDocument(found.entryId);

        if (!document) {
          // Entry was in index but document is missing (shouldn't happen, defensive)
          notFound.push(name);
          warnings.push(
            `"${name}" found in index but document missing in pack "${found.packId}" — skipped`
          );
          continue;
        }

        // 4. Prepare data for embedding
        const spellData = (document as any).toObject() as Record<string, unknown>;
        delete spellData._id; // Let Foundry assign a new local id; prevents id clash

        // 5. Embed individually — per-spell error isolation
        try {
          const [created] = (await actor.createEmbeddedDocuments('Item', [spellData])) as any[];
          added.push({
            name,
            packId: found.packId,
            packLabel: found.packLabel,
            itemId: created.id,
          });
        } catch (embedErr) {
          failed.push({
            name,
            error: embedErr instanceof Error ? embedErr.message : 'Unknown error',
          });
        }
      }

      // ── Phase D: audit + return ───────────────────────────────────────────
      this.auditLog(
        'addSpellsToActor',
        {
          actorId: actor.id,
          added: added.length,
          skipped: skipped.length,
          notFound: notFound.length,
          failed: failed.length,
        },
        'success'
      );

      return {
        actor: { id: actor.id, name: actor.name },
        added,
        skipped,
        notFound,
        failed,
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add spells to actor`, error);
      this.auditLog(
        'addSpellsToActor',
        { actorIdentifier: data.actorIdentifier },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add features from compendium packs to an actor
  // ---------------------------------------------------------------------------

  async addFeaturesFromCompendium(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addFeaturesFromCompendium requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      const featureNames: string[] = data.featureNames;
      const compendiumPacks: string[] = data.compendiumPacks ?? [
        'dnd5e.monsterfeatures',
        'dnd5e.classfeatures',
      ];
      const warnings: string[] = [];

      // ── Phase A: deduplicate input (case-insensitive) ─────────────────────
      const seen = new Set<string>();
      const unique: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];

      for (const name of featureNames) {
        const key = name.toLowerCase();
        if (seen.has(key)) {
          skipped.push({ name, reason: 'duplicate in input' });
        } else {
          seen.add(key);
          unique.push(name);
        }
      }

      // ── Phase B: build pack index maps (once per pack) ────────────────────
      interface PackMap {
        packId: string;
        packLabel: string;
        nameMap: Map<string, string>; // lowercase name → _id
      }
      const packMaps: PackMap[] = [];

      for (const packId of compendiumPacks) {
        const pack = game.packs.get(packId);
        if (!pack) {
          warnings.push(`Compendium pack "${packId}" not found — skipped`);
          continue;
        }

        // Type guard — Item packs only
        if (pack.metadata.type !== 'Item') {
          warnings.push(
            `Pack "${packId}" has type "${pack.metadata.type}", expected "Item" — skipped`
          );
          continue;
        }

        if (!pack.indexed) {
          await pack.getIndex({});
        }

        const nameMap = new Map<string, string>();
        for (const entry of pack.index.values() as IterableIterator<any>) {
          if (entry.name) {
            nameMap.set((entry.name as string).toLowerCase(), entry._id as string);
          }
        }

        packMaps.push({ packId, packLabel: pack.metadata.label as string, nameMap });
      }

      if (packMaps.length === 0) {
        throw new Error(
          'No valid compendium packs available — check the compendiumPacks parameter. ' +
            'Valid pack IDs for D&D 5e: "dnd5e.monsterfeatures" or "dnd5e.classfeatures" (2014), ' +
            '"dnd5e.monsterfeatures24" (2024 monster features). ' +
            'Note: 2024 class features are embedded in class items and cannot be imported with this tool.'
        );
      }

      // ── Phase C: per-feature search + import ─────────────────────────────
      const added: Array<{ name: string; packId: string; packLabel: string; itemId: string }> = [];
      const notFound: string[] = [];
      const failed: Array<{ name: string; error: string }> = [];

      for (const name of unique) {
        const normalizedName = name.toLowerCase();

        // 1. Duplicate check on actor — name-only, any item type
        //    (feature names are semantically unique on an actor regardless of stored type)
        const existing = (actor.items as any[]).find(
          (i: any) => i.name?.toLowerCase() === normalizedName
        );
        if (existing) {
          skipped.push({ name, reason: 'already on actor' });
          continue;
        }

        // 2. Lookup across packs — first-pack-wins
        let found: { packId: string; packLabel: string; entryId: string } | null = null;
        for (const pm of packMaps) {
          const entryId = pm.nameMap.get(normalizedName);
          if (entryId) {
            found = { packId: pm.packId, packLabel: pm.packLabel, entryId };
            break;
          }
        }

        if (!found) {
          notFound.push(name);
          continue;
        }

        // 3. Fetch full document from compendium
        const pack = game.packs.get(found.packId);
        const document = await (pack as any).getDocument(found.entryId);

        if (!document) {
          // Entry was in index but document is missing (shouldn't happen, defensive)
          notFound.push(name);
          warnings.push(
            `"${name}" found in index but document missing in pack "${found.packId}" — skipped`
          );
          continue;
        }

        // 4. Prepare data for embedding
        const featureData = (document as any).toObject() as Record<string, unknown>;
        delete featureData._id; // Let Foundry assign a new local id; prevents id clash

        // 5. Embed individually — per-feature error isolation
        try {
          const [created] = (await actor.createEmbeddedDocuments('Item', [featureData])) as any[];
          added.push({
            name,
            packId: found.packId,
            packLabel: found.packLabel,
            itemId: created.id,
          });
        } catch (embedErr) {
          failed.push({
            name,
            error: embedErr instanceof Error ? embedErr.message : 'Unknown error',
          });
        }
      }

      // ── Phase D: audit + return ───────────────────────────────────────────
      this.auditLog(
        'addFeaturesFromCompendium',
        {
          actorId: actor.id,
          added: added.length,
          skipped: skipped.length,
          notFound: notFound.length,
          failed: failed.length,
        },
        'success'
      );

      return {
        actor: { id: actor.id, name: actor.name },
        added,
        skipped,
        notFound,
        failed,
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add features from compendium`, error);
      this.auditLog(
        'addFeaturesFromCompendium',
        { actorIdentifier: data.actorIdentifier },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ===========================================================================
  // 3A: Chat log / combat play-by-play / in-character chat
  // ===========================================================================

  async getChatLog(data: {
    limit?: number;
    speakerName?: string;
    messageType?: string;
    sinceTimestamp?: string;
  }): Promise<any> {
    return this.chat.getChatLog(data);
  }

  async getCombatPlayByPlay(): Promise<any> {
    return this.combat.getCombatPlayByPlay();
  }

  async sendChatMessage(data: {
    message: string;
    speakerActorId?: string;
    speakerActorName?: string;
    messageType?: string;
    whisperTargets?: string[];
  }): Promise<any> {
    return this.chat.sendChatMessage(data);
  }

  // ===========================================================================
  // 3C: Resource tracking (spell slots, class resources, item charges, etc.)
  // ===========================================================================

  async getCharacterResources(data: { identifier: string }): Promise<any> {
    return this.resources.getCharacterResources(data);
  }

  async updateCharacterResource(data: {
    identifier: string;
    resourceName: string;
    newValue: number;
  }): Promise<any> {
    return this.resources.updateCharacterResource(data);
  }

  async getActiveEffects(data: { identifier: string }): Promise<any> {
    return this.resources.getActiveEffects(data);
  }

  async clearStaleConditions(data: {
    identifier: string;
    conditionNames?: string[];
  }): Promise<any> {
    return this.resources.clearStaleConditions(data);
  }

  // ===========================================================================
  // 3E: Combat tracker (read + manage)
  // ===========================================================================

  async getCombatState(): Promise<any> {
    return this.combat.getCombatState();
  }

  async advanceCombatTurn(data: { skipTo?: string }): Promise<any> {
    return this.combat.advanceCombatTurn(data);
  }

  async setInitiative(data: { combatantName: string; initiative: number }): Promise<any> {
    return this.combat.setInitiative(data);
  }

  // ===========================================================================
  // 3F: Movement and token positioning
  // ===========================================================================

  async getTokenPositions(data: { sceneId?: string }): Promise<any> {
    return this.scenesTokens.getTokenPositions(data);
  }

  async measureDistance(data: { fromTokenName: string; toTokenName: string }): Promise<any> {
    return this.scenesTokens.measureDistance(data);
  }

  // ===========================================================================
  // 3G: Extended roll requests / NPC rolls
  // ===========================================================================

  async requestAbilityCheck(data: {
    targetPlayer: string;
    ability: string;
    dc?: number;
    isPublic: boolean;
    reason?: string;
  }): Promise<any> {
    const flavorParts: string[] = [];
    if (data.reason) flavorParts.push(data.reason);
    if (data.dc != null) flavorParts.push(`DC ${data.dc}`);

    return this.requestPlayerRolls({
      rollType: 'ability',
      rollTarget: data.ability,
      targetPlayer: data.targetPlayer,
      isPublic: data.isPublic,
      rollModifier: '',
      flavor: flavorParts.join(' — '),
    });
  }

  async requestAttackRoll(data: {
    targetPlayer: string;
    weaponOrSpellName: string;
    isPublic: boolean;
  }): Promise<any> {
    return this.requestPlayerRolls({
      rollType: 'attack',
      rollTarget: data.weaponOrSpellName,
      targetPlayer: data.targetPlayer,
      isPublic: data.isPublic,
      rollModifier: '',
      flavor: `${data.weaponOrSpellName} attack`,
    });
  }

  async rollNpcCheck(data: {
    actorName: string;
    rollType: string;
    rollTarget: string;
    isPublic: boolean;
  }): Promise<any> {
    this.validateFoundryState();

    const actor = this.findActorByIdentifier(data.actorName);
    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.actorName}`);
    }

    let formula: string;
    if (data.rollType === 'attack') {
      const item = actor.items.find(
        (i: any) =>
          i.name.toLowerCase() === data.rollTarget.toLowerCase() ||
          i.name.toLowerCase().includes(data.rollTarget.toLowerCase())
      );
      let bonus = '';
      const toHit = (item as any)?.labels?.toHit;
      if (toHit && typeof toHit === 'string') {
        const trimmed = toHit.replace(/\s+/g, '');
        bonus = trimmed.startsWith('+') || trimmed.startsWith('-') ? trimmed : `+${trimmed}`;
      }
      formula = `1d20${bonus}`;
    } else {
      formula = this.buildRollFormula(data.rollType, data.rollTarget, '', actor);
    }

    const RollCls: any = (globalThis as any).Roll;
    const roll = new RollCls(formula, (actor as any).getRollData());
    await roll.evaluate();

    const speaker = (ChatMessage as any).getSpeaker({ actor });
    const modes: any = (CONST as any).DICE_ROLL_MODES || {};
    const rollMode = data.isPublic ? (modes.PUBLIC ?? 'publicroll') : (modes.PRIVATE ?? 'gmroll');

    await roll.toMessage(
      {
        speaker,
        flavor: `${data.rollTarget} (${data.rollType})`,
      },
      { rollMode }
    );

    return {
      success: true,
      actorName: actor.name,
      rollType: data.rollType,
      rollTarget: data.rollTarget,
      formula: roll.formula,
      total: roll.total,
      isPublic: data.isPublic,
    };
  }

  // ===========================================================================
  // 3H: Session event log
  // ===========================================================================

  async getSessionLog(data: {
    limit?: number;
    eventType?: string;
    actorName?: string;
  }): Promise<any> {
    return this.sessionLog.getSessionLog(data);
  }

  async getRecentEvents(data: {
    sinceTimestamp?: string;
    limit?: number;
    eventType?: string;
  }): Promise<any> {
    return this.sessionLog.getRecentEvents(data);
  }

  // ===========================================================================
  // Combat resolution: initiative
  // ===========================================================================

  async rollInitiativeForNpcs(data: { scope?: 'npcs' | 'all' | 'missing' }): Promise<any> {
    return this.combat.rollInitiativeForNpcs(data);
  }

  // ===========================================================================
  // Combat resolution helpers (dnd5e)
  // ===========================================================================

  /** Major version of the active game system (delegates to shared core). */
  private systemMajor(): number {
    return shared.systemMajor();
  }

  private requireDnd5e(toolName: string): void {
    shared.requireDnd5e(toolName);
  }

  async applyDamageAndHealing(data: {
    targets: string[];
    amount: number;
    kind?: 'damage' | 'healing' | 'temp';
    type?: string;
    multiplier?: number;
    ignoreResistance?: boolean;
  }): Promise<any> {
    return this.combat.applyDamageAndHealing(data);
  }

  async rollSavingThrows(data: {
    targets: string[];
    rollType: 'save' | 'check' | 'skill';
    ability?: string;
    skill?: string;
    dc?: number;
    isPublic?: boolean;
  }): Promise<any> {
    return this.combat.rollSavingThrows(data);
  }

  /**
   * Trigger an NPC's attack (or other item activity) and report the attack roll,
   * hit/miss vs an AC, crit, and damage. dnd5e v3 uses Item-level rollAttack/
   * rollDamage; v4/v5 use the Activity API.
   */
  async useNpcActivity(data: {
    actorName: string;
    itemName: string;
    targetAC?: number;
    isPublic?: boolean;
  }): Promise<any> {
    this.validateFoundryState();
    this.requireDnd5e('use-npc-activity');

    const actor = this.findActorByIdentifier(data.actorName);
    if (!actor) throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.actorName}`);
    const item = actor.items.find(
      (i: any) =>
        i.id === data.itemName ||
        i.name?.toLowerCase() === data.itemName.toLowerCase() ||
        i.name?.toLowerCase().includes(data.itemName.toLowerCase())
    );
    if (!item) throw new Error(`Item "${data.itemName}" not found on "${actor.name}"`);

    const major = this.systemMajor();
    let attackTotal: number | null = null;
    let isCritical = false;
    let damageTotal: number | null = null;
    let formula: string | null = null;
    let usedActivity = false;
    let attackSucceeded: boolean | null = null;

    if (major >= 4) {
      const activities = (item as any).system?.activities;
      const attackAct =
        activities?.getByType?.('attack')?.[0] ||
        (activities?.contents ?? []).find((a: any) => a.type === 'attack');
      if (attackAct) {
        usedActivity = true;
        const atkOut = await attackAct.rollAttack({}, { configure: false }, { create: true });
        const atk = Array.isArray(atkOut) ? atkOut[0] : atkOut;
        attackTotal = atk?.total ?? null;
        isCritical = atk?.isCritical ?? false;
        formula = atk?.formula ?? null;
        // dnd5e auto-fills the attack's target from a targeted token's AC.
        attackSucceeded = typeof atk?.isSuccess === 'boolean' ? atk.isSuccess : null;
        const dmgOut = await attackAct.rollDamage(
          { isCritical },
          { configure: false },
          { create: true }
        );
        damageTotal = Array.isArray(dmgOut)
          ? dmgOut.reduce((s: number, r: any) => s + (r.total || 0), 0)
          : (dmgOut?.total ?? null);
      } else {
        // No attack activity — just use the item (posts its card).
        await (item as any).use({}, { configure: false }, { create: true });
      }
    } else {
      // dnd5e v3 — Item-level rolls
      const atkOpts: any = { fastForward: true };
      if (data.targetAC != null) atkOpts.targetValue = data.targetAC;
      const atk = await (item as any).rollAttack(atkOpts);
      if (atk) {
        usedActivity = true;
        attackTotal = atk.total ?? null;
        isCritical = atk.isCritical ?? false;
        formula = atk.formula ?? null;
        attackSucceeded = typeof atk?.isSuccess === 'boolean' ? atk.isSuccess : null;
        const dmg = await (item as any).rollDamage({
          critical: isCritical,
          options: { fastForward: true },
        });
        damageTotal = dmg?.total ?? null;
      } else {
        await (item as any).use({}, { configureDialog: false, createMessage: true });
      }
    }

    // Resolve the target AC: explicit param wins, else the GM's targeted token.
    let targetAC = data.targetAC ?? null;
    let targetName: string | null = null;
    try {
      const userTargets = Array.from((game.user as any)?.targets ?? []);
      if (userTargets.length > 0) {
        const tt: any = userTargets[0];
        targetName = tt.name ?? null;
        if (targetAC == null) targetAC = tt.actor?.system?.attributes?.ac?.value ?? null;
      }
    } catch {
      // no targeting available
    }

    const hit = targetAC != null && attackTotal != null ? attackTotal >= targetAC : attackSucceeded; // falls back to dnd5e's own target evaluation

    this.auditLog('useNpcActivity', { actor: actor.name, item: item.name }, 'success');
    return {
      success: true,
      actor: actor.name,
      item: item.name,
      hadAttack: usedActivity,
      attackTotal,
      targetName,
      targetAC,
      hit,
      isCritical,
      damageTotal,
      formula,
    };
  }

  async manageRest(data: {
    targets: string[];
    restType: 'short' | 'long';
    newDay?: boolean;
  }): Promise<any> {
    return this.combat.manageRest(data);
  }

  // ===========================================================================
  // Encounter & scene tools
  // ===========================================================================

  async suggestBalancedEncounter(data: {
    partyLevels?: number[];
    difficulty?: 'low' | 'moderate' | 'high';
  }): Promise<any> {
    return this.combat.suggestBalancedEncounter(data);
  }

  async placeMeasuredTemplate(data: {
    shape: 'circle' | 'cone' | 'ray' | 'rect';
    distance: number;
    x?: number;
    y?: number;
    originTokenName?: string;
    direction?: number;
    angle?: number;
    width?: number;
    fillColor?: string;
  }): Promise<any> {
    return this.sceneFx.placeMeasuredTemplate(data);
  }

  async setSceneMood(data: {
    darkness?: number;
    globalLight?: boolean;
    playlistName?: string;
    playlistAction?: 'play' | 'stop';
  }): Promise<any> {
    return this.sceneFx.setSceneMood(data);
  }

  async addMapNote(data: {
    text?: string;
    x?: number;
    y?: number;
    tokenName?: string;
    journalName?: string;
    entryId?: string;
    icon?: string;
    iconSize?: number;
  }): Promise<any> {
    return this.sceneFx.addMapNote(data);
  }

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
    return this.scenesTokens.setTokenVisionLight(data);
  }

  async dropLoot(data: {
    targetCharacter?: string;
    currency?: Record<string, number>;
    itemUuids?: string[];
    announce?: boolean;
  }): Promise<any> {
    return this.sceneFx.dropLoot(data);
  }

  // ===========================================================================
  // Cleanup & targeting helpers
  // ===========================================================================

  async deleteMeasuredTemplate(data: { templateId?: string; all?: boolean }): Promise<any> {
    return this.sceneFx.deleteMeasuredTemplate(data);
  }

  async deleteMapNote(data: { noteId?: string; text?: string }): Promise<any> {
    return this.sceneFx.deleteMapNote(data);
  }

  async getTargets(): Promise<any> {
    return this.scenesTokens.getTargets();
  }

  // ===========================================================================
  // Diagnostics (module troubleshooting)
  // ===========================================================================

  async getModules(data: { activeOnly?: boolean; withIssuesOnly?: boolean }): Promise<any> {
    return this.modules.getModules(data);
  }

  async getModuleErrors(data: {
    level?: 'error' | 'warn';
    moduleId?: string;
    sinceTimestamp?: string;
    limit?: number;
  }): Promise<any> {
    return this.modules.getModuleErrors(data);
  }

  async clearModuleErrors(): Promise<any> {
    return this.modules.clearModuleErrors();
  }

  async getModuleManifest(data: { moduleId: string }): Promise<any> {
    return this.modules.getModuleManifest(data);
  }
}
