import { MODULE_ID, ERROR_MESSAGES } from '../constants.js';
import * as shared from './shared.js';

/** Outcome of resolving a roll-request target (a player user and/or character). */
interface ResolveResult {
  found: boolean;
  user?: User;
  character?: Actor;
  targetName: string;
  errorType?: 'PLAYER_OFFLINE' | 'PLAYER_NOT_FOUND' | 'CHARACTER_NOT_FOUND';
  errorMessage?: string;
}

/**
 * Player-roll-request + roll-button lifecycle domain.
 *
 * The flow: an AI-issued roll request resolves a target player/character, builds
 * a dnd5e roll formula, and posts a chat message carrying a clickable roll
 * button (state stored in the message's module flags). Players click the button
 * (handled live in {@link attachRollButtonHandlers}); the message is then
 * rewritten to a "completed" state, relayed through an online GM over the socket
 * when the clicking player lacks update permission.
 */
export class PlayerRollsDataAccess {
  /** Per-button "currently rolling" guard, mutated only by the live click handler. */
  private rollButtonProcessingStates: Map<string, boolean> = new Map();

  // ===========================================================================
  // Roll requests
  // ===========================================================================

  /**
   * Resolve a target player/character, build the roll formula + button, and post
   * it as a chat message (public → visible to all; private → whispered to the
   * target player and all active GMs). Returns a structured `{ success, message,
   * error? }` (never throws) so the MCP layer can surface a clear reason.
   */
  async requestPlayerRolls(data: {
    rollType: string;
    rollTarget: string;
    targetPlayer: string;
    isPublic: boolean;
    rollModifier: string;
    flavor: string;
  }): Promise<{ success: boolean; message: string; error?: string }> {
    shared.validateFoundryState();

    try {
      const playerInfo = this.resolveTargetPlayer(data.targetPlayer);
      if (!playerInfo.found) {
        return {
          success: false,
          message: '',
          error:
            playerInfo.errorMessage || `Could not find player or character: ${data.targetPlayer}`,
        };
      }

      const rollFormula = this.buildRollFormula(
        data.rollType,
        data.rollTarget,
        data.rollModifier,
        playerInfo.character
      );
      const buttonId = foundry.utils.randomID();
      const buttonLabel = this.buildRollButtonLabel(data.rollType, data.rollTarget, data.isPublic);

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

      // Public → visible to all (empty whisper). Private → target player + GMs.
      const whisperTargets = data.isPublic ? [] : this.collectWhisperTargets(playerInfo.user?.id);

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
                rollFormula,
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
      this.saveRollButtonMessageId(buttonId, chatMessage.id);

      // Click handlers are attached globally via the renderChatMessageHTML hook
      // in main.ts, so every client wires them up when it renders the message.
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

  /** Convenience wrapper: request an ability check, folding reason + DC into the flavor. */
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

  /** Convenience wrapper: request an attack roll for a named weapon/spell. */
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

  /**
   * Roll a check directly for a GM-controlled actor (no player button) and post
   * the result. Attacks read the matched item's `labels.toHit`; everything else
   * uses {@link buildRollFormula} against the actor's roll data.
   */
  async rollNpcCheck(data: {
    actorName: string;
    rollType: string;
    rollTarget: string;
    isPublic: boolean;
  }): Promise<any> {
    shared.validateFoundryState();

    const actor = shared.findActorByIdentifier(data.actorName);
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
      const toHit = item?.labels?.toHit;
      if (toHit && typeof toHit === 'string') {
        const trimmed = toHit.replace(/\s+/g, '');
        bonus = trimmed.startsWith('+') || trimmed.startsWith('-') ? trimmed : `+${trimmed}`;
      }
      formula = `1d20${bonus}`;
    } else {
      formula = this.buildRollFormula(data.rollType, data.rollTarget, '', actor);
    }

    const RollCls: any = (globalThis as any).Roll;
    const roll = new RollCls(formula, actor.getRollData());
    await roll.evaluate();

    const speaker = (ChatMessage as any).getSpeaker({ actor });
    const modes: any = (CONST as any).DICE_ROLL_MODES || {};
    const rollMode = data.isPublic ? (modes.PUBLIC ?? 'publicroll') : (modes.PRIVATE ?? 'gmroll');

    await roll.toMessage(
      { speaker, flavor: `${data.rollTarget} (${data.rollType})` },
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
  // Live DOM click handlers (verified live, not in the in-memory harness)
  // ===========================================================================

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
    const onRollButtonClick = async (event: any): Promise<void> => {
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
          rollMode,
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
    };
    html.find('.mcp-roll-button').on('click', (event: any) => void onRollButtonClick(event));
  }

  // ===========================================================================
  // Roll-button state + message persistence
  // ===========================================================================

  /**
   * LEGACY: persist a button's rolled state. Redirects to the modern
   * {@link updateRollButtonMessage} path; failures are swallowed (never throws)
   * to avoid breaking the legacy callers.
   */
  async saveRollState(buttonId: string, userId: string): Promise<void> {
    try {
      const rollLabel = 'Legacy Roll'; // No label available here; use a generic one.
      await this.updateRollButtonMessage(buttonId, userId, rollLabel);
    } catch (error) {
      console.error(`[${MODULE_ID}] Legacy saveRollState redirect failed:`, error);
      // Don't throw — we don't want to break the old system completely.
    }
  }

  /** Read a button's persisted roll state from settings, or null. */
  getRollState(
    buttonId: string
  ): { rolled: boolean; rolledBy?: string; rolledByName?: string; timestamp?: number } | null {
    shared.validateFoundryState();

    try {
      const rollStates = game.settings.get(MODULE_ID, 'rollStates') || {};
      return rollStates[buttonId] || null;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting roll state:`, error);
      return null;
    }
  }

  /** Persist a buttonId → messageId mapping (so the message can be rewritten later). */
  saveRollButtonMessageId(buttonId: string, messageId: string): void {
    try {
      const buttonMessageMap = game.settings.get(MODULE_ID, 'buttonMessageMap') || {};
      buttonMessageMap[buttonId] = messageId;
      void game.settings.set(MODULE_ID, 'buttonMessageMap', buttonMessageMap);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error saving button-message mapping:`, error);
    }
  }

  /** Look up the message id mapped to a roll button, or null. */
  getRollButtonMessageId(buttonId: string): string | null {
    try {
      const buttonMessageMap = game.settings.get(MODULE_ID, 'buttonMessageMap') || {};
      return buttonMessageMap[buttonId] || null;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting button-message mapping:`, error);
      return null;
    }
  }

  /** Read a button's roll state from a chat message's module flags, or null. */
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
   * Rewrite a roll-request message to its completed state (content + flags). When
   * the current user is a non-GM who cannot modify the message, relay the request
   * to an online GM over the socket instead (throwing if no GM is online).
   */
  async updateRollButtonMessage(
    buttonId: string,
    userId: string,
    rollLabel: string
  ): Promise<void> {
    try {
      const messageId = this.getRollButtonMessageId(buttonId);
      if (!messageId) {
        throw new Error(`No message ID found for button ${buttonId}`);
      }

      const chatMessage = game.messages?.get(messageId);
      if (!chatMessage) {
        throw new Error(`ChatMessage ${messageId} not found`);
      }

      const rolledByName = game.users?.get(userId)?.name || 'Unknown';
      const timestamp = new Date().toLocaleString();

      // Non-GM users who can't modify the message relay it to an online GM.
      const canUpdate = chatMessage.canUserModify(game.user, 'update');
      if (!canUpdate && !game.user?.isGM) {
        const onlineGM = game.users?.find(u => u.isGM && u.active);
        if (!onlineGM) {
          throw new Error('No Game Master is online to update the chat message');
        }
        if (!game.socket) {
          throw new Error('Socket not available for GM communication');
        }
        game.socket.emit('module.foundry-mcp-bridge', {
          type: 'requestMessageUpdate',
          buttonId,
          userId,
          rollLabel,
          messageId,
          fromUserId: game.user.id,
          targetGM: onlineGM.id,
        });
        return; // GM will perform the update.
      }

      // Mark the button rolled in the message flags.
      const currentFlags = chatMessage.flags || {};
      const moduleFlags = currentFlags[MODULE_ID] || {};
      const rollButtons = moduleFlags.rollButtons || {};
      rollButtons[buttonId] = {
        ...rollButtons[buttonId],
        rolled: true,
        rolledBy: userId,
        rolledByName,
        timestamp: Date.now(),
      };

      const rolledHtml = `
        <div class="mcp-roll-request" style="margin: 10px 0; padding: 10px; border: 1px solid #ccc; border-radius: 5px; background: #f9f9f9;">
          <p><strong>Roll Request:</strong> ${rollLabel}</p>
          <p><strong>Status:</strong> ✅ <strong>Completed by ${rolledByName}</strong> at ${timestamp}</p>
        </div>
      `;

      await chatMessage.update({
        content: rolledHtml,
        flags: {
          ...currentFlags,
          [MODULE_ID]: {
            ...moduleFlags,
            rollButtons,
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
   * LEGACY: request a GM to save roll state (for non-GM users). Redirects to
   * {@link updateRollButtonMessage}; fire-and-forget (returns void, logs on fail).
   */
  requestRollStateSave(buttonId: string, userId: string): void {
    try {
      const rollLabel = 'Legacy Roll'; // No label available here; use a generic one.
      this.updateRollButtonMessage(buttonId, userId, rollLabel)
        .then(() => {})
        .catch(error => {
          console.error(`[${MODULE_ID}] Legacy requestRollStateSave redirect failed:`, error);
        });
    } catch (error) {
      console.error(`[${MODULE_ID}] Error in legacy requestRollStateSave redirect:`, error);
    }
  }

  /**
   * LEGACY: no-op. ChatMessage.update() already broadcasts to every client, so
   * an explicit roll-state broadcast is no longer needed.
   */
  broadcastRollState(_buttonId: string, _rollState: any): void {
    // Intentionally empty — superseded by ChatMessage.update() auto-sync.
  }

  /**
   * Prune roll states older than 30 days from settings to prevent storage bloat.
   * Returns the number of entries removed.
   */
  async cleanOldRollStates(): Promise<number> {
    shared.validateFoundryState();

    try {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const rollStates = game.settings.get(MODULE_ID, 'rollStates') || {};
      let cleanedCount = 0;

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

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Resolve a roll-request target to a player user and/or character. Resolution
   * order: a user by name (exact, then partial) → a player-owned character by
   * name (exact, then partial) → any character with no player owner (GM rolls it)
   * → not found. Offline players resolve to a structured PLAYER_OFFLINE error.
   */
  private resolveTargetPlayer(targetPlayer: string): ResolveResult {
    const searchTerm = targetPlayer.toLowerCase().trim();
    const allUsers = Array.from(game.users?.values() || []);

    // 1) Registered user by name (exact wins over partial).
    const userByName =
      allUsers.find((u: User) => u.name?.toLowerCase() === searchTerm) ??
      allUsers.find((u: User) => Boolean(u.name?.toLowerCase().includes(searchTerm)));
    if (userByName) {
      return this.resultForUser(userByName);
    }

    // 2) Player-owned character by name (exact wins over partial).
    const character =
      game.actors?.find(
        (actor: Actor) => actor.name?.toLowerCase() === searchTerm && actor.hasPlayerOwner
      ) ??
      game.actors?.find((actor: Actor) =>
        Boolean(actor.name?.toLowerCase().includes(searchTerm) && actor.hasPlayerOwner)
      );
    if (character) {
      const ownerUser = allUsers.find(
        (u: User) => character.testUserPermission(u, 'OWNER') && !u.isGM
      );
      if (ownerUser) {
        if (!ownerUser.active) {
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
      }
      // No (non-GM) player owner — the GM can still roll for this character.
      return {
        found: true,
        character,
        targetName: character.name || 'Unknown Character',
      };
    }

    // 3) Any character that exists but has no player owner at all.
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
      };
    }

    // 4) Nothing matched.
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

  /** Resolve a matched user: PLAYER_OFFLINE when inactive, else found (with owned character). */
  private resultForUser(user: User): ResolveResult {
    if (!user.active) {
      return {
        found: false,
        user,
        targetName: user.name || 'Unknown Player',
        errorType: 'PLAYER_OFFLINE',
        errorMessage: `Player "${user.name}" is registered but not currently logged in. They need to be online to receive roll requests.`,
      };
    }
    // The user's owned character (non-GM), if any — drives roll-data lookups.
    const playerCharacter = game.actors?.find(
      (actor: Actor) => actor.testUserPermission(user, 'OWNER') && !user.isGM
    );
    return {
      found: true,
      user,
      ...(playerCharacter && { character: playerCharacter }),
      targetName: user.name || 'Unknown Player',
    };
  }

  /** Whisper recipients for a private roll: the target user (if any) + all active GMs. */
  private collectWhisperTargets(targetUserId?: string | null): string[] {
    const targets: string[] = [];
    if (targetUserId) {
      targets.push(targetUserId);
    }
    const gmUsers = game.users?.filter((u: User) => u.isGM && u.active);
    if (gmUsers) {
      for (const gm of gmUsers) {
        if (gm.id && !targets.includes(gm.id)) {
          targets.push(gm.id);
        }
      }
    }
    return targets;
  }

  /**
   * Build a `1d20`-based roll formula for the given roll type against a
   * character's roll data (dnd5e). Modifiers are coerced to finite numbers
   * (dnd5e v5 turned some flat fields into objects) and signed; an explicit
   * `rollModifier` is appended last.
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
      // Foundry's getRollData() gives calculated modifiers (incl. active effects).
      const rollData = character.getRollData() as any;

      switch (rollType) {
        case 'ability': {
          const abilityMod = toMod(rollData.abilities?.[rollTarget]?.mod);
          baseFormula = `1d20${signed(abilityMod)}`;
          break;
        }

        case 'skill': {
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

    if (rollModifier?.trim()) {
      const modifier =
        rollModifier.startsWith('+') || rollModifier.startsWith('-')
          ? rollModifier
          : `+${rollModifier}`;
      baseFormula += modifier;
    }

    return baseFormula;
  }

  /** Map a (possibly spaced) D&D 5e skill name to its 3-letter code. */
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
    return skillMap[normalizedName] || skillMap[skillName.toLowerCase()] || skillName.toLowerCase();
  }

  /** Human-readable button label for a roll request. */
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

  /** Whether a roll button is mid-roll (guards against concurrent clicks). */
  private isRollButtonProcessing(buttonId: string): boolean {
    return this.rollButtonProcessingStates.get(buttonId) || false;
  }

  /** Set/clear a roll button's "currently rolling" guard. */
  private setRollButtonProcessing(buttonId: string, processing: boolean): void {
    if (processing) {
      this.rollButtonProcessingStates.set(buttonId, true);
    } else {
      this.rollButtonProcessingStates.delete(buttonId);
    }
  }
}
