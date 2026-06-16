import { MODULE_ID } from './constants.js';
import { permissionManager } from './permissions.js';
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
import { ActorCreationDataAccess } from './data-access/actor-creation.js';
import { ActorBuilderDataAccess } from './data-access/actor-builder.js';
import { PlayerRollsDataAccess } from './data-access/player-rolls.js';
import type {
  CharacterInfo,
  CompendiumSearchResult,
  SceneInfo,
  WorldInfo,
  ActorCreationRequest,
  ActorCreationResult,
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
  private actorCreation = new ActorCreationDataAccess(this.compendium);
  private actorBuilder = new ActorBuilderDataAccess();
  private playerRolls = new PlayerRollsDataAccess();

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

  async createActorFromCompendium(request: ActorCreationRequest): Promise<ActorCreationResult> {
    return this.actorCreation.createActorFromCompendium(request);
  }

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
    return this.actorCreation.createActorFromCompendiumEntry(request);
  }

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
    return this.actorCreation.addActorItems(params);
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

  async addActorsToScene(
    placement: SceneTokenPlacement,
    transactionId?: string
  ): Promise<TokenPlacementResult> {
    return this.actorCreation.addActorsToScene(placement, transactionId);
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

  async requestPlayerRolls(data: {
    rollType: string;
    rollTarget: string;
    targetPlayer: string;
    isPublic: boolean;
    rollModifier: string;
    flavor: string;
  }): Promise<{ success: boolean; message: string; error?: string }> {
    return this.playerRolls.requestPlayerRolls(data);
  }

  /**
   * Restore roll button states from persistent storage
   * Called when chat messages are rendered to maintain state across sessions
   */

  public attachRollButtonHandlers(html: JQuery): void {
    this.playerRolls.attachRollButtonHandlers(html);
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

  async saveRollState(buttonId: string, userId: string): Promise<void> {
    return this.playerRolls.saveRollState(buttonId, userId);
  }

  getRollState(
    buttonId: string
  ): { rolled: boolean; rolledBy?: string; rolledByName?: string; timestamp?: number } | null {
    return this.playerRolls.getRollState(buttonId);
  }

  saveRollButtonMessageId(buttonId: string, messageId: string): void {
    return this.playerRolls.saveRollButtonMessageId(buttonId, messageId);
  }

  getRollButtonMessageId(buttonId: string): string | null {
    return this.playerRolls.getRollButtonMessageId(buttonId);
  }

  getRollStateFromMessage(chatMessage: any, buttonId: string): any {
    return this.playerRolls.getRollStateFromMessage(chatMessage, buttonId);
  }

  async updateRollButtonMessage(
    buttonId: string,
    userId: string,
    rollLabel: string
  ): Promise<void> {
    return this.playerRolls.updateRollButtonMessage(buttonId, userId, rollLabel);
  }

  requestRollStateSave(buttonId: string, userId: string): void {
    return this.playerRolls.requestRollStateSave(buttonId, userId);
  }

  broadcastRollState(_buttonId: string, _rollState: any): void {
    return this.playerRolls.broadcastRollState(_buttonId, _rollState);
  }

  async cleanOldRollStates(): Promise<number> {
    return this.playerRolls.cleanOldRollStates();
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

  async useItem(params: {
    actorIdentifier: string;
    itemIdentifier: string;
    targets?: string[] | undefined;
    options?:
      | {
          consume?: boolean | undefined;
          configureDialog?: boolean | undefined;
          skipDialog?: boolean | undefined;
          spellLevel?: number | undefined;
          versatile?: boolean | undefined;
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
    return this.actorBuilder.useItem(params);
  }

  // ===== D&D 5E FEATURE CREATION =====

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
    return this.actorBuilder.addSaveFeatureToActor(data);
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
    return this.actorBuilder.createNpcActor(data);
  }

  // ---------------------------------------------------------------------------
  // Add weapon attack to an existing actor (dnd5e-add-attack-feature)
  // ---------------------------------------------------------------------------

  async addAttackToActor(data: any): Promise<any> {
    return this.actorBuilder.addAttackToActor(data);
  }

  // ---------------------------------------------------------------------------
  // Add automatic-damage aura/emanation feature to an existing actor
  // (dnd5e-add-aura-feature)
  // ---------------------------------------------------------------------------

  async addAuraToActor(data: any): Promise<any> {
    return this.actorBuilder.addAuraToActor(data);
  }

  // ---------------------------------------------------------------------------
  // Add passive/descriptive feature to an existing actor (dnd5e-add-passive-feature)
  // No activities, no mechanics — pure description displayed on the sheet.
  // ---------------------------------------------------------------------------

  async addPassiveFeatureToActor(data: any): Promise<any> {
    return this.actorBuilder.addPassiveFeatureToActor(data);
  }

  // ---------------------------------------------------------------------------
  // Add weapon attack + save effect to an existing actor
  // (dnd5e-add-attack-with-save) — Tipo B
  // Two activities: attack (sort:0) + save (sort:1)
  // ---------------------------------------------------------------------------

  async addAttackWithSaveToActor(data: any): Promise<any> {
    return this.actorBuilder.addAttackWithSaveToActor(data);
  }

  // ---------------------------------------------------------------------------
  // Set actor spellcasting (ability + slot counts)
  // ---------------------------------------------------------------------------

  async setActorSpellcasting(data: any): Promise<any> {
    return this.actorBuilder.setActorSpellcasting(data);
  }

  // ---------------------------------------------------------------------------
  // Add spells from compendium packs to an actor
  // ---------------------------------------------------------------------------

  async addSpellsToActor(data: any): Promise<any> {
    return this.actorBuilder.addSpellsToActor(data);
  }

  // ---------------------------------------------------------------------------
  // Add features from compendium packs to an actor
  // ---------------------------------------------------------------------------

  async addFeaturesFromCompendium(data: any): Promise<any> {
    return this.actorBuilder.addFeaturesFromCompendium(data);
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
    return this.playerRolls.requestAbilityCheck(data);
  }

  async requestAttackRoll(data: {
    targetPlayer: string;
    weaponOrSpellName: string;
    isPublic: boolean;
  }): Promise<any> {
    return this.playerRolls.requestAttackRoll(data);
  }

  async rollNpcCheck(data: {
    actorName: string;
    rollType: string;
    rollTarget: string;
    isPublic: boolean;
  }): Promise<any> {
    return this.playerRolls.rollNpcCheck(data);
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

  async useNpcActivity(data: {
    actorName: string;
    itemName: string;
    targetAC?: number;
    isPublic?: boolean;
  }): Promise<any> {
    return this.actorBuilder.useNpcActivity(data);
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
