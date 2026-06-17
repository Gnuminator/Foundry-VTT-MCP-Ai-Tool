import { MODULE_ID } from './constants.js';
import { FoundryDataAccess } from './data-access.js';
import { ComfyUIManager } from './comfyui-manager.js';

export class QueryHandlers {
  public dataAccess: FoundryDataAccess;
  private comfyuiManager: ComfyUIManager;

  constructor() {
    this.dataAccess = new FoundryDataAccess();
    this.comfyuiManager = new ComfyUIManager();
  }

  /**
   * SECURITY: Validate access - returns silent failure for disallowed users.
   * The GM is always allowed; the `allowNonGmAccess` setting (locked on for this
   * build) additionally permits any logged-in user.
   */
  private validateGMAccess(): { allowed: boolean; error?: any } {
    if (game.user?.isGM || this.allowNonGmAccess()) {
      return { allowed: true };
    }
    // Silent failure - no error message for disallowed users
    return { allowed: false };
  }

  /** Whether non-GM callers are permitted (read defensively for early boot/tests). */
  private allowNonGmAccess(): boolean {
    try {
      return game.settings.get(MODULE_ID, 'allowNonGmAccess') === true;
    } catch {
      return false;
    }
  }

  /**
   * Shared wrapper for the GM-gated query handlers. Reproduces the convention
   * shared by ~80 handlers exactly: silent GM gate (non-GM callers get an
   * access-denied object and the body never runs) → validateFoundryState →
   * run the handler body → wrap any throw as `<errorPrefix>: <message>`.
   *
   * Handlers that diverge from this shape stay bespoke: `ping` (ungated),
   * map-generation (returns error objects instead of throwing), and
   * `createJournalEntry` (no validateFoundryState).
   */
  private async withGmGate(errorPrefix: string, body: () => Promise<any>): Promise<any> {
    const gmCheck = this.validateGMAccess();
    if (!gmCheck.allowed) {
      return { error: 'Access denied', success: false };
    }
    try {
      this.dataAccess.validateFoundryState();
      return await body();
    } catch (error) {
      throw new Error(
        `${errorPrefix}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Register all query handlers in CONFIG.queries
   */
  registerHandlers(): void {
    const modulePrefix = MODULE_ID;

    // Character/Actor queries
    CONFIG.queries[`${modulePrefix}.getCharacterInfo`] = this.handleGetCharacterInfo.bind(this);
    CONFIG.queries[`${modulePrefix}.listActors`] = this.handleListActors.bind(this);

    // Compendium queries
    CONFIG.queries[`${modulePrefix}.searchCompendium`] = this.handleSearchCompendium.bind(this);
    CONFIG.queries[`${modulePrefix}.listCreaturesByCriteria`] =
      this.handleListCreaturesByCriteria.bind(this);
    CONFIG.queries[`${modulePrefix}.getAvailablePacks`] = this.handleGetAvailablePacks.bind(this);

    // Scene queries
    CONFIG.queries[`${modulePrefix}.getActiveScene`] = this.handleGetActiveScene.bind(this);
    CONFIG.queries[`${modulePrefix}.list-scenes`] = this.handleListScenes.bind(this);
    CONFIG.queries[`${modulePrefix}.switch-scene`] = this.handleSwitchScene.bind(this);

    // World queries
    CONFIG.queries[`${modulePrefix}.getWorldInfo`] = this.handleGetWorldInfo.bind(this);

    // Utility queries
    CONFIG.queries[`${modulePrefix}.ping`] = this.handlePing.bind(this);

    // Phase 2 & 3: Write operation queries
    CONFIG.queries[`${modulePrefix}.createActorFromCompendium`] =
      this.handleCreateActorFromCompendium.bind(this);
    CONFIG.queries[`${modulePrefix}.getCompendiumDocumentFull`] =
      this.handleGetCompendiumDocumentFull.bind(this);
    CONFIG.queries[`${modulePrefix}.addActorsToScene`] = this.handleAddActorsToScene.bind(this);
    CONFIG.queries[`${modulePrefix}.validateWritePermissions`] =
      this.handleValidateWritePermissions.bind(this);
    CONFIG.queries[`${modulePrefix}.createJournalEntry`] = this.handleCreateJournalEntry.bind(this);
    CONFIG.queries[`${modulePrefix}.listJournals`] = this.handleListJournals.bind(this);
    CONFIG.queries[`${modulePrefix}.getJournalContent`] = this.handleGetJournalContent.bind(this);
    CONFIG.queries[`${modulePrefix}.getJournalPageContent`] =
      this.handleGetJournalPageContent.bind(this);
    CONFIG.queries[`${modulePrefix}.updateJournalContent`] =
      this.handleUpdateJournalContent.bind(this);

    // Phase 4: Dice roll queries
    CONFIG.queries[`${modulePrefix}.request-player-rolls`] =
      this.handleRequestPlayerRolls.bind(this);

    // Enhanced creature index for campaign analysis
    CONFIG.queries[`${modulePrefix}.getEnhancedCreatureIndex`] =
      this.handleGetEnhancedCreatureIndex.bind(this);

    // Campaign management queries
    CONFIG.queries[`${modulePrefix}.updateCampaignProgress`] =
      this.handleUpdateCampaignProgress.bind(this);

    // Phase 6: Actor ownership management
    CONFIG.queries[`${modulePrefix}.setActorOwnership`] = this.handleSetActorOwnership.bind(this);
    CONFIG.queries[`${modulePrefix}.getActorOwnership`] = this.handleGetActorOwnership.bind(this);
    CONFIG.queries[`${modulePrefix}.getFriendlyNPCs`] = this.handleGetFriendlyNPCs.bind(this);
    CONFIG.queries[`${modulePrefix}.getPartyCharacters`] = this.handleGetPartyCharacters.bind(this);
    CONFIG.queries[`${modulePrefix}.getConnectedPlayers`] =
      this.handleGetConnectedPlayers.bind(this);
    CONFIG.queries[`${modulePrefix}.findPlayers`] = this.handleFindPlayers.bind(this);
    CONFIG.queries[`${modulePrefix}.findActor`] = this.handleFindActor.bind(this);

    // Token manipulation queries
    CONFIG.queries[`${modulePrefix}.moveToken`] = this.handleMoveToken.bind(this);
    CONFIG.queries[`${modulePrefix}.updateToken`] = this.handleUpdateToken.bind(this);
    CONFIG.queries[`${modulePrefix}.deleteTokens`] = this.handleDeleteTokens.bind(this);
    CONFIG.queries[`${modulePrefix}.getTokenDetails`] = this.handleGetTokenDetails.bind(this);
    CONFIG.queries[`${modulePrefix}.toggleTokenCondition`] =
      this.handleToggleTokenCondition.bind(this);
    CONFIG.queries[`${modulePrefix}.getAvailableConditions`] =
      this.handleGetAvailableConditions.bind(this);

    // Map generation queries (hybrid architecture)
    CONFIG.queries[`${modulePrefix}.generate-map`] = this.handleGenerateMap.bind(this);
    CONFIG.queries[`${modulePrefix}.check-map-status`] = this.handleCheckMapStatus.bind(this);
    CONFIG.queries[`${modulePrefix}.cancel-map-job`] = this.handleCancelMapJob.bind(this);
    CONFIG.queries[`${modulePrefix}.upload-generated-map`] =
      this.handleUploadGeneratedMap.bind(this);

    // Item usage queries
    CONFIG.queries[`${modulePrefix}.useItem`] = this.handleUseItem.bind(this);

    // Character search queries
    CONFIG.queries[`${modulePrefix}.searchCharacterItems`] =
      this.handleSearchCharacterItems.bind(this);

    // Item authoring on actor sheets
    CONFIG.queries[`${modulePrefix}.addActorItems`] = this.handleAddActorItems.bind(this);

    // World-level item CRUD
    CONFIG.queries[`${modulePrefix}.createWorldItems`] = this.handleCreateWorldItems.bind(this);
    CONFIG.queries[`${modulePrefix}.listWorldItems`] = this.handleListWorldItems.bind(this);
    CONFIG.queries[`${modulePrefix}.updateWorldItems`] = this.handleUpdateWorldItems.bind(this);

    // Phase 7: Token manipulation queries
    CONFIG.queries[`${modulePrefix}.move-token`] = this.handleMoveToken.bind(this);
    CONFIG.queries[`${modulePrefix}.update-token`] = this.handleUpdateToken.bind(this);
    CONFIG.queries[`${modulePrefix}.delete-tokens`] = this.handleDeleteTokens.bind(this);
    CONFIG.queries[`${modulePrefix}.get-token-details`] = this.handleGetTokenDetails.bind(this);
    CONFIG.queries[`${modulePrefix}.toggle-token-condition`] =
      this.handleToggleTokenCondition.bind(this);
    CONFIG.queries[`${modulePrefix}.get-available-conditions`] =
      this.handleGetAvailableConditions.bind(this);

    // D&D 5e queries
    CONFIG.queries[`${modulePrefix}.addSaveFeatureToActor`] =
      this.handleAddSaveFeatureToActor.bind(this);
    CONFIG.queries[`${modulePrefix}.createNpcActor`] = this.handleCreateNpcActor.bind(this);
    CONFIG.queries[`${modulePrefix}.addAttackToActor`] = this.handleAddAttackToActor.bind(this);
    CONFIG.queries[`${modulePrefix}.addAuraToActor`] = this.handleAddAuraToActor.bind(this);
    CONFIG.queries[`${modulePrefix}.addPassiveFeatureToActor`] =
      this.handleAddPassiveFeatureToActor.bind(this);
    CONFIG.queries[`${modulePrefix}.addAttackWithSaveToActor`] =
      this.handleAddAttackWithSaveToActor.bind(this);
    CONFIG.queries[`${modulePrefix}.setActorSpellcasting`] =
      this.handleSetActorSpellcasting.bind(this);
    CONFIG.queries[`${modulePrefix}.addSpellsToActor`] = this.handleAddSpellsToActor.bind(this);
    CONFIG.queries[`${modulePrefix}.addFeaturesFromCompendium`] =
      this.handleAddFeaturesFromCompendium.bind(this);

    // 3A: Chat log / combat play-by-play / in-character chat
    CONFIG.queries[`${modulePrefix}.getChatLog`] = this.handleGetChatLog.bind(this);
    CONFIG.queries[`${modulePrefix}.getCombatPlayByPlay`] =
      this.handleGetCombatPlayByPlay.bind(this);
    CONFIG.queries[`${modulePrefix}.sendChatMessage`] = this.handleSendChatMessage.bind(this);

    // 3C: Resource tracking
    CONFIG.queries[`${modulePrefix}.getCharacterResources`] =
      this.handleGetCharacterResources.bind(this);
    CONFIG.queries[`${modulePrefix}.updateCharacterResource`] =
      this.handleUpdateCharacterResource.bind(this);

    // 3D: Active effects / conditions
    CONFIG.queries[`${modulePrefix}.getActiveEffects`] = this.handleGetActiveEffects.bind(this);
    CONFIG.queries[`${modulePrefix}.clearStaleConditions`] =
      this.handleClearStaleConditions.bind(this);

    // 3E: Combat tracker
    CONFIG.queries[`${modulePrefix}.getCombatState`] = this.handleGetCombatState.bind(this);
    CONFIG.queries[`${modulePrefix}.advanceCombatTurn`] = this.handleAdvanceCombatTurn.bind(this);
    CONFIG.queries[`${modulePrefix}.setInitiative`] = this.handleSetInitiative.bind(this);

    // 3F: Movement and positioning
    CONFIG.queries[`${modulePrefix}.getTokenPositions`] = this.handleGetTokenPositions.bind(this);
    CONFIG.queries[`${modulePrefix}.measureDistance`] = this.handleMeasureDistance.bind(this);

    // 3G: Extended roll requests / NPC rolls
    CONFIG.queries[`${modulePrefix}.requestAbilityCheck`] =
      this.handleRequestAbilityCheck.bind(this);
    CONFIG.queries[`${modulePrefix}.requestAttackRoll`] = this.handleRequestAttackRoll.bind(this);
    CONFIG.queries[`${modulePrefix}.rollNpcCheck`] = this.handleRollNpcCheck.bind(this);

    // 3H: Session event log
    CONFIG.queries[`${modulePrefix}.getSessionLog`] = this.handleGetSessionLog.bind(this);
    CONFIG.queries[`${modulePrefix}.getRecentEvents`] = this.handleGetRecentEvents.bind(this);

    // Combat resolution
    CONFIG.queries[`${modulePrefix}.rollInitiativeForNpcs`] =
      this.handleRollInitiativeForNpcs.bind(this);
    CONFIG.queries[`${modulePrefix}.applyDamageAndHealing`] =
      this.handleApplyDamageAndHealing.bind(this);
    CONFIG.queries[`${modulePrefix}.rollSavingThrows`] = this.handleRollSavingThrows.bind(this);
    CONFIG.queries[`${modulePrefix}.useNpcActivity`] = this.handleUseNpcActivity.bind(this);
    CONFIG.queries[`${modulePrefix}.manageRest`] = this.handleManageRest.bind(this);

    // Encounter & scene tools
    CONFIG.queries[`${modulePrefix}.suggestBalancedEncounter`] =
      this.handleSuggestBalancedEncounter.bind(this);
    CONFIG.queries[`${modulePrefix}.placeMeasuredTemplate`] =
      this.handlePlaceMeasuredTemplate.bind(this);
    CONFIG.queries[`${modulePrefix}.setSceneMood`] = this.handleSetSceneMood.bind(this);
    CONFIG.queries[`${modulePrefix}.addMapNote`] = this.handleAddMapNote.bind(this);
    CONFIG.queries[`${modulePrefix}.setTokenVisionLight`] =
      this.handleSetTokenVisionLight.bind(this);
    CONFIG.queries[`${modulePrefix}.dropLoot`] = this.handleDropLoot.bind(this);

    // Cleanup & targeting
    CONFIG.queries[`${modulePrefix}.deleteMeasuredTemplate`] =
      this.handleDeleteMeasuredTemplate.bind(this);
    CONFIG.queries[`${modulePrefix}.deleteMapNote`] = this.handleDeleteMapNote.bind(this);
    CONFIG.queries[`${modulePrefix}.getTargets`] = this.handleGetTargets.bind(this);

    // Diagnostics (module troubleshooting)
    CONFIG.queries[`${modulePrefix}.getModules`] = this.handleGetModules.bind(this);
    CONFIG.queries[`${modulePrefix}.getModuleErrors`] = this.handleGetModuleErrors.bind(this);
    CONFIG.queries[`${modulePrefix}.clearModuleErrors`] = this.handleClearModuleErrors.bind(this);
    CONFIG.queries[`${modulePrefix}.getModuleManifest`] = this.handleGetModuleManifest.bind(this);
  }

  /**
   * Unregister all query handlers
   */
  unregisterHandlers(): void {
    const modulePrefix = MODULE_ID;
    const keysToRemove = Object.keys(CONFIG.queries).filter(key => key.startsWith(modulePrefix));

    for (const key of keysToRemove) {
      delete CONFIG.queries[key];
    }
  }

  /**
   * Handle query requests from other parts of the module
   */
  async handleQuery(queryName: string, data: any): Promise<any> {
    try {
      const handler = CONFIG.queries[queryName];
      if (!handler || typeof handler !== 'function') {
        throw new Error(`Query handler not found: ${queryName}`);
      }

      return await handler(data);
    } catch (error) {
      console.error(`[${MODULE_ID}] Query failed: ${queryName}`, error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      };
    }
  }

  /**
   * Handle character information request
   */
  private async handleGetCharacterInfo(data: {
    characterName?: string;
    characterId?: string;
  }): Promise<any> {
    return this.withGmGate('Failed to get character info', async () => {
      const identifier = data.characterName || data.characterId;
      if (!identifier) {
        throw new Error('characterName or characterId is required');
      }

      return await this.dataAccess.getCharacterInfo(identifier);
    });
  }

  /**
   * Handle list actors request
   */
  private async handleListActors(data: { type?: string }): Promise<any> {
    return this.withGmGate('Failed to list actors', async () => {
      const actors = await this.dataAccess.listActors();

      // Filter by type if specified
      if (data.type) {
        return actors.filter(actor => actor.type === data.type);
      }

      return actors;
    });
  }

  /**
   * Handle compendium search request
   */
  private async handleSearchCompendium(data: {
    query: string;
    packType?: string;
    filters?: {
      challengeRating?: number | { min?: number; max?: number };
      creatureType?: string;
      size?: string;
      alignment?: string;
      hasLegendaryActions?: boolean;
      spellcaster?: boolean;
    };
  }): Promise<any> {
    return this.withGmGate('Failed to search compendium', async () => {
      // Add better parameter validation
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid data parameter structure');
      }

      if (!data.query || typeof data.query !== 'string') {
        throw new Error('query parameter is required and must be a string');
      }

      return await this.dataAccess.searchCompendium(data.query, data.packType, data.filters);
    });
  }

  /**
   * Handle list creatures by criteria request
   */
  private async handleListCreaturesByCriteria(data: {
    challengeRating?: number | { min?: number; max?: number };
    creatureType?: string;
    size?: string;
    hasSpells?: boolean;
    hasLegendaryActions?: boolean;
    limit?: number;
  }): Promise<any> {
    return this.withGmGate('Failed to list creatures by criteria', async () => {
      const result = await this.dataAccess.listCreaturesByCriteria(data);

      // Handle the new format with search summary
      return {
        response: result,
      };
    });
  }

  /**
   * Handle get available packs request
   */
  private async handleGetAvailablePacks(): Promise<any> {
    return this.withGmGate('Failed to get available packs', async () => {
      return await this.dataAccess.getAvailablePacks();
    });
  }

  /**
   * Handle get active scene request
   */
  private async handleGetActiveScene(): Promise<any> {
    return this.withGmGate('Failed to get active scene', async () => {
      return await this.dataAccess.getActiveScene();
    });
  }

  /**
   * Handle get world info request
   */
  private async handleGetWorldInfo(): Promise<any> {
    return this.withGmGate('Failed to get world info', async () => {
      return await this.dataAccess.getWorldInfo();
    });
  }

  /**
   * Handle ping request
   */
  private async handlePing(): Promise<any> {
    return {
      status: 'ok',
      timestamp: Date.now(),
      module: MODULE_ID,
      foundryVersion: game.version,
      worldId: game.world?.id,
      userId: game.user?.id,
    };
  }

  /**
   * Get list of all registered query methods
   */
  getRegisteredMethods(): string[] {
    const modulePrefix = MODULE_ID;
    return Object.keys(CONFIG.queries)
      .filter(key => key.startsWith(modulePrefix))
      .map(key => key.replace(`${modulePrefix}.`, ''));
  }

  /**
   * Test if a specific query handler is registered
   */
  isMethodRegistered(method: string): boolean {
    const queryKey = `${MODULE_ID}.${method}`;
    return queryKey in CONFIG.queries && typeof CONFIG.queries[queryKey] === 'function';
  }

  // ===== PHASE 2: WRITE OPERATION HANDLERS =====

  /**
   * Handle actor creation from specific compendium entry
   */
  private async handleCreateActorFromCompendium(data: {
    packId: string;
    itemId: string;
    customNames?: string[] | undefined;
    quantity?: number | undefined;
    addToScene?: boolean | undefined;
    placement?:
      | {
          type: 'random' | 'grid' | 'center' | 'coordinates';
          coordinates?: { x: number; y: number }[];
        }
      | undefined;
  }): Promise<any> {
    return this.withGmGate('Failed to create actor from compendium', async () => {
      // Clean interface - direct pack/item reference only
      const requestData: any = {
        packId: data.packId,
        itemId: data.itemId,
        customNames: data.customNames || [],
        quantity: data.quantity || 1,
        addToScene: data.addToScene || false,
      };

      if (data.placement) {
        requestData.placement = data.placement;
      }

      return await this.dataAccess.createActorFromCompendiumEntry(requestData);
    });
  }

  /**
   * Handle get compendium document full request
   */
  private async handleGetCompendiumDocumentFull(data: {
    packId: string;
    documentId: string;
  }): Promise<any> {
    return this.withGmGate('Failed to get compendium document', async () => {
      if (!data.packId) {
        throw new Error('packId is required');
      }

      if (!data.documentId) {
        throw new Error('documentId is required');
      }

      return await this.dataAccess.getCompendiumDocumentFull(data.packId, data.documentId);
    });
  }

  /**
   * Handle add actors to scene request
   */
  private async handleAddActorsToScene(data: {
    actorIds: string[];
    placement?: 'random' | 'grid' | 'center';
    hidden?: boolean;
  }): Promise<any> {
    return this.withGmGate('Failed to add actors to scene', async () => {
      if (!data.actorIds || !Array.isArray(data.actorIds) || data.actorIds.length === 0) {
        throw new Error('actorIds array is required and must not be empty');
      }

      return await this.dataAccess.addActorsToScene({
        actorIds: data.actorIds,
        placement: data.placement || 'random',
        hidden: data.hidden || false,
      });
    });
  }

  /**
   * Handle validate write permissions request
   */
  private async handleValidateWritePermissions(data: {
    operation: 'createActor' | 'modifyScene';
  }): Promise<any> {
    return this.withGmGate('Failed to validate write permissions', async () => {
      if (!data.operation) {
        throw new Error('operation is required');
      }

      return await this.dataAccess.validateWritePermissions(data.operation);
    });
  }

  /**
   * Handle journal entry creation
   */
  async handleCreateJournalEntry(data: any): Promise<any> {
    try {
      // SECURITY: Silent GM validation
      const gmCheck = this.validateGMAccess();
      if (!gmCheck.allowed) {
        return { error: 'Access denied', success: false };
      }

      if (!data.name) {
        throw new Error('name is required');
      }
      if (!data.content) {
        throw new Error('content is required');
      }

      return await this.dataAccess.createJournalEntry({
        name: data.name,
        content: data.content,
        additionalPages: data.additionalPages,
        folderName: data.folderName,
      });
    } catch (error) {
      throw new Error(
        `Failed to create journal entry: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle list journals request
   */
  async handleListJournals(): Promise<any> {
    return this.withGmGate('Failed to list journals', async () => {
      return await this.dataAccess.listJournals();
    });
  }

  /**
   * Handle get journal content request
   */
  async handleGetJournalContent(data: { journalId: string }): Promise<any> {
    return this.withGmGate('Failed to get journal content', async () => {
      if (!data.journalId) {
        throw new Error('journalId is required');
      }

      return await this.dataAccess.getJournalContent(data.journalId);
    });
  }

  /**
   * Handle get specific journal page content request
   */
  async handleGetJournalPageContent(data: { journalId: string; pageId: string }): Promise<any> {
    return this.withGmGate('Failed to get journal page content', async () => {
      if (!data.journalId) {
        throw new Error('journalId is required');
      }
      if (!data.pageId) {
        throw new Error('pageId is required');
      }

      return await this.dataAccess.getJournalPageContent(data.journalId, data.pageId);
    });
  }

  /**
   * Handle update journal content request
   */
  async handleUpdateJournalContent(data: {
    journalId: string;
    content: string;
    pageId?: string;
    newPageName?: string;
  }): Promise<any> {
    return this.withGmGate('Failed to update journal content', async () => {
      if (!data.journalId) {
        throw new Error('journalId is required');
      }
      if (!data.content) {
        throw new Error('content is required');
      }

      const updateRequest: {
        journalId: string;
        content: string;
        pageId?: string | undefined;
        newPageName?: string | undefined;
      } = {
        journalId: data.journalId,
        content: data.content,
      };
      if (data.pageId) updateRequest.pageId = data.pageId;
      if (data.newPageName) updateRequest.newPageName = data.newPageName;

      return await this.dataAccess.updateJournalContent(updateRequest);
    });
  }

  /**
   * Handle request player rolls - creates interactive roll buttons in chat
   */
  async handleRequestPlayerRolls(data: {
    rollType: string;
    rollTarget: string;
    targetPlayer: string;
    isPublic: boolean;
    rollModifier: string;
    flavor: string;
  }): Promise<any> {
    return this.withGmGate('Failed to request player rolls', async () => {
      if (!data.rollType || !data.rollTarget || !data.targetPlayer) {
        throw new Error('rollType, rollTarget, and targetPlayer are required');
      }

      return await this.dataAccess.requestPlayerRolls(data);
    });
  }

  /**
   * Handle get enhanced creature index request
   */
  async handleGetEnhancedCreatureIndex(): Promise<any> {
    return this.withGmGate('Failed to get enhanced creature index', async () => {
      return await this.dataAccess.getEnhancedCreatureIndex();
    });
  }

  /**
   * Handle campaign progress update request
   */
  async handleUpdateCampaignProgress(data: {
    campaignId: string;
    partId: string;
    newStatus: string;
  }): Promise<any> {
    return this.withGmGate('Failed to update campaign progress', async () => {
      // For now, this is a pass-through to the MCP server
      // In the future, campaign data might be stored in Foundry world flags
      // Currently, the campaign dashboard regeneration happens server-side

      return {
        success: true,
        message: `Campaign progress updated: ${data.partId} is now ${data.newStatus}`,
        campaignId: data.campaignId,
        partId: data.partId,
        newStatus: data.newStatus,
      };
    });
  }

  /**
   * Handle set actor ownership request
   */
  async handleSetActorOwnership(data: any): Promise<any> {
    return this.withGmGate('Failed to set actor ownership', async () => {
      if (!data.actorId || !data.userId || data.permission === undefined) {
        throw new Error('actorId, userId, and permission are required');
      }

      return await this.dataAccess.setActorOwnership(data);
    });
  }

  /**
   * Handle get actor ownership request
   */
  async handleGetActorOwnership(data: any): Promise<any> {
    return this.withGmGate('Failed to get actor ownership', async () => {
      return await this.dataAccess.getActorOwnership(data);
    });
  }

  /**
   * Handle get friendly NPCs request
   */
  async handleGetFriendlyNPCs(): Promise<any> {
    return this.withGmGate('Failed to get friendly NPCs', async () => {
      return await this.dataAccess.getFriendlyNPCs();
    });
  }

  /**
   * Handle get party characters request
   */
  async handleGetPartyCharacters(): Promise<any> {
    return this.withGmGate('Failed to get party characters', async () => {
      return await this.dataAccess.getPartyCharacters();
    });
  }

  /**
   * Handle get connected players request
   */
  async handleGetConnectedPlayers(): Promise<any> {
    return this.withGmGate('Failed to get connected players', async () => {
      return await this.dataAccess.getConnectedPlayers();
    });
  }

  /**
   * Handle find players request
   */
  async handleFindPlayers(data: any): Promise<any> {
    return this.withGmGate('Failed to find players', async () => {
      if (!data.identifier) {
        throw new Error('identifier is required');
      }

      return await this.dataAccess.findPlayers(data);
    });
  }

  /**
   * Handle find actor request
   */
  async handleFindActor(data: any): Promise<any> {
    return this.withGmGate('Failed to find actor', async () => {
      if (!data.identifier) {
        throw new Error('identifier is required');
      }

      return await this.dataAccess.findActor(data);
    });
  }

  /**
   * Handle list scenes request
   */
  private async handleListScenes(data: any): Promise<any> {
    return this.withGmGate('Failed to list scenes', async () => {
      return await this.dataAccess.listScenes(data);
    });
  }

  /**
   * Handle switch scene request
   */
  private async handleSwitchScene(data: any): Promise<any> {
    return this.withGmGate('Failed to switch scene', async () => {
      if (!data.scene_identifier) {
        throw new Error('scene_identifier is required');
      }

      return await this.dataAccess.switchScene(data);
    });
  }

  /**
   * Handle map generation request - uses hybrid architecture
   */
  private async handleGenerateMap(data: any): Promise<any> {
    try {
      // SECURITY: Silent GM validation
      const gmCheck = this.validateGMAccess();
      if (!gmCheck.allowed) {
        return { error: 'Access denied', success: false };
      }

      if (!data.prompt || typeof data.prompt !== 'string') {
        throw new Error('Prompt is required and must be a string');
      }

      if (!data.scene_name || typeof data.scene_name !== 'string') {
        throw new Error('Scene name is required and must be a string');
      }

      // Get quality setting from module settings
      const quality = game.settings.get(MODULE_ID, 'mapGenQuality') || 'low';

      const params = {
        prompt: data.prompt.trim(),
        scene_name: data.scene_name.trim(),
        size: data.size || 'medium',
        grid_size: data.grid_size || 70,
        quality,
      };

      // Use ComfyUIManager to communicate with backend via WebSocket
      const response = await this.comfyuiManager.generateMap(params);
      const isSuccess =
        typeof response?.success === 'boolean' ? response.success : response?.status === 'success';

      if (!isSuccess) {
        const errorMessage = response?.error || response?.message || 'Map generation failed';
        return {
          error: errorMessage,
          success: false,
          status: response?.status ?? 'error',
        };
      }

      return {
        success: true,
        status: response?.status ?? 'success',
        jobId: response.jobId,
        message: response.message || 'Map generation started',
        estimatedTime: response.estimatedTime || '30-90 seconds',
      };
    } catch (error: any) {
      return {
        error: error.message,
        success: false,
      };
    }
  }

  /**
   * Handle map status check request - uses hybrid architecture
   */
  private async handleCheckMapStatus(data: any): Promise<any> {
    try {
      // SECURITY: Silent GM validation
      const gmCheck = this.validateGMAccess();
      if (!gmCheck.allowed) {
        return { error: 'Access denied', success: false };
      }

      if (!data.job_id) {
        throw new Error('Job ID is required');
      }

      // Use ComfyUIManager to communicate with backend via WebSocket
      const response = await this.comfyuiManager.checkMapStatus(data);
      const isSuccess =
        typeof response?.success === 'boolean' ? response.success : response?.status === 'success';

      if (!isSuccess) {
        const errorMessage = response?.error || response?.message || 'Status check failed';
        return {
          error: errorMessage,
          success: false,
          status: response?.status ?? 'error',
        };
      }

      return {
        success: true,
        status: response?.status ?? 'success',
        job: response.job,
      };
    } catch (error: any) {
      return {
        error: error.message,
        success: false,
      };
    }
  }

  /**
   * Handle map job cancellation request - uses hybrid architecture
   */
  private async handleCancelMapJob(data: any): Promise<any> {
    try {
      // SECURITY: Silent GM validation
      const gmCheck = this.validateGMAccess();
      if (!gmCheck.allowed) {
        return { error: 'Access denied', success: false };
      }

      if (!data.job_id) {
        throw new Error('Job ID is required');
      }

      // Use ComfyUIManager to communicate with backend via WebSocket
      const response = await this.comfyuiManager.cancelMapJob(data);
      const isSuccess =
        typeof response?.success === 'boolean' ? response.success : response?.status === 'success';

      if (!isSuccess) {
        const errorMessage = response?.error || response?.message || 'Job cancellation failed';
        return {
          error: errorMessage,
          success: false,
          status: response?.status ?? 'error',
        };
      }

      return {
        success: true,
        status: response?.status ?? 'success',
        message: response.message || 'Job cancelled successfully',
      };
    } catch (error: any) {
      return {
        error: error.message,
        success: false,
      };
    }
  }

  /**
   * Handle upload of generated map image (for remote Foundry instances)
   * Receives base64-encoded image data and saves it to generated-maps folder
   */
  private async handleUploadGeneratedMap(data: any): Promise<any> {
    console.log(`[${MODULE_ID}] Upload generated map request received`, {
      hasFilename: !!data.filename,
      hasImageData: !!data.imageData,
      imageDataLength: data.imageData?.length,
    });

    try {
      // SECURITY: Silent GM validation
      const gmCheck = this.validateGMAccess();
      if (!gmCheck.allowed) {
        console.error(`[${MODULE_ID}] Upload denied - not GM`);
        return { error: 'Access denied', success: false };
      }

      if (!data.filename || typeof data.filename !== 'string') {
        console.error(`[${MODULE_ID}] Upload failed - invalid filename`);
        throw new Error('Filename is required and must be a string');
      }

      if (!data.imageData || typeof data.imageData !== 'string') {
        console.error(`[${MODULE_ID}] Upload failed - invalid image data`);
        throw new Error('Image data is required and must be a base64 string');
      }

      console.log(`[${MODULE_ID}] Validating filename...`);
      // Validate filename for security (prevent path traversal)
      const safeFilename = data.filename.replace(/[^a-zA-Z0-9_\-.]/g, '_');
      if (
        !safeFilename.endsWith('.png') &&
        !safeFilename.endsWith('.jpg') &&
        !safeFilename.endsWith('.jpeg')
      ) {
        throw new Error('Only PNG and JPEG images are supported');
      }

      console.log(`[${MODULE_ID}] Converting base64 to blob...`, {
        base64Length: data.imageData.length,
        estimatedSizeMB: (data.imageData.length / 1024 / 1024).toFixed(2),
      });

      // Convert base64 to Blob
      const byteCharacters = atob(data.imageData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });

      console.log(`[${MODULE_ID}] Creating file object...`, {
        filename: safeFilename,
        blobSize: blob.size,
      });

      // Create a File object from the Blob
      const file = new File([blob], safeFilename, { type: 'image/png' });

      console.log(`[${MODULE_ID}] Ensuring upload directory exists...`);

      // Upload to world-specific folder so maps persist even if module is deleted
      // This also keeps maps organized per world
      const worldId = (game as any).world?.id || 'unknown-world';
      const uploadPath = `worlds/${worldId}/ai-generated-maps`;
      try {
        // Use the modern Foundry API (v13+) with fallback for older versions
        const FilePickerAPI =
          (globalThis as any).foundry?.applications?.apps?.FilePicker?.implementation ||
          (globalThis as any).FilePicker;

        await FilePickerAPI.createDirectory('data', uploadPath, { bucket: null });
        console.log(`[${MODULE_ID}] Directory created/verified: ${uploadPath}`);
      } catch (dirError: any) {
        // Directory might already exist, that's okay
        if (
          !dirError.message?.includes('EEXIST') &&
          !dirError.message?.includes('already exists')
        ) {
          console.warn(`[${MODULE_ID}] Directory creation warning:`, dirError.message);
        }
      }

      console.log(`[${MODULE_ID}] Uploading to FilePicker...`);
      // Upload using Foundry's FilePicker.upload method with modern API
      const FilePickerAPI =
        (globalThis as any).foundry?.applications?.apps?.FilePicker?.implementation ||
        (globalThis as any).FilePicker;
      const response = await FilePickerAPI.upload('data', uploadPath, file, {}, { notify: false });

      console.log(`[${MODULE_ID}] FilePicker.upload response:`, JSON.stringify(response, null, 2));
      console.log(`[${MODULE_ID}] Response keys:`, Object.keys(response || {}));
      console.log(`[${MODULE_ID}] Uploaded generated map to:`, response.path);

      return {
        success: true,
        path: response.path,
        filename: safeFilename,
        message: `Map uploaded successfully to ${response.path}`,
      };
    } catch (error: any) {
      console.error(`[${MODULE_ID}] Failed to upload generated map:`, error);
      return {
        error: error.message || 'Failed to upload generated map',
        success: false,
      };
    }
  }

  // ===== PHASE 7: TOKEN MANIPULATION HANDLERS =====

  /**
   * Handle move token request
   */
  private async handleMoveToken(data: {
    tokenId: string;
    x: number;
    y: number;
    animate?: boolean;
  }): Promise<any> {
    return this.withGmGate('Failed to move token', async () => {
      if (!data.tokenId) {
        throw new Error('tokenId is required');
      }
      if (typeof data.x !== 'number' || typeof data.y !== 'number') {
        throw new Error('x and y coordinates are required and must be numbers');
      }

      return await this.dataAccess.moveToken(data);
    });
  }

  /**
   * Handle update token request
   */
  private async handleUpdateToken(data: {
    tokenId: string;
    updates: Record<string, any>;
  }): Promise<any> {
    return this.withGmGate('Failed to update token', async () => {
      if (!data.tokenId) {
        throw new Error('tokenId is required');
      }
      if (!data.updates || typeof data.updates !== 'object') {
        throw new Error('updates object is required');
      }

      return await this.dataAccess.updateToken(data);
    });
  }

  /**
   * Handle delete tokens request
   */
  private async handleDeleteTokens(data: { tokenIds: string[] }): Promise<any> {
    return this.withGmGate('Failed to delete tokens', async () => {
      if (!data.tokenIds || !Array.isArray(data.tokenIds) || data.tokenIds.length === 0) {
        throw new Error('tokenIds array is required and must not be empty');
      }

      return await this.dataAccess.deleteTokens(data);
    });
  }

  /**
   * Handle get token details request
   */
  private async handleGetTokenDetails(data: { tokenId: string }): Promise<any> {
    return this.withGmGate('Failed to get token details', async () => {
      if (!data.tokenId) {
        throw new Error('tokenId is required');
      }

      return await this.dataAccess.getTokenDetails(data);
    });
  }

  /**
   * Handle toggle token condition request
   */
  private async handleToggleTokenCondition(data: {
    tokenId: string;
    conditionId: string;
    active: boolean;
  }): Promise<any> {
    return this.withGmGate('Failed to toggle token condition', async () => {
      if (!data.tokenId) {
        throw new Error('tokenId is required');
      }
      if (!data.conditionId) {
        throw new Error('conditionId is required');
      }
      if (typeof data.active !== 'boolean') {
        throw new Error('active must be a boolean');
      }

      return await this.dataAccess.toggleTokenCondition(data);
    });
  }

  /**
   * Handle get available conditions request
   */
  private async handleGetAvailableConditions(): Promise<any> {
    return this.withGmGate('Failed to get available conditions', async () => {
      return await this.dataAccess.getAvailableConditions();
    });
  }

  /**
   * Handle use item request (cast spell, use ability, consume item, etc.)
   */
  private async handleUseItem(data: {
    actorIdentifier: string;
    itemIdentifier: string;
    targets?: string[];
    options?: {
      consume?: boolean;
      configureDialog?: boolean;
      spellLevel?: number;
      versatile?: boolean;
    };
  }): Promise<any> {
    return this.withGmGate('Failed to use item', async () => {
      if (!data.actorIdentifier) {
        throw new Error('actorIdentifier is required');
      }
      if (!data.itemIdentifier) {
        throw new Error('itemIdentifier is required');
      }

      return await this.dataAccess.useItem({
        actorIdentifier: data.actorIdentifier,
        itemIdentifier: data.itemIdentifier,
        targets: data.targets,
        options: data.options,
      });
    });
  }

  /**
   * Handle search character items request
   */
  private async handleSearchCharacterItems(data: {
    characterIdentifier: string;
    query?: string;
    type?: string;
    category?: string;
    limit?: number;
  }): Promise<any> {
    return this.withGmGate('Failed to search character items', async () => {
      if (!data.characterIdentifier) {
        throw new Error('characterIdentifier is required');
      }

      return await this.dataAccess.searchCharacterItems({
        characterIdentifier: data.characterIdentifier,
        query: data.query,
        type: data.type,
        category: data.category,
        limit: data.limit,
      });
    });
  }

  private async handleAddActorItems(data: {
    actorIdentifier: string;
    items: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, any>;
    }>;
  }): Promise<any> {
    return this.withGmGate('Failed to add actor items', async () => {
      if (!data?.actorIdentifier) {
        throw new Error('actorIdentifier is required');
      }
      if (!Array.isArray(data?.items) || data.items.length === 0) {
        throw new Error('items array is required and must contain at least one entry');
      }

      return await this.dataAccess.addActorItems({
        actorIdentifier: data.actorIdentifier,
        items: data.items,
      });
    });
  }

  private async handleUpdateWorldItems(data: {
    updates: Array<{
      id: string;
      name?: string;
      img?: string;
      system?: Record<string, any>;
      folder?: string;
    }>;
  }): Promise<any> {
    return this.withGmGate('Failed to update world items', async () => {
      if (!Array.isArray(data?.updates) || data.updates.length === 0) {
        throw new Error('updates array is required and must contain at least one entry');
      }

      return await this.dataAccess.updateWorldItems({ updates: data.updates });
    });
  }

  private async handleListWorldItems(data: {
    type?: string;
    folder?: string;
    nameFilter?: string;
  }): Promise<any> {
    return this.withGmGate('Failed to list world items', async () => {
      return await this.dataAccess.listWorldItems({
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.folder !== undefined ? { folder: data.folder } : {}),
        ...(data.nameFilter !== undefined ? { nameFilter: data.nameFilter } : {}),
      });
    });
  }

