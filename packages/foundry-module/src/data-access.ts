import { MODULE_ID, ERROR_MESSAGES } from './constants.js';
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