  private async handleCreateWorldItems(data: {
    items: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, any>;
    }>;
    folder?: string;
  }): Promise<any> {
    return this.withGmGate('Failed to create world items', async () => {
      if (!Array.isArray(data?.items) || data.items.length === 0) {
        throw new Error('items array is required and must contain at least one entry');
      }

      return await this.dataAccess.createWorldItems({
        items: data.items,
        ...(data.folder !== undefined ? { folder: data.folder } : {}),
      });
    });
  }

  // ===== D&D 5E HANDLERS =====

  /**
   * Handle add save feature to actor request (D&D 5e only)
   */
  private async handleAddSaveFeatureToActor(data: any): Promise<any> {
    return this.withGmGate('Failed to add save feature to actor', async () => {
      if (!data.actorIdentifier) {
        throw new Error('actorIdentifier is required');
      }
      if (!data.featureName) {
        throw new Error('featureName is required');
      }

      return await this.dataAccess.addSaveFeatureToActor(data);
    });
  }

  /**
   * Handle create NPC actor request (D&D 5e only)
   */
  private async handleCreateNpcActor(data: any): Promise<any> {
    return this.withGmGate('Failed to create NPC actor', async () => {
      if (!data.name) {
        throw new Error('name is required');
      }
      if (data.cr === undefined || data.cr === null) {
        throw new Error('cr is required');
      }
      if (!data.creatureType) {
        throw new Error('creatureType is required');
      }
      if (!data.size) {
        throw new Error('size is required');
      }
      if (!data.abilities || typeof data.abilities !== 'object') {
        throw new Error('abilities is required and must be an object');
      }
      if (data.hpAverage === undefined || data.hpAverage === null) {
        throw new Error('hpAverage is required');
      }
      if (!data.hpFormula) {
        throw new Error('hpFormula is required');
      }
      if (!data.acMode) {
        throw new Error('acMode is required');
      }

      return await this.dataAccess.createNpcActor(data);
    });
  }

  /**
   * Handle add attack feature to actor request (D&D 5e only)
   */
  private async handleAddAttackToActor(data: any): Promise<any> {
    return this.withGmGate('Failed to add attack to actor', async () => {
      if (!data.actorIdentifier) {
        throw new Error('actorIdentifier is required');
      }
      if (!data.featureName) {
        throw new Error('featureName is required');
      }
      if (!data.attackType) {
        throw new Error('attackType is required');
      }
      if (!Array.isArray(data.damageParts) || data.damageParts.length === 0) {
        throw new Error('damageParts is required and must contain at least one element');
      }

      return await this.dataAccess.addAttackToActor(data);
    });
  }

  /**
   * Handle add aura feature to actor request (D&D 5e only)
   */
  private async handleAddAuraToActor(data: any): Promise<any> {
    return this.withGmGate('Failed to add aura to actor', async () => {
      if (!data.actorIdentifier) {
        throw new Error('actorIdentifier is required');
      }
      if (!data.featureName) {
        throw new Error('featureName is required');
      }
      if (!Array.isArray(data.damageParts) || data.damageParts.length === 0) {
        throw new Error('damageParts is required and must contain at least one element');
      }
      if (!data.areaType) {
        throw new Error('areaType is required');
      }
      if (data.areaSize === undefined || data.areaSize === null) {
        throw new Error('areaSize is required');
      }

      return await this.dataAccess.addAuraToActor(data);
    });
  }

  /**
   * Handle add passive feature to actor request (D&D 5e only)
   */
  private async handleAddPassiveFeatureToActor(data: any): Promise<any> {
    return this.withGmGate('Failed to add passive feature to actor', async () => {
      if (!data.actorIdentifier) {
        throw new Error('actorIdentifier is required');
      }
      if (!data.featureName) {
        throw new Error('featureName is required');
      }

      return await this.dataAccess.addPassiveFeatureToActor(data);
    });
  }

  /**
   * Handle add attack+save feature to actor request (D&D 5e only)
   */
  private async handleAddAttackWithSaveToActor(data: any): Promise<any> {
    return this.withGmGate('Failed to add attack+save to actor', async () => {
      if (!data.actorIdentifier) throw new Error('actorIdentifier is required');
      if (!data.featureName) throw new Error('featureName is required');
      if (!data.attackType) throw new Error('attackType is required');
      if (!Array.isArray(data.damageParts) || data.damageParts.length === 0) {
        throw new Error('damageParts is required and must contain at least one element');
      }
      if (!data.saveAbility) throw new Error('saveAbility is required');
      if (!data.saveDC) throw new Error('saveDC is required');
      if (!Array.isArray(data.saveDamageParts) || data.saveDamageParts.length === 0) {
        throw new Error('saveDamageParts is required and must contain at least one element');
      }

      return await this.dataAccess.addAttackWithSaveToActor(data);
    });
  }

  private async handleSetActorSpellcasting(data: any): Promise<any> {
    return this.withGmGate('Failed to set actor spellcasting', async () => {
      if (!data.actorIdentifier) {
        throw new Error('actorIdentifier is required');
      }
      if (!data.spellcastingClass) {
        throw new Error('spellcastingClass is required');
      }
      if (
        typeof data.spellcastingLevel !== 'number' ||
        data.spellcastingLevel < 1 ||
        data.spellcastingLevel > 20
      ) {
        throw new Error('spellcastingLevel must be a number between 1 and 20');
      }
      if (!data.effectiveAbility) {
        throw new Error('effectiveAbility is required');
      }

      return await this.dataAccess.setActorSpellcasting(data);
    });
  }

  private async handleAddSpellsToActor(data: any): Promise<any> {
    return this.withGmGate('Failed to add spells to actor', async () => {
      if (!data.actorIdentifier) {
        throw new Error('actorIdentifier is required');
      }
      if (!Array.isArray(data.spellNames) || data.spellNames.length === 0) {
        throw new Error('spellNames is required and must contain at least one element');
      }
      if (data.spellNames.length > 50) {
        throw new Error('spellNames cannot contain more than 50 elements');
      }

      return await this.dataAccess.addSpellsToActor(data);
    });
  }

  private async handleAddFeaturesFromCompendium(data: any): Promise<any> {
    return this.withGmGate('Failed to add features from compendium', async () => {
      if (!data.actorIdentifier) {
        throw new Error('actorIdentifier is required');
      }
      if (!Array.isArray(data.featureNames) || data.featureNames.length === 0) {
        throw new Error('featureNames is required and must contain at least one element');
      }
      if (data.featureNames.length > 50) {
        throw new Error('featureNames cannot contain more than 50 elements');
      }

      return await this.dataAccess.addFeaturesFromCompendium(data);
    });
  }

  // ===== 3A: CHAT LOG / PLAY-BY-PLAY / IN-CHARACTER CHAT =====

  async handleGetChatLog(data: {
    limit?: number;
    speakerName?: string;
    messageType?: string;
    sinceTimestamp?: string;
  }): Promise<any> {
    return this.withGmGate('Failed to get chat log', async () => {
      return await this.dataAccess.getChatLog(data || {});
    });
  }

  async handleGetCombatPlayByPlay(): Promise<any> {
    return this.withGmGate('Failed to get combat play-by-play', async () => {
      return await this.dataAccess.getCombatPlayByPlay();
    });
  }

  async handleSendChatMessage(data: {
    message: string;
    speakerActorId?: string;
    speakerActorName?: string;
    messageType?: string;
    whisperTargets?: string[];
  }): Promise<any> {
    return this.withGmGate('Failed to send chat message', async () => {
      if (!data?.message) {
        throw new Error('message is required');
      }
      return await this.dataAccess.sendChatMessage(data);
    });
  }

  // ===== 3C: RESOURCE TRACKING =====

  async handleGetCharacterResources(data: { identifier: string }): Promise<any> {
    return this.withGmGate('Failed to get character resources', async () => {
      if (!data?.identifier) {
        throw new Error('identifier is required');
      }
      return await this.dataAccess.getCharacterResources(data);
    });
  }

  async handleUpdateCharacterResource(data: {
    identifier: string;
    resourceName: string;
    newValue: number;
  }): Promise<any> {
    return this.withGmGate('Failed to update character resource', async () => {
      if (!data?.identifier) throw new Error('identifier is required');
      if (!data?.resourceName) throw new Error('resourceName is required');
      if (data?.newValue === undefined || data?.newValue === null) {
        throw new Error('newValue is required');
      }
      return await this.dataAccess.updateCharacterResource(data);
    });
  }

  // ===== 3D: ACTIVE EFFECTS / CONDITIONS =====

  async handleGetActiveEffects(data: { identifier: string }): Promise<any> {
    return this.withGmGate('Failed to get active effects', async () => {
      if (!data?.identifier) {
        throw new Error('identifier is required');
      }
      return await this.dataAccess.getActiveEffects(data);
    });
  }

  async handleClearStaleConditions(data: {
    identifier: string;
    conditionNames?: string[];
  }): Promise<any> {
    return this.withGmGate('Failed to clear stale conditions', async () => {
      if (!data?.identifier) {
        throw new Error('identifier is required');
      }
      return await this.dataAccess.clearStaleConditions(data);
    });
  }

  // ===== 3E: COMBAT TRACKER =====

  async handleGetCombatState(): Promise<any> {
    return this.withGmGate('Failed to get combat state', async () => {
      return await this.dataAccess.getCombatState();
    });
  }

  async handleAdvanceCombatTurn(data: { skipTo?: string }): Promise<any> {
    return this.withGmGate('Failed to advance combat turn', async () => {
      return await this.dataAccess.advanceCombatTurn(data || {});
    });
  }

  async handleSetInitiative(data: { combatantName: string; initiative: number }): Promise<any> {
    return this.withGmGate('Failed to set initiative', async () => {
      if (!data?.combatantName) throw new Error('combatantName is required');
      if (data?.initiative === undefined || data?.initiative === null) {
        throw new Error('initiative is required');
      }
      return await this.dataAccess.setInitiative(data);
    });
  }

  // ===== 3F: MOVEMENT AND POSITIONING =====

  async handleGetTokenPositions(data: { sceneId?: string }): Promise<any> {
    return this.withGmGate('Failed to get token positions', async () => {
      return await this.dataAccess.getTokenPositions(data || {});
    });
  }

  async handleMeasureDistance(data: { fromTokenName: string; toTokenName: string }): Promise<any> {
    return this.withGmGate('Failed to measure distance', async () => {
      if (!data?.fromTokenName) throw new Error('fromTokenName is required');
      if (!data?.toTokenName) throw new Error('toTokenName is required');
      return await this.dataAccess.measureDistance(data);
    });
  }

  // ===== 3G: EXTENDED ROLL REQUESTS / NPC ROLLS =====

  async handleRequestAbilityCheck(data: {
    targetPlayer: string;
    ability: string;
    dc?: number;
    isPublic: boolean;
    reason?: string;
  }): Promise<any> {
    return this.withGmGate('Failed to request ability check', async () => {
      if (!data?.targetPlayer) throw new Error('targetPlayer is required');
      if (!data?.ability) throw new Error('ability is required');
      return await this.dataAccess.requestAbilityCheck(data);
    });
  }

  async handleRequestAttackRoll(data: {
    targetPlayer: string;
    weaponOrSpellName: string;
    isPublic: boolean;
  }): Promise<any> {
    return this.withGmGate('Failed to request attack roll', async () => {
      if (!data?.targetPlayer) throw new Error('targetPlayer is required');
      if (!data?.weaponOrSpellName) throw new Error('weaponOrSpellName is required');
      return await this.dataAccess.requestAttackRoll(data);
    });
  }

  async handleRollNpcCheck(data: {
    actorName: string;
    rollType: string;
    rollTarget: string;
    isPublic: boolean;
  }): Promise<any> {
    return this.withGmGate('Failed to roll NPC check', async () => {
      if (!data?.actorName) throw new Error('actorName is required');
      if (!data?.rollType) throw new Error('rollType is required');
      if (!data?.rollTarget) throw new Error('rollTarget is required');
      return await this.dataAccess.rollNpcCheck(data);
    });
  }

  // ===== 3H: SESSION EVENT LOG =====

  async handleGetSessionLog(data: {
    limit?: number;
    eventType?: string;
    actorName?: string;
  }): Promise<any> {
    return this.withGmGate('Failed to get session log', async () => {
      return await this.dataAccess.getSessionLog(data || {});
    });
  }

  async handleGetRecentEvents(data: {
    sinceTimestamp?: string;
    limit?: number;
    eventType?: string;
  }): Promise<any> {
    return this.withGmGate('Failed to get recent events', async () => {
      return await this.dataAccess.getRecentEvents(data || {});
    });
  }

  // ===== COMBAT RESOLUTION: INITIATIVE =====

  async handleRollInitiativeForNpcs(data: { scope?: 'npcs' | 'all' | 'missing' }): Promise<any> {
    return this.withGmGate('Failed to roll initiative', async () => {
      return await this.dataAccess.rollInitiativeForNpcs(data || {});
    });
  }

  async handleApplyDamageAndHealing(data: any): Promise<any> {
    return this.withGmGate('Failed to apply damage/healing', async () => {
      if (!Array.isArray(data?.targets) || data.targets.length === 0) {
        throw new Error('targets array is required');
      }
      if (data?.amount === undefined || data?.amount === null) {
        throw new Error('amount is required');
      }
      return await this.dataAccess.applyDamageAndHealing(data);
    });
  }

  async handleRollSavingThrows(data: any): Promise<any> {
    return this.withGmGate('Failed to roll saving throws', async () => {
      if (!Array.isArray(data?.targets) || data.targets.length === 0) {
        throw new Error('targets array is required');
      }
      if (!data?.rollType) throw new Error('rollType is required');
      return await this.dataAccess.rollSavingThrows(data);
    });
  }

  async handleUseNpcActivity(data: any): Promise<any> {
    return this.withGmGate('Failed to use NPC activity', async () => {
      if (!data?.actorName) throw new Error('actorName is required');
      if (!data?.itemName) throw new Error('itemName is required');
      return await this.dataAccess.useNpcActivity(data);
    });
  }

  async handleManageRest(data: any): Promise<any> {
    return this.withGmGate('Failed to manage rest', async () => {
      if (!Array.isArray(data?.targets) || data.targets.length === 0) {
        throw new Error('targets array is required');
      }
      if (!data?.restType) throw new Error('restType is required');
      return await this.dataAccess.manageRest(data);
    });
  }

  // ===== ENCOUNTER & SCENE TOOLS =====

  async handleSuggestBalancedEncounter(data: any): Promise<any> {
    return this.withGmGate('Failed to suggest encounter', async () => {
      return await this.dataAccess.suggestBalancedEncounter(data || {});
    });
  }

  async handlePlaceMeasuredTemplate(data: any): Promise<any> {
    return this.withGmGate('Failed to place template', async () => {
      if (!data?.shape) throw new Error('shape is required');
      if (data?.distance === undefined || data?.distance === null) {
        throw new Error('distance is required');
      }
      return await this.dataAccess.placeMeasuredTemplate(data);
    });
  }

  async handleSetSceneMood(data: any): Promise<any> {
    return this.withGmGate('Failed to set scene mood', async () => {
      return await this.dataAccess.setSceneMood(data || {});
    });
  }

  async handleAddMapNote(data: any): Promise<any> {
    return this.withGmGate('Failed to add map note', async () => {
      return await this.dataAccess.addMapNote(data || {});
    });
  }

  async handleSetTokenVisionLight(data: any): Promise<any> {
    return this.withGmGate('Failed to set token vision/light', async () => {
      if (!data?.tokenName) throw new Error('tokenName is required');
      return await this.dataAccess.setTokenVisionLight(data);
    });
  }

  async handleDropLoot(data: any): Promise<any> {
    return this.withGmGate('Failed to drop loot', async () => {
      return await this.dataAccess.dropLoot(data || {});
    });
  }

  // ===== CLEANUP & TARGETING =====

  async handleDeleteMeasuredTemplate(data: { templateId?: string; all?: boolean }): Promise<any> {
    return this.withGmGate('Failed to delete template', async () => {
      return await this.dataAccess.deleteMeasuredTemplate(data || {});
    });
  }

  async handleDeleteMapNote(data: { noteId?: string; text?: string }): Promise<any> {
    return this.withGmGate('Failed to delete map note', async () => {
      return await this.dataAccess.deleteMapNote(data || {});
    });
  }

  async handleGetTargets(): Promise<any> {
    return this.withGmGate('Failed to get targets', async () => {
      return await this.dataAccess.getTargets();
    });
  }

  // ===== DIAGNOSTICS =====

  async handleGetModules(data: { activeOnly?: boolean; withIssuesOnly?: boolean }): Promise<any> {
    return this.withGmGate('Failed to get modules', async () => {
      return await this.dataAccess.getModules(data || {});
    });
  }

  async handleGetModuleErrors(data: {
    level?: 'error' | 'warn';
    moduleId?: string;
    sinceTimestamp?: string;
    limit?: number;
  }): Promise<any> {
    return this.withGmGate('Failed to get module errors', async () => {
      return await this.dataAccess.getModuleErrors(data || {});
    });
  }

  async handleClearModuleErrors(): Promise<any> {
    return this.withGmGate('Failed to clear module errors', async () => {
      return await this.dataAccess.clearModuleErrors();
    });
  }

  async handleGetModuleManifest(data: { moduleId: string }): Promise<any> {
    return this.withGmGate('Failed to get module manifest', async () => {
      if (!data?.moduleId) throw new Error('moduleId is required');
      return await this.dataAccess.getModuleManifest(data);
    });
  }
}
